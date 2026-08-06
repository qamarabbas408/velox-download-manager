import { useState } from "react";
import {
  Pause,
  Play,
  X,
  RotateCw,
  FolderOpen,
  ChevronDown,
  ChevronRight,
  Check,
  Loader2,
  Circle,
  Activity,
} from "lucide-react";
import type { DownloadItem, DownloadStatus, SegmentInfo } from "../types";
import { SegmentedProgressBar } from "./SegmentedProgressBar";
import { formatBytes, formatEta, formatSpeed, progressPercent } from "../utils/format";
import { FileTypeIcon } from "./FileTypeIcon";

const statusLabel: Record<DownloadStatus, string> = {
  downloading: "Downloading",
  paused: "Paused",
  completed: "Completed",
  queued: "Queued",
  error: "Failed",
};

function RowActions({
  status,
  onPause,
  onResume,
  onRetry,
  onReveal,
  onRemove,
}: {
  status: DownloadStatus;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onReveal: () => void;
  onRemove: () => void;
}) {
  const btn = "p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised transition-colors";
  return (
    <div className="flex items-center gap-1">
      {status === "downloading" && (
        <button className={btn} aria-label="Pause download" onClick={onPause}>
          <Pause className="w-4 h-4" />
        </button>
      )}
      {status === "paused" && (
        <button className={btn} aria-label="Resume download" onClick={onResume}>
          <Play className="w-4 h-4" />
        </button>
      )}
      {status === "error" && (
        <button className={btn} aria-label="Retry download" onClick={onRetry}>
          <RotateCw className="w-4 h-4" />
        </button>
      )}
      {status === "completed" && (
        <button className={btn} aria-label="Show in folder" onClick={onReveal}>
          <FolderOpen className="w-4 h-4" />
        </button>
      )}
      <button className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-raised" aria-label="Remove download" onClick={onRemove}>
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function SegmentIcon({ state }: { state: SegmentInfo["state"] }) {
  if (state === "done") return <Check className="w-3.5 h-3.5 text-complete" />;
  if (state === "active") return <Loader2 className="w-3.5 h-3.5 text-signal animate-spin" />;
  return <Circle className="w-3.5 h-3.5 text-dim" />;
}

function SegmentDetail({ item }: { item: DownloadItem }) {
  if (!item.rangeSupported) {
    return (
      <div className="rounded-lg bg-raised/40 border border-line p-3 flex items-center gap-2 text-xs text-muted">
        <Activity className="w-4 h-4 text-dim" />
        Single-connection download — server does not support byte ranges.
      </div>
    );
  }

  const sorted = [...item.segments].sort((a, b) => a.start - b.start);
  return (
    <div className="grid gap-1">
      {sorted.map((seg) => {
        const segLength = seg.end - seg.start;
        const pct = Math.round((seg.downloaded / segLength) * 100);
        return (
          <div key={seg.index} className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-raised/40 transition-colors">
            <SegmentIcon state={seg.state} />
            <span className="font-mono text-[11px] text-dim w-5 shrink-0">#{seg.index + 1}</span>
            <span className="font-mono text-[11px] text-muted truncate">
              {formatBytes(seg.start)} – {formatBytes(seg.end)}
            </span>
            <div className="flex-1 h-1 rounded-full bg-raised overflow-hidden">
              <div
                className={[
                  "h-full rounded-full",
                  seg.state === "done" ? "bg-complete" : seg.state === "active" ? "bg-signal" : "bg-dim/40",
                ].join(" ")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="font-mono text-[11px] text-dim w-10 text-right">{pct}%</span>
          </div>
        );
      })}
    </div>
  );
}

export function DownloadRow({
  item,
  onPause,
  onResume,
  onRetry,
  onReveal,
  onRemove,
}: {
  item: DownloadItem;
  onPause: () => void;
  onResume: () => void;
  onRetry: () => void;
  onReveal: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const progress = progressPercent(item);
  const activeSegments = item.segments.filter((s) => s.state === "active").length;
  const doneSegments = item.segments.filter((s) => s.state === "done").length;

  return (
    <div className="group border-b border-line hover:bg-surface/60 transition-colors">
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-5 py-3.5">
        <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center text-muted shrink-0">
          <FileTypeIcon extension={item.extension} className="w-5 h-5" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <p className="font-body text-sm text-ink truncate">
              {item.name}
              <span className="text-dim">.{item.extension}</span>
            </p>
            {item.rangeSupported && (
              <span className="shrink-0 text-[11px] font-medium px-2 py-0.5 rounded-full bg-raised text-dim" title="Server supports byte ranges">
                segmented
              </span>
            )}
          </div>

          <SegmentedProgressBar
            progress={progress}
            segments={item.segments.length}
            activeSegments={activeSegments}
            status={item.status}
          />

          <div className="flex items-center gap-3 mt-1.5 font-mono text-[11px] text-muted">
            <span>{formatBytes(item.downloadedBytes)} / {formatBytes(item.sizeBytes)}</span>
            <span className="text-dim">·</span>
            <span>{formatSpeed(item.speedBytesPerSec)}</span>
            <span className="text-dim">·</span>
            <span>ETA {formatEta(item.etaSeconds)}</span>
            {item.status === "downloading" && item.rangeSupported && (
              <>
                <span className="text-dim">·</span>
                <span>{activeSegments}/{item.segments.length} connections</span>
              </>
            )}
          </div>
          {item.status === "error" && item.errorMessage && (
            <p className="mt-1.5 font-mono text-[11px] text-danger/90 truncate">
              {item.errorMessage}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${item.status === "downloading" ? "bg-signal/15 text-signal" : item.status === "paused" ? "bg-paused/15 text-paused" : item.status === "completed" ? "bg-complete/15 text-complete" : item.status === "error" ? "bg-danger/15 text-danger" : "bg-dim/20 text-muted"}`}>
            {statusLabel[item.status]}
          </span>
          <RowActions
            status={item.status}
            onPause={onPause}
            onResume={onResume}
            onRetry={onRetry}
            onReveal={onReveal}
            onRemove={onRemove}
          />
        </div>
      </div>

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1.5 px-5 pb-2 text-[11px] text-dim hover:text-muted transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {expanded
          ? `Hide segments — ${doneSegments}/${item.segments.length} complete`
          : `View segments — ${doneSegments}/${item.segments.length} complete`}
      </button>

      {expanded && (
        <div className="px-5 pb-4 space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-muted">
            <FolderOpen className="w-3.5 h-3.5 text-dim" />
            <span className="font-mono truncate">
              {item.downloadDir}/{item.name}.{item.extension}
            </span>
          </div>
          <SegmentDetail item={item} />
        </div>
      )}
    </div>
  );
}
