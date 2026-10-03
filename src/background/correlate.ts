import type { DetectorSettings, Finding, FindingSeverity } from "../shared/types";
import { formatTime } from "../shared/format";

export interface CorrelationMatch {
  ruleId: string;
  title: string;
  description: string;
  evidenceFindings: Finding[];
  confidence: number;
  possibleCauses: string[];
  recommendedInvestigation: string[];
  /** Identity used to build a stable groupKey so a repeating chain updates one row, not many. */
  groupKeySeed: string;
}

type Rule = (recent: Finding[], settings: DetectorSettings) => CorrelationMatch | null;

const SEVERITY_ORDER: FindingSeverity[] = ["info", "warning", "critical"];

function maxSeverity(findings: Finding[]): FindingSeverity {
  return findings.reduce<FindingSeverity>((max, f) => {
    return SEVERITY_ORDER.indexOf(f.severity) > SEVERITY_ORDER.indexOf(max) ? f.severity : max;
  }, "info");
}

export function severityForMatch(match: CorrelationMatch): FindingSeverity {
  return maxSeverity(match.evidenceFindings);
}

/** Slow/failing API followed by a long main-thread task (optionally followed by a slow render). */
const ruleSlowApiBlocksRender: Rule = (recent) => {
  const apiIssue = recent.find(
    (f) => f.category === "network" && (f.groupKey.startsWith("network:slow:") || f.groupKey.startsWith("network:failure:")),
  );
  if (!apiIssue) return null;

  // Use lastSeen (most recent occurrence), not firstSeen: a recurring finding's firstSeen can be
  // stale, which would otherwise let an old anchor falsely "match" an unrelated recent long task.
  const longTask = recent.find((f) => f.groupKey === "perf:longtask:page" && f.lastSeen >= apiIssue.lastSeen);
  if (!longTask) return null;

  const renderDelay = recent.find(
    (f) => (f.groupKey === "perf:dcl:page" || f.groupKey === "perf:load:page") && f.lastSeen >= apiIssue.lastSeen,
  );

  const evidenceFindings = [apiIssue, longTask, ...(renderDelay ? [renderDelay] : [])];

  return {
    ruleId: "slow-api-blocks-render",
    title: "Slow API response may be delaying rendering",
    description: `${apiIssue.title} occurred shortly before a long main-thread task${
      renderDelay ? " and a slow page render" : ""
    }. These happened close together in time — this is a timing correlation, not a confirmed causal link.`,
    evidenceFindings,
    confidence: Math.min(0.85, 0.5 + (renderDelay ? 0.2 : 0) + (apiIssue.occurrences > 1 ? 0.1 : 0)),
    possibleCauses: [
      "The flagged request may be a render-blocking data fetch that the page waits on before painting.",
      "A large or slow JSON response may require expensive client-side parsing/processing.",
      "Work scheduled after the response (e.g. re-rendering with new data) may be causing the long task.",
    ],
    recommendedInvestigation: [
      "Check backend latency and response size for the flagged endpoint.",
      "Profile the JS execution immediately after this response using the DevTools Performance tab.",
      "Confirm whether the UI actually waits on this request before it can render (render-blocking vs. background fetch).",
    ],
    groupKeySeed: apiIssue.groupKey,
  };
};

/** Repeated/duplicate calls to an endpoint that coincide with JS errors — a possible retry loop. */
const ruleRepeatedCallsWithErrors: Rule = (recent) => {
  const repeatedCall = recent.find(
    (f) => f.category === "network" && (f.groupKey.startsWith("network:repeated:") || f.groupKey.startsWith("network:duplicate:")),
  );
  if (!repeatedCall) return null;

  const jsError = recent.find((f) => f.category === "javascript" && f.lastSeen >= repeatedCall.lastSeen - 2000);
  if (!jsError) return null;

  const evidenceFindings = [repeatedCall, jsError];

  return {
    ruleId: "repeated-calls-with-errors",
    title: "Repeated requests coincide with JavaScript errors",
    description: `${repeatedCall.title} is happening around the same time as "${jsError.title}". This could indicate an error-triggered retry loop, but could also be unrelated.`,
    evidenceFindings,
    confidence: Math.min(0.75, 0.45 + (repeatedCall.occurrences > 3 ? 0.15 : 0) + (jsError.occurrences > 1 ? 0.1 : 0)),
    possibleCauses: [
      "An error handler may be re-invoking the same request without backoff.",
      "A failed request may be triggering a client-side retry that itself errors, looping.",
      "The error and the repeated calls may be independent symptoms of the same root cause (e.g. bad state).",
    ],
    recommendedInvestigation: [
      "Check whether the request's catch/error handler calls itself or re-dispatches the same action.",
      "Add exponential backoff or a retry cap if this is an intentional retry.",
      "Inspect the error's stack trace for a reference to the request/fetch call site.",
    ],
    groupKeySeed: repeatedCall.groupKey,
  };
};

/** Layout instability (CLS-like shifts) shortly after a DOM mutation or network burst. */
const ruleLayoutInstabilityAfterBurst: Rule = (recent) => {
  const layoutShift = recent.find((f) => f.groupKey === "rendering:layoutshift:page");
  if (!layoutShift) return null;

  const burst = recent.find(
    (f) =>
      (f.groupKey === "rendering:dommutation:page" ||
        f.groupKey.startsWith("network:repeated:") ||
        f.groupKey.startsWith("network:duplicate:")) &&
      f.lastSeen <= layoutShift.lastSeen,
  );
  if (!burst) return null;

  const evidenceFindings = [burst, layoutShift];

  return {
    ruleId: "layout-instability-after-burst",
    title: "Layout instability follows rapid DOM/network activity",
    description: `Layout shifts were observed shortly after "${burst.title}". Content inserted or re-rendered around this time may be pushing other elements around.`,
    evidenceFindings,
    confidence: 0.6,
    possibleCauses: [
      "Content (e.g. images, ads, or injected elements) may be loading without reserved space, pushing layout.",
      "A burst of DOM updates may be re-flowing large sections of the page.",
      "Data arriving asynchronously may be replacing placeholder content with differently-sized content.",
    ],
    recommendedInvestigation: [
      "Use the DevTools Rendering > Layout Shift Regions overlay to see what moved.",
      "Check if the inserted/updated elements have explicit width/height or reserved space.",
      "Correlate the timeline entries around this timestamp to see what triggered the update.",
    ],
    groupKeySeed: burst.groupKey,
  };
};

const RULES: Rule[] = [ruleSlowApiBlocksRender, ruleRepeatedCallsWithErrors, ruleLayoutInstabilityAfterBurst];

export function runCorrelation(findings: Finding[], now: number, settings: DetectorSettings): CorrelationMatch[] {
  const recent = findings
    .filter((f) => now - f.lastSeen <= settings.correlationWindowMs)
    .sort((a, b) => a.firstSeen - b.firstSeen);

  const matches: CorrelationMatch[] = [];
  for (const rule of RULES) {
    const match = rule(recent, settings);
    if (match) matches.push(match);
  }
  return matches;
}

export function buildCorrelationEvidence(match: CorrelationMatch): { label: string; value: string }[] {
  return match.evidenceFindings.map((f) => ({
    label: `${f.category} · ${formatTime(f.lastSeen)}`,
    value: f.title,
  }));
}
