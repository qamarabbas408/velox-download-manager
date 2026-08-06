import type { DownloadItem, SegmentInfo } from "../types";

const MOCK_DOWNLOAD_DIR = "/Users/qabbas715/Downloads";

function makeSegments(
  sizeBytes: number,
  count: number,
  activeCount: number,
  doneFraction: number
): SegmentInfo[] {
  const chunk = Math.floor(sizeBytes / count);
  const segments: SegmentInfo[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? sizeBytes : (i + 1) * chunk;
    const length = end - start;

    const active = i >= Math.floor(count * doneFraction) && i < Math.floor(count * doneFraction) + activeCount;
    const done = i < Math.floor(count * doneFraction);

    segments.push({
      index: i,
      start,
      end,
      downloaded: done ? length : active ? length * (0.3 + Math.random() * 0.4) : 0,
      state: done ? "done" : active ? "active" : "idle",
    });
  }

  return segments;
}

export const mockDownloads: DownloadItem[] = [
  {
    id: "1",
    name: "blender-4.3.0-linux-x64",
    extension: "tar.xz",
    sizeBytes: 412 * 1024 * 1024,
    downloadedBytes: 268 * 1024 * 1024,
    speedBytesPerSec: 9.4 * 1024 * 1024,
    etaSeconds: 16,
    status: "downloading",
    rangeSupported: true,
    segments: makeSegments(412 * 1024 * 1024, 16, 6, 0.5),
    source: "download.blender.org",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "2",
    name: "gb-survey-footage-drone-4k",
    extension: "mp4",
    sizeBytes: 2.1 * 1024 * 1024 * 1024,
    downloadedBytes: 612 * 1024 * 1024,
    speedBytesPerSec: 4.8 * 1024 * 1024,
    etaSeconds: 318,
    status: "downloading",
    rangeSupported: true,
    segments: makeSegments(2.1 * 1024 * 1024 * 1024, 24, 9, 0.28),
    source: "storage.internal.net",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "3",
    name: "rust-1.82.0-x86_64-pc-windows-msvc",
    extension: "msi",
    sizeBytes: 186 * 1024 * 1024,
    downloadedBytes: 186 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "completed",
    rangeSupported: true,
    segments: makeSegments(186 * 1024 * 1024, 8, 0, 1),
    source: "static.rust-lang.org",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "4",
    name: "postgres-16-backup-2026-07",
    extension: "sql.gz",
    sizeBytes: 3.4 * 1024 * 1024 * 1024,
    downloadedBytes: 1.1 * 1024 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "paused",
    rangeSupported: true,
    segments: makeSegments(3.4 * 1024 * 1024 * 1024, 32, 0, 0.32),
    source: "backups.gb-dev.local",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "5",
    name: "figma-design-tokens-export",
    extension: "zip",
    sizeBytes: 48 * 1024 * 1024,
    downloadedBytes: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "queued",
    rangeSupported: true,
    segments: makeSegments(48 * 1024 * 1024, 4, 0, 0),
    source: "figma.com",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "6",
    name: "steam-library-update-cache",
    extension: "pkg",
    sizeBytes: 890 * 1024 * 1024,
    downloadedBytes: 140 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "error",
    rangeSupported: true,
    segments: makeSegments(890 * 1024 * 1024, 12, 2, 0.15),
    source: "cdn.steampowered.com",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "7",
    name: "ielts-prep-audio-lessons-full",
    extension: "rar",
    sizeBytes: 1.2 * 1024 * 1024 * 1024,
    downloadedBytes: 1.2 * 1024 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "completed",
    rangeSupported: true,
    segments: makeSegments(1.2 * 1024 * 1024 * 1024, 16, 0, 1),
    source: "mirror.eduresources.io",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "8",
    name: "midnight-hour-sessions-album",
    extension: "flac",
    sizeBytes: 340 * 1024 * 1024,
    downloadedBytes: 0,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "queued",
    rangeSupported: true,
    segments: makeSegments(340 * 1024 * 1024, 8, 0, 0),
    source: "bandcamp.com",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "9",
    name: "nova-launcher-8.0.8.apk",
    extension: "apk",
    sizeBytes: 38 * 1024 * 1024,
    downloadedBytes: 38 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "completed",
    rangeSupported: true,
    segments: makeSegments(38 * 1024 * 1024, 4, 0, 1),
    source: "apkmirror.com",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "10",
    name: "aurora-aurora-ios-client",
    extension: "ipa",
    sizeBytes: 96 * 1024 * 1024,
    downloadedBytes: 96 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "completed",
    rangeSupported: true,
    segments: makeSegments(96 * 1024 * 1024, 6, 0, 1),
    source: "cdn.aurora.dev",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "11",
    name: "dubai-skyline-wallpaper-collection",
    extension: "jpg",
    sizeBytes: 42 * 1024 * 1024,
    downloadedBytes: 42 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "completed",
    rangeSupported: true,
    segments: makeSegments(42 * 1024 * 1024, 4, 0, 1),
    source: "wallpapers.unsplash.com",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
  {
    id: "12",
    name: "product-backlog-sprint-planning-doc",
    extension: "pdf",
    sizeBytes: 8 * 1024 * 1024,
    downloadedBytes: 8 * 1024 * 1024,
    speedBytesPerSec: 0,
    etaSeconds: null,
    status: "completed",
    rangeSupported: true,
    segments: makeSegments(8 * 1024 * 1024, 2, 0, 1),
    source: "drive.google.com",
    downloadDir: MOCK_DOWNLOAD_DIR,
  },
];

export const mockSettings = {
  maxConnections: 16,
  defaultSegments: 8,
  downloadDir: "/Users/qabbas715/Downloads",
  resumeEnabled: true,
};
