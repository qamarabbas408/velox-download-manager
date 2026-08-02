import { useState } from "react";
import { X, FolderOpen, SlidersHorizontal } from "lucide-react";
import type { AppSettings } from "../types";

export function SettingsModal({
  open,
  settings,
  onClose,
  onSave,
}: {
  open: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSave: (settings: AppSettings) => void;
}) {
  const [draft, setDraft] = useState<AppSettings>(settings);

  if (!open) return null;

  const reset = () => setDraft(settings);

  const inputCls =
    "bg-transparent text-sm text-ink placeholder:text-dim outline-none w-full";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[520px] max-w-full bg-surface border border-line rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 h-14 border-b border-line">
          <h2 className="font-display font-semibold text-sm">Settings</h2>
          <button onClick={onClose} className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-raised" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-ink">
              <SlidersHorizontal className="w-4 h-4 text-signal" />
              <span className="font-medium">Connections</span>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted">Max connections per download</span>
                <span className="font-mono text-ink">{draft.maxConnections}</span>
              </div>
              <input
                type="range"
                min={1}
                max={32}
                value={draft.maxConnections}
                onChange={(e) => setDraft({ ...draft, maxConnections: Number(e.target.value) })}
                className="w-full accent-[#0DA3EE]"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-muted">Default segment count</span>
                <span className="font-mono text-ink">{draft.defaultSegments}</span>
              </div>
              <input
                type="range"
                min={1}
                max={draft.maxConnections}
                value={draft.defaultSegments}
                onChange={(e) => setDraft({ ...draft, defaultSegments: Number(e.target.value) })}
                className="w-full accent-[#0DA3EE]"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-ink">
              <FolderOpen className="w-4 h-4 text-signal" />
              <span className="font-medium">Storage</span>
            </div>

            <div className="flex items-center gap-2 bg-raised border border-line rounded-lg px-3 py-2.5">
              <FolderOpen className="w-4 h-4 text-dim shrink-0" />
              <input
                type="text"
                value={draft.downloadDir}
                onChange={(e) => setDraft({ ...draft, downloadDir: e.target.value })}
                className={inputCls}
              />
            </div>

            <label className="flex items-center justify-between cursor-pointer">
              <span className="text-xs text-muted">
                Resume interrupted downloads from saved state
              </span>
              <button
                role="switch"
                aria-checked={draft.resumeEnabled}
                onClick={() => setDraft({ ...draft, resumeEnabled: !draft.resumeEnabled })}
                className={[
                  "w-10 h-6 rounded-full transition-colors relative",
                  draft.resumeEnabled ? "bg-signal" : "bg-raised",
                ].join(" ")}              >
                <span
                  className={[
                    "absolute top-0.5 w-5 h-5 rounded-full bg-ink transition-transform",
                    draft.resumeEnabled ? "translate-x-[18px]" : "translate-x-0.5",
                  ].join(" ")}
                />
              </button>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 h-16 border-t border-line">
          <button
            onClick={reset}
            className="px-3.5 py-2 rounded-lg text-sm text-muted hover:text-ink hover:bg-raised transition-colors"
          >
            Reset
          </button>
          <button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
            className="btn-primary px-3.5 py-2 rounded-lg text-sm font-medium transition-all"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
