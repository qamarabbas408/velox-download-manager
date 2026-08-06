import { ArrowDownToLine, SearchX } from "lucide-react";

export function EmptyState({
  variant,
  isTauri,
}: {
  variant: "empty" | "no-results";
  isTauri: boolean;
}) {
  if (variant === "no-results") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-raised border border-line flex items-center justify-center text-dim">
          <SearchX className="w-6 h-6" />
        </div>
        <div>
          <p className="text-sm text-ink font-medium">No downloads found</p>
          <p className="text-xs text-dim mt-1">Try adjusting your search or pick another category.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-raised border border-line flex items-center justify-center">
        <div className="w-10 h-10 rounded-xl btn-primary flex items-center justify-center">
          <ArrowDownToLine className="w-5 h-5 text-white" strokeWidth={2.5} />
        </div>
      </div>
      <div>
        <p className="text-sm text-ink font-medium">No downloads yet</p>
        {isTauri ? (
          <p className="text-xs text-dim mt-1">
            Paste a URL and hit “Add Url” to start a real segmented download.
          </p>
        ) : (
          <p className="text-xs text-dim mt-1">
            Your downloads will show up here once you add a URL.
          </p>
        )}
      </div>
    </div>
  );
}
