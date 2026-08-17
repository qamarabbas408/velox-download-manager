import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
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

export interface ResumeSummary {
  id: string;
  url: string;
  name: string;
  extension: string;
  downloadDir: string;
  sizeBytes: number;
  downloadedBytes: number;
  rangeSupported: boolean;
  segmentCount: number;
  progressPercent: number;
}

export interface HistoryRow {
  id: string;
  name: string;
  extension: string;
  url: string;
  sizeBytes: number;
  downloadedBytes: number;
  status: "queued" | "downloading" | "paused" | "completed" | "error";
  rangeSupported: boolean;
  segmentCount: number;
  source: string;
  downloadDir: string;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StorageStats {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
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

export function removeDownload(id: string, deleteFile = false): Promise<void> {
  return invoke("remove_download", { id, deleteFile });
}

export function listDownloads(): Promise<ResumeSummary[]> {
  return invoke("list_downloads");
}

export function getHistory(): Promise<HistoryRow[]> {
  return invoke("get_history");
}

export function getStorageStats(downloadDir: string): Promise<StorageStats> {
  return invoke("get_storage_stats", { path: downloadDir });
}

export function getDefaultDownloadDir(): Promise<string> {
  return invoke("default_download_dir");
}

export function setMaxConnections(max: number): Promise<void> {
  return invoke("set_max_connections", { max });
}

export function revealDownload(
  downloadDir: string,
  name: string,
  extension: string
): Promise<void> {
  const dir = downloadDir.trim();
  if (!dir) return Promise.resolve();
  const path = dir.endsWith("/") || dir.endsWith("\\")
    ? `${dir}${name}.${extension}`
    : `${dir}/${name}.${extension}`;
  return revealItemInDir(path);
}

export function onDownloadProgress(
  cb: (progress: EngineProgress) => void
): Promise<() => void> {
  return listen<EngineProgress>("download://progress", (event) =>
    cb(event.payload)
  );
}
