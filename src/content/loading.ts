import type { DraftFinding } from "../shared/messaging";
import type { DetectorSettings } from "../shared/types";
import { formatBytes, formatMs } from "../shared/format";

type ReportFn = (draft: DraftFinding) => void;

/** PerformanceResourceTiming.renderBlockingStatus isn't in older TS DOM libs yet. */
interface ResourceTimingWithBlockingStatus extends PerformanceResourceTiming {
  renderBlockingStatus?: "blocking" | "non-blocking" | "unknown";
}

/**
 * Synthesizes ONE higher-level "Potential Performance Issue" finding with a contributor
 * breakdown, instead of a pile of separate warnings — this is an approximate attribution
 * (overlapping requests aren't double-counted away), not a profiler-grade measurement.
 */
export function installLoadingAnalysis(report: ReportFn, settings: DetectorSettings): void {
  const run = () => setTimeout(() => analyze(report, settings), 500);

  if (document.readyState === "complete") {
    run();
  } else {
    window.addEventListener("load", run, { once: true });
  }
}

function analyze(report: ReportFn, settings: DetectorSettings): void {
  const [nav] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
  if (!nav) return;

  const loadTime = nav.loadEventEnd - nav.startTime;
  if (loadTime <= settings.pageLoadWarnMs) return; // only report when there's an actual problem

  const resources = performance.getEntriesByType("resource") as ResourceTimingWithBlockingStatus[];
  const withinLoad = resources.filter((r) => r.startTime <= nav.loadEventEnd);

  const scriptTime = sumDuration(withinLoad, "script");
  const imgTime = sumDuration(withinLoad, (t) => t === "img" || t === "image");
  const apiTime = sumDuration(withinLoad, (t) => t === "xmlhttprequest" || t === "fetch");

  const longTasks = (performance.getEntriesByType("longtask") as PerformanceEntry[]).filter(
    (t) => t.startTime <= nav.loadEventEnd,
  );
  const longTaskTime = longTasks.reduce((sum, t) => sum + t.duration, 0);

  const blockingResources = withinLoad.filter((r) => r.renderBlockingStatus === "blocking");
  const largeScripts = withinLoad.filter((r) => r.initiatorType === "script" && r.transferSize > settings.largeScriptBytes);
  const slowThirdParty = withinLoad.filter((r) => isThirdParty(r.name) && r.duration > settings.slowResourceMs);

  const contributors: string[] = [
    `- JavaScript download: ${formatMs(scriptTime)}`,
    `- API requests: ${formatMs(apiTime)}`,
    `- Image loading: ${formatMs(imgTime)}`,
    `- Main-thread long tasks: ${formatMs(longTaskTime)}`,
  ];

  report({
    category: "performance",
    severity: loadTime > settings.pageLoadWarnMs * 2 ? "critical" : "warning",
    title: "Potential performance issue",
    description: `Initial page load took ${formatMs(loadTime)} (threshold: ${formatMs(settings.pageLoadWarnMs)}).\n\nMajor contributors (approximate — concurrent requests overlap, so these won't sum to the total):\n${contributors.join("\n")}`,
    confidence: 0.6,
    possibleCauses: [
      "Render-blocking scripts or stylesheets may be delaying first paint.",
      "Large JavaScript bundles may be slow to download and/or parse on slower connections.",
      "Slow API responses on the critical path may be delaying content rendering.",
      "Long main-thread tasks may be blocking the browser from painting sooner.",
    ],
    recommendedInvestigation: [
      "Open DevTools > Network and check the waterfall for the longest critical-path requests.",
      "Open DevTools > Performance and record a reload to see what's running during the long tasks.",
      blockingResources.length > 0
        ? `Review the ${blockingResources.length} render-blocking resource(s) flagged in evidence — consider async/defer or moving them.`
        : "Check whether any <script> tags lack async/defer.",
      largeScripts.length > 0
        ? `Consider code-splitting the ${largeScripts.length} large script(s) flagged in evidence.`
        : "Check bundle size with a tool like source-map-explorer if JS download time is high.",
    ],
    evidence: [
      { label: "Total load time", value: formatMs(loadTime) },
      { label: "JavaScript download", value: formatMs(scriptTime) },
      { label: "API requests", value: formatMs(apiTime) },
      { label: "Image loading", value: formatMs(imgTime) },
      { label: "Main-thread long tasks", value: formatMs(longTaskTime) },
      ...(blockingResources.length > 0
        ? [{ label: "Render-blocking resources", value: blockingResources.map((r) => shortName(r.name)).join(", ") }]
        : []),
      ...(largeScripts.length > 0
        ? [{ label: "Large JS bundles", value: largeScripts.map((r) => `${shortName(r.name)} (${formatBytes(r.transferSize)})`).join(", ") }]
        : []),
      ...(slowThirdParty.length > 0
        ? [{ label: "Slow third-party resources", value: slowThirdParty.map((r) => `${shortName(r.name)} (${formatMs(r.duration)})`).join(", ") }]
        : []),
    ],
    timestamp: Date.now(),
    groupKey: "perf:loadbreakdown:page",
  });
}

function sumDuration(
  resources: PerformanceResourceTiming[],
  initiatorType: string | ((t: string) => boolean),
): number {
  const matches = (t: string) => (typeof initiatorType === "function" ? initiatorType(t) : t === initiatorType);
  return resources.filter((r) => matches(r.initiatorType)).reduce((sum, r) => sum + r.duration, 0);
}

function isThirdParty(url: string): boolean {
  try {
    return new URL(url).origin !== location.origin;
  } catch {
    return false;
  }
}

function shortName(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname}`.slice(-60);
  } catch {
    return url.slice(-60);
  }
}
