import { Sidebar } from "./components/Sidebar";
import { Toolbar } from "./components/Toolbar";
import { DownloadRow } from "./components/DownloadRow";
import { mockDownloads, sidebarSections } from "./data/mockDownloads";
import { formatSpeed } from "./utils/format";

export default function App() {
  const activeDownloads = mockDownloads.filter((d) => d.status === "downloading");
  const totalSpeed = activeDownloads.reduce((sum, d) => sum + d.speedBytesPerSec, 0);

  return (
    <div className="flex h-screen w-full bg-base text-ink font-body overflow-hidden">
      <Sidebar sections={sidebarSections} activeId="all" />

      <main className="flex-1 flex flex-col min-w-0">
        <Toolbar
          totalSpeedLabel={formatSpeed(totalSpeed)}
          activeCount={activeDownloads.length}
        />

        <div className="flex-1 overflow-y-auto">
          {mockDownloads.map((item) => (
            <DownloadRow key={item.id} item={item} />
          ))}
        </div>
      </main>
    </div>
  );
}
