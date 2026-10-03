import type { DetectorSettings } from "../shared/types";
import type { DraftFinding, DraftTimelineEvent } from "../shared/messaging";
import { hashKey } from "../shared/id";
import { normalizeUrl, formatMs, formatBytes } from "../shared/format";

interface PendingRequest {
  url: string;
  method: string;
  type: chrome.webRequest.ResourceType;
  startedAt: number;
  tabId: number;
}

interface CallRecord {
  key: string; // method + normalized url
  timestamp: number;
}

interface FailureRecord {
  key: string;
  timestamp: number;
}

/** webRequest reports both XHR and fetch() calls under this resource type. */
const API_RESOURCE_TYPES = new Set(["xmlhttprequest"]);

/** Navigation cancellations are expected noise, not real failures. */
const IGNORED_ERRORS = new Set(["net::ERR_ABORTED"]);

type ReportFn = (tabId: number, draft: DraftFinding) => void;
type TimelineFn = (tabId: number, draft: DraftTimelineEvent) => void;
type SettingsFn = () => DetectorSettings;
type StateChangeLookupFn = (tabId: number) => number | undefined;

export class NetworkMonitor {
  private pending = new Map<string, PendingRequest>();
  private callLog = new Map<number, CallRecord[]>();
  private failureLog = new Map<number, FailureRecord[]>();

  constructor(
    private readonly report: ReportFn,
    private readonly reportTimeline: TimelineFn,
    private readonly getSettings: SettingsFn,
    private readonly getLastStateChangeAt: StateChangeLookupFn,
  ) {}

  start(): void {
    const filter: chrome.webRequest.RequestFilter = { urls: ["<all_urls>"] };

    chrome.webRequest.onBeforeRequest.addListener((details) => {
      if (details.tabId < 0) return;
      this.pending.set(details.requestId, {
        url: details.url,
        method: details.method,
        type: details.type,
        startedAt: details.timeStamp,
        tabId: details.tabId,
      });
      if (API_RESOURCE_TYPES.has(details.type)) {
        this.recordCall(details.tabId, details.method, details.url, details.timeStamp);
      }
    }, filter);

    chrome.webRequest.onCompleted.addListener((details) => {
      this.handleCompleted(details);
    }, filter, ["responseHeaders", "extraHeaders"]);

    chrome.webRequest.onErrorOccurred.addListener((details) => {
      this.handleError(details);
    }, filter);
  }

  resetTab(tabId: number): void {
    this.callLog.delete(tabId);
    this.failureLog.delete(tabId);
  }

  /** True if a client-side navigation/state change happened just before this timestamp. */
  private followsStateChange(tabId: number, timestamp: number, settings: DetectorSettings): boolean {
    const stateChangeAt = this.getLastStateChangeAt(tabId);
    return stateChangeAt !== undefined && timestamp - stateChangeAt <= settings.stateChangeProximityMs;
  }

  private recordCall(tabId: number, method: string, url: string, timestamp: number): void {
    const settings = this.getSettings();
    const key = `${method} ${normalizeUrl(url)}`;
    const log = this.callLog.get(tabId) ?? [];
    log.push({ key, timestamp });

    const horizon = Math.max(settings.repeatedWindowMs, settings.duplicateWindowMs, settings.pollingWindowMs) * 1.2;
    const cutoff = timestamp - horizon;
    const trimmed = log.filter((r) => r.timestamp >= cutoff);
    this.callLog.set(tabId, trimmed);

    if (!settings.enabledCategories.network) return;

    const matching = trimmed.filter((r) => r.key === key);
    const inDuplicateWindow = matching.filter((r) => r.timestamp >= timestamp - settings.duplicateWindowMs);
    const inRepeatedWindow = matching.filter((r) => r.timestamp >= timestamp - settings.repeatedWindowMs);
    const inPollingWindow = matching.filter((r) => r.timestamp >= timestamp - settings.pollingWindowMs);

    const afterStateChange = this.followsStateChange(tabId, timestamp, settings);
    const stateChangeNote = afterStateChange
      ? [{ label: "Context", value: "Occurred shortly after a client-side navigation/state change" }]
      : [];

    if (inDuplicateWindow.length >= settings.duplicateThreshold) {
      this.report(tabId, {
        category: "network",
        severity: "warning",
        title: "Potential duplicate request pattern detected",
        description: `${key} was called ${inDuplicateWindow.length} times within ${formatMs(settings.duplicateWindowMs)}. This often indicates an accidental duplicate request (e.g. a missing debounce or a double-submit), but could also be intentional (e.g. parallel widgets fetching the same data).`,
        evidence: [
          { label: "Endpoint", value: key },
          { label: "Calls in window", value: inDuplicateWindow.length },
          { label: "Window", value: formatMs(settings.duplicateWindowMs) },
          ...stateChangeNote,
        ],
        timestamp,
        groupKey: `network:duplicate:${hashKey(key)}`,
      });
    }

    if (inRepeatedWindow.length >= settings.repeatedThreshold) {
      this.report(tabId, {
        category: "network",
        severity: "info",
        title: "Repeated calls to the same endpoint",
        description: `${key} was called ${inRepeatedWindow.length} times within ${formatMs(settings.repeatedWindowMs)}. Verify this is expected (e.g. polling) rather than an unintended re-fetch loop.`,
        evidence: [
          { label: "Endpoint", value: key },
          { label: "Calls in window", value: inRepeatedWindow.length },
          { label: "Window", value: formatMs(settings.repeatedWindowMs) },
          ...stateChangeNote,
        ],
        timestamp,
        groupKey: `network:repeated:${hashKey(key)}`,
      });
    }

    if (inPollingWindow.length >= settings.pollingThreshold) {
      const regularity = computeRegularity(inPollingWindow.map((r) => r.timestamp));
      if (regularity !== null && regularity <= settings.pollingRegularityTolerance) {
        this.report(tabId, {
          category: "network",
          severity: "info",
          title: "Potential excessive polling pattern detected",
          description: `${key} has been called ${inPollingWindow.length} times at fairly regular intervals over ${formatMs(settings.pollingWindowMs)}. This looks like polling — confirm the interval and necessity are intentional.`,
          evidence: [
            { label: "Endpoint", value: key },
            { label: "Calls in window", value: inPollingWindow.length },
            { label: "Window", value: formatMs(settings.pollingWindowMs) },
            { label: "Interval regularity (lower = more regular)", value: regularity.toFixed(2) },
          ],
          timestamp,
          groupKey: `network:polling:${hashKey(key)}`,
        });
      }
    }
  }

  private handleCompleted(details: chrome.webRequest.WebResponseCacheDetails): void {
    const pending = this.pending.get(details.requestId);
    this.pending.delete(details.requestId);
    if (details.tabId < 0) return;

    const settings = this.getSettings();
    const duration = pending ? details.timeStamp - pending.startedAt : undefined;
    const isApiCall = API_RESOURCE_TYPES.has(details.type);

    if (!settings.enabledCategories.network) return;

    if (isApiCall) {
      this.reportTimeline(details.tabId, {
        kind: "network",
        summary: `${details.method} ${normalizeUrl(details.url)} → ${details.statusCode}${duration !== undefined ? ` (${formatMs(duration)})` : ""}`,
        timestamp: details.timeStamp,
      });
    }

    const contentLength = details.responseHeaders?.find(
      (h) => h.name.toLowerCase() === "content-length",
    )?.value;

    if (details.statusCode >= 400) {
      const key = `${details.method} ${normalizeUrl(details.url)}`;
      if (isApiCall) this.recordFailure(details.tabId, key, details.timeStamp, settings);

      this.report(details.tabId, {
        category: "network",
        severity: details.statusCode >= 500 ? "critical" : "warning",
        title: `Request failed with status ${details.statusCode}`,
        description: `${details.method} ${normalizeUrl(details.url)} returned HTTP ${details.statusCode}.`,
        evidence: [
          { label: "URL", value: details.url },
          { label: "Method", value: details.method },
          { label: "Status", value: details.statusCode },
          ...(duration !== undefined ? [{ label: "Duration", value: formatMs(duration) }] : []),
        ],
        timestamp: details.timeStamp,
        groupKey: `network:failure:${hashKey(`${details.method} ${normalizeUrl(details.url)} ${details.statusCode}`)}`,
      });
    }

    if (duration !== undefined && duration > settings.slowRequestMs) {
      this.report(details.tabId, {
        category: "network",
        severity: duration > settings.slowRequestMs * 2 ? "critical" : "warning",
        title: "Slow network request",
        description: `${details.method} ${normalizeUrl(details.url)} took ${formatMs(duration)} to complete (threshold: ${formatMs(settings.slowRequestMs)}).`,
        evidence: [
          { label: "URL", value: details.url },
          { label: "Method", value: details.method },
          { label: "Duration", value: formatMs(duration) },
          ...(contentLength ? [{ label: "Response size", value: formatBytes(Number(contentLength)) }] : []),
        ],
        timestamp: details.timeStamp,
        groupKey: `network:slow:${hashKey(`${details.method} ${normalizeUrl(details.url)}`)}`,
      });
    }
  }

  private handleError(details: chrome.webRequest.WebResponseErrorDetails): void {
    const pending = this.pending.get(details.requestId);
    this.pending.delete(details.requestId);
    if (details.tabId < 0) return;
    if (IGNORED_ERRORS.has(details.error)) return;

    const settings = this.getSettings();
    const isApiCall = API_RESOURCE_TYPES.has(details.type);
    const method = pending?.method ?? "Request";

    if (!settings.enabledCategories.network) return;

    if (isApiCall) {
      this.reportTimeline(details.tabId, {
        kind: "network",
        summary: `${method} ${normalizeUrl(details.url)} → error (${details.error})`,
        timestamp: details.timeStamp,
      });
    }

    if (isApiCall) {
      const key = `${method} ${normalizeUrl(details.url)}`;
      this.recordFailure(details.tabId, key, details.timeStamp, settings);
    }

    this.report(details.tabId, {
      category: "network",
      severity: "critical",
      title: "Network request error",
      description: `${method} ${normalizeUrl(details.url)} failed: ${details.error}.`,
      evidence: [
        { label: "URL", value: details.url },
        { label: "Error", value: details.error },
      ],
      timestamp: details.timeStamp,
      groupKey: `network:error:${hashKey(`${normalizeUrl(details.url)} ${details.error}`)}`,
    });
  }

  private recordFailure(tabId: number, key: string, timestamp: number, settings: DetectorSettings): void {
    const log = this.failureLog.get(tabId) ?? [];
    log.push({ key, timestamp });
    const cutoff = timestamp - settings.repeatedWindowMs;
    const trimmed = log.filter((r) => r.timestamp >= cutoff);
    this.failureLog.set(tabId, trimmed);

    const matching = trimmed.filter((r) => r.key === key);
    if (matching.length >= settings.repeatedFailureThreshold) {
      this.report(tabId, {
        category: "network",
        severity: "critical",
        title: "Repeated failed requests",
        description: `${key} has failed ${matching.length} times within ${formatMs(settings.repeatedWindowMs)}. This suggests backend instability or a client-side retry loop rather than a one-off error.`,
        evidence: [
          { label: "Endpoint", value: key },
          { label: "Failures in window", value: matching.length },
          { label: "Window", value: formatMs(settings.repeatedWindowMs) },
        ],
        timestamp,
        groupKey: `network:repeatedfailure:${hashKey(key)}`,
      });
    }
  }
}

/**
 * Coefficient of variation of the inter-arrival gaps between timestamps: lower means more
 * regular/periodic (e.g. polling on a fixed interval). Returns null if fewer than 2 gaps exist.
 */
function computeRegularity(timestamps: number[]): number | null {
  const sorted = [...timestamps].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1];
    const b = sorted[i];
    if (a !== undefined && b !== undefined) gaps.push(b - a);
  }
  if (gaps.length < 2) return null;

  const mean = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
  if (mean <= 0) return null;

  const variance = gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length;
  const stdev = Math.sqrt(variance);
  return stdev / mean;
}
