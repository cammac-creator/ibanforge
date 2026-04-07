'use client';

import {
  BarChart as RechartsBarChart,
  Bar,
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

export function StackedBarChart({ data, bars }: StackedBarChartProps) {
  return (
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
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
