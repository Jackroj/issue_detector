# Development

## Setup

```bash
npm install
npm run build      # one-shot build to dist/
npm run watch      # esbuild watch mode (rebuilds src/ on change; re-run `npm run build`
                    # once if you only changed a static file like an .html/.css)
npm run typecheck  # tsc --noEmit
```

Load `dist/` as an unpacked extension (`chrome://extensions` → Developer mode → Load unpacked).
After a rebuild, click the reload icon on the extension's card — content scripts need the page
reloaded too, since they're injected at `document_start`.

## Project layout

```text
src/
├── background/        service worker — the source of truth for all state
│   ├── index.ts        message router, badge updates, navigation/tab lifecycle
│   ├── store.ts         FindingStore — dedup/grouping, debounced session persistence
│   ├── timeline.ts       TimelineStore — raw chronological ring buffer
│   ├── network.ts         chrome.webRequest-driven detection
│   ├── correlate.ts        correlation rule table
│   └── ai/                opt-in local AI layer (see below)
├── content/            injected per page load
│   ├── main-world.ts    world:"MAIN" — patches console.*, history.pushState/replaceState
│   ├── index.ts          isolated world entry point — wires everything below, respects settings
│   ├── errors.ts          window.onerror / unhandledrejection / relayed console events
│   ├── performance.ts     navigation/resource timing, Long Tasks API
│   ├── rendering.ts       MutationObserver + Layout Instability API
│   └── loading.ts         synthesizes the "Potential performance issue" breakdown finding
├── devtools/           devtools_page + the DevTools panel (polls background every 1.5s)
├── popup/              action popup (loads once per open)
├── options/            full settings page
├── shared/             types + UI code shared by every surface above
│   ├── types.ts          Finding / TimelineEvent / DetectorSettings
│   ├── ai-types.ts        AIProvider / AIAnalysis / DebugContext / AISettings
│   ├── messaging.ts       the entire RuntimeMessage / RuntimeResponse protocol
│   ├── constants.ts       DEFAULT_SETTINGS
│   └── dashboard-ui.ts    the dashboard, shared by popup.ts and panel.ts
└── icons/
test-app/               a static page with one button per intentional problem (see below)
```

## Adding a new detector

1. Decide where it belongs: `background/network.ts` if it needs `chrome.webRequest`;
   `content/*.ts` if it needs a page-level browser API (`PerformanceObserver`,
   `MutationObserver`, `window` events).
2. Build a `DraftFinding` (see `shared/messaging.ts`) with a **stable `groupKey`** — this is
   what the store uses to collapse repeats into one row instead of spamming the list. Prefix it
   by category, e.g. `"rendering:mynewthing:page"`.
3. Call the injected `report()` callback (background) or send
   `{ type: "finding:report", finding: draft }` (content script).
4. Add any new thresholds to `DetectorSettings` (`shared/types.ts`), `DEFAULT_SETTINGS`
   (`shared/constants.ts`), and a corresponding input in `options/options.html` +
   `NUMBER_FIELDS` in `options/options.ts`.
5. Add a trigger button to `test-app/` so the detector is manually verifiable.

## Adding a correlation rule

Add a function matching `Rule` in `background/correlate.ts` to the `RULES` array:

```ts
const myRule: Rule = (recent, settings) => {
  const a = recent.find((f) => /* match on f.groupKey or f.category */);
  if (!a) return null;
  const b = recent.find((f) => /* match, using f.lastSeen >= a.lastSeen — NOT a.firstSeen */);
  if (!b) return null;
  return {
    ruleId: "my-rule",
    title: "...",
    description: "...", // always hedged: "is consistent with", never "is caused by"
    evidenceFindings: [a, b],
    confidence: 0.5, // cap well under 1.0
    possibleCauses: ["..."],
    recommendedInvestigation: ["..."],
    groupKeySeed: a.groupKey,
  };
};
```

No other file needs to change — `runCorrelation` picks up anything in `RULES`.

## Adding an AI provider

1. Implement `AIProvider` (`shared/ai-types.ts`) in a new file under `background/ai/providers/`.
2. Add its id to `AIProviderId` (`shared/ai-types.ts`).
3. Add a case in `resolveProvider()` (`background/ai/service.ts`).
4. Add an `<option>` to the provider `<select>` in `options/options.html`, plus any
   provider-specific config fields (follow the `ollama-fields` pattern) and wire them in
   `options/options.ts`'s `populate()`/`readForm()`.

The detection and correlation engines have zero knowledge of AI — this is a one-directional
dependency (`ai/` depends on `shared/types.ts`, nothing depends back on `ai/` except
`background/index.ts`'s message router and the dashboard's "Analyze with AI" button).

## Messaging protocol

Every message between a content script / popup / DevTools panel and the background service
worker is a discriminated union member of `RuntimeMessage` (`shared/messaging.ts`), handled by
the single `switch` in `background/index.ts`'s `handleMessage`. That switch ends in a
`const _exhaustive: never = message` default case — if you add a new `RuntimeMessage` variant
and forget to handle it, `tsc` will fail to compile, not fail silently at runtime.

## Build pipeline

`build.mjs` is a small hand-rolled esbuild script (no bundler framework) — it bundles every
entry point in `ENTRY_POINTS` to an IIFE (so the background service worker can stay a classic,
non-module worker) and copies every `.html`/`.css`/`.png`/`.json` file from `src/` to `dist/`
verbatim, preserving directory structure, plus the root `manifest.json`. There's no magic here;
read it top to bottom if something isn't ending up where you expect.

## Test applications

`test-app/index.html` + `app.js` is one page with a button per intentional problem, grouped by
category (Network / JavaScript / Performance / Rendering / Correlation & SPA state) — see
`README.md`'s "Example findings" and the Phase 4 test matrix in the project history for the
full list. Open it in a tab alongside the extension's popup or DevTools panel to verify a
change didn't break detection.

## Code style notes

- No framework, no virtual DOM — `dashboard-ui.ts` builds real DOM nodes directly. The one
  hard rule: never rebuild an `<input>`/`<select>` that currently has focus from a filter
  change — rebuild only the results list below it (see `buildIssuesTab`'s `refreshList`
  closure). Rebuilding the whole dashboard on every keystroke would lose cursor position.
- Comments explain *why*, not *what* — if you're tempted to write `// loop over findings`,
  don't; if you're explaining a non-obvious constraint (quota limits, API world boundaries,
  ordering bugs), do.
