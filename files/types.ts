export type DownloadStatus =
  | "downloading"
  | "paused"
  | "completed"
  | "queued"
  | "error";

export interface DownloadItem {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  status: DownloadStatus;
  segments: number;
  activeSegments: number;
  source: string;
}

export interface SidebarSection {
  id: string;
  label: string;
  count: number;
}
