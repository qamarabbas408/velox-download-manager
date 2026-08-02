import { Plus, Search, ArrowDown } from "lucide-react";

export function Toolbar({
  totalSpeedLabel,
  activeCount,
  search,
  onSearch,
  onAdd,
}: {
  totalSpeedLabel: string;
  activeCount: number;
  search: string;
  onSearch: (value: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="h-16 shrink-0 flex items-center justify-between gap-4 px-6 border-b border-line">
      <div className="flex items-center gap-3">
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 bg-signal text-base font-medium text-sm px-3.5 py-2 rounded-lg hover:opacity-90 transition-opacity"
          style={{ color: "#0B0D10" }}
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          Add download
        </button>

        <div className="flex items-center gap-2 bg-surface border border-line rounded-lg px-3 py-2 w-72">
          <Search className="w-4 h-4 text-dim" />
          <input
            type="text"
            placeholder="Search downloads"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            className="bg-transparent text-sm text-ink placeholder:text-dim outline-none w-full"
          />
        </div>
      </div>

      <div className="flex items-center gap-2 font-mono text-sm text-muted">
        <ArrowDown className="w-4 h-4 text-signal" />
        <span className="text-ink">{totalSpeedLabel}</span>
        <span className="text-dim">·</span>
        <span>{activeCount} active</span>
      </div>
    </div>
  );
}
