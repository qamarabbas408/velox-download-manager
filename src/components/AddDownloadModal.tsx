import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Link2, ShieldCheck, ShieldAlert, Plus, FolderOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppSettings, DownloadItem, ProbeResult } from "../types";
import { formatBytes } from "../utils/format";
import { isTauri, probeUrl as engineProbe, startDownload } from "../engine";
import { FileTypeIcon } from "./FileTypeIcon";

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function mockProbe(url: string): ProbeResult {
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
  activeConnections,
  onClose,
  onAdd,
}: {
  open: boolean;
  settings: AppSettings;
  activeConnections: number;
  onClose: () => void;
  onAdd: (item: DownloadItem) => void;
}) {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState(settings.defaultSegments);
  const [downloadDir, setDownloadDir] = useState(settings.downloadDir);

  const maxConnections = Math.min(settings.maxConnections, 32);
  const effectiveConnections = probe?.rangeSupported ? connections : 1;

  const validUrl = useMemo(() => isHttpUrl(url), [url]);

  const handleProbe = async (target?: string) => {
    const targetUrl = target ?? url;
    if (!isHttpUrl(targetUrl)) return;
    setProbing(true);
    setError(null);
    setProbe(null);
    try {
      const result = isTauri ? await engineProbe(targetUrl) : await new Promise<ProbeResult>((res) => setTimeout(() => res(mockProbe(targetUrl)), 600));
      setProbe(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    if (!open || !isTauri || url !== "") return;
    let cancelled = false;
    (async () => {
      try {
        const text = (await readText()).trim();
        if (cancelled || !text || !isHttpUrl(text)) return;
        setUrl(text);
      } catch {
        // clipboard empty or read failed — leave the field untouched
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const handleBrowse = async () => {
    const dir = await openDialog({ directory: true, title: "Choose download folder", defaultPath: downloadDir });
    if (typeof dir === "string") setDownloadDir(dir);
  };

  const handleAdd = async () => {
    if (!probe) return;
    const id = crypto.randomUUID();
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
      id,
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

    if (isTauri) {
      try {
        await startDownload({
          id,
          url: probe.url,
          name: probe.name,
          extension: probe.extension,
          sizeBytes: probe.sizeBytes,
          downloadDir,
          rangeSupported: probe.rangeSupported,
          segments: effectiveConnections,
        });
      } catch (e) {
        setError(String(e));
        return;
      }
    }

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
                setError(null);
              }}
              placeholder="https://example.com/file.zip"
              className="bg-transparent text-sm text-ink placeholder:text-dim outline-none w-full min-w-0"
            />
            <button
              onClick={() => handleProbe()}
              disabled={!validUrl || probing}
              className="btn-primary flex items-center gap-1.5 shrink-0 text-xs font-medium px-3 py-1.5 rounded-md transition-all"
            >
              {probing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
              Analyze
            </button>
          </div>

          {error && (
            <p className="text-xs text-danger">{error}</p>
          )}

          {probe && (
            <div className="rounded-xl border border-line bg-raised/50 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-raised flex items-center justify-center text-muted shrink-0">
                    <FileTypeIcon extension={probe.extension} className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm text-ink truncate">
                      {probe.name}<span className="text-dim">.{probe.extension}</span>
                    </p>
                    <p className="font-mono text-[11px] text-dim truncate">{probe.url}</p>
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
                    className="w-full accent-[#0DA3EE]"
                  />
                  <p className="text-[11px] text-dim">
                    File split into {effectiveConnections} byte-range requests, fetched in parallel.
                  </p>
                  <p className="text-[11px] text-dim">
                    {activeConnections} of {settings.maxConnections} global connections in use right now.
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
            className="btn-primary flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-all"
          >
            <Plus className="w-4 h-4" strokeWidth={2.5} />
            Add download
          </button>
        </div>
      </div>
    </div>
  );
}
