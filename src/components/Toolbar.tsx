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
          className="btn-primary flex items-center gap-1.5 text-sm font-medium px-3.5 py-2 rounded-lg transition-all"
        >
          <Plus className="w-4 h-4" strokeWidth={2.5} />
          Add download
        </button>

        <div className="flex items-center gap-2 bg-surface border border-line rounded-lg px-3 py-2 w-72 focus-within:border-signal/50 focus-within:ring-1 focus-within:ring-signal/30 transition-all">
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

      <div className="flex items-center gap-2 font-mono text-sm">
        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-signal/10 text-signal">
          <ArrowDown className="w-4 h-4" />
          <span>{totalSpeedLabel}</span>
        </span>
        <span className="text-dim">·</span>
        <span className="text-muted">{activeCount} active</span>
      </div>
    </div>
  );
}
