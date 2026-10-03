# Issue Detector

A Chrome extension that watches a web application for failed/slow/duplicate requests,
JavaScript errors, performance problems, and rendering instability — correlates related
findings into higher-level insights — and can explain any finding using a **local** AI model
(open-weight via Ollama, or Chrome's on-device Gemini Nano). No cloud AI dependency, no
application telemetry leaves your machine.

> "An intelligent debugging companion that watches what happens in your web application, finds
> suspicious behavior, explains why it might be happening, and helps you investigate it — while
> keeping your debugging data local."

## What it does

- **Network**: failed requests (4xx/5xx/connection errors), slow requests, duplicate/repeated
  request patterns, excessive polling, repeated failures.
- **JavaScript**: uncaught errors, unhandled promise rejections, console errors/warnings.
- **Performance**: slow DOMContentLoaded/load, long main-thread tasks, large/slow resources,
  large JS bundles, render-blocking resources — summarized into one "Potential performance
  issue" finding with a contributor breakdown.
- **Rendering**: excessive/large DOM mutations, frequent update patterns, layout instability
  (CLS-like layout shifts) — framework-agnostic (works the same for React, Vue, Angular,
  Svelte, or vanilla JS, since it observes the real DOM and browser timing APIs, not framework
  internals).
- **Correlation**: links related findings that happen close together in time into one
  higher-level finding (e.g. "slow API → long task → delayed render"), with an explicit
  confidence score and a reminder that correlation isn't proof of causation.
- **Timeline**: a raw, chronological log of navigation/network/JS/performance/state-change
  events so you can see exactly what happened before and after an issue.
- **AI Analysis**: an "Analyze with AI" button on every finding that produces a problem
  explanation, likely causes (with confidence and reasoning), evidence, and debugging steps —
  using a provider you control (see [Local AI setup](#local-ai-setup)).

See [ARCHITECTURE.md](./ARCHITECTURE.md) for how the pieces fit together, and
[PRIVACY.md](./PRIVACY.md) for exactly what is and isn't collected.

## Installation

1. `npm install`
2. `npm run build` — produces the loadable extension in `dist/`
3. In Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
   the `dist/` folder (not the project root, and not `test-app/`).
4. Open `test-app/index.html` in a tab and click any button to generate a finding; open the
   extension's popup or the "Issue Detector" DevTools panel to see it.

Re-run `npm run build` (or `npm run watch`) after making source changes, then click the reload
icon on the extension's card in `chrome://extensions`.

## Supported browsers

Chrome/Chromium-based browsers with Manifest V3 and the `content_scripts[].world` field
(Chrome 111+). The optional Chrome built-in AI provider additionally requires a Chrome version
with the on-device Prompt API enabled (see below) — everything else works without it.

## Local AI setup

The AI assistant is **off by default**. When you enable it (Settings → AI Assistant), you
choose one of three providers:

| Provider | Setup | Notes |
|---|---|---|
| **Rule-based (default)** | None | Zero-dependency deterministic analysis. Always available, works offline. |
| **Ollama** | Install [Ollama](https://ollama.com), `ollama pull llama3.2` (or any model), start it with `OLLAMA_ORIGINS=chrome-extension://* ollama serve` | Genuinely open-weight local models. Per-machine — see note below. |
| **Chrome on-device AI** | Chrome's Gemini Nano feature enabled/downloaded on this browser | Zero network call at all. Experimental extension API surface. |

**Ollama is per-machine, not something you configure once for everyone.** It's local software
each user who wants it runs on their own computer — the extension ships with the rule-based
provider as the zero-setup default specifically so it works for every user immediately, with
Ollama/Chrome-AI as opt-in upgrades. See the "Check provider availability" button in Settings
to verify your setup.

If a configured provider fails or is unreachable, the assistant automatically falls back to the
rule-based analysis and says so — the button never dead-ends.

## Development

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the build pipeline, project layout, and how to add a
new detector or AI provider.

## Known limitations

- Attribution in the "Potential performance issue" breakdown (JS/API/image/long-task time) is
  approximate — concurrent requests overlap, so the contributors won't sum to the total. It's a
  rough guide for where to look, not a profiler.
- Correlated findings are timing-based heuristics, not proof of causation — always phrased as
  "consistent with," never "caused by."
- The Chrome on-device AI provider depends on an evolving browser API; if it's unavailable in
  this Chrome build/version, the assistant transparently falls back to the rule-based provider.
- Detection is deterministic/rule-based (Phases 1-2); only the opt-in AI analysis layer uses a
  model, and only when you explicitly click "Analyze with AI."
- The extension detects client-side symptoms, not root causes in your source code — it can't
  see your codebase, only what crosses the network/JS/DOM/performance APIs.

## Example findings

```text
[WARNING] Potential duplicate request pattern detected
POST /api/projects was called 5 times within 2000ms.

[CRITICAL] Repeated failed requests
GET /api/users/me has failed 4 times within 10000ms.

[WARNING] Slow API response may be delaying rendering   (correlated, confidence 65%)
"Slow network request" occurred shortly before a long main-thread task and a slow page render.
```

## License

Built for a hackathon submission — see the repository for license details.
