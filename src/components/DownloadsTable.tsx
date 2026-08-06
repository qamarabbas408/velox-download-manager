import type { DownloadItem } from "../types";
import { DownloadRow } from "./DownloadRow";
import { Checkbox } from "./Checkbox";

export function DownloadsTable({
  items,
  selectedIds,
  onToggleSelect,
  onPause,
  onResume,
  onRetry,
  onReveal,
  onRemove,
}: {
  items: DownloadItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onRetry: (id: string) => void;
  onReveal: (item: DownloadItem) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="divide-y divide-line">
      {items.map((item) => (
        <div key={item.id} className="flex items-center">
          <label className="pl-5 pr-2 shrink-0 flex items-center">
            <Checkbox checked={selectedIds.has(item.id)} onChange={() => onToggleSelect(item.id)} />
          </label>
          <div className="flex-1 min-w-0">
            <DownloadRow
              item={item}
              onPause={() => onPause(item.id)}
              onResume={() => onResume(item.id)}
              onRetry={() => onRetry(item.id)}
              onReveal={() => onReveal(item)}
              onRemove={() => onRemove(item.id)}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
