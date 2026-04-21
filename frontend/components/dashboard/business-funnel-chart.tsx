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

export interface BusinessFunnelDay {
  date: string;
  success: number;
  paywall: number;
  auth_or_quota: number;
  bad_input: number;
  server_error: number;
}

const BARS = [
  { key: 'success', color: '#22c55e', label: 'Paid success (2xx)' },
  { key: 'paywall', color: '#f59e0b', label: 'Paywall hit (402)' },
  { key: 'auth_or_quota', color: '#8b5cf6', label: 'Auth / quota (401 / 429)' },
  { key: 'bad_input', color: '#eab308', label: 'Bad input (400)' },
  { key: 'server_error', color: '#ef4444', label: 'Server error (5xx)' },
] as const;

type Row = BusinessFunnelDay & { total: number; conversion: number };

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: Row }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const total = row.total;
  const pct = (n: number) => (total > 0 ? ` (${((n / total) * 100).toFixed(0)}%)` : '');
  return (
    <div className="rounded-md border border-zinc-700/60 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-200 shadow-lg shadow-black/40 backdrop-blur">
      <div className="mb-1.5 font-semibold text-zinc-100">
        {label} · {total} requêtes métier
      </div>
      {total > 0 ? (
        <>
          <div className="mb-1 text-[11px] text-zinc-400">
            Taux de conversion : <span className="font-mono text-emerald-400">{row.conversion.toFixed(0)}%</span>
          </div>
          <div className="space-y-0.5 border-t border-zinc-800 pt-1.5">
            {BARS.map((b) => {
              const v = row[b.key];
              if (v === 0) return null;
              return (
                <div key={b.key} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="text-zinc-400">{b.label}</span>
                  <span className="ml-auto font-mono text-zinc-200 tabular-nums">
                    {v}
                    <span className="text-zinc-600">{pct(v)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="text-zinc-500 text-[11px]">Aucune requête métier ce jour-là.</div>
      )}
    </div>
  );
}

export function BusinessFunnelChart({ data }: { data: BusinessFunnelDay[] }) {
  const rows: Row[] = data.map((d) => {
    const total = d.success + d.paywall + d.auth_or_quota + d.bad_input + d.server_error;
    const conversion = total > 0 ? (d.success / total) * 100 : 0;
    return { ...d, total, conversion };
  });

  if (rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-zinc-500 text-sm">
        Pas encore de trafic métier à afficher.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={280}>
      <RechartsBarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
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
        <Tooltip content={<CustomTooltip />} cursor={{ fill: '#27272a40' }} />
        <Legend
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, color: '#a1a1aa', paddingTop: 8 }}
        />
        {BARS.map((b) => (
          <Bar
            key={b.key}
            dataKey={b.key}
            name={b.label}
            fill={b.color}
            stackId="funnel"
            radius={[0, 0, 0, 0]}
          />
        ))}
      </RechartsBarChart>
    </ResponsiveContainer>
  );
}
