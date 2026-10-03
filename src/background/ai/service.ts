import type { DetectorSettings } from "../../shared/types";
import type { AIAnalysis, AIProvider, AIProviderId, AISettings } from "../../shared/ai-types";
import type { FindingStore } from "../store";
import type { TimelineStore } from "../timeline";
import { buildDebugContext } from "./context";
import { redactContext } from "./redact";
import { enforceHedgedLanguage } from "./safety";
import { HeuristicProvider } from "./providers/heuristic";
import { OllamaProvider } from "./providers/ollama";
import { ChromeBuiltInAIProvider } from "./providers/chrome-builtin";

const ANALYSIS_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function resolveProvider(providerId: AIProviderId, ai: AISettings): AIProvider {
  switch (providerId) {
    case "ollama":
      return new OllamaProvider(ai.ollamaEndpoint, ai.ollamaModel);
    case "chrome-builtin":
      return new ChromeBuiltInAIProvider();
    case "heuristic":
    default:
      return new HeuristicProvider();
  }
}

export class AIService {
  constructor(
    private readonly store: FindingStore,
    private readonly timeline: TimelineStore,
    private readonly getSettings: () => DetectorSettings,
  ) {}

  async checkAvailability(
    providerId: AIProviderId,
    overrides?: { ollamaEndpoint?: string; ollamaModel?: string },
  ): Promise<{ available: boolean; detail?: string }> {
    const ai = { ...this.getSettings().ai, ...overrides };
    const provider = resolveProvider(providerId, ai);
    try {
      return await provider.isAvailable();
    } catch (err) {
      return { available: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  async analyze(tabId: number, findingId: string): Promise<AIAnalysis> {
    const settings = this.getSettings();
    if (!settings.ai.enabled) {
      throw new Error("The AI assistant is turned off. Enable it under Settings > AI Assistant.");
    }

    const finding = await this.store.getById(tabId, findingId);
    if (!finding) throw new Error("This finding is no longer available (it may have been cleared or the page navigated).");

    const allFindings = await this.store.get(tabId);
    const timelineEvents = await this.timeline.get(tabId);
    const context = redactContext(buildDebugContext(finding, allFindings, timelineEvents));

    const primary = resolveProvider(settings.ai.provider, settings.ai);
    let analysis: AIAnalysis;
    let actualProviderId: AIProviderId = primary.id;

    try {
      analysis = await withTimeout(primary.analyze(context), ANALYSIS_TIMEOUT_MS);
    } catch (err) {
      console.warn(`[Issue Detector] AI provider "${primary.id}" failed, falling back to heuristic:`, err);
      const fallback = new HeuristicProvider();
      analysis = await fallback.analyze(context);
      analysis.summary = `Note: the "${primary.label}" provider was unavailable (${describeError(err)}), so this is a rule-based analysis, not a model-generated one.\n\n${analysis.summary}`;
      actualProviderId = fallback.id;
    }

    const safe = enforceHedgedLanguage(analysis);
    safe.provider = actualProviderId;
    safe.generatedAt = Date.now();

    await this.store.attachAIAnalysis(tabId, findingId, safe);
    return safe;
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
