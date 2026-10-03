*This is a submission for the [Hacktoberfest Weekend Challenge: Build for a Friend](https://dev.to/challenges/hacktoberfest-weekend-2026-10-01)*

## What I Built

I built **Issue Detector**, a Chrome extension for my developer friend who spends a lot of time debugging web applications.

When something feels wrong in a web app, the first challenge isn't always fixing it — it's figuring out **what is actually causing the problem**.

Is an API failing?  
Is the same API being called repeatedly?  
Is a JavaScript error causing the page to break?  
Is the page slow because of network requests, large resources, or heavy client-side work?  
Are excessive DOM updates or rendering activity causing the UI to feel sluggish?

**Issue Detector** acts as a debugging companion. It observes browser activity and automatically detects suspicious patterns such as:

- Failed API requests
- Slow API/network requests
- Duplicate or repeated requests
- JavaScript errors
- Long-running browser tasks
- Large or slow resources
- Layout and rendering performance issues
- Excessive DOM activity
- Page loading problems

Instead of showing every problem as an unrelated warning, it correlates related evidence and presents it as a single investigation.

The developer can then ask the local AI analyzer to explain the finding in plain English, identify possible causes, show the evidence behind the conclusion, and suggest what to investigate next.

The goal isn't to replace DevTools. It's to reduce the **time spent figuring out where to start**.

## Demo

[Add a short video/demo link here]

The demo will show:

1. Opening a test web application.
2. Triggering a failed API request.
3. Triggering repeated API calls.
4. Creating a performance problem.
5. Issue Detector identifying the problems.
6. Related events being correlated into a single finding.
7. AI analysis explaining the possible cause.
8. Suggested debugging steps.

Because this is a Chrome extension, it can be installed locally through:

`chrome://extensions` → **Developer mode** → **Load unpacked**

See the README for installation instructions.

## Code

[Add GitHub repository link here]

The repository contains:

- Chrome extension source code
- Detection engine
- Correlation engine
- AI provider integration
- Test applications
- Architecture documentation
- Privacy documentation
- Development instructions

## How I Built It

The architecture is intentionally layered so that detection does not depend on a particular AI model.

```text
Browser / Chrome APIs
        ↓
Telemetry Collection
        ↓
Detection Engine
        ↓
Correlation Engine
        ↓
Structured Debug Context
        ↓
Local / Open AI
        ↓
Plain-English Explanation
```

The detection layer identifies observable browser events such as failed requests, slow requests, JavaScript errors, long tasks, DOM activity, and loading problems.

The correlation layer connects related events and provides the evidence used for analysis.

The AI layer receives structured debugging information rather than blindly receiving everything happening inside the browser.

The AI can then provide:

- Possible causes
- Evidence
- Confidence
- Recommended investigation steps

The AI is instructed to distinguish between **observed facts and possible explanations** rather than claiming that a suspected cause is definitely the bug.

The project is designed around **local/open-weight AI**, allowing the model to run on the developer's own machine rather than requiring a cloud AI API.

## Why Does Open Innovation Matter?

Open AI is important to this project because debugging information can contain sensitive application details.

A developer may be working on:

- Client applications
- Internal dashboards
- Private APIs
- Authentication flows
- Business applications
- Proprietary code

Sending that information to an external AI service isn't always appropriate.

With local/open-weight AI, the developer can analyze debugging information on their own machine without making a cloud AI service a requirement.

Open models also give the developer control over:

- Which model is used
- Where inference happens
- Model size and performance
- Offline usage
- Future customization

This makes the architecture more flexible than building the entire product around a single closed AI API.

The project also keeps the AI layer separate from the detection engine, so developers can change the local model without rewriting the browser-monitoring system.

## My Agent Session

The project was developed incrementally through multiple phases:

1. Browser telemetry and issue detection
2. Event correlation and performance analysis
3. Local AI integration
4. Developer experience, testing, privacy review, and final polish

## Prize CategoriesPrizes

Partners: Tinker, Render, Backboard, and ElevenLabs
<!-- Team Submissions: Please credit teammates using their DEV usernames if applicable. -->