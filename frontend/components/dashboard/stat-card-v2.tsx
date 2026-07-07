import type { ReactNode } from 'react';
import { InfoDot } from './info-dot';

interface TrendProps {
  direction: 'up' | 'down' | 'neutral';
  label: string;
}

interface StatCardV2Props {
  title: string;
  value: string;
  trend?: TrendProps;
  sparkline?: number[];
  accentColor?: string;
  hint?: ReactNode;
}

function SparklineSVG({
  data,
  color = '#f59e0b',
}: {
  data: number[];
  color?: string;
}) {
  if (data.length < 2) return null;

  const width = 80;
  const height = 24;
  const padding = 2;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = padding + (i / (data.length - 1)) * (width - padding * 2);
      const y = padding + ((max - v) / range) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <polyline
        points={points}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        opacity="0.8"
      />
    </svg>
  );
}

function TrendBadge({ trend }: { trend: TrendProps }) {
  const styles = {
    up: 'bg-[var(--ok)]/10 text-[var(--ok)] border border-[var(--ok)]/20',
    down: 'bg-red-500/10 text-red-400 border border-red-500/20',
    neutral: 'bg-[var(--ink-4)] text-[var(--fg-3)] border border-[var(--ink-5)]',
  };

  const arrows = {
    up: '↑',
    down: '↓',
    neutral: '→',
  };

  return (
    <span
      className={[
        'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium',
        styles[trend.direction],
      ].join(' ')}
    >
      <span>{arrows[trend.direction]}</span>
      <span>{trend.label}</span>
    </span>
  );
}

export function StatCardV2({
  title,
  value,
  trend,
  sparkline,
  accentColor = '#f59e0b',
  hint,
}: StatCardV2Props) {
  return (
    <div className="bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 border border-[var(--ink-4)]/60 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="mb-2 flex items-center gap-1.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--fg-4)]">
              {title}
            </p>
            {hint && <InfoDot>{hint}</InfoDot>}
          </div>
          <p className="text-2xl font-bold font-mono text-white leading-none mb-2">
            {value}
          </p>
          {trend && <TrendBadge trend={trend} />}
        </div>

        {sparkline && sparkline.length >= 2 && (
          <div className="shrink-0 mt-1">
            <SparklineSVG data={sparkline} color={accentColor} />
          </div>
        )}
      </div>
    </div>
  );
}
