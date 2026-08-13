import { useMemo } from "react";
import { Activity } from "lucide-react";
import { formatSpeed } from "../utils/format";

export interface SpeedSample {
  t: number;
  speed: number;
}

const WIDTH = 800;
const HEIGHT = 120;
const PAD_BOTTOM = 10;

interface SpeedChartProps {
  samples: SpeedSample[];
  currentSpeed: number;
}

export function SpeedChart({ samples, currentSpeed }: SpeedChartProps) {
  const now = Date.now();
  const windowMs = 90_000;

  const { points, areaPath, peak, active } = useMemo(() => {
    const visible = samples.filter((s) => now - s.t <= windowMs);
    const peak = Math.max(currentSpeed, ...visible.map((s) => s.speed));
    const active = currentSpeed > 0 || visible.some((s) => s.speed > 0);
    const scaled = Math.max(peak * 1.08, 1);
    const startT = now - windowMs;
    const pts = visible.map((s) => {
      const x = Math.max(0, Math.min(WIDTH, ((s.t - startT) / windowMs) * WIDTH));
      const y = HEIGHT - (s.speed / scaled) * (HEIGHT - PAD_BOTTOM);
      return { x, y };
    });
    let points = "";
    let areaPath = "";
    if (pts.length >= 2) {
      points = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
      const first = pts[0];
      const last = pts[pts.length - 1];
      const linePath = pts
        .map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ");
      areaPath = `M${first.x.toFixed(1)},${HEIGHT} ${linePath} L${last.x.toFixed(1)},${HEIGHT} Z`;
    }
    return { points, areaPath, peak, active };
  }, [samples, currentSpeed, now]);

  const gridY = [0, 0.25, 0.5, 0.75, 1];
  const baselineY = HEIGHT * 0.75;

  return (
    <section className="shrink-0 border-b border-line bg-surface/30 select-none">
      <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
        <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
          <Activity size={15} className="text-signal" aria-hidden />
          Download speed
        </div>
        <div className="flex items-center gap-4 font-mono text-[11px]">
          <span className="text-muted">
            NOW <span className="ml-1 text-ink">{formatSpeed(currentSpeed)}</span>
          </span>
          <span className="text-muted">
            PEAK <span className="ml-1 text-signal">{formatSpeed(peak)}</span>
          </span>
        </div>
      </div>

      <div className="h-[116px] px-2 pb-2">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label="Download speed over time"
        >
          <defs>
            <linearGradient id="speedLine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="rgb(var(--signal-deep))" />
              <stop offset="100%" stopColor="rgb(var(--signal))" />
            </linearGradient>
            <linearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--signal))" stopOpacity="0.22" />
              <stop offset="100%" stopColor="rgb(var(--signal))" stopOpacity="0" />
            </linearGradient>
          </defs>

          {gridY.map((g) => (
            <line
              key={g}
              x1="0"
              y1={HEIGHT * g}
              x2={WIDTH}
              y2={HEIGHT * g}
              stroke="rgb(var(--line))"
              strokeOpacity="0.4"
              strokeWidth="1"
            />
          ))}

          {!active ? (
            <line
              x1="0"
              y1={baselineY}
              x2={WIDTH}
              y2={baselineY}
              stroke="rgb(var(--dim))"
              strokeOpacity="0.5"
              strokeWidth="1.5"
              strokeDasharray="2 5"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <>
              {areaPath && <path d={areaPath} fill="url(#speedFill)" />}
              {points && (
                <polyline
                  points={points}
                  fill="none"
                  stroke="url(#speedLine)"
                  strokeWidth="2"
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </>
          )}
        </svg>
      </div>
    </section>
  );
}
