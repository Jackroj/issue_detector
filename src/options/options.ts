import type { RuntimeResponse } from "../shared/messaging";
import type { DetectorSettings } from "../shared/types";
import type { AIProviderId } from "../shared/ai-types";
import { DEFAULT_SETTINGS } from "../shared/constants";

const form = document.getElementById("settings-form") as HTMLFormElement;
const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;
const status = document.getElementById("status") as HTMLElement;
const aiCheckBtn = document.getElementById("ai-check-btn") as HTMLButtonElement;
const aiCheckStatus = document.getElementById("ai-check-status") as HTMLElement;
const aiProviderSelect = document.getElementById("ai-provider-select") as HTMLSelectElement;
const ollamaFields = document.getElementById("ollama-fields") as HTMLElement;

const NUMBER_FIELDS: Array<keyof DetectorSettings> = [
  "slowRequestMs",
  "largeResourceBytes",
  "slowResourceMs",
  "longTaskMs",
  "repeatedWindowMs",
  "repeatedThreshold",
  "duplicateWindowMs",
  "duplicateThreshold",
  "repeatedFailureThreshold",
  "pollingWindowMs",
  "pollingThreshold",
  "pollingRegularityTolerance",
  "stateChangeProximityMs",
  "domContentLoadedWarnMs",
  "pageLoadWarnMs",
  "largeScriptBytes",
  "domMutationWindowMs",
  "domMutationThreshold",
  "domMutationBurstWindowMs",
  "domMutationBurstThreshold",
  "largeDomUpdateNodeThreshold",
  "layoutShiftWindowMs",
  "layoutShiftCountThreshold",
  "layoutShiftScoreThreshold",
  "correlationWindowMs",
  "maxFindingsPerTab",
  "maxTimelineEventsPerTab",
];

function updateOllamaFieldsVisibility(): void {
  ollamaFields.hidden = aiProviderSelect.value !== "ollama";
}

function populate(settings: DetectorSettings): void {
  for (const field of NUMBER_FIELDS) {
    const input = form.elements.namedItem(field) as HTMLInputElement | null;
    if (input) input.value = String(settings[field]);
  }
  for (const category of Object.keys(settings.enabledCategories) as Array<keyof DetectorSettings["enabledCategories"]>) {
    const input = form.elements.namedItem(`enabled_${category}`) as HTMLInputElement | null;
    if (input) input.checked = settings.enabledCategories[category];
  }

  (form.elements.namedItem("ai_enabled") as HTMLInputElement).checked = settings.ai.enabled;
  aiProviderSelect.value = settings.ai.provider;
  (form.elements.namedItem("ai_ollamaEndpoint") as HTMLInputElement).value = settings.ai.ollamaEndpoint;
  (form.elements.namedItem("ai_ollamaModel") as HTMLInputElement).value = settings.ai.ollamaModel;
  updateOllamaFieldsVisibility();
}

function readForm(): DetectorSettings {
  const data = new FormData(form);
  const settings: DetectorSettings = {
    ...DEFAULT_SETTINGS,
    enabledCategories: { ...DEFAULT_SETTINGS.enabledCategories },
    ai: { ...DEFAULT_SETTINGS.ai },
  };

  for (const field of NUMBER_FIELDS) {
    const raw = data.get(field);
    if (raw !== null) (settings as unknown as Record<string, number>)[field] = Number(raw);
  }
  for (const category of Object.keys(settings.enabledCategories) as Array<keyof DetectorSettings["enabledCategories"]>) {
    settings.enabledCategories[category] = data.get(`enabled_${category}`) !== null;
  }

  settings.ai = {
    enabled: data.get("ai_enabled") !== null,
    provider: (data.get("ai_provider") as AIProviderId | null) ?? DEFAULT_SETTINGS.ai.provider,
    ollamaEndpoint: String(data.get("ai_ollamaEndpoint") ?? DEFAULT_SETTINGS.ai.ollamaEndpoint),
    ollamaModel: String(data.get("ai_ollamaModel") ?? DEFAULT_SETTINGS.ai.ollamaModel),
  };

  return settings;
}

async function load(): Promise<void> {
  const response = (await chrome.runtime.sendMessage({ type: "settings:get" })) as RuntimeResponse;
  populate(response.ok && "settings" in response ? response.settings : DEFAULT_SETTINGS);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const settings = readForm();
  await chrome.runtime.sendMessage({ type: "settings:set", settings });
  status.textContent = "Saved";
  setTimeout(() => (status.textContent = ""), 1500);
});

resetBtn.addEventListener("click", async () => {
  populate(DEFAULT_SETTINGS);
  await chrome.runtime.sendMessage({ type: "settings:set", settings: DEFAULT_SETTINGS });
  status.textContent = "Reset to defaults";
  setTimeout(() => (status.textContent = ""), 1500);
});

aiProviderSelect.addEventListener("change", updateOllamaFieldsVisibility);

aiCheckBtn.addEventListener("click", async () => {
  // Checks against whatever is currently typed in the form (not yet saved) without side effects.
  const provider = aiProviderSelect.value as AIProviderId;
  const ollamaEndpoint = (form.elements.namedItem("ai_ollamaEndpoint") as HTMLInputElement).value;
  const ollamaModel = (form.elements.namedItem("ai_ollamaModel") as HTMLInputElement).value;
  aiCheckStatus.textContent = "Checking…";

  const response = (await chrome.runtime.sendMessage({
    type: "ai:checkAvailability",
    provider,
    ollamaEndpoint,
    ollamaModel,
  })) as RuntimeResponse;

  if (response.ok && "available" in response) {
    aiCheckStatus.textContent = response.available
      ? "✓ Available"
      : `✗ Not available${response.detail ? ` (${response.detail})` : ""}`;
  } else {
    aiCheckStatus.textContent = "✗ Error checking availability";
  }
});

load();
