import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import { Checkbox } from "./Checkbox";

export function ConfirmDeleteModal({
  names,
  onCancel,
  onConfirm,
}: {
  names: string[];
  onCancel: () => void;
  onConfirm: (deleteFile: boolean) => void;
}) {
  const [deleteFile, setDeleteFile] = useState(false);

  if (names.length === 0) return null;

  const single = names.length === 1;
  const label = single ? names[0] : `${names.length} downloads`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-[440px] max-w-full bg-surface border border-line rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 className="font-display font-semibold text-sm">Remove download</h2>
          <button
            onClick={onCancel}
            className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-ink leading-relaxed">
            Remove <span className="font-mono text-muted">{label}</span> from the list?
          </p>
          <label className="flex items-center gap-2.5 text-sm text-muted cursor-pointer select-none">
            <Checkbox
              checked={deleteFile}
              onChange={() => setDeleteFile((v) => !v)}
            />
            Also delete the file from disk
          </label>
          {deleteFile && (
            <p className="text-[11px] text-dim leading-relaxed">
              The file will be moved to the Recycle Bin, not permanently erased.
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 h-16 border-t border-line">
          <button
            onClick={onCancel}
            className="px-3.5 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-raised transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(deleteFile)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white bg-danger hover:opacity-90 transition-opacity"
          >
            <Trash2 className="w-4 h-4" strokeWidth={2.5} />
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
