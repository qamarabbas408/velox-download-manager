import { load } from "@tauri-apps/plugin-store";
import type { AppSettings } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  maxConnections: 32,
  defaultSegments: 8,
  downloadDir: "",
  resumeEnabled: true,
};

const SETTINGS_KEY = "appSettings";

export async function loadSettings(): Promise<AppSettings> {
  try {
    const store = await load("settings.json", { autoSave: true });
    const raw = await store.get<Partial<AppSettings>>(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...raw };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  try {
    const store = await load("settings.json", { autoSave: true });
    await store.set(SETTINGS_KEY, settings);
  } catch {
    // best-effort persistence
  }
}