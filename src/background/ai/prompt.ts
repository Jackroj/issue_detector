import type { DebugContext } from "../../shared/ai-types";

const SYSTEM_INSTRUCTIONS = `You are a careful web performance/debugging assistant analyzing structured browser telemetry collected by a Chrome extension. You are given OBSERVED FACTS (the evidence); everything you add on top is a POSSIBLE EXPLANATION, not a confirmed one.

Rules you must follow:
- Never claim certainty about root cause. Do not say "this is definitely caused by X" or "the root cause is X".
- Prefer hedged language: "this pattern is consistent with X; check Y to confirm."
- Keep each likely cause's confidence between 0 and 0.9 — never 1.0, because correlation in this data never proves causation.
- Suggest concrete debugging steps and, where relevant, what kind of code to look at (e.g. "the event handler that calls this endpoint", "the component that renders this list") — but only in general terms, since you cannot see the actual source code.
- Respond with ONLY a single JSON object in the exact shape below. No markdown, no code fences, no commentary outside the JSON.`;

const RESPONSE_SHAPE = `{
  "summary": string,
  "likelyCauses": [{ "cause": string, "reasoning": string, "confidence": number (0-0.9) }],
  "evidence": string[],
  "debuggingSteps": string[],
  "severity": "info" | "warning" | "critical"
}`;

export function buildPrompt(context: DebugContext): string {
  return `${SYSTEM_INSTRUCTIONS}

Respond in exactly this JSON shape:
${RESPONSE_SHAPE}

Issue data (structured evidence only — no request/response bodies or source code are ever included):
${JSON.stringify(context, null, 2)}`;
}

/** JSON Schema for providers that support constrained/structured output (e.g. Chrome's Prompt API). */
export function buildResponseSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      summary: { type: "string" },
      likelyCauses: {
        type: "array",
        items: {
          type: "object",
          properties: {
            cause: { type: "string" },
            reasoning: { type: "string" },
            confidence: { type: "number" },
          },
          required: ["cause", "reasoning", "confidence"],
        },
      },
      evidence: { type: "array", items: { type: "string" } },
      debuggingSteps: { type: "array", items: { type: "string" } },
      severity: { type: "string", enum: ["info", "warning", "critical"] },
    },
    required: ["summary", "likelyCauses", "evidence", "debuggingSteps", "severity"],
  };
}
