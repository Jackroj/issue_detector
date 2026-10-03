import type { AIAnalysis, AIProvider, DebugContext } from "../../../shared/ai-types";

interface HeuristicRule {
  match(ctx: DebugContext): boolean;
  build(ctx: DebugContext): AIAnalysis;
}

function evidenceLines(ctx: DebugContext): string[] {
  return ctx.evidence.map((e) => `${e.label}: ${e.value}`);
}

function severityOf(ctx: DebugContext): AIAnalysis["severity"] {
  return (["info", "warning", "critical"].includes(ctx.severity) ? ctx.severity : "warning") as AIAnalysis["severity"];
}

function endpointLabel(ctx: DebugContext): string {
  return ctx.evidence.find((e) => e.label === "Endpoint" || e.label === "URL")?.value ?? "this endpoint";
}

const RULES: HeuristicRule[] = [
  {
    match: (ctx) => /duplicate request pattern|repeated calls|excessive polling/i.test(ctx.issue),
    build: (ctx) => ({
      summary: `${ctx.issue} — ${endpointLabel(ctx)} was observed ${ctx.occurrences} time(s). This pattern is consistent with a client-side re-fetch loop, but could also be intentional polling or several independent widgets requesting the same data.`,
      likelyCauses: [
        { cause: "Repeated state-triggered requests", reasoning: "A state update (e.g. a re-render or store change) may be re-triggering the same fetch each time it runs.", confidence: 0.5 },
        { cause: "Duplicated event handlers", reasoning: "The same handler might be bound more than once, causing each user action to fire multiple requests.", confidence: 0.4 },
        { cause: "Component/page remounting", reasoning: "If a state-change or navigation entry appears just before this in the timeline, a remount could be re-issuing the initial data fetch.", confidence: 0.4 },
        { cause: "Retry logic without backoff", reasoning: "An error-handling retry path may be re-calling the endpoint without a cap or backoff.", confidence: 0.3 },
      ],
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        `Check what triggers ${endpointLabel(ctx)} in the code (the event handler, effect, or data-fetching hook that calls it).`,
        "Inspect the timeline entries immediately before the first call in this burst for a navigation or state-change event.",
        "Confirm the call site isn't bound more than once (e.g. inside a loop, a re-run effect, or duplicated component instances).",
        "If this is intentional polling, confirm the interval and necessity are what you expect.",
      ],
      severity: severityOf(ctx),
    }),
  },
  {
    match: (ctx) => /repeated failed requests|request failed with status|network request error/i.test(ctx.issue),
    build: (ctx) => ({
      summary: `${ctx.issue} — ${endpointLabel(ctx)} is failing. This is consistent with either a backend issue or a client sending a malformed/unauthorized request.`,
      likelyCauses: [
        { cause: "Backend instability or an outage on this endpoint", reasoning: "Repeated failures to the same endpoint, especially 5xx, often point to server-side issues rather than the client.", confidence: 0.45 },
        { cause: "A client-side retry loop without backoff", reasoning: "If failures recur quickly and regularly, the client may be retrying a request that cannot succeed as sent.", confidence: 0.35 },
        { cause: "An auth/session issue (for repeated 401/403)", reasoning: "Status codes in the 401/403 range are consistent with an expired token or missing credentials.", confidence: 0.3 },
      ],
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        `Check server-side logs/monitoring for ${endpointLabel(ctx)} around the timestamps in evidence.`,
        "Reproduce the request in DevTools Network tab and inspect the full response.",
        "If this is a retry loop, confirm there is a cap and backoff so a persistent failure doesn't hammer the backend.",
      ],
      severity: severityOf(ctx),
    }),
  },
  {
    match: (ctx) => /slow network request/i.test(ctx.issue),
    build: (ctx) => ({
      summary: `${ctx.issue} — ${endpointLabel(ctx)} took longer than expected. This is consistent with backend latency, a large payload, or network conditions, not necessarily a client-side bug.`,
      likelyCauses: [
        { cause: "Slow backend processing (e.g. an expensive query)", reasoning: "Request duration is dominated by server-side time-to-first-byte in most slow-API cases.", confidence: 0.45 },
        { cause: "Large response payload", reasoning: "If a response-size evidence value is present and large, transfer time itself may dominate.", confidence: 0.35 },
        { cause: "Network conditions (client-side)", reasoning: "Poor connectivity can slow any single request independent of the backend.", confidence: 0.2 },
      ],
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        "Check the response size and server timing headers (if available) to split network vs. processing time.",
        "Profile the backend endpoint directly (outside the browser) to isolate server-side latency.",
        "Check whether this request blocks rendering — if so, consider showing a loading state or fetching in parallel with other work.",
      ],
      severity: severityOf(ctx),
    }),
  },
  {
    match: (ctx) => ctx.category === "javascript",
    build: (ctx) => ({
      summary: `${ctx.issue}. This is an observed JavaScript error/warning; the likely cause depends on the surrounding code, which isn't visible to this analysis.`,
      likelyCauses: [
        { cause: "A null/undefined value reaching code that doesn't guard for it", reasoning: "This is the most common cause of uncaught TypeErrors in browser JS.", confidence: 0.4 },
        { cause: "A race condition (e.g. code running before data has loaded)", reasoning: "If this error recurs intermittently or follows a network/state-change event in the timeline, timing may be the trigger.", confidence: 0.35 },
        { cause: "An unhandled edge case in a recent code change", reasoning: "Errors that appear frequently in a short window are consistent with a regression.", confidence: 0.25 },
      ],
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        "Open the stack trace (in evidence, if present) and inspect the exact line/column referenced.",
        "Check the timeline for a network response or state change shortly before this error — it may be the trigger.",
        "Add a guard or reproduce the error with breakpoints at the referenced location.",
      ],
      severity: severityOf(ctx),
    }),
  },
  {
    match: (ctx) => /long task|slow domcontentloaded|slow page load|potential performance issue/i.test(ctx.issue),
    build: (ctx) => ({
      summary: `${ctx.issue}. This is consistent with heavy main-thread work delaying rendering or interactivity.`,
      likelyCauses: [
        { cause: "Expensive synchronous JavaScript (parsing, large loops, heavy computation)", reasoning: "Long tasks are, by definition, main-thread work that blocks the browser from painting or responding to input.", confidence: 0.45 },
        { cause: "Large JS bundle parse/execution cost", reasoning: "If this coincides with page load, bundle size is a common contributor.", confidence: 0.35 },
        { cause: "A slow API response gating rendering", reasoning: "If a network finding appears nearby in the timeline, the long task may be processing that response.", confidence: 0.3 },
      ],
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        "Record a DevTools Performance trace covering this timestamp and inspect the flame chart for the long task.",
        "Check the timeline for a network event immediately before this task.",
        "Consider code-splitting, deferring non-critical work, or chunking large synchronous loops.",
      ],
      severity: severityOf(ctx),
    }),
  },
  {
    match: (ctx) => /dom mutation|large dom update|frequent update pattern/i.test(ctx.issue),
    build: (ctx) => ({
      summary: `${ctx.issue}. This is consistent with a large or frequent DOM update, which can be expensive to lay out and paint regardless of framework.`,
      likelyCauses: [
        { cause: "A bulk render or list update happening in one pass", reasoning: "A high mutation/node count in a short window is consistent with rendering many elements at once.", confidence: 0.4 },
        { cause: "Excessive component re-rendering", reasoning: "Repeated update batches close together can indicate a component re-rendering more often than necessary.", confidence: 0.35 },
      ],
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        "Use DevTools Performance > the 'Layout'/'Rendering' sections to see what triggered the updates at this timestamp.",
        "If using a framework, check for unnecessary re-renders (e.g. React DevTools Profiler, Vue DevTools).",
        "Consider virtualizing long lists or batching DOM updates.",
      ],
      severity: severityOf(ctx),
    }),
  },
  {
    match: (ctx) => /layout instability|repeated layout changes/i.test(ctx.issue),
    build: (ctx) => ({
      summary: `${ctx.issue}. This is consistent with content shifting after initial render, which hurts perceived stability (and Core Web Vitals' CLS metric).`,
      likelyCauses: [
        { cause: "Content without reserved space (images, ads, injected widgets)", reasoning: "Elements that load asynchronously without a fixed size commonly push surrounding content.", confidence: 0.5 },
        { cause: "Late-arriving data replacing placeholder content", reasoning: "If a network/state-change event appears nearby, a data response replacing placeholder content is a common trigger.", confidence: 0.35 },
      ],
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        "Use DevTools Rendering > 'Layout Shift Regions' to see what moved.",
        "Check if the affected elements have explicit width/height or reserved space before their content loads.",
        "Correlate with the timeline to see what update preceded the shift.",
      ],
      severity: severityOf(ctx),
    }),
  },
  {
    match: (ctx) => ctx.category === "correlated",
    build: (ctx) => ({
      summary: `${ctx.issue}. This links ${ctx.relatedFindings.length} related finding(s) that occurred close together in time — a timing correlation, not a confirmed causal chain.`,
      likelyCauses: ctx.relatedFindings.map((f) => ({
        cause: `Related to: ${f.title}`,
        reasoning: `This finding (${f.category}, ${f.severity}) occurred close in time to the primary issue and may be part of the same chain of events.`,
        confidence: 0.35,
      })),
      evidence: evidenceLines(ctx),
      debuggingSteps: [
        "Open the Timeline view and inspect the exact order of the related events listed above.",
        "Investigate the earliest event in the chain first — later ones may just be downstream effects.",
      ],
      severity: severityOf(ctx),
    }),
  },
];

function genericAnalysis(ctx: DebugContext): AIAnalysis {
  return {
    summary: `${ctx.issue}. ${ctx.description}`,
    likelyCauses: [
      {
        cause: "No specific rule-based pattern matched this finding",
        reasoning: "This finding type doesn't match a known heuristic. Enabling a local model provider (Ollama or Chrome's built-in AI) in Settings may give a more specific analysis.",
        confidence: 0.2,
      },
    ],
    evidence: evidenceLines(ctx),
    debuggingSteps: [
      "Review the evidence above and the surrounding Timeline entries for context.",
      "Reproduce the scenario with DevTools open (Network/Performance/Console) to gather more detail.",
    ],
    severity: severityOf(ctx),
  };
}

/** Zero-dependency, always-available fallback — works with no model installed. */
export class HeuristicProvider implements AIProvider {
  readonly id = "heuristic" as const;
  readonly label = "Rule-based (no model required)";

  async isAvailable(): Promise<{ available: boolean }> {
    return { available: true };
  }

  async analyze(context: DebugContext): Promise<AIAnalysis> {
    const rule = RULES.find((r) => r.match(context));
    return rule ? rule.build(context) : genericAnalysis(context);
  }
}
