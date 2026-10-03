import type { DetectorSettings } from "./types";

export const SETTINGS_STORAGE_KEY = "detectorSettings";

export const DEFAULT_SETTINGS: DetectorSettings = {
  enabledCategories: {
    network: true,
    javascript: true,
    performance: true,
    rendering: true,
    correlated: true,
  },

  slowRequestMs: 3000,
  largeResourceBytes: 1_000_000, // 1 MB
  slowResourceMs: 2000,
  longTaskMs: 50,

  repeatedWindowMs: 10_000,
  repeatedThreshold: 5,
  duplicateWindowMs: 2000,
  duplicateThreshold: 3,
  repeatedFailureThreshold: 3,

  pollingWindowMs: 30_000,
  pollingThreshold: 6,
  pollingRegularityTolerance: 0.35,

  stateChangeProximityMs: 800,

  domContentLoadedWarnMs: 2500,
  pageLoadWarnMs: 5000,
  largeScriptBytes: 300_000,

  domMutationWindowMs: 1000,
  domMutationThreshold: 60,
  domMutationBurstWindowMs: 2000,
  domMutationBurstThreshold: 8,
  largeDomUpdateNodeThreshold: 150,

  layoutShiftWindowMs: 2000,
  layoutShiftCountThreshold: 5,
  layoutShiftScoreThreshold: 0.5,

  correlationWindowMs: 5000,

  maxFindingsPerTab: 500,
  maxTimelineEventsPerTab: 400,

  ai: {
    enabled: false,
    provider: "heuristic",
    ollamaEndpoint: "http://localhost:11434",
    ollamaModel: "llama3.2",
  },
};

export const SEVERITY_WEIGHT: Record<string, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};
