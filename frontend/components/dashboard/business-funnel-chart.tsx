'use client';

import {
  BarChart as RechartsBarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { ChartMarker } from '@/components/stacked-bar-chart';

// The funnel series always ends on the current UTC day, still in progress —
// its last bar is shorter than a full day and must NOT be read as a drop. We
// fade it and add a note instead of rendering a misleading cliff.
function isCurrentUtcDay(date: unknown): boolean {
  return typeof date === 'string' && date === new Date().toISOString().slice(0, 10);
}

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

// Amber, matching the cohort study panel, and set apart from the five funnel
// colours so the marker never reads as a funnel category.
const COHORT_COLOR = '#d0a548';

type Row = BusinessFunnelDay & {
  total: number;
  conversion: number;
  /** Real cohort validations that day (kept out of `total`). */
  cohort_units: number;
  /** Height of the marker only — a reduced, funnel-relative scale, never the
   *  real count (that would be ~10× the funnel and flatten it). */
  cohort_scaled: number;
  /** Transparent gap under the marker so it floats clear of the funnel. */
  cohort_gap: number;
};

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: Row }>; label?: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  const total = row.total;
  const pct = (n: number) => (total > 0 ? ` (${((n / total) * 100).toFixed(0)}%)` : '');
  return (
    <div className="rounded-md border border-[var(--ink-5)]/60 bg-[var(--ink-0)]/95 px-3 py-2 text-xs text-[var(--fg-1)] shadow-lg shadow-black/40 backdrop-blur">
      <div className="mb-1.5 font-semibold text-[var(--fg-1)]">
        {label} · {total} requêtes métier
      </div>
      {total > 0 ? (
        <>
          <div className="mb-1 text-[11px] text-[var(--fg-3)]">
            Taux de conversion : <span className="font-mono text-[var(--ok)]">{row.conversion.toFixed(0)}%</span>
          </div>
          <div className="space-y-0.5 border-t border-[var(--ink-4)] pt-1.5">
            {BARS.map((b) => {
              const v = row[b.key];
              if (v === 0) return null;
              return (
                <div key={b.key} className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ backgroundColor: b.color }} />
                  <span className="text-[var(--fg-3)]">{b.label}</span>
                  <span className="ml-auto font-mono text-[var(--fg-1)] tabular-nums">
                    {v}
                    <span className="text-[var(--fg-5)]">{pct(v)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="text-[var(--fg-4)] text-[11px]">Aucune requête métier ce jour-là.</div>
      )}
      {row.cohort_units > 0 && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-[var(--ink-4)] pt-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: COHORT_COLOR }} />
          <span className="text-[var(--fg-3)]">Cohortes (hors funnel)</span>
          <span className="ml-auto font-mono tabular-nums" style={{ color: COHORT_COLOR }}>
            {row.cohort_units.toLocaleString('fr-CH').replace(/ /g, ' ')}
          </span>
        </div>
      )}
    </div>
  );
}

export function BusinessFunnelChart({
  data,
  markers,
  cohortByDate,
}: {
  data: BusinessFunnelDay[];
  markers?: ChartMarker[];
  /** date (YYYY-MM-DD) → real cohort validations that day. */
  cohortByDate?: Record<string, number>;
}) {
  const cohort = cohortByDate ?? {};
  const cohortValues = Object.values(cohort).filter((n) => n > 0);
  const maxCohort = cohortValues.length ? Math.max(...cohortValues) : 0;

  const base = data.map((d) => {
    const total = d.success + d.paywall + d.auth_or_quota + d.bad_input + d.server_error;
    const conversion = total > 0 ? (d.success / total) * 100 : 0;
    return { ...d, total, conversion };
  });
  const maxFunnel = Math.max(1, ...base.map((r) => r.total));

  const rows: Row[] = base.map((r) => {
    const units = cohort[r.date] ?? 0;
    // The marker rides a reduced scale (a cohort day at most ~18% of the tallest
    // funnel bar) and stays proportional BETWEEN cohort days, with a floor so a
    // small one is still visible. The true count lives in the tooltip only.
    const cohort_scaled =
      units > 0 && maxCohort > 0 ? Math.max(maxFunnel * 0.03, (units / maxCohort) * maxFunnel * 0.18) : 0;
    // A transparent spacer between the funnel and the marker, so the amber
    // pill floats clear of the orange paywall band instead of blending into it.
    const cohort_gap = units > 0 ? maxFunnel * 0.05 : 0;
    return { ...r, cohort_units: units, cohort_scaled, cohort_gap };
  });
  const hasCohort = rows.some((r) => r.cohort_units > 0);

  if (rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center text-[var(--fg-4)] text-sm">
        Pas encore de trafic métier à afficher.
      </div>
    );
  }

  const lastIdx = rows.length - 1;
  const lastIsPartial = lastIdx >= 0 && isCurrentUtcDay(rows[lastIdx]?.date);

  // Same convention as the traffic chart: one marker per day, labels joined.
  const dates = new Set(rows.map((r) => r.date));
  const markersByDate = new Map<string, string>();
  for (const m of markers ?? []) {
    const day = m.date.slice(0, 10);
    if (!dates.has(day)) continue;
    markersByDate.set(day, markersByDate.has(day) ? `${markersByDate.get(day)} · ${m.label}` : m.label);
  }

  return (
    <div>
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
          >
            {rows.map((_, i) => (
              <Cell key={i} fillOpacity={lastIsPartial && i === lastIdx ? 0.3 : 1} />
            ))}
          </Bar>
        ))}
        {/* Transparent spacer, then the marker on top — the pill floats clear
            of the funnel. Both stacked LAST and excluded from `total`, so
            conversion and the funnel figures are untouched; the real count is in
            the tooltip. The marker's height is a reduced scale, not the count. */}
        {hasCohort && (
          <Bar dataKey="cohort_gap" stackId="funnel" fill="transparent" legendType="none" isAnimationActive={false} />
        )}
        {hasCohort && (
          <Bar
            dataKey="cohort_scaled"
            name="Cohortes (hors funnel · repère)"
            fill={COHORT_COLOR}
            stackId="funnel"
            radius={[2, 2, 2, 2]}
            isAnimationActive={false}
          />
        )}
        {[...markersByDate.entries()].map(([day]) => (
          <ReferenceLine key={day} x={day} stroke="#a78bfa" strokeDasharray="4 3" strokeOpacity={0.7} />
        ))}
      </RechartsBarChart>
      </ResponsiveContainer>
      {markersByDate.size > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-violet-300/80">
          ⚑ {[...markersByDate.entries()].map(([day, label]) => `${day.slice(8, 10)}/${day.slice(5, 7)} ${label}`).join(' · ')}
        </p>
      )}
      {hasCohort && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-[var(--fg-4)]">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: COHORT_COLOR, opacity: 0.7 }} />
          <span>
            Le repère ambré marque les jours d&apos;<strong className="text-[var(--fg-3)]">inscriptions
            automatiques regroupées</strong> — validations exclues du funnel, à échelle réduite (le volume
            réel, jusqu&apos;à ~10× la hauteur du graphe, s&apos;affiche au survol).
          </span>
        </p>
      )}
      {lastIsPartial && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--fg-4)]">
          La dernière barre = <strong className="text-[var(--fg-3)]">aujourd&apos;hui</strong>, jour en
          cours (comptage depuis minuit UTC) — encore incomplet, ce n&apos;est pas une chute. Sa
          couleur est volontairement estompée.
        </p>
      )}
    </div>
  );
}
