# Architecture

## High-level data flow

```text
Chrome APIs (webRequest, webNavigation, PerformanceObserver, MutationObserver, window.onerror)
        ↓
Content scripts (src/content/*)  +  background webRequest listener (src/background/network.ts)
        ↓
Structured Finding / TimelineEvent  (src/shared/types.ts)
        ↓
FindingStore / TimelineStore  (src/background/store.ts, src/background/timeline.ts)
        ↓
Correlation engine  (src/background/correlate.ts)
        ↓
AI Service + swappable providers  (src/background/ai/*)   — opt-in, local-only
        ↓
Dashboard UI  (src/shared/dashboard-ui.ts, rendered in popup + DevTools panel)
```

Everything from "Chrome APIs" down to "Correlation engine" runs **in the background service
worker**, which is the single source of truth for a tab's findings/timeline/settings. The
popup and DevTools panel are thin, stateless clients: they send a message, render whatever
comes back, and send messages for actions (clear, pause, set status, analyze).

## Why this split

- **Content scripts (`src/content/`)** run once per page load, in two worlds:
  - **MAIN world** (`main-world.ts`): the only script that needs direct access to the page's
    own `console` and `history` objects (isolated worlds get their own `console`/`window`
    bindings, so they can't intercept the page's own calls to `console.error` or
    `history.pushState`). It dispatches `CustomEvent`s on `window`, which — unlike `console` —
    *is* shared across worlds, so the isolated-world script can hear them.
  - **Isolated world** (`index.ts` + friends): everything else — `window.onerror`,
    `unhandledrejection`, `PerformanceObserver`, `MutationObserver`. These fire on the shared
    DOM event target, so no MAIN-world access is needed for them.
- **`background/network.ts`** uses `chrome.webRequest` instead of a content script because
  it's the only API surface that reliably sees HTTP status codes and timing for cross-origin
  requests regardless of CORS — a content script's `fetch`/`XHR` interception can't see status
  codes for most cross-origin failures.
- **The background service worker owns all state** (`FindingStore`, `TimelineStore`,
  `DetectorSettings`) so popup and DevTools panel stay dumb and interchangeable, and so
  findings survive the popup closing (service workers are suspended, not findings — state is
  mirrored to `chrome.storage.session`, see below).

## Finding model (`src/shared/types.ts`)

A `Finding` is a **deduplicated, aggregated** issue: repeats of the same problem (same
`groupKey`) increment `occurrences` and advance `lastSeen` on one row instead of spamming the
list. A `TimelineEvent` is the opposite: a **raw, non-deduplicated** point-in-time record, kept
so a developer can see the exact sequence of events around an issue.

Both are capped ring buffers per tab (`maxFindingsPerTab`, `maxTimelineEventsPerTab`) and are
cleared on every top-level navigation (`chrome.webNavigation.onCommitted`, frame 0 only — SPA
`pushState` navigations do *not* clear them, since those aren't real navigations).

## Persistence

Findings/timeline are mirrored to `chrome.storage.session` — ephemeral (cleared when the
browser closes), never synced, and scoped to this browser profile. This exists purely so a
suspended/restarted service worker (normal MV3 behavior) doesn't lose the current tab's data;
it is not meant as durable storage. Writes are debounced (250ms) per tab so a burst of findings
(e.g. a polling loop) collapses into one storage write instead of one per finding. Evidence
strings are truncated (800 chars) before persisting so one deep stack trace can't blow the
~1MB per-item storage quota.

Settings (`DetectorSettings`) persist to `chrome.storage.local` instead — they're small,
infrequent writes, and should survive even a full browser restart (unlike session storage).

## Detection engine (Phase 1-2)

Deterministic, threshold-based, no ML:

- `background/network.ts` — webRequest-driven: failures, slow requests, duplicate/repeated
  calls (sliding window + count), excessive polling (coefficient-of-variation on inter-call
  gaps — low variation ⇒ "this looks periodic"), repeated failures.
- `content/errors.ts` — `window.onerror`, `unhandledrejection`, relayed console errors/warnings.
- `content/performance.ts` — navigation timing, resource timing (slow/large), Long Tasks API.
- `content/rendering.ts` — `MutationObserver` (mutation bursts, large DOM updates, frequent
  update batches) and the Layout Instability API (`layout-shift` entries, excluding
  `hadRecentInput` shifts).
- `content/loading.ts` — synthesizes one "Potential performance issue" finding per slow page
  load, with an approximate contributor breakdown (JS download / API time / images / long
  tasks), using the real `renderBlockingStatus` resource-timing field for render-blocking
  detection.

## Correlation engine (Phase 2) — `background/correlate.ts`

A small rule table, each rule a plain function `(recentFindings, settings) => Match | null`:

```ts
type Rule = (recent: Finding[], settings: DetectorSettings) => CorrelationMatch | null;
```

`runCorrelation` filters findings to a recency window (`correlationWindowMs`), runs every rule,
and turns each match into a `category: "correlated"` Finding with `confidence` (capped at 0.85,
never 1.0 — correlation isn't proof), `possibleCauses`, and `recommendedInvestigation`. Rules
compare on `lastSeen` (not `firstSeen`) so a recurring finding's stale first-occurrence
timestamp can't falsely "match" an unrelated recent event. Correlated findings are produced
with `skipCorrelation: true` so they can't recursively trigger more correlation.

Adding a new correlation is adding one function to the `RULES` array — no other code changes.

## AI layer (Phase 3) — `background/ai/`

```ts
interface AIProvider {
  readonly id: AIProviderId;
  readonly label: string;
  isAvailable(): Promise<{ available: boolean; detail?: string }>;
  analyze(context: DebugContext): Promise<AIAnalysis>;
}
```

Three implementations behind this interface (`providers/heuristic.ts`, `providers/ollama.ts`,
`providers/chrome-builtin.ts`) — see [PRIVACY.md](./PRIVACY.md) for what each one does and does
not send anywhere. `AIService.analyze()`:

1. Builds a `DebugContext` from the finding + nearby timeline events + related findings
   (`ai/context.ts`).
2. Redacts anything that looks like a token/JWT/email (`ai/redact.ts`) — even for the local
   Ollama path, since "local" doesn't mean "skip redaction."
3. Calls the configured provider with a 30s timeout.
4. On any failure, falls back to the heuristic provider and says so in the result — the button
   never dead-ends.
5. Runs the result through `ai/safety.ts`'s `enforceHedgedLanguage`, a deterministic regex pass
   that rewrites overclaiming language ("is caused by" → "is consistent with") and clamps
   confidence to ≤0.9 — independent of whether the model actually followed the prompt's
   instructions.
6. Caches the result on the finding (so repeat views don't re-run the model) and returns it.

`ai/parse.ts` does lenient JSON extraction (balanced-brace scan from the first `{`, not a naive
"first `{` to last `}`") because local models don't always honor "respond with only JSON."

## Swapping/adding a model provider

Implement `AIProvider`, add a case to `resolveProvider()` in `ai/service.ts`, add the id to
`AIProviderId` in `shared/ai-types.ts`, and add it to the provider `<select>` in
`options/options.html`. The detection/correlation engine never needs to change — it has no
knowledge of AI at all.

## Dashboard (`src/shared/dashboard-ui.ts`)

One rendering module shared by the popup and the DevTools panel (they differ only in how they
fetch the active tab ID and how often they poll). Tabs: Overview, Issues (full filters),
Network/Errors/Performance (Issues pre-filtered by category), Timeline, AI Analysis (history of
past analyses), Settings (opens the full options page rather than duplicating it inline).

The Issues tab's filter bar is built **once** per tab-switch; filter changes only replace the
results list, never the filter inputs themselves — rebuilding a focused `<input>` on every
keystroke would lose cursor position/focus.

## Permissions

- `webRequest`, `webNavigation` — network/navigation visibility (no `webRequestBlocking`; this
  extension never modifies requests, only observes).
- `storage` — settings + ephemeral session persistence.
- `host_permissions: ["<all_urls>"]` — required for `webRequest` to see status/timing on
  arbitrary sites being debugged, and for the two content scripts to run anywhere. No `tabs`
  permission is declared; `chrome.tabs.query` in the popup only reads `tab.id`, which needs no
  permission at all.
