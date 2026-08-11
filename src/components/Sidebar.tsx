import { useState } from "react";
import {
  Settings,
  Sun,
  Moon,
  ChevronDown,
  ChevronRight,
  HardDrive,
  ArrowDown,
  CheckCheck,
  AlertTriangle,
  Music,
  FileArchive,
  Video,
  MonitorDown,
  FileText,
  Smartphone,
  Image as ImageIcon,
} from "lucide-react";
import type { SidebarSection } from "../types";
import { useTheme } from "../theme";
import { formatBytes } from "../utils/format";
import logo from "../assets/logo.png";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  music: Music,
  video: Video,
  compressed: FileArchive,
  programs: MonitorDown,
  apk: Smartphone,
  ipa: Smartphone,
  images: ImageIcon,
  documents: FileText,
  other: FileText,
};

export function Sidebar({
  sections,
  activeId,
  onSelect,
  onOpenSettings,
  storage,
}: {
  sections: SidebarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  storage: { totalBytes: number; usedBytes: number } | null;
}) {
  const { theme, toggleTheme } = useTheme();
  const [libraryOpen, setLibraryOpen] = useState(true);

  const allSection = sections.find((s) => s.id === "all");
  const usedPercent = storage
    ? Math.round((storage.usedBytes / storage.totalBytes) * 100)
    : 0;

  const statusSections = sections.filter((s) => s.id !== "all");

  return (
    <aside className="w-64 shrink-0 h-full bg-surface border-r border-line flex flex-col px-3 py-4 gap-1">
      <div className="flex items-center gap-2.5 px-2 pb-3 border-b border-line">
        <img src={logo} alt="Velox" className="w-8 h-8 rounded-md object-contain" />
        <div className="leading-none">
          <span className="block font-display font-bold text-lg brand-gradient-text tracking-tight">
            Velox
          </span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.18em] text-dim mt-0.5">
            Download manager
          </span>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 pr-1 -mr-1">
        <nav>
          {allSection && (
          <>
            <button
              onClick={() => {
                setLibraryOpen((v) => !v);
                onSelect("all");
              }}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-raised text-ink text-sm mt-3"
            >
              <span className="flex items-center gap-2.5">
                <HardDrive className="w-4 h-4" />
                All Downloads
              </span>
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-dim">{allSection.count}</span>
                {libraryOpen ? (
                  <ChevronDown className="w-4 h-4 text-dim" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-dim" />
                )}
              </span>
            </button>

            {libraryOpen &&
              allSection.children?.map((child) => {
                const isActive = child.id === activeId;
                const Icon = CATEGORY_ICONS[child.id.replace("cat:", "")] ?? FileText;
                return (
                  <button
                    key={child.id}
                    onClick={() => onSelect(child.id)}
                    className={[
                      "w-full flex items-center gap-2.5 pl-8 pr-3 py-2 rounded-lg text-sm transition-colors",
                      isActive
                        ? "bg-raised text-ink"
                        : "text-muted hover:text-ink hover:bg-raised/60",
                    ].join(" ")}
                  >
                    <Icon className="w-4 h-4" />
                    <span className="flex-1 text-left">{child.label}</span>
                    <span className="font-mono text-xs text-dim">{child.count}</span>
                  </button>
                );
              })}
          </>
        )}

        <div className="border-t border-line my-2" />

        {statusSections.map((section) => {
          const isActive = section.id === activeId;
          const Icon =
            section.id === "in-progress"
              ? ArrowDown
              : section.id === "error"
                ? AlertTriangle
                : CheckCheck;
          return (
            <button
              key={section.id}
              onClick={() => onSelect(section.id)}
              className={[
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-raised text-ink"
                  : "text-muted hover:text-ink hover:bg-raised/60",
              ].join(" ")}
            >
              <Icon className="w-4 h-4" />
              <span className="flex-1 text-left">{section.label}</span>
              <span className="font-mono text-xs text-dim">{section.count}</span>
            </button>
          );
        })}
        </nav>

        <div className="mt-auto pt-4 space-y-2">
        <div className="rounded-2xl bg-raised/40 border border-line p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-muted flex items-center gap-2">
              <HardDrive className="w-4 h-4" /> Disk Space
            </span>
          </div>

          <div className="relative mx-auto w-[150px] h-[80px]">
            <svg viewBox="0 0 150 80" className="w-full h-full overflow-visible">
              <defs>
                <linearGradient id="gaugeGradient" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="rgb(var(--signal))" />
                  <stop offset="100%" stopColor="rgb(var(--signal-deep))" />
                </linearGradient>
              </defs>
              <path
                d="M 21 75 A 54 54 0 0 1 129 75"
                fill="none"
                stroke="rgb(var(--raised))"
                strokeWidth="10"
                strokeLinecap="round"
              />
              <path
                d="M 21 75 A 54 54 0 0 1 129 75"
                fill="none"
                stroke="url(#gaugeGradient)"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={`${(usedPercent / 100) * Math.PI * 54} ${Math.PI * 54}`}
              />
            </svg>
            <span className="absolute left-0 bottom-0 text-[10px] text-dim">0%</span>
            <span className="absolute right-0 bottom-0 text-[10px] text-dim">100%</span>
          </div>

          <p className="text-center text-2xl font-semibold text-ink mt-1">{usedPercent}%</p>
          <p className="text-center text-xs text-dim mb-1 truncate">
            {storage ? formatBytes(storage.usedBytes) : "—"} used
          </p>
        </div>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-raised/60 transition-colors"
        >
          <Settings className="w-4 h-4" />
          Options
        </button>
        <button
          onClick={toggleTheme}
          aria-label="Toggle theme"
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-raised/60 transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        </div>
      </div>
    </aside>
  );
}
