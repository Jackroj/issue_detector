# Privacy

Privacy is a design constraint, not an afterthought bolted on at the end. This document is both
the policy and the audit: every claim below was checked against the actual source at the path
given, not assumed.

## What is collected

| Data | Source | Notes |
|---|---|---|
| Request URL, method, status code, duration, response size | `chrome.webRequest` (`background/network.ts`) | Response size comes only from the `Content-Length` header, not the body. |
| JS error messages, stack traces, console error/warning text | `window.onerror`, `unhandledrejection`, patched `console.error`/`warn` (`content/errors.ts`, `content/main-world.ts`) | Verbatim text — see caveat below. |
| Page/resource timing, long-task durations, DOM mutation counts, layout-shift scores | `PerformanceObserver`, `MutationObserver` (`content/performance.ts`, `content/rendering.ts`) | Counts/durations/sizes only — never element content. |
| SPA navigation signal | Patched `history.pushState`/`replaceState`, `popstate` (`main-world.ts`) | Only *that* a navigation happened, not any app state/data. |

## What is never collected

- **Request/response bodies.** `chrome.webRequest` is never registered with the
  `"requestBody"` extra-info spec, and response bodies are never read — only headers
  (specifically, only `Content-Length` is ever extracted; see `network.ts`'s
  `handleCompleted`).
- **Cookies.** No `cookies` permission is declared; `document.cookie` is never read anywhere in
  the codebase.
- **Page DOM text/HTML content.** `MutationObserver` callbacks only count added/removed nodes
  (`m.addedNodes.length`) — they never read `textContent`, `innerHTML`, or any attribute value.
- **Source code.** The extension has no access to your build artifacts or source maps; it only
  sees what crosses browser APIs at runtime.
- **Anything from pages the extension isn't running on.** Each tab's findings/timeline are
  isolated and cleared on navigation; nothing is aggregated across tabs or sent anywhere in
  bulk.

**Caveat on console/error text**: if your application logs sensitive data via
`console.error`/`console.warn`, or includes sensitive data in an error message or an exception
object's own properties, that text is captured verbatim — the extension has no way to know
what's sensitive in an arbitrary log message. If this is a concern, disable the **JavaScript**
category for that site in Settings.

## Headers

The spec goal here is "redact headers appropriately." In practice, the extension redacts by
**not collecting headers in the first place** — `responseHeaders` is only ever scanned for
`Content-Length`; no other header (including `Authorization`, `Set-Cookie`, custom auth
headers, etc.) is ever read, stored, or displayed. There is nothing further to redact because
nothing else is collected.

## Local AI and redaction (Phase 3)

The AI assistant is **off by default** (`DetectorSettings.ai.enabled = false`). When a developer
explicitly enables it and clicks "Analyze with AI" on a specific finding:

1. Only that finding's structured data is sent: title, description, evidence table (already
   visible in the dashboard), occurrence counts/timestamps, nearby timeline entries (±5s), and
   — for correlated findings — the titles/categories of the underlying findings. **Never**
   request/response bodies, cookies, or source code, because those are never collected to
   begin with.
2. Before it reaches any provider — including the "local" Ollama path — `background/ai/redact.ts`
   strips anything matching a JWT pattern, an email address, or a query-string parameter whose
   key looks like a credential (`token`, `key`, `secret`, `password`, `session`, `auth`, `jwt`,
   `credential`, etc.), replacing the value with `[redacted]`. This runs unconditionally; there
   is no setting to turn it off.
3. **The rule-based provider never leaves the machine at all** — it's pure local JavaScript,
   zero network calls, zero telemetry.
4. **The Ollama provider** only talks to the endpoint you configure (default
   `http://localhost:11434`) — your own machine, not a cloud service. No data crosses the
   network boundary of your own computer.
5. **The Chrome on-device provider** runs Gemini Nano locally in the browser — genuinely zero
   network calls for the analysis itself.
6. **No AI provider is ever a cloud API.** There is no code path to any hosted/proprietary AI
   service anywhere in this codebase — grep `background/ai/providers/` yourself; there are
   exactly three files, and none of them have a non-localhost/non-on-device destination.

## No telemetry, period

The extension makes **no network requests of its own** except:
- The user-initiated, user-configured Ollama call above (only when AI is enabled and a finding
  is explicitly analyzed).
- Nothing else. There is no analytics SDK, no error reporter, no update-check beyond the
  browser's own extension-update mechanism, no external font/script/stylesheet loaded by any
  extension page (popup/options/DevTools panel) — everything the UI needs ships in the bundle.

## Permissions — minimality

| Permission | Why | What it does *not* grant |
|---|---|---|
| `webRequest` | See status/timing/headers of requests (observe-only) | Cannot read request/response bodies; never registered with `"blocking"`, so it cannot modify or delay requests |
| `webNavigation` | Detect top-level page navigations, to reset per-page state | No content access |
| `storage` | Settings + ephemeral per-tab findings/timeline | Not synced to any account; `session` storage clears on browser close |
| `host_permissions: ["<all_urls>"]` | Required for `webRequest` visibility and content-script injection on whatever site you're debugging | Does not grant `tabs` (title/URL of *other* tabs); the popup's `chrome.tabs.query` only ever reads `tab.id` |

No `tabs`, `cookies`, `downloads`, `history`, `bookmarks`, `management`, or any other broad
permission is declared.

## Individual collector controls

Settings → **Categories** lets you disable Network, JavaScript, Performance, Rendering, or
Correlated insights independently per the browser profile. Settings → toolbar **Pause** button
stops recording new findings for the current tab without needing to reload or disable anything
— useful when you want to confirm the extension itself isn't affecting what you're debugging.

## Reporting a concern

This is a hackathon prototype, not an audited production tool. If you find a data-handling
issue, please open a GitHub issue describing exactly what was collected and from where.
