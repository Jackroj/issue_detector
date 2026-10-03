/**
 * Runs in the page's MAIN world (declared via manifest content_scripts "world": "MAIN")
 * so it can patch the page's own `console` object and `history` methods. The isolated-world
 * content script (index.ts) cannot see page-originated console calls directly because
 * isolated worlds get their own console binding, even though they share the DOM/window
 * event target — which is why events dispatched here are still visible over there.
 */
const EVENT_NAME = "__issue_detector_console__";
const STATE_EVENT_NAME = "__issue_detector_state__";

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function patch(method: "error" | "warn"): void {
  const original = console[method];
  console[method] = function patched(...args: unknown[]) {
    original.apply(console, args);
    try {
      window.dispatchEvent(
        new CustomEvent(EVENT_NAME, {
          detail: { level: method, message: args.map(safeStringify).join(" ") },
        }),
      );
    } catch {
      // never let instrumentation break the page
    }
  };
}

patch("error");
patch("warn");

function notifyStateChange(reason: string): void {
  try {
    window.dispatchEvent(new CustomEvent(STATE_EVENT_NAME, { detail: { reason } }));
  } catch {
    // never let instrumentation break the page
  }
}

/**
 * SPA routers overwhelmingly use pushState/replaceState for client-side navigation, and
 * fire/observe popstate for back/forward. Patching these (framework-agnostic — it works
 * the same for React Router, Vue Router, Angular Router, etc.) lets the correlation engine
 * know "a client-side navigation/state change just happened" without any app integration.
 */
for (const method of ["pushState", "replaceState"] as const) {
  const original = history[method].bind(history);
  history[method] = function patched(...args: unknown[]) {
    const result = (original as (...a: unknown[]) => unknown)(...args);
    notifyStateChange(method);
    return result;
  } as typeof history.pushState;
}

window.addEventListener("popstate", () => notifyStateChange("popstate"));

