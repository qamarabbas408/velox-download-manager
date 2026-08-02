import type { DownloadStatus } from "../types";

interface SegmentedProgressBarProps {
  progress: number; // 0-100
  segments: number;
  activeSegments: number;
  status: DownloadStatus;
}

const toneByStatus: Record<DownloadStatus, string> = {
  downloading: "bg-signal",
  completed: "bg-complete",
  paused: "bg-paused",
  queued: "bg-dim",
  error: "bg-danger",
};

/**
 * Renders the download's progress as discrete segments rather than a single
 * bar — each cell stands for one of the file's concurrent byte-range
 * connections, so the UI mirrors how the engine actually fetches the file.
 */
export function SegmentedProgressBar({
  progress,
  segments,
  activeSegments,
  status,
}: SegmentedProgressBarProps) {
  const fillColor = toneByStatus[status];
  const filledCount = Math.round((progress / 100) * segments);
  const cells = Array.from({ length: segments });

  return (
    <div className="flex items-center gap-[2px] h-1.5 w-full" role="progressbar" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
      {cells.map((_, i) => {
        const isFilled = i < filledCount;
        const isLeadingEdge =
          status === "downloading" && i === filledCount - 1 && activeSegments > 0;

        return (
          <div
            key={i}
            className={[
              "flex-1 h-full rounded-[1px]",
              isFilled ? fillColor : "bg-raised",
              isLeadingEdge ? "animate-pulse" : "",
            ].join(" ")}
          />
        );
      })}
    </div>
  );
}
