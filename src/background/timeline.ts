import { createId } from "../shared/id";
import type { DraftTimelineEvent } from "../shared/messaging";
import type { TimelineEvent } from "../shared/types";

/**
 * Raw, chronological, non-deduplicated event log per tab, capped to a ring buffer.
 * Complements FindingStore: findings are deduped/aggregated issues, the timeline is
 * "what actually happened, in order" so a developer can see the context around an issue.
 */
export class TimelineStore {
  private byTab = new Map<number, TimelineEvent[]>();
  private loaded = new Set<number>();
  private persistTimers = new Map<number, ReturnType<typeof setTimeout>>();

  private storageKey(tabId: number): string {
    return `timeline:${tabId}`;
  }

  private async ensureLoaded(tabId: number): Promise<void> {
    if (this.loaded.has(tabId)) return;
    this.loaded.add(tabId);
    try {
      const stored = await chrome.storage.session.get(this.storageKey(tabId));
      const events = stored[this.storageKey(tabId)] as TimelineEvent[] | undefined;
      if (events) this.byTab.set(tabId, events);
    } catch {
      // storage.session may be unavailable; fall back to memory-only.
    }
  }

  private async persistNow(tabId: number): Promise<void> {
    const events = this.byTab.get(tabId) ?? [];
    try {
      await chrome.storage.session.set({ [this.storageKey(tabId)]: events });
    } catch (err) {
      console.warn(`[Issue Detector] Failed to persist timeline for tab ${tabId}:`, err);
    }
  }

  private schedulePersist(tabId: number): void {
    if (this.persistTimers.has(tabId)) return;
    const timer = setTimeout(() => {
      this.persistTimers.delete(tabId);
      void this.persistNow(tabId);
    }, 250);
    this.persistTimers.set(tabId, timer);
  }

  async add(tabId: number, draft: DraftTimelineEvent, maxEvents: number): Promise<TimelineEvent> {
    await this.ensureLoaded(tabId);
    const list = this.byTab.get(tabId) ?? [];

    const event: TimelineEvent = { ...draft, id: createId(), tabId };
    list.push(event);

    if (list.length > maxEvents) {
      list.splice(0, list.length - maxEvents);
    }

    this.byTab.set(tabId, list);
    this.schedulePersist(tabId);
    return event;
  }

  async get(tabId: number): Promise<TimelineEvent[]> {
    await this.ensureLoaded(tabId);
    return [...(this.byTab.get(tabId) ?? [])].sort((a, b) => a.timestamp - b.timestamp);
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
