import type { DraftFinding, RuntimeResponse } from "../shared/messaging";
import type { DetectorSettings } from "../shared/types";
import { DEFAULT_SETTINGS } from "../shared/constants";
import { installErrorListeners } from "./errors";
import { installPerformanceObservers } from "./performance";
import { installRenderingObservers } from "./rendering";
import { installLoadingAnalysis } from "./loading";

function send(draft: DraftFinding): void {
  try {
    chrome.runtime.sendMessage({ type: "finding:report", finding: draft }).catch(() => {
      // background may not be ready yet (e.g. extension just reloaded); drop silently.
    });
  } catch {
    // extension context invalidated (e.g. during an extension reload); nothing to do.
  }
}

function sendTimelineEvent(kind: "state-change", summary: string): void {
  try {
    chrome.runtime.sendMessage({ type: "timeline:report", kind, summary, timestamp: Date.now() }).catch(() => {
      // background may not be ready yet; drop silently.
    });
  } catch {
    // extension context invalidated; nothing to do.
  }
}

/** Relays the SPA pushState/replaceState/popstate signal dispatched by main-world.ts. */
function installStateChangeRelay(): void {
  window.addEventListener("__issue_detector_state__", (event: Event) => {
    const detail = (event as CustomEvent<{ reason: string }>).detail;
    sendTimelineEvent("state-change", "JS state/update event");
    void detail;
  });
}

async function getSettings(): Promise<DetectorSettings> {
  try {
    const response = (await chrome.runtime.sendMessage({ type: "settings:get" })) as RuntimeResponse;
    if (response.ok && "settings" in response) return response.settings;
  } catch {
    // fall through to defaults
  }
  return DEFAULT_SETTINGS;
}

async function main(): Promise<void> {
  const settings = await getSettings();

  installStateChangeRelay();

  if (settings.enabledCategories.javascript) {
    installErrorListeners(send);
  }
  if (settings.enabledCategories.performance) {
    installPerformanceObservers(send, settings);
    installLoadingAnalysis(send, settings);
  }
  if (settings.enabledCategories.rendering) {
    installRenderingObservers(send, settings);
  }
}

void main();
