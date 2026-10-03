# 2-3 Minute Demo Script

Setup beforehand (not timed): extension loaded unpacked from `dist/`, `test-app/index.html`
open in a tab, extension popup pinned to the toolbar, Settings → AI Assistant enabled
(rule-based provider is fine — no install needed for this demo).

## 0:00 – 0:20 — Open the broken app, show a failed API

> "This is a normal-looking test page. I'm going to click one button that calls a backend
> endpoint that returns a 500."

- Click **Trigger a 500 request** in test-app.
- Open the extension popup → **Issues** tab.
- Point at the new `[CRITICAL] Request failed with status 500` row — click to expand, show the
  Evidence table (URL, method, status, duration).

## 0:20 – 0:50 — Show repeated requests

> "Now let's simulate a bug every frontend dev has shipped by accident — a component firing the
> same request multiple times."

- Click **Fire 4 rapid duplicate calls**.
- Switch to the **Network** tab in the dashboard — point at `Potential duplicate request
  pattern detected`, note the wording: it says "potential," not "this is a bug."
- Click **Fire 6 calls to the same endpoint** — show the separate "Repeated calls to the same
  endpoint" finding, and mention the extension also detects *regular-interval polling* and
  *repeated failures* specifically, not just generic repetition.

## 0:50 – 1:30 — Show a performance issue + correlation

> "Now something more interesting — a slow API immediately followed by heavy JS work on the
> main thread."

- Click **Trigger slow API + long task back-to-back**.
- Wait ~4 seconds, hit **Refresh**.
- Open the **Performance** tab — show the long task finding.
- Open **Issues** (or point out the `correlated` badge) — show the synthesized finding: *"Slow
  API response may be delaying rendering"* with its **confidence score** and explicit wording:
  "these happened close together in time — this is a timing correlation, not a confirmed
  causal link."
- Mention: "Five separate warnings would be noisy. One correlated finding with a confidence
  score and reasoning is what a developer actually wants to see first."

## 1:30 – 2:10 — Open AI analysis, show causes + debugging steps

> "Every finding has an 'Analyze with AI' button."

- Expand the correlated finding from the previous step, click **Analyze with AI**.
- While it runs (instant for the rule-based provider), say: "This can run fully offline — a
  rule-based analyzer by default, or a local open-weight model like Llama via Ollama, or
  Chrome's own on-device model. No API key, no cloud call."
- Point at the result: **Summary**, **Likely causes** (each with a confidence percentage and
  reasoning), **Debugging steps**. Read one cause and one step aloud.
- Point at the disclaimer line: "AI-generated — verify before acting." and the provider name.

## 2:10 – 2:40 — Explain local/open-source AI

> "This matters because debugging data is often sensitive — internal URLs, error messages,
> sometimes stack traces that reference internal services. Sending that to a third-party cloud
> AI API is a real objection a lot of teams have. This extension's AI layer is a pluggable
> interface — swap providers without touching detection code — and the default path never
> leaves your machine at all."

- Optionally flip Settings → AI Assistant → Provider to "Ollama" and show the **Check provider
  availability** button (skip the live call if Ollama isn't running — the point is the
  architecture, not a live Ollama demo).

## 2:40 – 3:00 — Show the GitHub repository

- Switch to the repo. Point at `ARCHITECTURE.md`'s diagram and `PRIVACY.md`'s audit table.
- Close on: "Detection is deterministic and framework-agnostic, correlation links related
  events into one finding, and the AI layer is local-first by construction, not by policy."

## Fallback timings

If something doesn't fire fast enough live: `btn-404`/`btn-500` are instant; the correlated
chain needs ~4s wait; Ollama calls can take 5-20s depending on the model — have a cached
"Re-analyze" result ready from a rehearsal pass rather than waiting live on stage.
