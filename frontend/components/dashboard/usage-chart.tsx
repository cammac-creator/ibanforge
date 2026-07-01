'use client';

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

/**
 * Column chart of a client's API usage, for the client-detail header.
 * Prefers the per-day series (request_log, last 30 days); falls back to the
 * per-month series (api_usage, 6 months) for keys whose daily attribution
 * predates the key_prefix logging rollout (2026-06-30).
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
  const daily = days.length > 0;
  const monthlyTotal = series.reduce((a, b) => a + b, 0);

  if (!daily && monthlyTotal === 0) {
    return (
      <div className="w-full rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-600">Utilisation</p>
        <p className="mt-1 text-xs text-zinc-600">Aucun appel API enregistré pour l’instant.</p>
      </div>
    );
  }

  let bars: Array<{ label: string; tip: string; value: number }>;
  let caption: string;
  let total: number;

  if (daily) {
    const byDay = new Map(days.map((d) => [d.day, d.count]));
    const axis = lastNDays(30);
    bars = axis.map((day) => ({
      label: day.slice(8), // "01".."31"
      tip: `${day} · ${byDay.get(day) ?? 0} appel${(byDay.get(day) ?? 0) > 1 ? 's' : ''}`,
      value: byDay.get(day) ?? 0,
    }));
    total = days.reduce((a, d) => a + d.count, 0);
    caption = '30 derniers jours · par jour';
  } else {
    bars = series.map((v, i) => ({
      label: monthLabel(months[i] ?? ''),
      tip: `${months[i] ?? ''} · ${v} appel${v > 1 ? 's' : ''}`,
      value: v,
    }));
    total = monthlyTotal;
    caption = '6 derniers mois · par mois (le détail par jour se construit depuis le 30 juin)';
  }

  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <div className="w-full rounded-lg border border-zinc-800/60 bg-zinc-950/40 px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-600">Utilisation · {caption}</p>
        <p className="shrink-0 font-mono text-[11px] text-violet-300">{total.toLocaleString('fr-CH')} appels</p>
      </div>
      <div className="mt-2 flex h-[52px] items-end gap-[3px]">
        {bars.map((b, i) => {
          const last = i === bars.length - 1;
          return (
            <div key={i} className="group relative flex h-full flex-1 flex-col justify-end" title={b.tip}>
              {b.value > 0 && daily && (
                <span className="pointer-events-none absolute -top-0.5 left-1/2 hidden -translate-x-1/2 font-mono text-[9px] text-violet-300 group-hover:block">
                  {b.value}
                </span>
              )}
              {!daily && b.value > 0 && (
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
        {daily ? (
          <>
            <span>{bars[0]?.label}</span>
            <span>{bars[14]?.label}</span>
            <span>{bars[29]?.label}</span>
          </>
        ) : (
          bars.map((b, i) => <span key={i}>{b.label}</span>)
        )}
      </div>
    </div>
  );
}
