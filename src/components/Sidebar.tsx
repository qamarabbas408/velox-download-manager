import { Zap, Settings } from "lucide-react";
import type { SidebarSection } from "../types";

export function Sidebar({
  sections,
  activeId,
  onSelect,
  onOpenSettings,
}: {
  sections: SidebarSection[];
  activeId: string;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const totalBytes = 2.1 * 1024 * 1024 * 1024 * 1024;
  const usedBytes = 1.9 * 1024 * 1024 * 1024 * 1024;
  const usedPercent = Math.round((usedBytes / totalBytes) * 100);

  return (
    <aside className="w-64 shrink-0 h-full bg-surface border-r border-line flex flex-col">
      <div className="flex items-center gap-2.5 px-5 h-16 border-b border-line">
        <div className="w-7 h-7 rounded-md bg-signal/15 flex items-center justify-center">
          <Zap className="w-4 h-4 text-signal" fill="currentColor" />
        </div>
        <span className="font-display font-semibold text-base tracking-tight">Velox</span>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {sections.map((section) => {
          const isActive = section.id === activeId;
          return (
            <button
              key={section.id}
              onClick={() => onSelect(section.id)}
              className={[
                "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors",
                isActive
                  ? "bg-raised text-ink"
                  : "text-muted hover:text-ink hover:bg-raised/60",
              ].join(" ")}
            >
              <span className="flex items-center gap-2.5">
                <span
                  className={[
                    "w-1.5 h-1.5 rounded-full",
                    isActive ? "bg-signal" : "bg-dim",
                  ].join(" ")}
                />
                {section.label}
              </span>
              <span className="font-mono text-xs text-dim">{section.count}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-5 py-4 border-t border-line">
        <div className="flex items-center justify-between text-xs text-dim mb-2">
          <span>Storage used</span>
          <span className="font-mono">1.9 TB</span>
        </div>
        <div className="h-1.5 rounded-full bg-raised overflow-hidden">
          <div
            className="h-full rounded-full bg-signal"
            style={{ width: `${usedPercent}%` }}
          />
        </div>
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-2 mt-4 text-sm text-muted hover:text-ink"
        >
          <Settings className="w-4 h-4" />
          Settings
        </button>
      </div>
    </aside>
  );
}
