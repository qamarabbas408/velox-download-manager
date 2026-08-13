import { useCallback, useEffect, useRef, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { DownloadsTable } from "./components/DownloadsTable";
import { BottomBar } from "./components/BottomBar";
import { EmptyState } from "./components/EmptyState";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { SettingsModal } from "./components/SettingsModal";
import { DownloadDetailDrawer } from "./components/DownloadDetailDrawer";
import {
  notifyDownloadComplete,
  notifyDownloadFailed,
  useSystemTray,
} from "./hooks/useSystemTray";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "./store";
import {
  getHistory,
  getStorageStats,
  getDefaultDownloadDir,
  isTauri,
  listDownloads,
  onDownloadProgress,
  pauseDownload,
  removeDownload,
  resumeDownload,
  revealDownload,
  setMaxConnections,
} from "./engine";
import type { AppSettings, DownloadItem, DownloadSpeedSample, SegmentInfo, SidebarSection } from "./types";
import { CATEGORY_LABELS, CATEGORY_ORDER, CATEGORY_PREFIX, categoryFor } from "./categories";
import { formatSpeed } from "./utils/format";

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
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activeId, setActiveId] = useState("all");
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [storage, setStorage] = useState<{ totalBytes: number; usedBytes: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const downloadDirRef = useRef(settings.downloadDir);
  const lastManualTabRef = useRef("all");
  const activeIdRef = useRef(activeId);
  const notifiedIdsRef = useRef<Set<string>>(new Set());
  const downloadsRef = useRef<DownloadItem[]>(downloads);
  const downloadHistoryRef = useRef<Map<string, DownloadSpeedSample[]>>(new Map());

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  useEffect(() => {
    downloadDirRef.current = settings.downloadDir;
  }, [settings.downloadDir]);

  const refreshStorage = useCallback((dir: string) => {
    if (!isTauri) return;
    getStorageStats(dir)
      .then((s) => setStorage({ totalBytes: s.totalBytes, usedBytes: s.usedBytes }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isTauri) return;
    refreshStorage(settings.downloadDir);
  }, [settings.downloadDir, refreshStorage]);

  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    (async () => {
      try {
        const [saved, osDefault] = await Promise.all([
          loadSettings(),
          getDefaultDownloadDir(),
        ]);
        if (cancelled) return;
        const effective: AppSettings = {
          ...saved,
          downloadDir: saved.downloadDir.trim() || osDefault,
        };
        setSettings(effective);
        setMaxConnections(effective.maxConnections).catch(() => {});
      } catch {
        if (cancelled) return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveSettings = (next: AppSettings) => {
    setSettings(next);
    if (isTauri) {
      saveSettings(next);
      setMaxConnections(next.maxConnections).catch(() => {});
    }
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
              status: "queued",
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
      if (p.status === "completed") refreshStorage(downloadDirRef.current);
      if (p.status === "error" && ["all", "in-progress", "error"].includes(activeIdRef.current)) {
        setActiveId("error");
      }
      if (
        (p.status === "completed" || p.status === "error") &&
        !notifiedIdsRef.current.has(p.id)
      ) {
        notifiedIdsRef.current.add(p.id);
        const item = downloadsRef.current.find((d) => d.id === p.id);
        if (item) {
          if (p.status === "completed") notifyDownloadComplete(item.name, item.extension);
          else notifyDownloadFailed(item.name, item.extension);
        }
      }
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

  useEffect(() => {
    if (!isTauri) return;
    const intervalMs = 400;
    const windowMs = 90_000;
    const id = setInterval(() => {
      const now = Date.now();
      const cutoff = now - windowMs;
      const hist = downloadHistoryRef.current;
      for (const d of downloadsRef.current) {
        if (d.status !== "downloading") continue;
        const arr = hist.get(d.id) ?? [];
        arr.push({ t: now, speed: d.speedBytesPerSec });
        let drop = 0;
        while (drop < arr.length && arr[drop].t < cutoff) drop++;
        if (drop > 0) arr.splice(0, drop);
        if (arr.length > 300) arr.splice(0, arr.length - 300);
        hist.set(d.id, arr);
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, []);

  const countByStatus = (status: string) =>
    downloads.filter((d) => d.status === status).length;

  const handleSelectTab = (id: string) => {
    lastManualTabRef.current = id;
    setActiveId(id);
  };

  const inProgressCount =
    countByStatus("downloading") + countByStatus("queued") + countByStatus("paused");

  const categorySections: SidebarSection[] = CATEGORY_ORDER.map((category) => ({
    id: `${CATEGORY_PREFIX}${category}`,
    label: CATEGORY_LABELS[category],
    count: downloads.filter((d) => categoryFor(d.extension) === category).length,
  }));

  const sections: SidebarSection[] = [
    { id: "all", label: "All downloads", count: downloads.length, children: categorySections },
    { id: "in-progress", label: "In progress", count: inProgressCount },
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
      if (activeId.startsWith(CATEGORY_PREFIX)) {
        const category = activeId.slice(CATEGORY_PREFIX.length);
        if (categoryFor(d.extension) !== category) return false;
      } else if (activeId === "in-progress") {
        if (!["downloading", "queued", "paused"].includes(d.status)) return false;
      } else if (activeId !== "all" && d.status !== activeId) {
        return false;
      }
      if (search && !`${d.name}.${d.extension}`.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    })
    .sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  const activeDownloads = downloads.filter((d) => d.status === "downloading");
  const totalSpeed = activeDownloads.reduce((sum, d) => sum + d.speedBytesPerSec, 0);
  const activeConnections = downloads.reduce(
    (sum, d) => sum + d.segments.filter((s) => s.state === "active").length,
    0
  );

  const totalActiveSize = activeDownloads.reduce((sum, d) => sum + d.sizeBytes, 0);
  const totalActiveDone = activeDownloads.reduce((sum, d) => sum + d.downloadedBytes, 0);
  const taskbarProgress =
    totalActiveSize > 0 ? Math.round((totalActiveDone / totalActiveSize) * 100) : null;

  const addDownload = (item: DownloadItem) => {
    setDownloads((prev) => [item, ...prev]);
    setActiveId("in-progress");
    setIsAddOpen(false);
  };

  const updateStatus = (id: string, status: DownloadItem["status"]) => {
    setDownloads((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              status,
              speedBytesPerSec: status === "downloading" ? d.speedBytesPerSec : 0,
              etaSeconds: status === "downloading" ? d.etaSeconds : null,
            }
          : d
      )
    );
  };

  const handlePause = (id: string) => {
    if (isTauri) pauseDownload(id).catch(() => {});
    updateStatus(id, "paused");
  };

  const handleResume = (id: string) => {
    notifiedIdsRef.current.delete(id);
    if (isTauri) resumeDownload(id).catch(() => {});
    updateStatus(id, "downloading");
    setActiveId("in-progress");
  };

  const handleRemove = (id: string) => {
    if (isTauri) removeDownload(id).catch(() => {});
    setDownloads((prev) => prev.filter((d) => d.id !== id));
    downloadHistoryRef.current.delete(id);
    setDetailId((prev) => (prev === id ? null : prev));
    refreshStorage(downloadDirRef.current);
  };

  const handleReveal = (item: DownloadItem) => {
    if (isTauri) revealDownload(item.downloadDir, item.name, item.extension).catch(() => {});
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) =>
      prev.size === visibleDownloads.length ? new Set() : new Set(visibleDownloads.map((d) => d.id))
    );
  };

  const selectedStatuses = Array.from(
    new Set(visibleDownloads.filter((d) => selectedIds.has(d.id)).map((d) => d.status))
  );

  const handleResumeSelected = () => {
    visibleDownloads.filter((d) => selectedIds.has(d.id)).forEach((d) => handleResume(d.id));
  };

  const handlePauseSelected = () => {
    visibleDownloads.filter((d) => selectedIds.has(d.id)).forEach((d) => handlePause(d.id));
  };

  const handleStopAll = () => {
    downloads.filter((d) => d.status === "downloading").forEach((d) => handlePause(d.id));
  };

  useSystemTray({
    activeCount: activeDownloads.length,
    totalSpeedLabel: formatSpeed(totalSpeed),
    hasActive: activeDownloads.length > 0,
    taskbarProgress,
    onPauseAll: handleStopAll,
  });

  const handleDeleteSelected = () => {
    visibleDownloads.filter((d) => selectedIds.has(d.id)).forEach((d) => handleRemove(d.id));
    setSelectedIds(new Set());
  };

  const handleRemoveWithDeselect = (id: string) => {
    handleRemove(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const closeDetailDrawer = useCallback(() => setDetailId(null), []);

  return (
    <div className="flex h-screen w-full bg-base text-ink font-body overflow-hidden">
      <Sidebar
        sections={sections}
        activeId={activeId}
        onSelect={handleSelectTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
        storage={storage}
      />

      <main className="flex-1 flex flex-col min-w-0">
        <Toolbar
          totalSpeedLabel={formatSpeed(totalSpeed)}
          activeCount={activeDownloads.length}
          search={search}
          onSearch={setSearch}
          onAdd={() => setIsAddOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          hasSelection={selectedIds.size > 0}
          selectedStatuses={selectedStatuses}
          onResumeSelected={handleResumeSelected}
          onPauseSelected={handlePauseSelected}
          onDeleteSelected={handleDeleteSelected}
          onStopAll={handleStopAll}
          hasActive={activeDownloads.length > 0}
        />

        <div className="flex-1 overflow-y-auto">
          {visibleDownloads.length === 0 ? (
            <EmptyState
              variant={downloads.length === 0 ? "empty" : "no-results"}
              isTauri={isTauri}
            />
          ) : (
            <DownloadsTable
              items={visibleDownloads}
              selectedIds={selectedIds}
              onToggleSelect={toggleSelect}
              onOpenDetail={setDetailId}
              onPause={handlePause}
              onResume={handleResume}
              onRetry={handleResume}
              onReveal={handleReveal}
              onRemove={handleRemoveWithDeselect}
            />
          )}
        </div>

        <BottomBar
          visibleCount={visibleDownloads.length}
          totalCount={downloads.length}
          selectedCount={selectedIds.size}
          allSelected={selectedIds.size > 0 && selectedIds.size === visibleDownloads.length}
          onToggleSelectAll={toggleSelectAll}
          totalSpeedLabel={formatSpeed(totalSpeed)}
        />
      </main>

      <AddDownloadModal
        open={isAddOpen}
        settings={settings}
        activeConnections={activeConnections}
        onClose={() => setIsAddOpen(false)}
        onAdd={addDownload}
      />

      <SettingsModal
        open={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={handleSaveSettings}
      />

      <DownloadDetailDrawer
        item={detailId ? downloads.find((d) => d.id === detailId) ?? null : null}
        history={detailId ? downloadHistoryRef.current.get(detailId) ?? [] : []}
        modalOpen={isAddOpen || isSettingsOpen}
        onClose={closeDetailDrawer}
      />
    </div>
  );
}
