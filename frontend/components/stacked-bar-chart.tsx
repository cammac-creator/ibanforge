'use client';

import {
  ComposedChart,
  Bar,
  Area,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export interface ChartMarker {
  /** YYYY-MM-DD — must match a date on the X axis to be drawn. */
  date: string;
  label: string;
  kind: string;
}

interface StackedBarChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Array<Record<string, any>>;
  bars: Array<{ key: string; color: string; label: string }>;
  /**
   * Draw the weekday expected band from these per-row fields (null-safe:
   * rows without a band leave a gap). Off when omitted.
   */
  band?: { minKey: string; maxKey: string };
  /** Vertical event markers (deploys, manual notes). */
  markers?: ChartMarker[];
}

// The stats history always ends on the current UTC day, which is still in
// progress — its bar is therefore shorter than a full day and must NOT be read
// as a traffic drop. We fade that last bar and add a note instead of hiding it.
function isCurrentUtcDay(date: unknown): boolean {
  return typeof date === 'string' && date === new Date().toISOString().slice(0, 10);
}

export function StackedBarChart({ data, bars, band, markers }: StackedBarChartProps) {
  const lastIdx = data.length - 1;
  const lastIsPartial = lastIdx >= 0 && isCurrentUtcDay(data[lastIdx]?.date);

  // One marker per day on the axis: several events a day would stack
  // unreadable labels on the same x, so their labels are joined.
  const dates = new Set(data.map((d) => String(d.date)));
  const markersByDate = new Map<string, string>();
  for (const m of markers ?? []) {
    const day = m.date.slice(0, 10);
    if (!dates.has(day)) continue;
    markersByDate.set(day, markersByDate.has(day) ? `${markersByDate.get(day)} · ${m.label}` : m.label);
  }

  const hasBand =
    band !== undefined && data.some((d) => d[band.minKey] != null && d[band.maxKey] != null);

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <XAxis
          dataKey="date"
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={{ stroke: '#27272a' }}
          tickLine={false}
          tickFormatter={(v: string) => {
            const d = new Date(v + 'T00:00:00');
            return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
          }}
        />
        <YAxis
          tick={{ fill: '#71717a', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={40}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: '#18181b',
            border: '1px solid #3f3f46',
            borderRadius: '8px',
            color: '#f4f4f5',
            fontSize: 12,
          }}
          cursor={{ fill: '#27272a40' }}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 12, color: '#a1a1aa', paddingTop: 8 }}
        />
        {hasBand && (
          <Area
            // Range area: [low, high] per point — the grey "normal weeks"
            // corridor behind the bars. Rows with a null band produce a gap.
            dataKey={(d: Record<string, unknown>) =>
              d[band.minKey] != null && d[band.maxKey] != null
                ? [d[band.minKey] as number, d[band.maxKey] as number]
                : [null, null]
            }
            name="Attendu (8 sem. même jour)"
            stroke="none"
            fill="#71717a"
            fillOpacity={0.18}
            connectNulls={false}
            isAnimationActive={false}
            legendType="rect"
          />
        )}
        {bars.map((bar) => (
          <Bar
            key={bar.key}
            dataKey={bar.key}
            name={bar.label}
            fill={bar.color}
            stackId="status"
            radius={[0, 0, 0, 0]}
          >
            {data.map((entry, i) => (
              <Cell
                key={i}
                fillOpacity={lastIsPartial && i === lastIdx ? 0.3 : 1}
              />
            ))}
          </Bar>
        ))}
        {[...markersByDate.entries()].map(([day, label]) => (
          <ReferenceLine
            key={day}
            x={day}
            stroke="#a78bfa"
            strokeDasharray="4 3"
            strokeOpacity={0.7}
            label={{
              value: label.length > 22 ? `${label.slice(0, 22)}…` : label,
              position: 'top',
              fill: '#a78bfa',
              fontSize: 10,
            }}
          />
        ))}
      </ComposedChart>
      </ResponsiveContainer>
      {lastIsPartial && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--fg-4)]">
          La dernière barre = <strong className="text-[var(--fg-3)]">aujourd&apos;hui</strong>, jour en
          cours (comptage depuis minuit UTC). Elle se remplit au fil de la journée — ce n&apos;est
          pas une chute de trafic.
        </p>
      )}
    </div>
  );
}
