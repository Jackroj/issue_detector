import type { DetectorSettings, Finding, TimelineEvent, TimelineEventKind } from "./types";
import type { AIAnalysis, AIProviderId } from "./ai-types";

/**
 * A "draft" finding is what detectors (content scripts, network monitor) produce.
 * The background store fills in id/tabId/occurrence bookkeeping and turns it into a Finding.
 */
export type DraftFinding = Omit<
  Finding,
  "id" | "tabId" | "occurrences" | "firstSeen" | "lastSeen"
>;

export type DraftTimelineEvent = Omit<TimelineEvent, "id" | "tabId">;

export type RuntimeMessage =
  | { type: "finding:report"; finding: DraftFinding }
  | { type: "timeline:report"; kind: TimelineEventKind; summary: string; timestamp: number }
  | { type: "findings:get"; tabId: number }
  | { type: "findings:clear"; tabId: number }
  | { type: "findings:setStatus"; tabId: number; findingId: string; status: Finding["status"] }
  | { type: "timeline:get"; tabId: number }
  | { type: "settings:get" }
  | { type: "settings:set"; settings: DetectorSettings }
  | { type: "ai:analyze"; tabId: number; findingId: string }
  | { type: "ai:checkAvailability"; provider: AIProviderId; ollamaEndpoint?: string; ollamaModel?: string }
  | { type: "monitoring:setPaused"; tabId: number; paused: boolean }
  | { type: "monitoring:getPaused"; tabId: number };

export type RuntimeResponse =
  | { ok: true; findings: Finding[] }
  | { ok: true; timeline: TimelineEvent[] }
  | { ok: true; settings: DetectorSettings }
  | { ok: true; analysis: AIAnalysis }
  | { ok: true; available: boolean; detail?: string }
  | { ok: true; paused: boolean }
  | { ok: true }
  | { ok: false; error: string };

export function sendToBackground(message: RuntimeMessage): Promise<RuntimeResponse> {
  return chrome.runtime.sendMessage(message);
}
