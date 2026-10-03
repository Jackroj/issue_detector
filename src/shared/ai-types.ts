export type AIProviderId = "heuristic" | "chrome-builtin" | "ollama";

export interface AISettings {
  /** Master switch — off by default; the assistant never runs without explicit opt-in. */
  enabled: boolean;
  provider: AIProviderId;
  ollamaEndpoint: string;
  ollamaModel: string;
}

/** Structured evidence handed to a provider — never raw request/response bodies or source code. */
export interface DebugContext {
  issue: string;
  category: string;
  severity: string;
  description: string;
  evidence: { label: string; value: string }[];
  occurrences: number;
  firstSeen: string;
  lastSeen: string;
  /** Nearby raw events (±5s) so the model can see what happened before/after. */
  timelineWindow: { time: string; summary: string }[];
  /** For correlated findings: the underlying findings it was synthesized from. */
  relatedFindings: { title: string; category: string; severity: string }[];
}

export interface AIAnalysis {
  summary: string;
  likelyCauses: { cause: string; reasoning: string; confidence: number }[];
  evidence: string[];
  debuggingSteps: string[];
  severity: "info" | "warning" | "critical";
  /** Which provider actually produced this result (set after any fallback) — for transparency. */
  provider?: AIProviderId;
  generatedAt?: number;
}

export interface AIProvider {
  readonly id: AIProviderId;
  readonly label: string;
  isAvailable(): Promise<{ available: boolean; detail?: string }>;
  analyze(context: DebugContext): Promise<AIAnalysis>;
}
