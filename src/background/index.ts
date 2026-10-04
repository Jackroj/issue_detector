import type { DetectorSettings, Finding, FindingSeverity } from "../shared/types";
import type { RuntimeMessage, RuntimeResponse, DraftFinding, DraftTimelineEvent } from "../shared/messaging";
import { loadSettings, saveSettings } from "../shared/storage";
import { FindingStore } from "./store";
import { TimelineStore } from "./timeline";
import { NetworkMonitor } from "./network";
import { runCorrelation, buildCorrelationEvidence, severityForMatch } from "./correlate";
import { AIService } from "./ai/service";
import { hashKey } from "../shared/id";

const store = new FindingStore();
const timelineStore = new TimelineStore();
const lastStateChangeAt = new Map<number, number>();
const pausedTabs = new Set<number>();
const aiService = new AIService(store, timelineStore, () => settings);

let settings: DetectorSettings;

const settingsReady = loadSettings().then((s) => {
  settings = s;
});

const networkMonitor = new NetworkMonitor(
  reportDraft,
  reportTimeline,
  () => settings,
  (tabId) => lastStateChangeAt.get(tabId),
);

settingsReady.then(() => {
  networkMonitor.start();
});

function reportTimeline(tabId: number, draft: DraftTimelineEvent): void {
  if (pausedTabs.has(tabId)) return;
  void timelineStore.add(tabId, draft, settings.maxTimelineEventsPerTab);
}

/** Best-effort, human-scannable echo of a finding onto the timeline, in the style of the spec's example rows. */
function summarizeForTimeline(draft: DraftFinding): string {
  if (draft.groupKey === "perf:longtask:page") {
    const duration = draft.evidence.find((e) => e.label === "Duration")?.value;
    return `Long task: ${duration ?? ""}`;
  }
  return draft.title;
}

function reportDraft(tabId: number, draft: DraftFinding, opts: { skipCorrelation?: boolean } = {}): void {
  if (pausedTabs.has(tabId)) return;
  store.add(tabId, draft, settings).then((finding) => {
    void updateBadge(tabId);

    // Network events already get a precise raw entry from NetworkMonitor itself; avoid double-logging.
    if (draft.category !== "network") {
      reportTimeline(tabId, {
        kind: draft.category,
        summary: summarizeForTimeline(draft),
        timestamp: draft.timestamp,
        findingId: finding.id,
      });
    }

    if (!opts.skipCorrelation && draft.category !== "correlated") {
      void runCorrelationForTab(tabId);
    }
  });
}

async function runCorrelationForTab(tabId: number): Promise<void> {
  if (!settings.enabledCategories.correlated) return;
  const findings = await store.get(tabId);
  const now = Date.now();
  const matches = runCorrelation(findings, now, settings);

  for (const match of matches) {
    const severity: FindingSeverity = severityForMatch(match);
    reportDraft(
      tabId,
      {
        category: "correlated",
        severity,
        title: match.title,
        description: match.description,
        evidence: buildCorrelationEvidence(match),
        timestamp: now,
        confidence: match.confidence,
        possibleCauses: match.possibleCauses,
        recommendedInvestigation: match.recommendedInvestigation,
        relatedFindingIds: match.evidenceFindings.map((f) => f.id),
        groupKey: `correlated:${match.ruleId}:${hashKey(match.groupKeySeed)}`,
      },
      { skipCorrelation: true },
    );
  }
}

async function updateBadge(tabId: number): Promise<void> {
  const all = await store.get(tabId);
  const findings = all.filter((f) => (f.status ?? "open") === "open");
  if (findings.length === 0) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  const hasCritical = findings.some((f) => f.severity === "critical");
  const hasWarning = findings.some((f) => f.severity === "warning");
  await chrome.action.setBadgeText({ tabId, text: String(findings.length) });
  await chrome.action.setBadgeBackgroundColor({
    tabId,
    color: hasCritical ? "#d93025" : hasWarning ? "#f29900" : "#1a73e8",
  });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse);
  return true; // keep the message channel open for the async response
});

// TEMP DEBUG — remove after verifying the UI: lets a content script ask the background
// (which has chrome.tabs access) to open one of the extension's own pages as a normal tab,
// so it can be inspected without visiting chrome://extensions.
chrome.runtime.onMessage.addListener((message: unknown) => {
  if (typeof message === "object" && message !== null && (message as { type?: string }).type === "debug:openPage") {
    const path = (message as { path: string }).path;
    chrome.tabs.create({ url: chrome.runtime.getURL(path) });
  }
});

async function handleMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
): Promise<RuntimeResponse> {
  await settingsReady;

  switch (message.type) {
    case "finding:report": {
      const tabId = sender.tab?.id;
      if (tabId === undefined || tabId < 0) {
        return { ok: false, error: "No tab associated with sender" };
      }
      reportDraft(tabId, message.finding);
      return { ok: true };
    }
    case "timeline:report": {
      const tabId = sender.tab?.id;
      if (tabId === undefined || tabId < 0) {
        return { ok: false, error: "No tab associated with sender" };
      }
      if (message.kind === "state-change") {
        lastStateChangeAt.set(tabId, message.timestamp);
      }
      reportTimeline(tabId, { kind: message.kind, summary: message.summary, timestamp: message.timestamp });
      return { ok: true };
    }
    case "findings:get": {
      const findings = await store.get(message.tabId);
      return { ok: true, findings };
    }
    case "findings:clear": {
      await store.clear(message.tabId);
      await timelineStore.clear(message.tabId);
      await updateBadge(message.tabId);
      return { ok: true };
    }
    case "findings:setStatus": {
      await store.setStatus(message.tabId, message.findingId, message.status);
      await updateBadge(message.tabId);
      return { ok: true };
    }
    case "monitoring:setPaused": {
      if (message.paused) pausedTabs.add(message.tabId);
      else pausedTabs.delete(message.tabId);
      return { ok: true };
    }
    case "monitoring:getPaused": {
      return { ok: true, paused: pausedTabs.has(message.tabId) };
    }
    case "timeline:get": {
      const timeline = await timelineStore.get(message.tabId);
      return { ok: true, timeline };
    }
    case "settings:get": {
      return { ok: true, settings };
    }
    case "settings:set": {
      settings = message.settings;
      await saveSettings(settings);
      return { ok: true };
    }
    case "ai:analyze": {
      try {
        const analysis = await aiService.analyze(message.tabId, message.findingId);
        void updateBadge(message.tabId);
        return { ok: true, analysis };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    case "ai:checkAvailability": {
      const result = await aiService.checkAvailability(message.provider, {
        ollamaEndpoint: message.ollamaEndpoint,
        ollamaModel: message.ollamaModel,
      });
      return { ok: true, ...result };
    }
    default: {
      const _exhaustive: never = message;
      return { ok: false, error: `Unknown message: ${JSON.stringify(_exhaustive)}` };
    }
  }
}

// Reset per-tab findings on a fresh top-level navigation so the dashboard reflects the
// current page rather than accumulating across unrelated page loads.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  networkMonitor.resetTab(details.tabId);
  lastStateChangeAt.delete(details.tabId);
  Promise.all([store.clear(details.tabId), timelineStore.clear(details.tabId)]).then(() => {
    reportTimeline(details.tabId, { kind: "navigation", summary: "Page navigation", timestamp: details.timeStamp });
    void updateBadge(details.tabId);
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  networkMonitor.resetTab(tabId);
  lastStateChangeAt.delete(tabId);
  pausedTabs.delete(tabId);
  store.dropTab(tabId);
  timelineStore.dropTab(tabId);
});

export type { Finding };
