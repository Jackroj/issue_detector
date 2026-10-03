import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from "./constants";
import type { DetectorSettings } from "./types";

export async function loadSettings(): Promise<DetectorSettings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const saved = stored[SETTINGS_STORAGE_KEY] as Partial<DetectorSettings> | undefined;
  if (!saved) return { ...DEFAULT_SETTINGS };
  return {
    ...DEFAULT_SETTINGS,
    ...saved,
    enabledCategories: {
      ...DEFAULT_SETTINGS.enabledCategories,
      ...(saved.enabledCategories ?? {}),
    },
  };
}

export async function saveSettings(settings: DetectorSettings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: settings });
}
