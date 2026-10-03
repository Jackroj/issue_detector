import type { DraftFinding } from "../shared/messaging";
import type { DetectorSettings } from "../shared/types";

type ReportFn = (draft: DraftFinding) => void;

interface LayoutShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

/**
 * Framework-agnostic rendering signals. React/Vue/Angular/Svelte/vanilla all ultimately
 * mutate the real DOM and trigger real layout, so observing the DOM and the browser's own
 * Layout Instability API works the same regardless of framework — no app integration needed.
 */
export function installRenderingObservers(report: ReportFn, settings: DetectorSettings): void {
  observeDomMutations(report, settings);
  observeLayoutShifts(report, settings);
}

function observeDomMutations(report: ReportFn, settings: DetectorSettings): void {
  if (typeof MutationObserver === "undefined") return;

  let windowMutationCount = 0;
  let windowNodeDelta = 0;
  let windowStart = performance.now();

  let burstCount = 0;
  let burstWindowStart = performance.now();

  const resetMutationWindowIfNeeded = (now: number) => {
    if (now - windowStart > settings.domMutationWindowMs) {
      windowMutationCount = 0;
      windowNodeDelta = 0;
      windowStart = now;
    }
  };

  const resetBurstWindowIfNeeded = (now: number) => {
    if (now - burstWindowStart > settings.domMutationBurstWindowMs) {
      burstCount = 0;
      burstWindowStart = now;
    }
  };

  const observer = new MutationObserver((mutations) => {
    const now = performance.now();

    resetMutationWindowIfNeeded(now);
    resetBurstWindowIfNeeded(now);
    burstCount += 1;

    let nodeDelta = 0;
    for (const m of mutations) {
      windowMutationCount += 1;
      nodeDelta += m.addedNodes.length + m.removedNodes.length;
    }
    windowNodeDelta += nodeDelta;

    if (windowMutationCount >= settings.domMutationThreshold) {
      report({
        category: "rendering",
        severity: "warning",
        title: "Excessive DOM mutations",
        description: `${windowMutationCount} DOM mutations were recorded within ${settings.domMutationWindowMs}ms. High-frequency DOM churn can cause jank, especially if it triggers layout or style recalculation repeatedly.`,
        evidence: [
          { label: "Mutations", value: windowMutationCount },
          { label: "Window", value: `${settings.domMutationWindowMs}ms` },
          { label: "Page", value: location.href },
        ],
        timestamp: Date.now(),
        groupKey: "rendering:dommutation:page",
      });
    }

    if (windowNodeDelta >= settings.largeDomUpdateNodeThreshold) {
      report({
        category: "rendering",
        severity: "warning",
        title: "Large DOM update",
        description: `${windowNodeDelta} nodes were added/removed within ${settings.domMutationWindowMs}ms. Large bulk DOM updates are expensive to lay out and paint.`,
        evidence: [
          { label: "Nodes added/removed", value: windowNodeDelta },
          { label: "Window", value: `${settings.domMutationWindowMs}ms` },
        ],
        timestamp: Date.now(),
        groupKey: "rendering:largedomupdate:page",
      });
    }

    if (burstCount >= settings.domMutationBurstThreshold) {
      report({
        category: "rendering",
        severity: "info",
        title: "Frequent update pattern detected",
        description: `The DOM was updated in ${burstCount} separate batches within ${settings.domMutationBurstWindowMs}ms. This can be a sign of excessive component-like re-rendering, but may also be normal for highly interactive UI.`,
        evidence: [
          { label: "Update batches", value: burstCount },
          { label: "Window", value: `${settings.domMutationBurstWindowMs}ms` },
        ],
        timestamp: Date.now(),
        groupKey: "rendering:frequentupdates:page",
      });
    }
  });

  try {
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true });
  } catch {
    // documentElement may not exist yet at document_start in rare cases; skip silently
  }
}

function observeLayoutShifts(report: ReportFn, settings: DetectorSettings): void {
  if (typeof PerformanceObserver === "undefined") return;

  let shifts: { timestamp: number; value: number }[] = [];

  try {
    const observer = new PerformanceObserver((list) => {
      const now = Date.now();
      for (const entry of list.getEntries() as LayoutShiftEntry[]) {
        if (entry.hadRecentInput) continue; // user-caused shifts are not an issue
        shifts.push({ timestamp: now, value: entry.value });
      }

      const cutoff = now - settings.layoutShiftWindowMs;
      shifts = shifts.filter((s) => s.timestamp >= cutoff);

      const cumulativeValue = shifts.reduce((sum, s) => sum + s.value, 0);

      if (shifts.length >= settings.layoutShiftCountThreshold || cumulativeValue >= settings.layoutShiftScoreThreshold) {
        report({
          category: "rendering",
          severity: cumulativeValue >= settings.layoutShiftScoreThreshold * 2 ? "critical" : "warning",
          title: "Repeated layout changes (layout instability)",
          description: `${shifts.length} unexpected layout shifts (cumulative impact score ${cumulativeValue.toFixed(3)}) occurred within ${formatWindow(settings.layoutShiftWindowMs)}. Content is likely moving after it has already rendered.`,
          evidence: [
            { label: "Shift count", value: shifts.length },
            { label: "Cumulative shift score", value: cumulativeValue.toFixed(3) },
            { label: "Window", value: formatWindow(settings.layoutShiftWindowMs) },
          ],
          timestamp: now,
          groupKey: "rendering:layoutshift:page",
        });
      }
    });
    observer.observe({ type: "layout-shift", buffered: true });
  } catch {
    // Layout Instability API not supported; skip silently
  }
}

function formatWindow(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}
