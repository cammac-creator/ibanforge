'use client';

import { useState } from 'react';

const VIOLET = '#a855f7';
const VIOLET_DIM = '#6d28d9';

const MONTH_FR = ['jan', 'fév', 'mar', 'avr', 'mai', 'juin', 'juil', 'août', 'sep', 'oct', 'nov', 'déc'];

function monthLabel(ym: string): string {
  const m = Number(ym.slice(5, 7));
  return MONTH_FR[m - 1] ?? ym.slice(5);
}

function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

type Mode = 'day' | 'month';

/**
 * Column chart of a client's API usage, for the client-detail header.
 * Two views the user toggles between:
 *   - "Jour"  — per-day (request_log), last 30 days. Precise, but attribution
 *     is forward-only since 2026-06-30, so older activity may be absent here.
 *   - "Mois"  — per-month (api_usage), last 6 months. Complete history.
 * Defaults to the day view when it carries any data, otherwise the month view.
 */
export function UsageChart({
  days,
  series,
  months,
}: {
  days: Array<{ day: string; count: number }>;
  series: number[];
  months: string[];
}) {
  const dailyTotal = days.reduce((a, d) => a + d.count, 0);
  const monthlyTotal = series.reduce((a, b) => a + b, 0);
  const [mode, setMode] = useState<Mode>(dailyTotal > 0 ? 'day' : 'month');

  if (dailyTotal === 0 && monthlyTotal === 0) {
    return (
      <div className="w-full rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-600">Utilisation</p>
        <p className="mt-1 text-xs text-zinc-600">Aucun appel API enregistré pour l’instant.</p>
      </div>
    );
  }

  const isDay = mode === 'day';
  let bars: Array<{ label: string; tip: string; value: number }>;
  let total: number;

  if (isDay) {
    const byDay = new Map(days.map((d) => [d.day, d.count]));
    const axis = lastNDays(30);
    bars = axis.map((day) => {
      const v = byDay.get(day) ?? 0;
      return { label: day.slice(8), tip: `${day} · ${v} appel${v > 1 ? 's' : ''}`, value: v };
    });
    total = dailyTotal;
  } else {
    bars = series.map((v, i) => ({
      label: monthLabel(months[i] ?? ''),
      tip: `${months[i] ?? ''} · ${v} appel${v > 1 ? 's' : ''}`,
      value: v,
    }));
    total = monthlyTotal;
  }

  const max = Math.max(...bars.map((b) => b.value), 1);
  const caption = isDay ? '30 derniers jours · par jour' : '6 derniers mois · par mois';

  return (
    <div className="w-full rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-600">Utilisation · {caption}</p>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-md border border-zinc-800">
            {(['day', 'month'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`px-2 py-0.5 text-[10px] font-medium transition-colors ${
                  mode === m ? 'bg-violet-500/20 text-violet-200' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                aria-pressed={mode === m}
              >
                {m === 'day' ? 'Jour' : 'Mois'}
              </button>
            ))}
          </div>
          <p className="shrink-0 font-mono text-[11px] text-violet-300">{total.toLocaleString('fr-CH')} appels</p>
        </div>
      </div>
      <div className="mt-2 flex h-[52px] items-end gap-[3px]">
        {bars.map((b, i) => {
          const last = i === bars.length - 1;
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={b.tip}>
              {b.value > 0 && isDay && (
                <span className="pointer-events-none absolute -top-0.5 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] text-violet-300 group-hover:block">
                  {b.value}
                </span>
              )}
              {!isDay && b.value > 0 && (
                <span className="mb-0.5 text-center font-mono text-[9px] text-zinc-400">{b.value}</span>
              )}
              <div
                className="w-full rounded-[2px]"
                style={{
                  height: `${Math.max(b.value > 0 ? 4 : 2, (b.value / max) * 40)}px`,
                  backgroundColor: last ? VIOLET : VIOLET_DIM,
                  opacity: b.value === 0 ? 0.18 : 0.95,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-zinc-600">
        {isDay ? (
          <>
            <span>{bars[0]?.label}</span>
            <span>{bars[14]?.label}</span>
            <span>{bars[29]?.label}</span>
          </>
        ) : (
          bars.map((b, i) => <span key={i}>{b.label}</span>)
        )}
      </div>
      {isDay && dailyTotal === 0 && (
        <p className="mt-1.5 text-[10px] leading-snug text-zinc-600">
          Aucune activité attribuée au jour le jour pour ce client. Le détail quotidien ne se construit que depuis
          le 30 juin&nbsp;; l’historique plus ancien reste visible dans la vue «&nbsp;Mois&nbsp;».
        </p>
      )}
    </div>
  );
}
