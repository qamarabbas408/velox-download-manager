export type DownloadStatus =
  | "downloading"
  | "paused"
  | "completed"
  | "queued"
  | "error";

export type SegmentState = "idle" | "active" | "done";

export interface SegmentInfo {
  index: number;
  start: number;
  end: number;
  downloaded: number;
  state: SegmentState;
}

export interface DownloadSpeedSample {
  t: number;
  speed: number;
}

export interface DownloadItem {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  downloadedBytes: number;
  speedBytesPerSec: number;
  etaSeconds: number | null;
  status: DownloadStatus;
  rangeSupported: boolean;
  segments: SegmentInfo[];
  source: string;
  downloadDir: string;
  errorMessage?: string | null;
}

export interface SidebarSection {
  id: string;
  label: string;
  count: number;
  children?: SidebarSection[];
}

export interface ProbeResult {
  url: string;
  name: string;
  extension: string;
  sizeBytes: number;
  rangeSupported: boolean;
  contentType: string;
}

export interface AppSettings {
  maxConnections: number;
  defaultSegments: number;
  downloadDir: string;
  resumeEnabled: boolean;
}
