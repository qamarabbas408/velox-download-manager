import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { X, Activity, Link2, FolderOpen, Server, AlertTriangle, Check, Loader2, Circle } from "lucide-react";
import type { DownloadItem, DownloadSpeedSample, SegmentInfo } from "../types";
import { formatBytes, formatEta, formatSpeed, joinPathForDisplay, progressPercent } from "../utils/format";
import { FileTypeIcon } from "./FileTypeIcon";

const WIDTH = 720;
const HEIGHT = 120;
const PAD_BOTTOM = 12;
const WINDOW_MS = 90_000;

const statusLabel: Record<DownloadItem["status"], string> = {
  downloading: "Downloading",
  paused: "Paused",
  completed: "Completed",
  queued: "Queued",
  error: "Failed",
};

function statusBadge(status: DownloadItem["status"]): string {
  const base = "inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-0.5 rounded-full";
  switch (status) {
    case "downloading":
      return `${base} bg-signal/15 text-signal`;
    case "paused":
      return `${base} bg-paused/15 text-paused`;
    case "completed":
      return `${base} bg-complete/15 text-complete`;
    case "error":
      return `${base} bg-danger/15 text-danger`;
    default:
      return `${base} bg-dim/20 text-muted`;
  }
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
        <Server className="w-4 h-4 text-dim" />
        Single-connection download — server does not support byte ranges.
      </div>
    );
  }

  if (item.segments.length === 0) {
    return (
      <div className="rounded-lg bg-raised/40 border border-line p-3 flex items-center gap-2 text-xs text-muted">
        <Loader2 className="w-4 h-4 text-dim" />
        Segment data will appear once the download resumes.
      </div>
    );
  }

  const sorted = [...item.segments].sort((a, b) => a.start - b.start);
  return (
    <div className="grid gap-1">
      {sorted.map((seg) => {
        const segLength = seg.end - seg.start;
        const pct = segLength > 0 ? Math.round((seg.downloaded / segLength) * 100) : 0;
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

function MiniSpeedGraph({ history, now }: { history: DownloadSpeedSample[]; now: number }) {
  const visible = history.filter((s) => now - s.t <= WINDOW_MS);
  const hasData = visible.some((s) => s.speed > 0);
  const peak = Math.max(1, ...visible.map((s) => s.speed)) * 1.08;
  const startT = now - WINDOW_MS;
  const pts = visible.map((s) => ({
    x: Math.max(0, Math.min(WIDTH, ((s.t - startT) / WINDOW_MS) * WIDTH)),
    y: HEIGHT - (s.speed / peak) * (HEIGHT - PAD_BOTTOM),
  }));
  const points = pts.length >= 2 ? pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ") : "";
  let areaPath = "";
  if (pts.length >= 2) {
    const first = pts[0];
    const last = pts[pts.length - 1];
    areaPath = `M${first.x.toFixed(1)},${HEIGHT} ${pts
      .map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ")} L${last.x.toFixed(1)},${HEIGHT} Z`;
  }

  return (
    <div className="h-[104px]">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="dlLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgb(var(--signal-deep))" />
            <stop offset="100%" stopColor="rgb(var(--signal))" />
          </linearGradient>
          <linearGradient id="dlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(var(--signal))" stopOpacity="0.22" />
            <stop offset="100%" stopColor="rgb(var(--signal))" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.33, 0.66, 1].map((g) => (
          <line
            key={g}
            x1="0"
            y1={HEIGHT * g}
            x2={WIDTH}
            y2={HEIGHT * g}
            stroke="rgb(var(--line))"
            strokeOpacity="0.4"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {!hasData || !points ? (
          <line
            x1="0"
            y1={HEIGHT * 0.72}
            x2={WIDTH}
            y2={HEIGHT * 0.72}
            stroke="rgb(var(--dim))"
            strokeOpacity="0.5"
            strokeWidth="1.5"
            strokeDasharray="2 5"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <>
            {areaPath && <path d={areaPath} fill="url(#dlFill)" />}
            <polyline
              points={points}
              fill="none"
              stroke="url(#dlLine)"
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}
      </svg>
    </div>
  );
}

export function DownloadDetailDrawer({
  item,
  history,
  modalOpen,
  onClose,
}: {
  item: DownloadItem | null;
  history: DownloadSpeedSample[];
  modalOpen: boolean;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevItemIdRef = useRef<string | null>(null);
  const itemId = item?.id ?? null;

  useEffect(() => {
    if (!itemId) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [itemId]);

  useEffect(() => {
    if (!itemId || modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [itemId, modalOpen, onClose]);

  useLayoutEffect(() => {
    if (itemId === null) {
      returnFocusRef.current?.focus?.();
      returnFocusRef.current = null;
      prevItemIdRef.current = null;
      return;
    }
    if (prevItemIdRef.current !== itemId) {
      prevItemIdRef.current = itemId;
      returnFocusRef.current = document.activeElement as HTMLElement | null;
      closeBtnRef.current?.focus();
    }
  }, [itemId]);

  if (!item) return null;

  const activeSegments = item.segments.filter((s) => s.state === "active").length;
  const doneSegments = item.segments.filter((s) => s.state === "done").length;
  const pct = progressPercent(item);
  const moving = history.filter((s) => s.speed > 0 && now - s.t <= WINDOW_MS);
  const avgSpeed = moving.length > 0 ? moving.reduce((a, s) => a + s.speed, 0) / moving.length : 0;
  const peak = history.some((s) => s.speed > 0 && now - s.t <= WINDOW_MS)
    ? Math.max(...history.filter((s) => s.speed > 0 && now - s.t <= WINDOW_MS).map((s) => s.speed))
    : 0;

  return (
    <div className="fixed inset-0 z-40 animate-fade-in">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="false"
        aria-label={`${item.name}.${item.extension} details`}
        className="absolute inset-y-0 right-0 w-[400px] max-w-[92vw] bg-surface border-l border-line shadow-2xl flex flex-col animate-slide-in-right"
      >
        <header className="flex items-start justify-between gap-3 px-5 py-4 border-b border-line shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-lg bg-raised flex items-center justify-center text-muted shrink-0">
              <FileTypeIcon extension={item.extension} className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <p className="font-body text-sm font-medium text-ink truncate">
                {item.name}
                <span className="text-dim">.{item.extension}</span>
              </p>
              <span className={statusBadge(item.status)}>{statusLabel[item.status]}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            ref={closeBtnRef}
            aria-label="Close details"
            className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="px-5 py-4 border-b border-line space-y-3">
            <div className="grid grid-cols-3 gap-2 text-center">
              {[
                { label: "Size", value: formatBytes(item.sizeBytes) },
                { label: "Downloaded", value: `${formatBytes(item.downloadedBytes)} · ${pct}%` },
                { label: "Speed", value: formatSpeed(item.speedBytesPerSec) },
                { label: "ETA", value: formatEta(item.etaSeconds) },
                { label: "Avg speed", value: formatSpeed(avgSpeed) },
                {
                  label: "Connections",
                  value: item.rangeSupported
                    ? item.segments.length > 0
                      ? `${activeSegments}/${item.segments.length}`
                      : "—"
                    : "1",
                },
              ].map((s) => (
                <div key={s.label} className="rounded-lg bg-raised/40 border border-line px-2 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-dim">{s.label}</p>
                  <p className="mt-0.5 font-mono text-[12px] text-ink truncate">{s.value}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="px-5 py-4 border-b border-line">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-[12px] font-medium text-ink">
                <Activity size={14} className="text-signal" aria-hidden />
                Speed (last 90s)
              </div>
              <span className="font-mono text-[10px] text-dim uppercase tracking-wider">
                Peak {formatSpeed(peak)}
              </span>
            </div>
            <MiniSpeedGraph history={history} now={now} />
          </div>

          <div className="px-5 py-4 border-b border-line">
            <div className="flex items-center gap-2 text-[12px] font-medium text-ink mb-2">
              <Server size={14} className="text-dim" aria-hidden />
              Segments
              {item.rangeSupported && item.segments.length > 0 && (
                <span className="ml-auto font-mono text-[10px] text-dim uppercase tracking-wider">
                  {doneSegments}/{item.segments.length} complete
                </span>
              )}
            </div>
            <SegmentDetail item={item} />
          </div>

          <div className="px-5 py-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <Link2 size={14} className="text-dim mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-dim">Source URL</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted break-all">{item.source}</p>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FolderOpen size={14} className="text-dim mt-0.5 shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-wider text-dim">Save location</p>
                <p className="mt-0.5 font-mono text-[11px] text-muted break-all">
                  {joinPathForDisplay(item.downloadDir, `${item.name}.${item.extension}`)}
                </p>
              </div>
            </div>
            {item.status === "error" && item.errorMessage && (
              <div className="flex items-start gap-2.5 rounded-lg bg-danger/10 border border-danger/25 px-3 py-2.5">
                <AlertTriangle size={14} className="text-danger mt-0.5 shrink-0" aria-hidden />
                <p className="font-mono text-[11px] text-danger/90 break-all">{item.errorMessage}</p>
              </div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
