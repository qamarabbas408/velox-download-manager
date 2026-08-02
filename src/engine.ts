import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProbeResult } from "./types";

export const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface StartRequest {
  id: string;
  url: string;
  name: string;
  extension: string;
  sizeBytes: number;
  downloadDir: string;
  rangeSupported: boolean;
  segments: number;
}

export interface EngineSegment {
  index: number;
  start: number;
  end: number;
  current: number;
  state: "idle" | "active" | "done";
}

export interface EngineProgress {
  id: string;
  status: "queued" | "downloading" | "paused" | "completed" | "error";
  downloadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  error?: string | null;
  segments: EngineSegment[];
}

export function probeUrl(url: string): Promise<ProbeResult> {
  return invoke("probe_url", { url });
}

export function startDownload(req: StartRequest): Promise<void> {
  return invoke("start_download", { request: req });
}

export function pauseDownload(id: string): Promise<void> {
  return invoke("pause_download", { id });
}

export function resumeDownload(id: string): Promise<void> {
  return invoke("resume_download", { id });
}

export function cancelDownload(id: string): Promise<void> {
  return invoke("cancel_download", { id });
}

export function onDownloadProgress(
  cb: (progress: EngineProgress) => void
): Promise<() => void> {
  return listen<EngineProgress>("download://progress", (event) =>
    cb(event.payload)
  );
}
