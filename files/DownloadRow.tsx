import {
  Pause,
  Play,
  X,
  RotateCw,
  FolderOpen,
  FileArchive,
  FileVideo,
  FileCog,
  File as FileIcon,
} from "lucide-react";
import type { DownloadItem, DownloadStatus } from "../types";
import { SegmentedProgressBar } from "./SegmentedProgressBar";
import { formatBytes, formatEta, formatSpeed, progressPercent } from "../utils/format";

const statusLabel: Record<DownloadStatus, string> = {
  downloading: "Downloading",
  paused: "Paused",
  completed: "Completed",
  queued: "Queued",
  error: "Failed",
};

const statusPillClass: Record<DownloadStatus, string> = {
  downloading: "bg-signal/15 text-signal",
  paused: "bg-paused/15 text-paused",
  completed: "bg-complete/15 text-complete",
  queued: "bg-dim/20 text-muted",
  error: "bg-danger/15 text-danger",
};

function iconForExtension(extension: string) {
  const archive = ["zip", "rar", "tar.xz", "sql.gz"];
  const video = ["mp4", "mkv"];
  const system = ["msi", "pkg", "exe"];

  const cls = "w-5 h-5";
  if (archive.includes(extension)) return <FileArchive className={cls} />;
  if (video.includes(extension)) return <FileVideo className={cls} />;
  if (system.includes(extension)) return <FileCog className={cls} />;
  return <FileIcon className={cls} />;
}

function RowActions({ status }: { status: DownloadStatus }) {
  return (
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      {status === "downloading" && (
        <button className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised" aria-label="Pause download">
          <Pause className="w-4 h-4" />
        </button>
      )}
      {status === "paused" && (
        <button className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised" aria-label="Resume download">
          <Play className="w-4 h-4" />
        </button>
      )}
      {status === "error" && (
        <button className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised" aria-label="Retry download">
          <RotateCw className="w-4 h-4" />
        </button>
      )}
      {status === "completed" && (
        <button className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised" aria-label="Show in folder">
          <FolderOpen className="w-4 h-4" />
        </button>
      )}
      <button className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-raised" aria-label="Remove download">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function DownloadRow({ item }: { item: DownloadItem }) {
  const progress = progressPercent(item);

  return (
    <div className="group grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3.5 border-b border-line hover:bg-surface/60">
      <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center text-muted shrink-0">
        {iconForExtension(item.extension)}
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <p className="font-body text-sm text-ink truncate">
            {item.name}
            <span className="text-dim">.{item.extension}</span>
          </p>
          <span className={`shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full ${statusPillClass[item.status]}`}>
            {statusLabel[item.status]}
          </span>
        </div>

        <SegmentedProgressBar
          progress={progress}
          segments={item.segments}
          activeSegments={item.activeSegments}
          status={item.status}
        />

        <div className="flex items-center gap-3 mt-1.5 font-mono text-[11px] text-muted">
          <span>{formatBytes(item.downloadedBytes)} / {formatBytes(item.sizeBytes)}</span>
          <span className="text-dim">·</span>
          <span>{formatSpeed(item.speedBytesPerSec)}</span>
          <span className="text-dim">·</span>
          <span>ETA {formatEta(item.etaSeconds)}</span>
          {item.status === "downloading" && (
            <>
              <span className="text-dim">·</span>
              <span>{item.activeSegments}/{item.segments} connections</span>
            </>
          )}
        </div>
      </div>

      <RowActions status={item.status} />
    </div>
  );
}
