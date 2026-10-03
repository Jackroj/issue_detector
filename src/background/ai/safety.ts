import type { AIAnalysis } from "../../shared/ai-types";

/**
 * Deterministic safety net independent of model compliance: even if a model ignores the
 * prompt's "never claim certainty" instruction, this rewrites overclaiming language and
 * caps confidence, so the UI never shows an unqualified causal claim.
 */
const OVERCLAIM_REPLACEMENTS: [RegExp, string][] = [
  [/\bis definitely caused by\b/gi, "is consistent with"],
  [/\bthis is caused by\b/gi, "this pattern is consistent with"],
  [/\bthe root cause is\b/gi, "a possible contributing factor is"],
  [/\bdefinitely\b/gi, "possibly"],
  [/\bcertainly\b/gi, "possibly"],
  [/\bwill (definitely )?fix\b/gi, "may help address"],
  [/\b100% (sure|certain)\b/gi, "reasonably confident"],
  [/\bproves\b/gi, "suggests"],
];

function hedge(text: string): string {
  let out = text;
  for (const [pattern, replacement] of OVERCLAIM_REPLACEMENTS) out = out.replace(pattern, replacement);
  return out;
}

export function enforceHedgedLanguage(analysis: AIAnalysis): AIAnalysis {
  return {
    ...analysis,
    summary: hedge(analysis.summary),
    likelyCauses: analysis.likelyCauses.map((c) => ({
      cause: hedge(c.cause),
      reasoning: hedge(c.reasoning),
      confidence: Math.min(0.9, Math.max(0, c.confidence)),
    })),
    evidence: analysis.evidence.map(hedge),
    debuggingSteps: analysis.debuggingSteps.map(hedge),
  };
}
