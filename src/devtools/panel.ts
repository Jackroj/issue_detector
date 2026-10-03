import type { RuntimeResponse } from "../shared/messaging";
import type { Finding, TimelineEvent } from "../shared/types";
import { renderDashboard } from "../shared/dashboard-ui";

const root = document.getElementById("root") as HTMLElement;
const tabId = chrome.devtools.inspectedWindow.tabId;

// Paused while an AI analysis is in flight so the periodic poll below doesn't wipe out the
// "Analyzing…" button state with a full re-render before the result comes back.
let aiInFlight = false;

async function load(): Promise<void> {
  const [findingsResponse, timelineResponse, pausedResponse] = await Promise.all([
    chrome.runtime.sendMessage({ type: "findings:get", tabId }) as Promise<RuntimeResponse>,
    chrome.runtime.sendMessage({ type: "timeline:get", tabId }) as Promise<RuntimeResponse>,
    chrome.runtime.sendMessage({ type: "monitoring:getPaused", tabId }) as Promise<RuntimeResponse>,
  ]);

  const findings: Finding[] = findingsResponse.ok && "findings" in findingsResponse ? findingsResponse.findings : [];
  const timeline: TimelineEvent[] = timelineResponse.ok && "timeline" in timelineResponse ? timelineResponse.timeline : [];
  const paused = pausedResponse.ok && "paused" in pausedResponse ? pausedResponse.paused : false;

  renderDashboard(root, { findings, timeline, paused }, {
    onRefresh: load,
    onOpenSettings: () => chrome.runtime.openOptionsPage(),
    onClear: async () => {
      await chrome.runtime.sendMessage({ type: "findings:clear", tabId });
      load();
    },
    onSetStatus: async (findingId, status) => {
      await chrome.runtime.sendMessage({ type: "findings:setStatus", tabId, findingId, status });
      load();
    },
    onTogglePause: async () => {
      await chrome.runtime.sendMessage({ type: "monitoring:setPaused", tabId, paused: !paused });
      load();
    },
    onAnalyze: async (findingId) => {
      aiInFlight = true;
      try {
        const response = (await chrome.runtime.sendMessage({ type: "ai:analyze", tabId, findingId })) as RuntimeResponse;
        if (response.ok && "analysis" in response) return response.analysis;
        throw new Error(!response.ok ? response.error : "AI analysis failed.");
      } finally {
        aiInFlight = false;
      }
    },
  });
}

/** True while focus is in a filter input/select — a full re-render would wipe out an in-progress keystroke. */
function isEditingFilter(): boolean {
  const active = document.activeElement;
  return active !== null && ["INPUT", "SELECT", "TEXTAREA"].includes(active.tagName);
}

load();
const intervalId = setInterval(() => {
  if (!aiInFlight && !isEditingFilter()) void load();
}, 1500);
window.addEventListener("unload", () => clearInterval(intervalId));
