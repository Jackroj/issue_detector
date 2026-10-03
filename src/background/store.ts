import { createId } from "../shared/id";
import type { DetectorSettings, Finding } from "../shared/types";
import type { DraftFinding } from "../shared/messaging";

/**
 * Keeps findings per tab in memory, mirrored to chrome.storage.session so a
 * suspended/restarted service worker doesn't lose the current tab's findings.
 * chrome.storage.session is ephemeral (cleared when the browser closes) and
 * never synced, which keeps this in line with "don't persist app data".
 */
/** Caps a single evidence value so one deep stack trace can't blow the per-item storage quota. */
const MAX_EVIDENCE_VALUE_LENGTH = 800;

export class FindingStore {
  private byTab = new Map<number, Finding[]>();
  private loaded = new Set<number>();
  private persistTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private storageKey(tabId: number): string {
    return `findings:${tabId}`;
  }

  async ensureLoaded(tabId: number): Promise<void> {
    if (this.loaded.has(tabId)) return;
    this.loaded.add(tabId);
    try {
      const stored = await chrome.storage.session.get(this.storageKey(tabId));
      const findings = stored[this.storageKey(tabId)] as Finding[] | undefined;
      if (findings) this.byTab.set(tabId, findings);
    } catch {
      // storage.session may be unavailable in older Chrome; fall back to memory-only.
    }
  }

  private async persistNow(tabId: number): Promise<void> {
    const findings = this.byTab.get(tabId) ?? [];
    try {
      await chrome.storage.session.set({ [this.storageKey(tabId)]: findings });
    } catch (err) {
      console.warn(`[Issue Detector] Failed to persist findings for tab ${tabId}:`, err);
    }
  }

  /** Batches writes: bursts of findings (e.g. a polling loop) collapse into one write per tick. */
  private schedulePersist(tabId: number): void {
    if (this.persistTimers.has(tabId)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(tabId);
      void this.persistNow(tabId);
    }, 250);
    this.persistTimers.set(tabId, timer);
  }

  async add(tabId: number, draft: DraftFinding, settings: DetectorSettings): Promise<Finding> {
    await this.ensureLoaded(tabId);
    const list = this.byTab.get(tabId) ?? [];

    const draftEvidence = truncateEvidence(draft.evidence);
    const existing = list.find((f) => f.groupKey === draft.groupKey);
    let finding: Finding;

    if (existing) {
      existing.occurrences += 1;
      existing.lastSeen = draft.timestamp;
      existing.timestamp = draft.timestamp;
      existing.description = draft.description;
      existing.severity = draft.severity;
      existing.evidence = mergeEvidence(existing.evidence, draftEvidence);
      finding = existing;
    } else {
      finding = {
        ...draft,
        evidence: draftEvidence,
        id: createId(),
        tabId,
        occurrences: 1,
        firstSeen: draft.timestamp,
        lastSeen: draft.timestamp,
      };
      list.push(finding);
    }

    if (list.length > settings.maxFindingsPerTab) {
      list.sort((a, b) => a.lastSeen - b.lastSeen);
      list.splice(0, list.length - settings.maxFindingsPerTab);
    }

    this.byTab.set(tabId, list);
    this.schedulePersist(tabId);
    return finding;
  }

  async get(tabId: number): Promise<Finding[]> {
    await this.ensureLoaded(tabId);
    return [...(this.byTab.get(tabId) ?? [])].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  async getById(tabId: number, findingId: string): Promise<Finding | undefined> {
    await this.ensureLoaded(tabId);
    return (this.byTab.get(tabId) ?? []).find((f) => f.id === findingId);
  }

  /** Caches an AI analysis result directly on its finding so repeat views don't re-run the model. */
  async attachAIAnalysis(tabId: number, findingId: string, analysis: Finding["aiAnalysis"]): Promise<void> {
    await this.ensureLoaded(tabId);
    const list = this.byTab.get(tabId) ?? [];
    const finding = list.find((f) => f.id === findingId);
    if (!finding) return;
    finding.aiAnalysis = analysis;
    this.byTab.set(tabId, list);
    this.schedulePersist(tabId);
  }

  async setStatus(tabId: number, findingId: string, status: Finding["status"]): Promise<void> {
    await this.ensureLoaded(tabId);
    const list = this.byTab.get(tabId) ?? [];
    const finding = list.find((f) => f.id === findingId);
    if (!finding) return;
    finding.status = status;
    this.byTab.set(tabId, list);
    this.schedulePersist(tabId);
  }

  async clear(tabId: number): Promise<void> {
    this.byTab.set(tabId, []);
    this.loaded.add(tabId);
    const timer = this.persistTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(tabId);
    }
    await this.persistNow(tabId);
  }

  async dropTab(tabId: number): Promise<void> {
    this.byTab.delete(tabId);
    this.loaded.delete(tabId);
    const timer = this.persistTimers.get(tabId);
    if (timer) {
      clearTimeout(timer);
      this.persistTimers.delete(tabId);
    }
    try {
      await chrome.storage.session.remove(this.storageKey(tabId));
    } catch {
      // best effort
    }
  }
}

function truncateEvidence(evidence: Finding["evidence"]): Finding["evidence"] {
  return evidence.map((e) =>
    typeof e.value === "string" && e.value.length > MAX_EVIDENCE_VALUE_LENGTH
      ? { ...e, value: `${e.value.slice(0, MAX_EVIDENCE_VALUE_LENGTH)}… (truncated)` }
      : e,
  );
}

/** Evidence lists are capped so one noisy finding can't grow without bound. */
function mergeEvidence(
  existing: Finding["evidence"],
  incoming: Finding["evidence"],
  limit = 10,
): Finding["evidence"] {
  const merged = [...incoming, ...existing];
  return merged.slice(0, limit);
}
