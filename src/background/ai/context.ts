import type { Finding, TimelineEvent } from "../../shared/types";
import type { DebugContext } from "../../shared/ai-types";

const TIMELINE_CONTEXT_WINDOW_MS = 5000;
const MAX_TIMELINE_EVENTS = 15;

/** Builds the structured, source-code-free evidence package handed to an AI provider. */
export function buildDebugContext(finding: Finding, allFindings: Finding[], timeline: TimelineEvent[]): DebugContext {
  const nearby = timeline
    .filter((e) => Math.abs(e.timestamp - finding.lastSeen) <= TIMELINE_CONTEXT_WINDOW_MS)
    .slice(-MAX_TIMELINE_EVENTS);

  const related = finding.relatedFindingIds
    ? allFindings.filter((f) => finding.relatedFindingIds?.includes(f.id))
    : [];

  return {
    issue: finding.title,
    category: finding.category,
    severity: finding.severity,
    description: finding.description,
    evidence: finding.evidence.map((e) => ({ label: e.label, value: String(e.value) })),
    occurrences: finding.occurrences,
    firstSeen: new Date(finding.firstSeen).toISOString(),
    lastSeen: new Date(finding.lastSeen).toISOString(),
    timelineWindow: nearby.map((e) => ({ time: new Date(e.timestamp).toISOString(), summary: e.summary })),
    relatedFindings: related.map((f) => ({ title: f.title, category: f.category, severity: f.severity })),
  };
}
