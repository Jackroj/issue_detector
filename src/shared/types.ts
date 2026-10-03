import type { AIAnalysis, AISettings } from "./ai-types";

export type FindingCategory = "network" | "javascript" | "performance" | "rendering" | "correlated";

export type FindingSeverity = "info" | "warning" | "critical";

export interface Evidence {
  label: string;
  value: string | number;
}

export interface Finding {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  title: string;
  description: string;
  evidence: Evidence[];
  timestamp: number;
  /** 0-1. Only correlated (Phase 2) findings are expected to set this meaningfully. */
  confidence?: number;
  /** Plausible explanations for a correlated finding — explicitly not asserted as root cause. */
  possibleCauses?: string[];
  /** Concrete next steps a developer can take to confirm or rule out the possible causes. */
  recommendedInvestigation?: string[];
  /** IDs of the underlying Phase 1-style findings a correlated finding was synthesized from. */
  relatedFindingIds?: string[];
  /** Cached result of the last "Analyze with AI" run, if any. */
  aiAnalysis?: AIAnalysis;
  /** Developer-set triage status. Defaults to "open" when absent. */
  status?: "open" | "ignored" | "resolved";

  /** Identifies the tab this finding was observed on. */
  tabId: number;
  /** Stable key used to group repeated/identical findings instead of spamming the list. */
  groupKey: string;
  /** Number of times this group has occurred; 1 on first occurrence. */
  occurrences: number;
  /** Timestamp of the first occurrence in this group. */
  firstSeen: number;
  /** Timestamp of the most recent occurrence in this group. */
  lastSeen: number;
}

export type TimelineEventKind =
  | "navigation"
  | "state-change"
  | "network"
  | "javascript"
  | "performance"
  | "rendering"
  | "correlated";

/**
 * A raw, non-deduplicated point-in-time event. Unlike Finding (which groups repeats into one
 * row), the timeline keeps every occurrence in order so a developer can see what happened
 * immediately before/after an issue.
 */
export interface TimelineEvent {
  id: string;
  tabId: number;
  kind: TimelineEventKind;
  summary: string;
  timestamp: number;
  /** Links back to the Finding this event also produced, if any. */
  findingId?: string;
}

export interface DetectorSettings {
  enabledCategories: Record<FindingCategory, boolean>;

  slowRequestMs: number;
  largeResourceBytes: number;
  slowResourceMs: number;
  longTaskMs: number;

  repeatedWindowMs: number;
  repeatedThreshold: number;
  duplicateWindowMs: number;
  duplicateThreshold: number;

  /** Consecutive/clustered failures to the same endpoint within repeatedWindowMs. */
  repeatedFailureThreshold: number;

  /** Longer-horizon polling detector: regular-interval calls to the same endpoint. */
  pollingWindowMs: number;
  pollingThreshold: number;
  /** Max allowed coefficient of variation of inter-call gaps to still call it "regular". */
  pollingRegularityTolerance: number;

  /** How recently a client-side navigation/state change must precede a request to annotate it. */
  stateChangeProximityMs: number;

  domContentLoadedWarnMs: number;
  pageLoadWarnMs: number;

  /** Large JS bundle detection (separate from the generic large-resource threshold). */
  largeScriptBytes: number;

  /** DOM mutation burst detection. */
  domMutationWindowMs: number;
  domMutationThreshold: number;
  domMutationBurstWindowMs: number;
  domMutationBurstThreshold: number;
  largeDomUpdateNodeThreshold: number;

  /** Layout-shift (CLS-like) instability detection. */
  layoutShiftWindowMs: number;
  layoutShiftCountThreshold: number;
  layoutShiftScoreThreshold: number;

  /** Correlation engine window: how close together events must be to be considered related. */
  correlationWindowMs: number;

  maxFindingsPerTab: number;
  maxTimelineEventsPerTab: number;

  ai: AISettings;
}
