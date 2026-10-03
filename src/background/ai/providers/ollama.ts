import type { AIAnalysis, AIProvider, DebugContext } from "../../../shared/ai-types";
import { buildPrompt } from "../prompt";
import { parseAIResponse } from "../parse";

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/**
 * Talks to a local Ollama server (https://ollama.com) running open-weight models
 * (Llama, Mistral, Phi, Gemma, ...) on the user's own machine — no cloud dependency.
 *
 * Note: Ollama restricts which browser Origins may call it. If requests fail with a CORS-like
 * error, start Ollama with `OLLAMA_ORIGINS=chrome-extension://*` set in its environment.
 */
export class OllamaProvider implements AIProvider {
  readonly id = "ollama" as const;

  constructor(
    private readonly endpoint: string,
    private readonly model: string,
  ) {}

  get label(): string {
    return `Ollama (${this.model})`;
  }

  async isAvailable(): Promise<{ available: boolean; detail?: string }> {
    try {
      const res = await fetchWithTimeout(`${this.endpoint}/api/tags`, {}, 2500);
      if (!res.ok) return { available: false, detail: `HTTP ${res.status}` };
      return { available: true };
    } catch (err) {
      return { available: false, detail: describeError(err) };
    }
  }

  async analyze(context: DebugContext): Promise<AIAnalysis> {
    const prompt = buildPrompt(context);
    const res = await fetchWithTimeout(
      `${this.endpoint}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt, format: "json", stream: false }),
      },
      30_000,
    );

    if (!res.ok) {
      throw new Error(`Ollama returned HTTP ${res.status}. Is the model "${this.model}" pulled (ollama pull ${this.model})?`);
    }

    const data = (await res.json()) as { response?: string };
    const parsed = parseAIResponse(data.response ?? "");
    if (!parsed) {
      throw new Error("Ollama's response didn't match the expected JSON schema. Try a different/larger model.");
    }
    return parsed;
  }
}

function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === "AbortError") return "Timed out — is Ollama running?";
  return err instanceof Error ? err.message : String(err);
}
