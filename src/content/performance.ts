import type { DraftFinding } from "../shared/messaging";
import type { DetectorSettings } from "../shared/types";
import { hashKey } from "../shared/id";
import { formatBytes, formatMs, normalizeUrl } from "../shared/format";

type ReportFn = (draft: DraftFinding) => void;

const reportedResources = new Set<string>();

export function installPerformanceObservers(report: ReportFn, settings: DetectorSettings): void {
  observeNavigationTiming(report, settings);
  observeResourceTiming(report, settings);
  observeLongTasks(report, settings);
}

function observeNavigationTiming(report: ReportFn, settings: DetectorSettings): void {
  const emit = () => {
    const [entry] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    if (!entry) return;

    const domContentLoaded = entry.domContentLoadedEventEnd - entry.startTime;
    const loadTime = entry.loadEventEnd - entry.startTime;

    if (domContentLoaded > settings.domContentLoadedWarnMs) {
      report({
        category: "performance",
        severity: domContentLoaded > settings.domContentLoadedWarnMs * 2 ? "critical" : "warning",
        title: "Slow DOMContentLoaded",
        description: `DOMContentLoaded fired after ${formatMs(domContentLoaded)} (threshold: ${formatMs(settings.domContentLoadedWarnMs)}).`,
        evidence: [
          { label: "DOMContentLoaded", value: formatMs(domContentLoaded) },
          { label: "Page", value: location.href },
        ],
        timestamp: Date.now(),
        groupKey: "perf:dcl:page",
      });
    }

    if (loadTime > settings.pageLoadWarnMs) {
      report({
        category: "performance",
        severity: loadTime > settings.pageLoadWarnMs * 2 ? "critical" : "warning",
        title: "Slow page load",
        description: `The load event fired after ${formatMs(loadTime)} (threshold: ${formatMs(settings.pageLoadWarnMs)}).`,
        evidence: [
          { label: "Load time", value: formatMs(loadTime) },
          { label: "Page", value: location.href },
        ],
        timestamp: Date.now(),
        groupKey: "perf:load:page",
      });
    }
  };

  if (document.readyState === "complete") {
    emit();
  } else {
    window.addEventListener("load", () => setTimeout(emit, 0), { once: true });
  }
}

function observeResourceTiming(report: ReportFn, settings: DetectorSettings): void {
  if (typeof PerformanceObserver === "undefined") return;

  const handle = (entries: PerformanceResourceTiming[]) => {
    for (const entry of entries) {
      const url = normalizeUrl(entry.name);

      if (entry.duration > settings.slowResourceMs) {
        reportOnce(reportedResources, `slow:${url}`, () =>
          report({
            category: "performance",
            severity: entry.duration > settings.slowResourceMs * 2 ? "critical" : "warning",
            title: "Slow resource load",
            description: `${entry.initiatorType} resource ${url} took ${formatMs(entry.duration)} to load (threshold: ${formatMs(settings.slowResourceMs)}).`,
            evidence: [
              { label: "URL", value: entry.name },
              { label: "Type", value: entry.initiatorType },
              { label: "Duration", value: formatMs(entry.duration) },
            ],
            timestamp: Date.now(),
            groupKey: `perf:slowresource:${hashKey(url)}`,
          }),
        );
      }

      const transferSize = entry.transferSize;
      if (transferSize > settings.largeResourceBytes) {
        reportOnce(reportedResources, `large:${url}`, () =>
          report({
            category: "performance",
            severity: "warning",
            title: "Large resource",
            description: `${entry.initiatorType} resource ${url} transferred ${formatBytes(transferSize)} (threshold: ${formatBytes(settings.largeResourceBytes)}).`,
            evidence: [
              { label: "URL", value: entry.name },
              { label: "Type", value: entry.initiatorType },
              { label: "Size", value: formatBytes(transferSize) },
            ],
            timestamp: Date.now(),
            groupKey: `perf:largeresource:${hashKey(url)}`,
          }),
        );
      }
    }
  };

  try {
    const observer = new PerformanceObserver((list) => handle(list.getEntries() as PerformanceResourceTiming[]));
    observer.observe({ type: "resource", buffered: true });
  } catch {
    // resource timing observation not supported; skip silently
  }
}

function observeLongTasks(report: ReportFn, settings: DetectorSettings): void {
  if (typeof PerformanceObserver === "undefined") return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < settings.longTaskMs) continue;
        report({
          category: "performance",
          severity: entry.duration > settings.longTaskMs * 4 ? "critical" : "warning",
          title: "Long task blocking the main thread",
          description: `A task blocked the main thread for ${formatMs(entry.duration)} (threshold: ${formatMs(settings.longTaskMs)}).`,
          evidence: [
            { label: "Duration", value: formatMs(entry.duration) },
            { label: "Page", value: location.href },
          ],
          timestamp: Date.now(),
          groupKey: "perf:longtask:page",
        });
      }
    });
    observer.observe({ type: "longtask", buffered: true });
  } catch {
    // Long Tasks API not supported; skip silently
  }
}

function reportOnce(seen: Set<string>, key: string, emit: () => void): void {
  if (seen.has(key)) return;
  seen.add(key);
  emit();
}
