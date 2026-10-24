import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Link2, ShieldCheck, ShieldAlert, Plus, FolderOpen } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import type { AppSettings, DownloadItem, ProbeResult } from "../types";
import { formatBytes, joinPathForDisplay } from "../utils/format";
import { isTauri, getDefaultDownloadDir, probeUrl as engineProbe, startDownload, startDownloadCopy } from "../engine";
import { FileTypeIcon } from "./FileTypeIcon";

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

interface StartErrorInfo {
  code?: string;
  message: string;
  expectedBytes?: number;
  availableBytes?: number;
  shortfallBytes?: number;
  path?: string;
}

function errInfo(e: unknown): StartErrorInfo {
  if (e && typeof e === "object" && "message" in e) {
    const err = e as {
      code?: string;
      message?: unknown;
      expectedBytes?: number;
      availableBytes?: number;
      shortfallBytes?: number;
      path?: string;
    };
    return {
      code: err.code,
      message: String(err.message ?? "Failed"),
      expectedBytes: err.expectedBytes,
      availableBytes: err.availableBytes,
      shortfallBytes: err.shortfallBytes,
      path: err.path,
    };
  }
  return { message: String(e) };
}

export function AddDownloadModal({
  open,
  settings,
  activeConnections,
  downloads,
  onClose,
  onAdd,
  onResume,
}: {
  open: boolean;
  settings: AppSettings;
  activeConnections: number;
  downloads: DownloadItem[];
  onClose: () => void;
  onAdd: (item: DownloadItem) => void;
  onResume: (id: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [probing, setProbing] = useState(false);
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [spaceError, setSpaceError] = useState<StartErrorInfo | null>(null);
  const [conflictProbe, setConflictProbe] = useState<ProbeResult | null>(null);
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
    setSpaceError(null);
    setProbe(null);
    try {
      if (!isTauri) {
        setError("Downloading is only available in the Velox desktop app.");
        return;
      }
      const result = await engineProbe(targetUrl);
      setProbe(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setProbing(false);
    }
  };

  useEffect(() => {
    if (open) return;
    setUrl("");
    setProbe(null);
    setError(null);
    setSpaceError(null);
    setConflictProbe(null);
    setConnections(settings.defaultSegments);
    setDownloadDir(settings.downloadDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || settings.downloadDir.trim()) return;
    let cancelled = false;
    getDefaultDownloadDir()
      .then((dir) => {
        if (!cancelled && dir.trim()) setDownloadDir(dir);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, settings.downloadDir]);

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
    if (typeof dir === "string") {
      setDownloadDir(dir);
      setSpaceError(null);
    }
  };

  const resetForm = () => {
    setUrl("");
    setProbe(null);
    setError(null);
    setSpaceError(null);
    setConflictProbe(null);
    setConnections(settings.defaultSegments);
    setDownloadDir(settings.downloadDir);
  };

  const start = async (target: ProbeResult, copy: boolean) => {
    const id = crypto.randomUUID();
    setSpaceError(null);
    setError(null);
    const conns = target.rangeSupported ? connections : 1;
    const chunk = conns > 0 ? Math.floor(target.sizeBytes / conns) : 0;
    const segments = Array.from({ length: conns }, (_, i) => ({
      index: i,
      start: i * chunk,
      end: i === conns - 1 ? target.sizeBytes : (i + 1) * chunk,
      downloaded: 0,
      state: "idle" as const,
    }));

    if (isTauri) {
      const request = {
        id,
        url: target.url,
        name: target.name,
        extension: target.extension,
        sizeBytes: target.sizeBytes,
        sizeKnown: target.sizeKnown,
        downloadDir,
        rangeSupported: target.rangeSupported,
        segments: conns,
      };
      try {
        if (copy) await startDownloadCopy(request);
        else await startDownload(request);
      } catch (e) {
        const info = errInfo(e);
        if (info.code === "ALREADY_PAUSED") {
          setConflictProbe(target);
          setError(null);
        } else if (
          info.code === "INSUFFICIENT_SPACE" ||
          info.code === "SPACE_UNAVAILABLE"
        ) {
          setSpaceError(info);
          setError(null);
        } else {
          setError(info.message);
        }
        return;
      }
    }

    onAdd({
      id,
      name: target.name,
      extension: target.extension,
      sizeBytes: target.sizeBytes,
      downloadedBytes: 0,
      speedBytesPerSec: 0,
      etaSeconds: null,
      status: "downloading",
      rangeSupported: target.rangeSupported,
      segments,
      source: target.url,
      downloadDir,
    });
    resetForm();
  };

  const handleAdd = () => {
    if (probe) void start(probe, false);
  };

  const handleResumeExisting = () => {
    if (!conflictProbe) return;
    const sameUrl = (d: DownloadItem) => d.source === conflictProbe.url;
    const paused = downloads.find((d) => sameUrl(d) && d.status === "paused");
    if (paused) {
      onResume(paused.id);
      onClose();
      return;
    }
    // State may have changed while the prompt was open.
    const active = downloads.find(
      (d) => sameUrl(d) && (d.status === "downloading" || d.status === "queued")
    );
    if (active) {
      onClose();
      return;
    }
    // The existing record is gone — start a copy instead.
    void start(conflictProbe, true);
  };

  const handleDownloadCopy = () => {
    if (conflictProbe) void start(conflictProbe, true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-[560px] max-w-full bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 className="font-display font-semibold text-sm">Add download</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          <div className="flex items-center gap-2 bg-raised border border-line rounded-lg px-3 py-2.5 focus-within:border-signal/60">
            <Link2 className="w-4 h-4 text-dim shrink-0" />
            <input
              type="text"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setProbe(null);
                setError(null);
                setSpaceError(null);
                setConflictProbe(null);
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
            <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5">
              <ShieldAlert className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
              <p className="text-xs text-danger min-w-0 break-all leading-relaxed">{error}</p>
            </div>
          )}

          {spaceError && (
            <div className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-3 space-y-2">
              <div className="flex items-start gap-2">
                <ShieldAlert className="w-3.5 h-3.5 text-danger shrink-0 mt-0.5" />
                <p className="text-xs text-danger font-medium">
                  {spaceError.code === "SPACE_UNAVAILABLE"
                    ? "Couldn't check free space"
                    : "Not enough disk space"}
                </p>
              </div>
              {spaceError.code === "INSUFFICIENT_SPACE" && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted">
                  <dt>File size</dt>
                  <dd className="font-mono text-right text-ink">
                    {formatBytes(spaceError.expectedBytes ?? 0)}
                  </dd>
                  <dt>Available</dt>
                  <dd className="font-mono text-right text-ink">
                    {formatBytes(spaceError.availableBytes ?? 0)}
                  </dd>
                  <dt>Short by</dt>
                  <dd className="font-mono text-right text-danger">
                    {formatBytes(spaceError.shortfallBytes ?? 0)}
                  </dd>
                </dl>
              )}
              <p className="text-[11px] text-muted leading-relaxed break-words">
                {spaceError.message}
              </p>
              {spaceError.path && (
                <p className="font-mono text-[11px] text-dim break-all">{spaceError.path}</p>
              )}
              <p className="text-[11px] text-dim leading-relaxed">
                Velox keeps a 256 MiB safety reserve free on the destination. The reserve is
                not part of the file.
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  onClick={handleBrowse}
                  className="btn-primary text-xs font-medium px-3 py-1.5 rounded-md transition-all"
                >
                  Choose another folder
                </button>
                <button
                  onClick={() => {
                    if (probe) void start(probe, false);
                  }}
                  className="bg-raised border border-line text-xs font-medium px-3 py-1.5 rounded-md text-muted hover:text-ink transition-colors"
                >
                  Try again
                </button>
                <button
                  onClick={onClose}
                  className="text-xs px-2 py-1.5 rounded-md text-muted hover:text-ink transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {conflictProbe && (
            <div className="rounded-lg border border-paused/30 bg-paused/10 px-3 py-3 space-y-2">
              <p className="text-xs text-paused font-medium">This download is already paused.</p>
              <p className="text-[11px] text-muted leading-relaxed">
                Resume the existing download, or start another copy with a unique filename.
              </p>
              <div className="flex items-center gap-2 pt-0.5">
                <button
                  onClick={handleResumeExisting}
                  className="btn-primary text-xs font-medium px-3 py-1.5 rounded-md transition-all"
                >
                  Resume existing
                </button>
                <button
                  onClick={handleDownloadCopy}
                  className="bg-raised border border-line text-xs font-medium px-3 py-1.5 rounded-md text-muted hover:text-ink transition-colors"
                >
                  Download another copy
                </button>
                <button
                  onClick={() => setConflictProbe(null)}
                  className="text-xs px-2 py-1.5 rounded-md text-muted hover:text-ink transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
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
                <span className="font-mono text-xs text-muted shrink-0">
                  {probe.sizeKnown ? formatBytes(probe.sizeBytes) : "Unknown size"}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs">
                {!probe.sizeKnown ? (
                  <>
                    <ShieldAlert className="w-3.5 h-3.5 text-danger" />
                    <span className="text-muted">
                      Size unknown — Velox will monitor free space while downloading
                    </span>
                  </>
                ) : probe.rangeSupported ? (
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
                  {joinPathForDisplay(downloadDir, `${probe.name}.${probe.extension}`)}
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
