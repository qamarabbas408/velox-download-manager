import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { DownloadRow } from "./components/DownloadRow";
import { AddDownloadModal } from "./components/AddDownloadModal";
import { SettingsModal } from "./components/SettingsModal";
import { mockDownloads, mockSettings } from "./data/mockDownloads";
import { formatSpeed } from "./utils/format";
import type { AppSettings, DownloadItem, SidebarSection } from "./types";

export default function App() {
  const [downloads, setDownloads] = useState<DownloadItem[]>(mockDownloads);
  const [settings, setSettings] = useState<AppSettings>(mockSettings);
  const [activeId, setActiveId] = useState("all");
  const [search, setSearch] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const countByStatus = (status: string) =>
    downloads.filter((d) => d.status === status).length;

  const sections: SidebarSection[] = [
    { id: "all", label: "All downloads", count: downloads.length },
    { id: "downloading", label: "Downloading", count: countByStatus("downloading") },
    { id: "paused", label: "Paused", count: countByStatus("paused") },
    { id: "completed", label: "Completed", count: countByStatus("completed") },
    { id: "error", label: "Failed", count: countByStatus("error") },
  ];

  const visibleDownloads = downloads.filter((d) => {
    if (activeId !== "all" && d.status !== activeId) return false;
    if (search && !`${d.name}.${d.extension}`.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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

  const removeDownload = (id: string) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
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
            <div className="h-full flex flex-col items-center justify-center text-muted">
              <p className="text-sm">No downloads here</p>
            </div>
          ) : (
            visibleDownloads.map((item) => (
              <DownloadRow
                key={item.id}
                item={item}
                onPause={() => updateStatus(item.id, "paused")}
                onResume={() => updateStatus(item.id, "downloading")}
                onRetry={() => updateStatus(item.id, "downloading")}
                onRemove={() => removeDownload(item.id)}
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
        onSave={setSettings}
      />
    </div>
  );
}
