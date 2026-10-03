import type { DraftFinding } from "../shared/messaging";
import { hashKey } from "../shared/id";

type ReportFn = (draft: DraftFinding) => void;

function firstStackLine(stack: string | undefined): string {
  if (!stack) return "";
  const lines = stack.split("\n");
  return lines.length > 1 ? lines[1]?.trim() ?? "" : "";
}

export function installErrorListeners(report: ReportFn): void {
  window.addEventListener("error", (event: ErrorEvent) => {
    const message = event.message || "Unknown error";
    const stack = event.error instanceof Error ? event.error.stack : undefined;
    const location = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "unknown";

    report({
      category: "javascript",
      severity: "critical",
      title: "Uncaught JavaScript error",
      description: message,
      evidence: [
        { label: "Message", value: message },
        { label: "Location", value: location },
        ...(stack ? [{ label: "Stack", value: stack }] : []),
      ],
      timestamp: Date.now(),
      groupKey: `js:error:${hashKey(message + firstStackLine(stack))}`,
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message =
      reason instanceof Error ? reason.message : typeof reason === "string" ? reason : JSON.stringify(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;

    report({
      category: "javascript",
      severity: "critical",
      title: "Unhandled promise rejection",
      description: message || "Promise rejected with no reason",
      evidence: [
        { label: "Reason", value: message ?? "(none)" },
        ...(stack ? [{ label: "Stack", value: stack }] : []),
      ],
      timestamp: Date.now(),
      groupKey: `js:rejection:${hashKey((message ?? "") + firstStackLine(stack))}`,
    });
  });

  window.addEventListener("__issue_detector_console__", (event: Event) => {
    const detail = (event as CustomEvent<{ level: "error" | "warn"; message: string }>).detail;
    if (!detail) return;

    report({
      category: "javascript",
      severity: detail.level === "error" ? "warning" : "info",
      title: detail.level === "error" ? "Console error logged" : "Console warning logged",
      description: detail.message,
      evidence: [{ label: "Message", value: detail.message }],
      timestamp: Date.now(),
      groupKey: `js:console:${detail.level}:${hashKey(detail.message)}`,
    });
  });
}
