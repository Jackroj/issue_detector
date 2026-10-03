import type { AIAnalysis, AIProvider, DebugContext } from "../../../shared/ai-types";
import { buildPrompt, buildResponseSchema } from "../prompt";
import { parseAIResponse } from "../parse";

interface LanguageModelSession {
  prompt(input: string, options?: Record<string, unknown>): Promise<string>;
  destroy?(): void;
}

interface LanguageModelApi {
  availability?(): Promise<string>;
  create(options?: Record<string, unknown>): Promise<LanguageModelSession>;
}

function getLanguageModelApi(): LanguageModelApi | undefined {
  return (globalThis as Record<string, unknown>).LanguageModel as LanguageModelApi | undefined;
}

/**
 * Chrome's built-in on-device model (Gemini Nano via the Prompt API). Genuinely local —
 * no network call at all — but requires the browser's on-device model to be downloaded and
 * the feature available on this Chrome build; we feature-detect and degrade gracefully
 * (the AIService falls back to the heuristic provider) when it isn't.
 */
export class ChromeBuiltInAIProvider implements AIProvider {
  readonly id = "chrome-builtin" as const;
  readonly label = "Chrome on-device AI (Gemini Nano)";

  async isAvailable(): Promise<{ available: boolean; detail?: string }> {
    const api = getLanguageModelApi();
    if (!api) return { available: false, detail: "LanguageModel API not present in this Chrome build/version." };

    try {
      if (api.availability) {
        const status = await api.availability();
        const ok = status === "available" || status === "readily";
        return { available: ok, detail: ok ? undefined : `Model status: ${status}` };
      }
      return { available: true };
    } catch (err) {
      return { available: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async analyze(context: DebugContext): Promise<AIAnalysis> {
    const api = getLanguageModelApi();
    if (!api) throw new Error("Chrome's on-device AI (LanguageModel) is not available in this browser.");

    const session = await api.create({
      initialPrompts: [{ role: "system", content: "You are a careful, honest web debugging assistant. Respond with strict JSON only." }],
    });

    try {
      let raw: string;
      try {
        // Structured output constraint, if this Chrome version supports it.
        raw = await session.prompt(buildPrompt(context), { responseConstraint: buildResponseSchema() });
      } catch {
        raw = await session.prompt(buildPrompt(context));
      }

      const parsed = parseAIResponse(raw);
      if (!parsed) throw new Error("The on-device model's response didn't match the expected JSON schema.");
      return parsed;
    } finally {
      session.destroy?.();
    }
  }
}
