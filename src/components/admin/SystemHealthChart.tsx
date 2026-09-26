import React, { useMemo, useState } from 'react';
import { cn } from '@/src/lib/utils';
import type { TimelineBucket } from '@/src/types/systemLogs';

/**
 * Real-time activity line chart for System Health.
 *
 * Dependency-free SVG: the project ships no chart library and the rest of the
 * admin UI hand-rolls SVG, so installing one here would be an unnecessary new
 * dependency. The viewBox scales it responsively, and every colour comes from
 * the shell CSS variables, so light and dark themes both work for free.
 *
 * Every point is a real bucket from `system_logs`. Nothing is synthesised: a
 * quiet period is drawn as a flat line at zero rather than filled in.
 */

export type SeriesKey = 'requests' | 'errors4xx' | 'errors5xx';

interface SeriesConfig {
  key: SeriesKey;
  label: string;
  color: string;
}

const SERIES: SeriesConfig[] = [
  { key: 'requests', label: 'Requests', color: 'var(--color-shell-primary)' },
  { key: 'errors4xx', label: '4xx', color: 'var(--color-shell-warning)' },
  { key: 'errors5xx', label: '5xx', color: 'var(--color-shell-error)' },
];

export interface SystemHealthChartProps {
  timeline: TimelineBucket[];
  /** Called with the clicked bucket so the page can drill into its logs. */
  onBucketClick?: (bucket: TimelineBucket) => void;
  /** Highlights the bucket currently shown in the log tabs. */
  selectedBucket?: string | null;
  className?: string;
}

const VIEW_W = 1000;
const VIEW_H = 260;
const PAD = { top: 12, right: 12, bottom: 26, left: 40 };

export const SystemHealthChart: React.FC<SystemHealthChartProps> = ({
  timeline,
  onBucketClick,
  selectedBucket,
  className,
}) => {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const { maxValue, hasData } = useMemo(() => {
    let max = 0;
    for (const b of timeline) {
      max = Math.max(max, b.requests, b.errors4xx, b.errors5xx);
    }
    return { maxValue: max, hasData: timeline.length > 0 && max > 0 };
  }, [timeline]);

  if (!timeline.length) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-[var(--color-shell-text-subtle)]">
        No activity in the selected window
      </div>
    );
  }

  const plotW = VIEW_W - PAD.left - PAD.right;
  const plotH = VIEW_H - PAD.top - PAD.bottom;
  const step = timeline.length > 1 ? plotW / (timeline.length - 1) : 0;

  // A flat line at the bottom is honest for a window with no traffic; scaling to
  // a max of zero would divide by zero and draw nonsense.
  const scaleMax = maxValue || 1;
  const x = (i: number) => PAD.left + (timeline.length > 1 ? i * step : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / scaleMax) * plotH;

  const pathFor = (key: SeriesKey) =>
    timeline.map((b, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(b[key]).toFixed(1)}`).join(' ');

  // A few evenly spaced time labels, never one per bucket.
  const labelEvery = Math.max(1, Math.ceil(timeline.length / 6));
  const hovered = hoverIndex != null ? timeline[hoverIndex] : null;
  const gridValues = [0, 0.5, 1].map((f) => Math.round(scaleMax * f));
  const selectedIndex = selectedBucket ? timeline.findIndex((b) => b.bucket === selectedBucket) : -1;

  return (
    <div className={cn('w-full', className)}>
      <div className="mb-2 flex flex-wrap items-center gap-4">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-shell-text-muted)]">
            <span className="h-2 w-4 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>

      <div className="relative">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="h-auto w-full"
          role="img"
          aria-label="Requests, 4xx errors and 5xx errors over time"
          preserveAspectRatio="none"
        >

          {timeline.map((b, i) =>
            i % labelEvery === 0 || i === timeline.length - 1 ? (
              <text
                key={b.bucket}
                x={x(i)}
                y={VIEW_H - 8}
                textAnchor="middle"
                fontSize="10"
                fill="var(--color-shell-text-subtle)"
              >
                {new Date(b.bucket).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </text>
            ) : null,
          )}

          {/* Highlight the bucket currently drilled into */}
          {selectedIndex >= 0 && (
            <rect
              x={x(selectedIndex) - step / 2}
              y={PAD.top}
              width={Math.max(step, 2)}
              height={plotH}
              fill="var(--color-shell-primary)"
              opacity="0.12"
            />
          )}

          {hovered && hoverIndex != null && (
            <line
              x1={x(hoverIndex)}
              x2={x(hoverIndex)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              stroke="var(--color-shell-border)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          )}

          {SERIES.map((s) => (
            <path
              key={s.key}
              d={pathFor(s.key)}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Invisible hit areas, one per bucket, for hover + click drill-down */}
          {timeline.map((b, i) => (
            <rect
              key={b.bucket}
              x={x(i) - step / 2}
              y={PAD.top}
              width={Math.max(step, 1)}
              height={plotH}
              fill="transparent"
              style={{ cursor: onBucketClick ? 'pointer' : 'default' }}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              onClick={() => onBucketClick?.(b)}
            >
              <title>
                {`${new Date(b.bucket).toLocaleString()} — ${b.requests} requests, ${b.errors4xx} 4xx, ${b.errors5xx} 5xx`}
              </title>
            </rect>
          ))}
        </svg>

        {hovered && hoverIndex != null && (
          <div className="pointer-events-none absolute left-2 top-2 rounded-lg border border-[var(--color-shell-border)] bg-[var(--color-shell-surface)] px-2.5 py-1.5 text-[11px] shadow-xs">
            <div className="font-semibold text-[var(--color-shell-text)]">
              {new Date(hovered.bucket).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'medium' })}
            </div>
            <div className="text-[var(--color-shell-text-muted)]">
              {hovered.requests} requests · {hovered.errors4xx} 4xx · {hovered.errors5xx} 5xx
              {hovered.latencyMs != null ? ` · ${hovered.latencyMs}ms avg` : ''}
            </div>
          </div>
        )}
      </div>

      {!hasData && (
        <p className="mt-2 text-center text-[11px] text-[var(--color-shell-text-subtle)]">
          No requests were recorded in this window.
        </p>
      )}
    </div>
  );
};

export default SystemHealthChart;
