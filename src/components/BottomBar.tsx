import { ArrowDown } from "lucide-react";
import { Checkbox } from "./Checkbox";

export function BottomBar({
  visibleCount,
  totalCount,
  selectedCount,
  allSelected,
  onToggleSelectAll,
  totalSpeedLabel,
}: {
  visibleCount: number;
  totalCount: number;
  selectedCount: number;
  allSelected: boolean;
  onToggleSelectAll: () => void;
  totalSpeedLabel: string;
}) {
  return (
    <div className="h-11 shrink-0 flex items-center justify-between px-5 border-t border-line bg-surface/40 text-sm">
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-muted cursor-pointer select-none">
          <Checkbox checked={allSelected} onChange={onToggleSelectAll} />
          Select all
        </label>
        <span className="text-dim">
          {selectedCount > 0 ? `${selectedCount} selected` : `${visibleCount} of ${totalCount} shown`}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-muted">
        <ArrowDown className="w-4 h-4 text-dim" />
        <span className="font-mono">{totalSpeedLabel}</span>
      </div>
    </div>
  );
}
