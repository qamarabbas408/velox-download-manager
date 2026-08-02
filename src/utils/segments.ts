import type { SegmentInfo, SegmentState } from "../types";

export function buildSegments(
  sizeBytes: number,
  count: number,
  activeCount: number
): SegmentInfo[] {
  if (count <= 0) return [];
  const chunk = Math.floor(sizeBytes / count);
  const segments: SegmentInfo[] = [];

  for (let i = 0; i < count; i++) {
    const start = i * chunk;
    const end = i === count - 1 ? sizeBytes : (i + 1) * chunk;
    const length = end - start;

    let state: SegmentState = "idle";
    let downloaded = 0;
    if (i < activeCount) {
      state = "active";
      downloaded = Math.floor(length * (0.3 + Math.random() * 0.5));
    }

    segments.push({ index: i, start, end, downloaded, state });
  }

  return segments;
}
