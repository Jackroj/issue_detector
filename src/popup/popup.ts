import type { RuntimeResponse } from "../shared/messaging";
import type { Finding, TimelineEvent } from "../shared/types";
import { renderDashboard } from "../shared/dashboard-ui";

const root = document.getElementById("root") as HTMLElement;
const optionsLink = document.getElementById("options-link") as HTMLAnchorElement;

optionsLink.addEventListener("click", (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

async function getActiveTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function load(): Promise<void> {
  const tabId = await getActiveTabId();
  if (tabId === undefined) {
    root.textContent = "No active tab.";
    return;
  }

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
      const response = (await chrome.runtime.sendMessage({ type: "ai:analyze", tabId, findingId })) as RuntimeResponse;
      if (response.ok && "analysis" in response) return response.analysis;
      throw new Error(!response.ok ? response.error : "AI analysis failed.");
    },
  });
}

load();
