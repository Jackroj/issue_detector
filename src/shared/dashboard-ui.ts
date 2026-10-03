import type { Finding, FindingCategory, FindingSeverity, TimelineEvent } from "./types";
import type { AIAnalysis } from "./ai-types";
import { formatTime } from "./format";

export interface DashboardData {
  findings: Finding[];
  timeline: TimelineEvent[];
  paused: boolean;
}

export interface DashboardHandlers {
  onClear: () => void;
  onRefresh: () => void;
  onAnalyze: (findingId: string) => Promise<AIAnalysis>;
  onSetStatus: (findingId: string, status: Finding["status"]) => void;
  onTogglePause: () => void;
  onOpenSettings: () => void;
}

const CATEGORY_LABEL: Record<FindingCategory, string> = {
  network: "Network",
  javascript: "JavaScript",
  performance: "Performance",
  rendering: "Rendering",
  correlated: "Correlated",
};

type TabId = "overview" | "issues" | "network" | "errors" | "performance" | "timeline" | "ai" | "settings";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "issues", label: "Issues" },
  { id: "network", label: "Network" },
  { id: "errors", label: "Errors" },
  { id: "performance", label: "Performance" },
  { id: "timeline", label: "Timeline" },
  { id: "ai", label: "AI Analysis" },
  { id: "settings", label: "Settings" },
];

let activeTab: TabId = "overview";

interface FilterState {
  severity: "all" | FindingSeverity;
  category: "all" | FindingCategory;
  timeRange: "all" | "5m" | "15m" | "1h";
  urlQuery: string;
  typeQuery: string;
  showResolved: boolean;
}

const TIME_RANGE_MS: Record<Exclude<FilterState["timeRange"], "all">, number> = {
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
};

const filters: FilterState = {
  severity: "all",
  category: "all",
  timeRange: "all",
  urlQuery: "",
  typeQuery: "",
  showResolved: false,
};

export function renderDashboard(root: HTMLElement, data: DashboardData, handlers: DashboardHandlers): void {
  root.replaceChildren();

  const rerenderFull = () => renderDashboard(root, data, handlers);

  root.appendChild(buildToolbar(data, handlers));
  root.appendChild(buildTabBar(rerenderFull, handlers.onOpenSettings));

  switch (activeTab) {
    case "overview":
      root.appendChild(buildOverview(data, handlers));
      break;
    case "issues":
      root.appendChild(buildIssuesTab(data, handlers));
      break;
    case "network":
      root.appendChild(buildIssuesTab(data, handlers, ["network"]));
      break;
    case "errors":
      root.appendChild(buildIssuesTab(data, handlers, ["javascript"]));
      break;
    case "performance":
      root.appendChild(buildIssuesTab(data, handlers, ["performance", "rendering"]));
      break;
    case "timeline":
      root.appendChild(buildTimelineList(data.timeline));
      break;
    case "ai":
      root.appendChild(buildAiHistoryTab(data.findings));
      break;
    case "settings":
      // Intercepted in the tab bar's click handler (opens the real options page) — never reached.
      break;
  }
}

function buildToolbar(data: DashboardData, handlers: DashboardHandlers): HTMLElement {
  const toolbar = document.createElement("div");
  toolbar.className = "toolbar";

  const refreshBtn = document.createElement("button");
  refreshBtn.textContent = "Refresh";
  refreshBtn.className = "btn";
  refreshBtn.addEventListener("click", handlers.onRefresh);

  const clearBtn = document.createElement("button");
  clearBtn.textContent = "Clear";
  clearBtn.className = "btn btn-secondary";
  clearBtn.addEventListener("click", handlers.onClear);

  const pauseBtn = document.createElement("button");
  pauseBtn.className = `btn ${data.paused ? "btn-paused" : "btn-secondary"}`;
  pauseBtn.textContent = data.paused ? "▶ Resume" : "⏸ Pause";
  pauseBtn.title =
    "Stops recording new findings for this tab (without reloading the page) — useful to confirm the extension itself isn't affecting what you're debugging.";
  pauseBtn.addEventListener("click", handlers.onTogglePause);

  toolbar.append(refreshBtn, clearBtn, pauseBtn);
  return toolbar;
}

function buildTabBar(rerenderFull: () => void, onOpenSettings: () => void): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "tab-bar";

  for (const tab of TABS) {
    const btn = document.createElement("button");
    btn.textContent = tab.label;
    btn.className = `tab-button ${activeTab === tab.id ? "active" : ""}`.trim();
    btn.addEventListener("click", () => {
      if (tab.id === "settings") {
        onOpenSettings();
        return;
      }
      activeTab = tab.id;
      rerenderFull();
    });
    bar.appendChild(btn);
  }

  return bar;
}

function buildOverview(data: DashboardData, handlers: DashboardHandlers): HTMLElement {
  const container = document.createElement("div");
  const openFindings = data.findings.filter((f) => (f.status ?? "open") === "open");

  container.appendChild(buildTiles(openFindings));

  const recent = [...openFindings].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, 8);
  const heading = document.createElement("div");
  heading.className = "detail-section-label";
  heading.style.marginTop = "10px";
  heading.textContent = recent.length > 0 ? "Most recent" : "";
  container.appendChild(heading);

  container.appendChild(buildFindingRowsList(recent, data.timeline, handlers, "No issues detected on this page yet."));
  return container;
}

function buildTiles(findings: Finding[]): HTMLElement {
  const total = findings.length;
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warnings = findings.filter((f) => f.severity === "warning").length;
  const networkFailures = findings.filter(
    (f) => f.category === "network" && (f.groupKey.startsWith("network:failure") || f.groupKey.startsWith("network:error")),
  ).length;
  const jsErrors = findings.filter((f) => f.category === "javascript").length;
  const perfIssues = findings.filter((f) => f.category === "performance" || f.category === "rendering").length;

  const tiles = document.createElement("div");
  tiles.className = "tiles";

  const specs: Array<[string, number, string]> = [
    ["Total", total, ""],
    ["Critical", critical, "tile-critical"],
    ["Warnings", warnings, "tile-warning"],
    ["Network failures", networkFailures, ""],
    ["JS errors", jsErrors, ""],
    ["Performance", perfIssues, ""],
  ];

  for (const [label, value, extraClass] of specs) {
    const tile = document.createElement("div");
    tile.className = `tile ${extraClass}`.trim();

    const valueEl = document.createElement("div");
    valueEl.className = "tile-value";
    valueEl.textContent = String(value);

    const labelEl = document.createElement("div");
    labelEl.className = "tile-label";
    labelEl.textContent = label;

    tile.append(valueEl, labelEl);
    tiles.appendChild(tile);
  }

  return tiles;
}

function applyFilters(findings: Finding[], fixedCategories?: FindingCategory[]): Finding[] {
  const now = Date.now();
  const cutoff = filters.timeRange === "all" ? 0 : now - TIME_RANGE_MS[filters.timeRange];
  const urlQuery = filters.urlQuery.trim().toLowerCase();
  const typeQuery = filters.typeQuery.trim().toLowerCase();

  return findings.filter((f) => {
    if (fixedCategories && !fixedCategories.includes(f.category)) return false;
    if (!fixedCategories && filters.category !== "all" && f.category !== filters.category) return false;
    if (filters.severity !== "all" && f.severity !== filters.severity) return false;
    if (f.lastSeen < cutoff) return false;
    if (!filters.showResolved && (f.status ?? "open") !== "open") return false;
    if (urlQuery) {
      const hay = `${f.description} ${f.evidence.map((e) => e.value).join(" ")}`.toLowerCase();
      if (!hay.includes(urlQuery)) return false;
    }
    if (typeQuery && !f.title.toLowerCase().includes(typeQuery)) return false;
    return true;
  });
}

/** Builds the filter bar's own DOM once; filter changes only touch the list below it, never
 * rebuilding these inputs — otherwise every keystroke in a text filter would lose focus. */
function buildIssuesTab(data: DashboardData, handlers: DashboardHandlers, fixedCategories?: FindingCategory[]): HTMLElement {
  const container = document.createElement("div");
  const listContainer = document.createElement("div");

  const refreshList = () => {
    const filtered = applyFilters(data.findings, fixedCategories);
    listContainer.replaceChildren();

    const countLine = document.createElement("div");
    countLine.className = "count-line";
    countLine.textContent = `Showing ${filtered.length} of ${data.findings.length} findings`;
    listContainer.appendChild(countLine);

    listContainer.appendChild(
      buildFindingRowsList(
        filtered.sort((a, b) => b.lastSeen - a.lastSeen),
        data.timeline,
        handlers,
        "No findings match the current filters.",
      ),
    );
  };

  container.appendChild(buildFilterBar(refreshList, fixedCategories));
  container.appendChild(listContainer);
  refreshList();
  return container;
}

function buildFilterBar(refreshList: () => void, fixedCategories?: FindingCategory[]): HTMLElement {
  const bar = document.createElement("div");
  bar.className = "filter-bar";

  const severitySelect = document.createElement("select");
  severitySelect.className = "filter-select";
  for (const [value, label] of [
    ["all", "All severities"],
    ["critical", "Critical"],
    ["warning", "Warning"],
    ["info", "Info"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = value === filters.severity;
    severitySelect.appendChild(opt);
  }
  severitySelect.addEventListener("change", () => {
    filters.severity = severitySelect.value as FilterState["severity"];
    refreshList();
  });
  bar.appendChild(severitySelect);

  if (!fixedCategories) {
    const categorySelect = document.createElement("select");
    categorySelect.className = "filter-select";
    const options: Array<[string, string]> = [
      ["all", "All categories"],
      ...(Object.keys(CATEGORY_LABEL) as FindingCategory[]).map((c): [string, string] => [c, CATEGORY_LABEL[c]]),
    ];
    for (const [value, label] of options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      opt.selected = value === filters.category;
      categorySelect.appendChild(opt);
    }
    categorySelect.addEventListener("change", () => {
      filters.category = categorySelect.value as FilterState["category"];
      refreshList();
    });
    bar.appendChild(categorySelect);
  }

  const timeSelect = document.createElement("select");
  timeSelect.className = "filter-select";
  for (const [value, label] of [
    ["all", "All time"],
    ["5m", "Last 5 min"],
    ["15m", "Last 15 min"],
    ["1h", "Last hour"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    opt.selected = value === filters.timeRange;
    timeSelect.appendChild(opt);
  }
  timeSelect.addEventListener("change", () => {
    filters.timeRange = timeSelect.value as FilterState["timeRange"];
    refreshList();
  });
  bar.appendChild(timeSelect);

  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "Filter by URL/text…";
  urlInput.className = "filter-input";
  urlInput.value = filters.urlQuery;
  urlInput.addEventListener("input", () => {
    filters.urlQuery = urlInput.value;
    refreshList();
  });
  bar.appendChild(urlInput);

  const typeInput = document.createElement("input");
  typeInput.type = "text";
  typeInput.placeholder = "Filter by issue type…";
  typeInput.className = "filter-input";
  typeInput.value = filters.typeQuery;
  typeInput.addEventListener("input", () => {
    filters.typeQuery = typeInput.value;
    refreshList();
  });
  bar.appendChild(typeInput);

  const showResolvedLabel = document.createElement("label");
  showResolvedLabel.className = "filter-checkbox-label";
  const showResolvedCheckbox = document.createElement("input");
  showResolvedCheckbox.type = "checkbox";
  showResolvedCheckbox.checked = filters.showResolved;
  showResolvedCheckbox.addEventListener("change", () => {
    filters.showResolved = showResolvedCheckbox.checked;
    refreshList();
  });
  showResolvedLabel.append(showResolvedCheckbox, document.createTextNode(" Show ignored/resolved"));
  bar.appendChild(showResolvedLabel);

  return bar;
}

function buildFindingRowsList(
  findings: Finding[],
  timeline: TimelineEvent[],
  handlers: DashboardHandlers,
  emptyMessage: string,
): HTMLElement {
  const list = document.createElement("div");
  list.className = "finding-list";

  if (findings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = emptyMessage;
    list.appendChild(empty);
    return list;
  }

  for (const finding of findings) {
    list.appendChild(buildFindingRow(finding, timeline, handlers));
  }
  return list;
}

function buildFindingRow(finding: Finding, timeline: TimelineEvent[], handlers: DashboardHandlers): HTMLElement {
  const status = finding.status ?? "open";
  const row = document.createElement("div");
  row.className = `finding-row severity-${finding.severity} status-${status}`;

  const header = document.createElement("button");
  header.className = "finding-header";
  header.setAttribute("aria-expanded", "false");

  const dot = document.createElement("span");
  dot.className = `severity-dot severity-${finding.severity}`;

  const title = document.createElement("span");
  title.className = "finding-title";
  title.textContent = finding.title;

  const badge = document.createElement("span");
  badge.className = "category-badge";
  badge.textContent = CATEGORY_LABEL[finding.category];

  if (status !== "open") {
    const statusBadge = document.createElement("span");
    statusBadge.className = "status-badge";
    statusBadge.textContent = status === "ignored" ? "Ignored" : "Resolved";
    header.append(dot, title, badge, statusBadge);
  } else {
    header.append(dot, title, badge);
  }

  const meta = document.createElement("span");
  meta.className = "finding-meta";
  meta.textContent =
    finding.occurrences > 1
      ? `×${finding.occurrences} · last ${formatTime(finding.lastSeen)}`
      : formatTime(finding.lastSeen);
  header.append(meta);

  const details = document.createElement("div");
  details.className = "finding-details";
  details.hidden = true;

  details.appendChild(buildActionsRow(finding, handlers));

  const description = document.createElement("p");
  description.className = "finding-description";
  description.textContent = finding.description;
  details.appendChild(description);

  if (finding.confidence !== undefined) {
    details.appendChild(buildConfidenceBar(finding.confidence));
  }

  if (finding.evidence.length > 0) {
    details.appendChild(buildLabeledSection("Evidence", buildEvidenceTable(finding.evidence)));
  }

  const timelineContext = buildInlineTimeline(finding, timeline);
  if (timelineContext) {
    details.appendChild(buildLabeledSection("Timeline context (±5s)", timelineContext));
  }

  if (finding.possibleCauses && finding.possibleCauses.length > 0) {
    details.appendChild(buildLabeledSection("Possible causes", buildBulletList(finding.possibleCauses)));
  }

  details.appendChild(buildAiSection(finding, handlers.onAnalyze));

  if (finding.recommendedInvestigation && finding.recommendedInvestigation.length > 0) {
    details.appendChild(buildLabeledSection("Recommended investigation", buildBulletList(finding.recommendedInvestigation)));
  }

  header.addEventListener("click", () => {
    const expanded = header.getAttribute("aria-expanded") === "true";
    header.setAttribute("aria-expanded", String(!expanded));
    details.hidden = expanded;
  });

  row.append(header, details);
  return row;
}

function buildInlineTimeline(finding: Finding, timeline: TimelineEvent[]): HTMLElement | null {
  const windowMs = 5000;
  const nearby = timeline.filter((e) => Math.abs(e.timestamp - finding.lastSeen) <= windowMs);
  return nearby.length > 0 ? buildTimelineList(nearby) : null;
}

function buildActionsRow(finding: Finding, handlers: DashboardHandlers): HTMLElement {
  const row = document.createElement("div");
  row.className = "actions-row";

  const copyBtn = document.createElement("button");
  copyBtn.className = "btn btn-small";
  copyBtn.textContent = "Copy";

  const feedback = document.createElement("span");
  feedback.className = "action-feedback";

  copyBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(formatFindingAsText(finding));
      feedback.textContent = "Copied!";
    } catch {
      feedback.textContent = "Copy failed";
    }
    setTimeout(() => (feedback.textContent = ""), 1500);
  });

  const exportBtn = document.createElement("button");
  exportBtn.className = "btn btn-small";
  exportBtn.textContent = "Export";
  exportBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    exportFinding(finding);
  });

  row.append(copyBtn, exportBtn, feedback);

  const status = finding.status ?? "open";
  if (status === "open") {
    const ignoreBtn = document.createElement("button");
    ignoreBtn.className = "btn btn-small";
    ignoreBtn.textContent = "Ignore";
    ignoreBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSetStatus(finding.id, "ignored");
    });

    const resolveBtn = document.createElement("button");
    resolveBtn.className = "btn btn-small";
    resolveBtn.textContent = "Mark resolved";
    resolveBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSetStatus(finding.id, "resolved");
    });

    row.append(ignoreBtn, resolveBtn);
  } else {
    const reopenBtn = document.createElement("button");
    reopenBtn.className = "btn btn-small";
    reopenBtn.textContent = "Reopen";
    reopenBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      handlers.onSetStatus(finding.id, "open");
    });
    row.append(reopenBtn);
  }

  return row;
}

function formatFindingAsText(finding: Finding): string {
  const lines: string[] = [];
  lines.push(`[${finding.severity.toUpperCase()}] ${finding.title}`);
  lines.push(
    `Category: ${CATEGORY_LABEL[finding.category]} | Occurrences: ${finding.occurrences} | First seen: ${new Date(finding.firstSeen).toLocaleString()} | Last seen: ${new Date(finding.lastSeen).toLocaleString()}`,
  );
  lines.push("", "Description:", finding.description);

  if (finding.evidence.length > 0) {
    lines.push("", "Evidence:");
    for (const e of finding.evidence) lines.push(`- ${e.label}: ${e.value}`);
  }
  if (finding.possibleCauses?.length) {
    lines.push("", "Possible causes:");
    for (const c of finding.possibleCauses) lines.push(`- ${c}`);
  }
  if (finding.recommendedInvestigation?.length) {
    lines.push("", "Recommended investigation:");
    for (const r of finding.recommendedInvestigation) lines.push(`- ${r}`);
  }
  if (finding.aiAnalysis) {
    lines.push("", `AI Analysis (provider: ${finding.aiAnalysis.provider ?? "unknown"}):`, finding.aiAnalysis.summary);
    if (finding.aiAnalysis.likelyCauses.length > 0) {
      lines.push("Likely causes:");
      for (const c of finding.aiAnalysis.likelyCauses) {
        lines.push(`- ${c.cause} (${Math.round(c.confidence * 100)}%): ${c.reasoning}`);
      }
    }
    if (finding.aiAnalysis.debuggingSteps.length > 0) {
      lines.push("Debugging steps:");
      for (const s of finding.aiAnalysis.debuggingSteps) lines.push(`- ${s}`);
    }
  }

  return lines.join("\n");
}

function exportFinding(finding: Finding): void {
  const blob = new Blob([JSON.stringify(finding, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finding-${finding.id}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildAiSection(finding: Finding, onAnalyze: (findingId: string) => Promise<AIAnalysis>): HTMLElement {
  const section = document.createElement("div");
  section.className = "ai-section";

  const button = document.createElement("button");
  button.className = "btn btn-ai";
  button.textContent = finding.aiAnalysis ? "Re-analyze with AI" : "Analyze with AI";

  const resultContainer = document.createElement("div");
  resultContainer.className = "ai-result";
  if (finding.aiAnalysis) {
    resultContainer.appendChild(renderAiAnalysis(finding.aiAnalysis));
  }

  button.addEventListener("click", async (e) => {
    e.stopPropagation();
    button.disabled = true;
    button.textContent = "Analyzing…";
    resultContainer.replaceChildren();

    try {
      const analysis = await onAnalyze(finding.id);
      resultContainer.replaceChildren(renderAiAnalysis(analysis));
      button.textContent = "Re-analyze with AI";
    } catch (err) {
      const errorEl = document.createElement("p");
      errorEl.className = "ai-error";
      errorEl.textContent = err instanceof Error ? err.message : "AI analysis failed.";
      resultContainer.replaceChildren(errorEl);
      button.textContent = "Analyze with AI";
    } finally {
      button.disabled = false;
    }
  });

  section.append(button, resultContainer);
  return section;
}

function renderAiAnalysis(analysis: AIAnalysis): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "ai-analysis";

  const disclaimer = document.createElement("p");
  disclaimer.className = "ai-disclaimer";
  disclaimer.textContent = `AI-generated — verify before acting. Provider: ${analysis.provider ?? "unknown"}.`;
  wrapper.appendChild(disclaimer);

  const summary = document.createElement("p");
  summary.className = "ai-summary";
  summary.textContent = analysis.summary;
  wrapper.appendChild(summary);

  if (analysis.likelyCauses.length > 0) {
    const causesList = document.createElement("div");
    for (const cause of analysis.likelyCauses) {
      const item = document.createElement("div");
      item.className = "ai-cause";

      const title = document.createElement("div");
      title.className = "ai-cause-title";
      title.textContent = `${cause.cause} (${Math.round(cause.confidence * 100)}% confidence)`;

      const reasoning = document.createElement("div");
      reasoning.className = "ai-cause-reasoning";
      reasoning.textContent = cause.reasoning;

      item.append(title, reasoning);
      causesList.appendChild(item);
    }
    wrapper.appendChild(buildLabeledSection("Possible causes", causesList));
  }

  if (analysis.evidence.length > 0) {
    wrapper.appendChild(buildLabeledSection("AI-cited evidence", buildBulletList(analysis.evidence)));
  }

  if (analysis.debuggingSteps.length > 0) {
    wrapper.appendChild(buildLabeledSection("Debugging steps", buildOrderedList(analysis.debuggingSteps)));
  }

  return wrapper;
}

function buildAiHistoryTab(findings: Finding[]): HTMLElement {
  const container = document.createElement("div");
  const withAi = findings
    .filter((f): f is Finding & { aiAnalysis: AIAnalysis } => Boolean(f.aiAnalysis))
    .sort((a, b) => (b.aiAnalysis.generatedAt ?? 0) - (a.aiAnalysis.generatedAt ?? 0));

  if (withAi.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = 'No AI analyses yet — click "Analyze with AI" on a finding in the Issues tab.';
    container.appendChild(empty);
    return container;
  }

  for (const finding of withAi) {
    const card = document.createElement("div");
    card.className = "ai-history-card";

    const header = document.createElement("div");
    header.className = "ai-history-header";
    header.textContent = `${CATEGORY_LABEL[finding.category]} · ${finding.title}`;
    card.appendChild(header);

    card.appendChild(renderAiAnalysis(finding.aiAnalysis));
    container.appendChild(card);
  }
  return container;
}

function buildOrderedList(items: string[]): HTMLElement {
  const ol = document.createElement("ol");
  ol.className = "bullet-list";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ol.appendChild(li);
  }
  return ol;
}

function buildLabeledSection(label: string, content: HTMLElement): HTMLElement {
  const section = document.createElement("div");
  section.className = "detail-section";

  const heading = document.createElement("div");
  heading.className = "detail-section-label";
  heading.textContent = label;

  section.append(heading, content);
  return section;
}

function buildEvidenceTable(evidence: Finding["evidence"]): HTMLElement {
  const table = document.createElement("table");
  table.className = "evidence-table";
  for (const item of evidence) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = item.label;
    const td = document.createElement("td");
    td.textContent = String(item.value);
    tr.append(th, td);
    table.appendChild(tr);
  }
  return table;
}

function buildBulletList(items: string[]): HTMLElement {
  const ul = document.createElement("ul");
  ul.className = "bullet-list";
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = item;
    ul.appendChild(li);
  }
  return ul;
}

function buildConfidenceBar(confidence: number): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "confidence";

  const label = document.createElement("span");
  label.className = "confidence-label";
  label.textContent = `Confidence: ${Math.round(confidence * 100)}%`;

  const bar = document.createElement("div");
  bar.className = "confidence-bar";
  const fill = document.createElement("div");
  fill.className = "confidence-fill";
  fill.style.width = `${Math.round(confidence * 100)}%`;
  bar.appendChild(fill);

  wrapper.append(label, bar);
  return wrapper;
}

const TIMELINE_ICON: Record<TimelineEvent["kind"], string> = {
  navigation: "\u{1F9ED}",
  "state-change": "\u{1F504}",
  network: "\u{1F310}",
  javascript: "\u{1F41E}",
  performance: "⏱️",
  rendering: "\u{1F3A8}",
  correlated: "\u{1F517}",
};

function buildTimelineList(timeline: TimelineEvent[]): HTMLElement {
  const list = document.createElement("div");
  list.className = "timeline-list";

  if (timeline.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No timeline events recorded yet.";
    list.appendChild(empty);
    return list;
  }

  for (const event of [...timeline].sort((a, b) => a.timestamp - b.timestamp)) {
    const row = document.createElement("div");
    row.className = `timeline-row timeline-${event.kind}`;

    const time = document.createElement("span");
    time.className = "timeline-time";
    time.textContent = formatTime(event.timestamp);

    const icon = document.createElement("span");
    icon.className = "timeline-icon";
    icon.textContent = TIMELINE_ICON[event.kind] ?? "•";

    const summary = document.createElement("span");
    summary.className = "timeline-summary";
    summary.textContent = event.summary;

    row.append(time, icon, summary);
    list.appendChild(row);
  }

  return list;
}
