import type { DebugContext } from "../../shared/ai-types";

const SENSITIVE_QUERY_KEY = /\b(token|key|apikey|api_key|secret|password|passwd|auth|session|sid|jwt|credential)\b/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Scrubs anything that looks like a credential before it leaves the extension for ANY AI
 * provider — including a local Ollama endpoint. Defense in depth: "local" doesn't mean we
 * should skip redaction, since the data still leaves this process.
 */
function redactString(value: string): string {
  let out = value.replace(JWT_PATTERN, "[redacted-jwt]").replace(EMAIL_PATTERN, "[redacted-email]");

  try {
    const url = new URL(out);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) url.searchParams.set(key, "[redacted]");
    }
    out = url.toString();
  } catch {
    // not a URL on its own — the regex passes above still applied
  }

  return out;
}

export function redactContext(context: DebugContext): DebugContext {
  return {
    ...context,
    description: redactString(context.description),
    evidence: context.evidence.map((e) => ({ ...e, value: redactString(e.value) })),
    timelineWindow: context.timelineWindow.map((e) => ({ ...e, summary: redactString(e.summary) })),
  };
}
