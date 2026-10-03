*This is a submission for the [Hacktoberfest Weekend Challenge: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)*

## What I Built

My friend does frontend work for a living, which means his days are full of the same quiet,
low-grade misery: something's broken, and the first twenty minutes of every bug aren't spent
fixing it — they're spent figuring out *what kind of bug it even is*. Is the API slow, or did
his code call it five times by accident? Is that error actually a bug, or just noise from a
third-party script? Is the page sluggish because of his JavaScript, or because someone shipped
a 2MB image above the fold?

DevTools can answer all of this, eventually, if you know exactly where to look. The real
problem is triage — figuring out which of fifteen possible things is the *one* thing worth
chasing, before you've burned half an hour chasing the wrong one.

[Optional: swap in the real moment that made you want to build this — a specific bug he
complained about, a Slack message, a late-night "why is this so slow" rant. One real sentence
here will do more for this post than anything else in it.]

So I built him **Issue Detector** — a Chrome extension that watches whatever web app he has
open, automatically flags failed requests, duplicate/repeated API calls, slow responses, JS
errors, and rendering jank, links the ones that are probably related into a single explanation
instead of five separate alarms, and can explain *why* something might be happening in plain
English — using a model that runs entirely on his own laptop. No API key, no per-request cost,
no app data ever leaving his machine unless he explicitly asks it to.

## Demo

[Screenshot or short screen recording here — open the test app, trigger a duplicate-call bug
and a slow-API-then-long-task combo, show the correlated finding, click "Analyze with AI,"
show the explanation.]

[Deployed/loadable: this is a Chrome extension, not a hosted site — link the GitHub repo and
note that it's loaded via `chrome://extensions` → Developer mode → Load unpacked → `dist/`,
per the README.]

## Code

[Embed or link the GitHub repository here.]

Also in the repo: `ARCHITECTURE.md` (how the pieces fit together), `PRIVACY.md` (an audit of
what is and isn't collected, checked line-by-line against the source rather than asserted), and
`DEVELOPMENT.md` for anyone who wants to add a detector or swap in a different local model.

## How I Built It

The pipeline is deliberately layered so the AI is swappable without touching detection:

```text
Chrome APIs (network, navigation, performance, DOM mutations, errors)
        ↓
Detection engine        — deterministic: failed/slow/duplicate requests, long tasks,
        ↓                 layout shifts, DOM mutation bursts
Correlation engine      — links related findings into one explanation instead of five
        ↓                 separate warnings, with an honest confidence score
Local AI (your choice)  — rule-based, Ollama (open-weight), or Chrome's on-device model
        ↓
Plain-English explanation — likely causes, evidence, concrete next steps to check
```

The AI layer is a single interface — `analyze(context) → explanation` — with three
interchangeable implementations behind it:

- **A zero-dependency rule-based analyzer** (the always-on default, no model required at all).
- **[Ollama](https://ollama.com)**, running any open-weight model he wants — Llama, Mistral,
  Phi — entirely on his own machine, no cloud call.
- **Chrome's own on-device model** (Gemini Nano via the Prompt API), for zero-network-call
  inference built right into the browser.

Every finding — AI-analyzed or not — comes with a "why do you think that" trail: the raw
evidence (which request, which error, which timing number), and for anything AI-touched, an
explicit rule that it's never allowed to say "this is definitely X" — only "this is consistent
with X, here's how to confirm it." I didn't want to hand my friend a tool that sounds more
confident than it actually is.

## Why Does Open Innovation Matter?

This isn't a checkbox — it's the reason the tool is usable *for him specifically*:

- **He debugs client work.** A lot of frontend contract work comes with an implicit (and
  sometimes explicit, in-writing) "don't paste our code or our errors into random AI tools"
  expectation. A cloud AI debugging assistant is a non-starter for exactly the people who'd
  benefit from it most. A local one isn't — there's nothing to explain to a client, because
  nothing left the laptop.
- **It costs nothing to run, forever.** He hits the same handful of bug shapes ten times a
  week. Paying per-call for a cloud model to explain "yep, that's a duplicate request" every
  time is a bad trade. A quantized open-weight model running locally via Ollama costs
  electricity, not API credits.
- **It works with no internet.** Half of debugging happens on a train, in a coffee shop with
  dead wifi, or on a flight. The rule-based analysis and the on-device model both work
  completely offline — no "AI assistant is temporarily unavailable" banner at the worst
  possible moment.
- **He can swap or tune the model himself.** If he decides he wants a bigger model, or a
  fine-tuned one, he changes one setting in the extension. Nothing about how findings are
  detected or correlated has to change at all.

None of this works with a closed, cloud-hosted model. The whole value proposition — "debug
freely, including client work, for free, offline, with a model you control" — only exists
*because* the AI is open and local.

## My Agent Session

[Optional — if you want to include it: link the DevRelay/Claude Code session this was built in.
It's a long, iterative session — four build phases, each one reviewed for real bugs before
moving to the next (a storage-quota issue, a stale-timestamp bug in the correlation rules, a
focus-loss bug in the dashboard's filter inputs) — which might be interesting to judges who
want to see process, not just output.]

## Prize Categories

[List the partner categories you're entering, if any — e.g. if Ollama is a listed partner
technology for this challenge. Remove this section if none apply.]
