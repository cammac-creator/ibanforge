'use client';

import {
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface StackedBarChartProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: Array<Record<string, any>>;
  bars: Array<{ key: string; color: string; label: string }>;
}

// The stats history always ends on the current UTC day, which is still in
// progress — its bar is therefore shorter than a full day and must NOT be read
// as a traffic drop. We fade that last bar and add a note instead of hiding it.
function isCurrentUtcDay(date: unknown): boolean {
  return typeof date === 'string' && date === new Date().toISOString().slice(0, 10);
}

export function StackedBarChart({ data, bars }: StackedBarChartProps) {
  const lastIdx = data.length - 1;
  const lastIsPartial = lastIdx >= 0 && isCurrentUtcDay(data[lastIdx]?.date);

  return (
    <div>
      <ResponsiveContainer width="100%" height={280}>
      <RechartsBarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
      </RechartsBarChart>
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
