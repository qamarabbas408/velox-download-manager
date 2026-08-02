import { useMemo, useState } from "react";
import { X, Loader2, Link2, ShieldCheck, ShieldAlert, Gauge, Plus, FolderOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { AppSettings, DownloadItem, ProbeResult } from "../types";
import { formatBytes } from "../utils/format";

function probeUrl(url: string): ProbeResult {
  const parsed = new URL(url);
  const raw = parsed.pathname.split("/").filter(Boolean).pop() ?? "download";
  const dot = raw.lastIndexOf(".");
  const hasExt = dot > 0 && dot < raw.length - 1;

  const name = hasExt ? raw.slice(0, dot) : raw;
  const extension = hasExt ? raw.slice(dot + 1) : "bin";
  const rangeSupported = !/\.(html?|php)$/i.test(raw);

  return {
    url,
    name,
    extension,
    sizeBytes: Math.floor(20 + Math.random() * 3000) * 1024 * 1024,
    rangeSupported,
    contentType: rangeSupported ? "application/octet-stream" : "text/html",
  };
}

export function AddDownloadModal({
  open,
  settings,
  onClose,
  onAdd,
}: {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onAdd: (item: DownloadItem) => void;
}) {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [connections, setConnections] = useState(settings.defaultSegments);
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir);

  const maxConnections = Math.min(settings.maxConnections, 32);
  const effectiveConnections = probe?.rangeSupported
    ? connections
    : 1;

  const validUrl = useMemo(() => {
    try {
      const u = new URL(url);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }, [url]);

  if (!open) return null;

  const handleProbe = () => {
    if (!validUrl) return;
    setProbing(true);
    setTimeout(() => {
      setProbe(probeUrl(url));
      setProbing(false);
    }, 600);
  };

  const handleBrowse = async () => {
    const dir = await openDialog({ directory: true, title: "Choose download folder", defaultPath: downloadDir });
    if (typeof dir === "string") setDownloadDir(dir);
  };

  const handleAdd = () => {
    if (!probe) return;
    const chunk = Math.floor(probe.sizeBytes / effectiveConnections);
    const segments = Array.from({ length: effectiveConnections }, (_, i) => ({
      index: i,
      start: i * chunk,
      end: i === effectiveConnections - 1 ? probe.sizeBytes : (i + 1) * chunk,
      downloaded: 0,
      state: i < Math.min(4, effectiveConnections) ? ("active" as const) : ("idle" as const),
    }));

    const speed = effectiveConnections * 2.4 * 1024 * 1024;

    onAdd({
      id: crypto.randomUUID(),
      name: probe.name,
      extension: probe.extension,
      sizeBytes: probe.sizeBytes,
      downloadedBytes: 0,
      speedBytesPerSec: speed,
      etaSeconds: Math.round(probe.sizeBytes / speed),
      status: "downloading",
      rangeSupported: probe.rangeSupported,
      segments,
      source: probe.url,
      downloadDir,
    });

    setUrl("");
    setProbe(null);
    setConnections(settings.defaultSegments);
    setDownloadDir(settings.downloadDir);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[560px] max-w-full bg-surface border border-line rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 className="font-display font-semibold text-sm">Add download</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 bg-raised border border-line rounded-lg px-3 py-2.5 focus-within:border-signal/60">
            <Link2 className="w-4 h-4 text-dim shrink-0" />
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setProbe(null);
              }}
              placeholder="https://example.com/file.zip"
              className="bg-transparent text-sm text-ink placeholder:text-dim outline-none w-full"
            />
            <button
              onClick={handleProbe}
              disabled={!validUrl || probing}
              className="flex items-center gap-1.5 shrink-0 bg-signal text-xs font-medium px-3 py-1.5 rounded-md hover:opacity-90 disabled:opacity-40 transition-opacity"
              style={{ color: "#0B0D10" }}
            >
              {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Analyze
            </button>
          </div>

          {probe && (
            <div className="rounded-xl border border-line bg-raised/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center text-muted shrink-0">
                    <Gauge className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">
                      {probe.name}<span className="text-dim">.{probe.extension}</span>
                    </p>
                    <p className="font-mono text-[11px] text-dim">{probe.url}</p>
                  </div>
                </div>
                <span className="font-mono text-xs text-muted shrink-0">{formatBytes(probe.sizeBytes)}</span>
              </div>

              <div className="flex items-center gap-2 text-xs">
                {probe.rangeSupported ? (
                  <>
                    <ShieldCheck className="w-3.5 h-3.5 text-complete" />
                    <span className="text-muted">Server supports <span className="font-mono text-complete">Accept-Ranges: bytes</span> — segmented download available</span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5 text-danger" />
                    <span className="text-muted">No range support — single connection</span>
                  </>
                )}
              </div>

              {probe.rangeSupported && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted">Connections</span>
                    <span className="font-mono text-ink">{effectiveConnections}</span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={maxConnections}
                    value={connections}
                    onChange={(e) => setConnections(Number(e.target.value))}
                    className="w-full accent-[#FF6B2C]"
                  />
                  <p className="text-[11px] text-dim">
                    File split into {effectiveConnections} byte-range requests, fetched in parallel.
                  </p>
                </div>
              )}
            </div>
          )}

          {probe && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted">Save to</span>
                <span className="font-mono text-[11px] text-dim truncate max-w-[220px]">
                  {downloadDir}/{probe.name}.{probe.extension}
                </span>
              </div>
              <div className="flex items-center gap-2 bg-raised border border-line rounded-lg px-3 py-2.5">
                <FolderOpen className="w-4 h-4 text-dim shrink-0" />
                <input
                  type="text"
                  value={downloadDir}
                  onChange={(e) => setDownloadDir(e.target.value)}
                  className="bg-transparent text-sm text-ink placeholder:text-dim outline-none w-full font-mono text-xs"
                />
                <button
                  onClick={handleBrowse}
                  className="shrink-0 bg-raised border border-line text-xs font-medium px-3 py-1.5 rounded-md text-muted hover:text-ink transition-colors"
                >
                  Browse…
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 h-16 border-t border-line">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-raised transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={!probe}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-signal text-sm font-medium hover:opacity-90 disabled:opacity-40 transition-opacity"
            style={{ color: "#0B0D10" }}
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            Add download
          </button>
        </div>
      </div>
    </div>
  );
}
