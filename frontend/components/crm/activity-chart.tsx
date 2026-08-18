'use client';

import { useEffect, useMemo, useState } from 'react';

/** The chart is a guest in two homes (Clients dossier, Contacts thread), so
 *  its input is the minimal series shape rather than a full ClientDossier. */
export interface ActivityInput {
  email: string;
  /** Identity of the subject; a change resets the lazily-fetched 24 h data. */
  uid: string;
  days: Array<{ day: string; count: number; bad?: number }>;
  /** Aggregated monthly series (persistent counters, outlive log retention). */
  months: Array<{ month: string; count: number }>;
}

/**
 * One customer's call volume, at the scale the question needs: a year of
 * months for the arc of the relationship, weeks for the trend, 30/7 days for
 * the recent shape, and the last 24 hours when "are they calling right now?"
 * is the question. Refusals stack in red on top of the amber so a customer
 * hitting a wall is visible at every scale.
 *
 * Months come from the persistent per-key monthly counters (they outlive the
 * 12-month request_log retention window); weeks and days derive from the
 * dossier's daily series; the 24 h scale is fetched lazily because it is the
 * only one the dossier payload does not carry.
 */

type Scale = 'months' | 'weeks' | 'd30' | 'd7' | 'h24';

const SCALES: Array<{ key: Scale; label: string }> = [
  { key: 'months', label: 'Mois' },
  { key: 'weeks', label: 'Semaines' },
  { key: 'd30', label: '30 j' },
  { key: 'd7', label: '7 j' },
  { key: 'h24', label: '24 h' },
];

interface BarPoint {
  key: string;
  /** Full label for the tooltip. */
  label: string;
  count: number;
  bad: number;
}

const dayKeyUTC = (t: number): string => new Date(t).toISOString().slice(0, 10);
const DAY_MS = 86_400_000;

function daysBars(days: ActivityInput['days'], span: number): BarPoint[] {
  const known = new Map(days.map((x) => [x.day, x]));
  const out: BarPoint[] = [];
  const today = Date.now();
  for (let i = span - 1; i >= 0; i--) {
    const key = dayKeyUTC(today - i * DAY_MS);
    const hit = known.get(key);
    const [y, m, dd] = key.split('-');
    out.push({ key, label: `${dd}.${m}.${y}`, count: hit?.count ?? 0, bad: hit?.bad ?? 0 });
  }
  return out;
}

/** ISO-week bars (13 weeks, Monday keys) folded from the daily series. */
function weeksBars(days: ActivityInput['days']): BarPoint[] {
  const mondayOf = (t: number): number => {
    const d = new Date(t);
    const dow = (d.getUTCDay() + 6) % 7; // Monday=0
    return t - dow * DAY_MS;
  };
  const sums = new Map<string, { count: number; bad: number }>();
  for (const x of days) {
    const key = dayKeyUTC(mondayOf(Date.parse(`${x.day}T00:00:00Z`)));
    const s = sums.get(key) ?? { count: 0, bad: 0 };
    s.count += x.count;
    s.bad += x.bad ?? 0;
    sums.set(key, s);
  }
  const out: BarPoint[] = [];
  const thisMonday = mondayOf(Date.now());
  for (let i = 12; i >= 0; i--) {
    const key = dayKeyUTC(thisMonday - i * 7 * DAY_MS);
    const s = sums.get(key);
    const [y, m, dd] = key.split('-');
    out.push({ key, label: `semaine du ${dd}.${m}.${y}`, count: s?.count ?? 0, bad: s?.bad ?? 0 });
  }
  return out;
}

/** Twelve calendar months from the aggregated monthly series. */
function monthsBars(months: ActivityInput['months']): BarPoint[] {
  const sums = new Map<string, number>();
  for (const m of months) {
    sums.set(m.month, (sums.get(m.month) ?? 0) + m.count);
  }
  const out: BarPoint[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    const key = d.toISOString().slice(0, 7);
    out.push({ key, label: key.replace('-', '.'), count: sums.get(key) ?? 0, bad: 0 });
  }
  return out;
}

function hoursBars(fetched: Array<{ hour: string; count: number; bad: number }>): BarPoint[] {
  const known = new Map(fetched.map((h) => [h.hour, h]));
  const out: BarPoint[] = [];
  const now = new Date();
  const top = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours());
  for (let i = 23; i >= 0; i--) {
    const t = new Date(top - i * 3_600_000);
    const key = `${t.toISOString().slice(0, 13)}:00`;
    const hit = known.get(key);
    // Buckets are UTC; the label speaks the operator's clock.
    const local = new Date(t);
    out.push({
      key,
      label: `${String(local.getHours()).padStart(2, '0')}h (heure locale)`,
      count: hit?.count ?? 0,
      bad: hit?.bad ?? 0,
    });
  }
  return out;
}

export function ActivityChart({ a }: { a: ActivityInput }) {
  const d = a;
  const [scale, setScale] = useState<Scale>('d30');
  const [hours, setHours] = useState<Array<{ hour: string; count: number; bad: number }> | null>(null);
  const [hoursState, setHoursState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    if (scale !== 'h24' || hours !== null || hoursState === 'loading') return;
    setHoursState('loading');
    fetch(`/api/crm/client-hours?email=${encodeURIComponent(d.email)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = (await r.json()) as { hours?: Array<{ hour: string; count: number; bad: number }> };
        setHours(data.hours ?? []);
        setHoursState('idle');
      })
      .catch(() => setHoursState('error'));
  }, [scale, hours, hoursState, d.email]);

  // A new subject means new series; drop the fetched hours of the old one.
  useEffect(() => {
    setHours(null);
    setHoursState('idle');
  }, [d.uid]);

  const bars = useMemo<BarPoint[]>(() => {
    switch (scale) {
      case 'months':
        return monthsBars(d.months);
      case 'weeks':
        return weeksBars(d.days);
      case 'd30':
        return daysBars(d.days, 30);
      case 'd7':
        return daysBars(d.days, 7);
      case 'h24':
        return hours ? hoursBars(hours) : [];
    }
  }, [scale, d.months, d.days, hours]);

  const total = bars.reduce((s, b) => s + b.count, 0);
  const totalBad = bars.reduce((s, b) => s + b.bad, 0);
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] tabular-nums text-[var(--fg-3)]">
          {total.toLocaleString('fr-CH')} appel{total > 1 ? 's' : ''}
          {totalBad > 0 && <span className="text-red-400"> · {totalBad.toLocaleString('fr-CH')} refus</span>}
        </span>
        <span className="ml-auto flex items-center gap-0.5 rounded-md border border-[var(--ink-4)] p-0.5">
          {SCALES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScale(s.key)}
              className={`rounded px-2 py-1 text-[11.5px] font-medium transition-colors ${
                scale === s.key ? 'bg-[var(--ink-4)] text-white' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      {scale === 'h24' && hoursState === 'loading' ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--fg-4)]">Chargement des dernières 24 h…</p>
      ) : scale === 'h24' && hoursState === 'error' ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--fg-4)]">
          Échelle 24 h indisponible (API injoignable) — réessaie en repassant sur l&apos;échelle.
        </p>
      ) : total === 0 ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--fg-4)]">Aucun appel sur cette fenêtre.</p>
      ) : (
        <>
          <div className="flex h-24 items-end gap-px" aria-hidden>
            {bars.map((b) => {
              const h = (b.count / max) * 100;
              const badH = b.count > 0 ? (b.bad / b.count) * h : 0;
              return (
                <span
                  key={b.key}
                  title={`${b.label} : ${b.count.toLocaleString('fr-CH')} appel${b.count > 1 ? 's' : ''}${
                    b.bad > 0 ? ` (dont ${b.bad.toLocaleString('fr-CH')} refus)` : ''
                  }`}
                  className="flex min-w-[3px] flex-1 flex-col justify-end"
                  style={{ height: '100%' }}
                >
                  {b.bad > 0 && <span className="w-full rounded-t-sm bg-red-500/70" style={{ height: `${Math.max(badH, 2)}%` }} />}
                  {b.count > 0 && (
                    <span
                      className={`w-full bg-[var(--amber-500)]/60 ${b.bad > 0 ? '' : 'rounded-t-sm'}`}
                      style={{ height: `${Math.max(h - badH, b.bad > 0 ? 0 : 2)}%` }}
                    />
                  )}
                </span>
              );
            })}
          </div>
          <div className="mt-1 flex justify-between font-mono text-[10.5px] text-[var(--fg-5)]">
            <span>{bars[0]?.label}</span>
            <span>max {max.toLocaleString('fr-CH')}</span>
            <span>{bars[bars.length - 1]?.label}</span>
          </div>
        </>
      )}
    </div>
  );
}
