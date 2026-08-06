import { Link2, ArrowDown, Search, Play, Square, OctagonX, Trash2, Settings } from "lucide-react";

function ToolbarButton({
  icon: Icon,
  label,
  disabled,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-lg text-muted hover:text-ink hover:bg-raised transition-colors disabled:opacity-40 disabled:pointer-events-none"
    >
      <Icon className="w-[18px] h-[18px]" />
      <span className="text-[11px]">{label}</span>
    </button>
  );
}

export function Toolbar({
  totalSpeedLabel,
  activeCount,
  search,
  onSearch,
  onAdd,
  onOpenSettings,
  hasSelection,
  selectedStatuses,
  onResumeSelected,
  onPauseSelected,
  onDeleteSelected,
  onStopAll,
  hasActive,
}: {
  totalSpeedLabel: string;
  activeCount: number;
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
  onOpenSettings: () => void;
  hasSelection: boolean;
  selectedStatuses: Array<"downloading" | "paused" | "queued" | "completed" | "error">;
  onResumeSelected: () => void;
  onPauseSelected: () => void;
  onDeleteSelected: () => void;
  onStopAll: () => void;
  hasActive: boolean;
}) {
  const canResume = selectedStatuses.some((s) => s === "paused" || s === "error");
  const canPause = selectedStatuses.some((s) => s === "downloading");

  return (
    <div className="flex items-center gap-1 px-5 py-2.5 border-b border-line bg-surface/40">
      <button
        onClick={onAdd}
        className="flex items-center gap-2 bg-raised border border-line rounded-lg pl-3 pr-1.5 py-1.5 mr-3 hover:bg-raised/80 transition-colors"
      >
        <Link2 className="w-4 h-4 text-ink" />
        <span className="text-sm text-ink">Add Url</span>
        <span className="w-6 h-6 rounded-full btn-primary flex items-center justify-center">
          <ArrowDown className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
        </span>
      </button>

      <ToolbarButton icon={Play} label="Resume" disabled={!canResume} onClick={onResumeSelected} />
      <ToolbarButton icon={Square} label="Stop" disabled={!canPause} onClick={onPauseSelected} />
      <ToolbarButton icon={OctagonX} label="Stop All" disabled={!hasActive} onClick={onStopAll} />
      <ToolbarButton icon={Trash2} label="Delete" disabled={!hasSelection} onClick={onDeleteSelected} />
      <ToolbarButton icon={Settings} label="Options" onClick={onOpenSettings} />

      <div className="ml-auto flex items-center gap-3">
        <div className="flex items-center gap-2 bg-raised border border-line rounded-lg px-3 py-1.5 w-64 focus-within:border-signal/50 focus-within:ring-1 focus-within:ring-signal/30 transition-all">
          <Search className="w-3.5 h-3.5 text-dim" />
          <input
            type="text"
            placeholder="Search in the List"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="bg-transparent text-xs text-ink placeholder:text-dim outline-none w-full"
          />
        </div>
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-signal/10 text-signal font-mono text-sm">
          {totalSpeedLabel}
        </span>
        <span className="text-dim text-sm">{activeCount} active</span>
      </div>
    </div>
  );
}
