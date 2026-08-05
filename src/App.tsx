import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { DownloadRow } from "./components/DownloadRow";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { SettingsModal } from "./components/SettingsModal";
import { mockDownloads, mockSettings } from "./data/mockDownloads";
import { formatSpeed } from "./utils/format";
import {
  getHistory,
  isTauri,
  listDownloads,
  onDownloadProgress,
  pauseDownload,
  removeDownload,
  resumeDownload,
  revealDownload,
} from "./engine";
import type { AppSettings, DownloadItem, SegmentInfo, SidebarSection } from "./types";
import { loadSettings, saveSettings } from "./store";

function toStatus(status: string): DownloadItem["status"] {
  switch (status) {
    case "downloading":
    case "paused":
    case "completed":
    case "queued":
    case "error":
      return status;
    default:
      return "error";
  }
}

export default function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>(() =>
    isTauri ? [] : mockDownloads
  );
  const [settings, setSettings] = useState<AppSettings>(mockSettings);
  const [activeId, setActiveId] = useState("all");
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  useEffect(() => {
    if (!isTauri) return;
    loadSettings().then((s) => setSettings(s)).catch(() => {});
  }, []);

  const handleSaveSettings = (next: AppSettings) => {
    setSettings(next);
    if (isTauri) saveSettings(next);
  };

  useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    getHistory()
      .then((rows) => {
        const historyItems: DownloadItem[] = rows.map((r) => ({
          id: r.id,
          name: r.name,
          extension: r.extension,
          sizeBytes: r.sizeBytes,
          downloadedBytes: r.downloadedBytes,
          speedBytesPerSec: 0,
          etaSeconds: null,
          status: r.status,
          rangeSupported: r.rangeSupported,
          segments: [],
          source: r.url,
          downloadDir: r.downloadDir,
          errorMessage: r.errorMessage,
        }));
        return listDownloads().then((saved) => {
          const dedup = new Set(saved.map((s) => s.id));
          setDownloads((prev) => {
            const restored: DownloadItem[] = saved.map((s) => ({
              id: s.id,
              name: s.name,
              extension: s.extension,
              sizeBytes: s.sizeBytes,
              downloadedBytes: s.downloadedBytes,
              speedBytesPerSec: 0,
              etaSeconds: null,
              status: "downloading",
              rangeSupported: s.rangeSupported,
              segments: [],
              source: s.url,
              downloadDir: s.downloadDir,
            }));
            return [
              ...restored,
              ...historyItems.filter((h) => !dedup.has(h.id)),
              ...prev,
            ];
          });
        });
      })
      .catch(() => {});
    onDownloadProgress((p) => {
      setDownloads((prev) => {
        const segments: SegmentInfo[] = p.segments.map((s) => ({
          index: s.index,
          start: s.start,
          end: s.end,
          downloaded: s.current - s.start,
          state: s.state,
        }));
        const existing = prev.find((d) => d.id === p.id);
        if (!existing) return prev;
        const remaining = p.totalBytes - p.downloadedBytes;
        const eta = p.speedBytesPerSec > 0 ? Math.round(remaining / p.speedBytesPerSec) : null;
        return prev.map((d) =>
          d.id === p.id
            ? {
                ...d,
                status: toStatus(p.status),
                downloadedBytes: p.downloadedBytes,
                speedBytesPerSec: p.speedBytesPerSec,
                etaSeconds: eta,
                errorMessage: p.error ?? null,
                segments,
              }
            : d
        );
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const countByStatus = (status: string) =>
    downloads.filter((d) => d.status === status).length;

  const sections: SidebarSection[] = [
    { id: "all", label: "All downloads", count: downloads.length },
    { id: "downloading", label: "Downloading", count: countByStatus("downloading") },
    { id: "paused", label: "Paused", count: countByStatus("paused") },
    { id: "completed", label: "Completed", count: countByStatus("completed") },
    { id: "error", label: "Failed", count: countByStatus("error") },
  ];

  const statusOrder: Record<DownloadItem["status"], number> = {
    downloading: 0,
    queued: 1,
    paused: 2,
    error: 3,
    completed: 4,
  };

  const visibleDownloads = downloads
    .filter((d) => {
      if (activeId !== "all" && d.status !== activeId) return false;
      if (search && !`${d.name}.${d.extension}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const activeDownloads = downloads.filter((d) => d.status === "downloading");
  const totalSpeed = activeDownloads.reduce((sum, d) => sum + d.speedBytesPerSec, 0);

  const addDownload = (item: DownloadItem) => {
    setDownloads((prev) => [item, ...prev]);
    setActiveId("all");
    setIsAddOpen(false);
  };

  const updateStatus = (id: string, status: DownloadItem["status"]) => {
    setDownloads((prev) =>
      prev.map((d) =>
        d.id === id
          ? { ...d, status, speedBytesPerSec: status === "downloading" ? d.speedBytesPerSec || 5 * 1024 * 1024 : 0 }
          : d
      )
    );
  };

  const handlePause = (id: string) => {
    if (isTauri) pauseDownload(id).catch(() => {});
    updateStatus(id, "paused");
  };

  const handleResume = (id: string) => {
    if (isTauri) resumeDownload(id).catch(() => {});
    updateStatus(id, "downloading");
  };

  const handleRemove = (id: string) => {
    if (isTauri) removeDownload(id);
    setDownloads((prev) => prev.filter((d) => d.id !== id));
  };

  const handleReveal = (item: DownloadItem) => {
    if (isTauri) revealDownload(item.downloadDir, item.name, item.extension).catch(() => {});
  };

  return (
    <div className="flex h-screen w-full bg-base text-ink font-body overflow-hidden">
      <Sidebar sections={sections} activeId={activeId} onSelect={setActiveId} onOpenSettings={() => setIsSettingsOpen(true)} />

      <main className="flex-1 flex flex-col min-w-0">
        <Toolbar
          totalSpeedLabel={formatSpeed(totalSpeed)}
          activeCount={activeDownloads.length}
          search={search}
          onSearch={setSearch}
          onAdd={() => setIsAddOpen(true)}
        />

        <div className="flex-1 overflow-y-auto">
          {visibleDownloads.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted gap-2">
              <p className="text-sm">No downloads yet</p>
              {isTauri && (
                <p className="text-xs text-dim">
                  Paste a URL and hit “Add download” to start a real segmented download.
                </p>
              )}
            </div>
          ) : (
            visibleDownloads.map((item) => (
              <DownloadRow
                key={item.id}
                item={item}
                onPause={() => handlePause(item.id)}
                onResume={() => handleResume(item.id)}
                onRetry={() => handleResume(item.id)}
                onReveal={() => handleReveal(item)}
                onRemove={() => handleRemove(item.id)}
              />
            ))
          )}
        </div>
      </main>

      <AddDownloadModal
        open={isAddOpen}
        settings={settings}
        onClose={() => setIsAddOpen(false)}
        onAdd={addDownload}
      />

      <SettingsModal
        open={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
