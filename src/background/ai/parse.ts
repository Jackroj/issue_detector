import type { AIAnalysis } from "../../shared/ai-types";

const SEVERITIES = ["info", "warning", "critical"];

/**
 * Lenient parsing: local models (especially smaller open-weight ones) don't always honor
 * "JSON only" instructions perfectly — they may wrap it in prose or code fences. We extract
 * the first {...} block and validate/coerce fields rather than trusting the shape blindly.
 */
export function parseAIResponse(raw: string): AIAnalysis | null {
  const jsonText = extractJson(raw);
  if (!jsonText) return null;

  try {
    const obj = JSON.parse(jsonText) as Record<string, unknown>;
    if (typeof obj.summary !== "string" || obj.summary.trim().length === 0) return null;

    const likelyCauses = Array.isArray(obj.likelyCauses)
      ? obj.likelyCauses
          .filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null)
          .map((c) => ({
            cause: String(c.cause ?? "Unspecified"),
            reasoning: String(c.reasoning ?? ""),
            confidence: clamp(Number(c.confidence)) || 0.3,
          }))
      : [];

    const evidence = Array.isArray(obj.evidence) ? obj.evidence.map((e) => String(e)) : [];
    const debuggingSteps = Array.isArray(obj.debuggingSteps) ? obj.debuggingSteps.map((s) => String(s)) : [];
    const severity = SEVERITIES.includes(String(obj.severity)) ? (obj.severity as AIAnalysis["severity"]) : "warning";

    return { summary: obj.summary, likelyCauses, evidence, debuggingSteps, severity };
  } catch {
    return null;
  }
}

/**
 * Scans for the first balanced {...} block rather than naively taking "first { to last }" —
 * local models often add trailing commentary (or code-fence markers) containing stray braces
 * after the JSON, which would otherwise corrupt a naive slice.
 */
function extractJson(raw: string): string | null {
  const start = raw.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === "\\") {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return null; // unbalanced — likely truncated output
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0.3;
  return Math.min(0.9, Math.max(0, n));
}
