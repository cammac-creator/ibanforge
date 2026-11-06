'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatGrouped } from '@/lib/format-grouped';
import { dailyActivity, weeklyActivity, monthlyActivity, hourlyActivity, decodeHours, type HourActivity, type ActivityPoint } from '@/lib/crm/activity-series';

/** The chart is a guest in two homes (Clients dossier, Contacts thread), so
 *  its input is the minimal series shape rather than a full ClientDossier. */
export interface ActivityInput {
  email: string;
  /** Instant de la lecture initiale, fourni par le dossier quand il est disponible. */
  observedAt: string;
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

export function ActivityChart({ a }: { a: ActivityInput }) {
  const d = a;
  const observedAt = a.observedAt;
  const [scale, setScale] = useState<Scale>('d30');
  const [hours, setHours] = useState<HourActivity | null>(null);
  const [hoursError, setHoursError] = useState(false);

  // A new subject means new series; drop the fetched hours of the old one.
  // Render-phase compare, the React-sanctioned shape for prop-driven resets
  // (a setState inside an effect body trips the cascading-render lint rule).
  const [prevUid, setPrevUid] = useState(d.uid);
  if (prevUid !== d.uid) {
    setPrevUid(d.uid);
    setHours(null);
    setHoursError(false);
  }

  // "Loading" is derived, never stored: the effect below only performs the
  // async fetch, so no state is set synchronously inside it.
  const hoursLoading = scale === 'h24' && hours === null && !hoursError;

  useEffect(() => {
    if (scale !== 'h24' || hours !== null || hoursError) return;
    let cancelled = false;
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 8_000);
    fetch(`/api/crm/client-hours?email=${encodeURIComponent(d.email)}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(String(r.status));
        const data = decodeHours(await r.json(), d.email);
        if (!data) throw new Error('Lecture horaire invalide');
        if (!cancelled) setHours(data);
      })
      .catch(() => {
        if (!cancelled) setHoursError(true);
      }).finally(() => clearTimeout(deadline));
    return () => {
      cancelled = true;
      clearTimeout(deadline);
      controller.abort();
    };
  }, [scale, hours, hoursError, d.email]);

  const bars = useMemo<ActivityPoint[]>(() => {
    switch (scale) {
      case 'months':
        return monthlyActivity(d.months, observedAt);
      case 'weeks':
        return weeklyActivity(d.days, observedAt);
      case 'd30':
        return dailyActivity(d.days, 30, observedAt);
      case 'd7':
        return dailyActivity(d.days, 7, observedAt);
      case 'h24':
        return hours ? hourlyActivity(hours) : [];
    }
  }, [scale, d.months, d.days, hours, observedAt]);

  const total = bars.reduce((s, b) => s + b.count, 0);
  const totalBad = bars.reduce((s, b) => s + b.bad, 0);
  const max = Math.max(1, ...bars.map((b) => b.count));

  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[12.5px] tabular-nums text-[var(--fg-3)]">
          {scale === 'h24' && (hoursLoading || hoursError) ? '—' : formatGrouped(total, 'fr')} appel{total > 1 ? 's' : ''}
          {totalBad > 0 && <span className="text-red-400"> · {formatGrouped(totalBad, 'fr')} refus</span>}
        </span>
        <span className="ml-auto flex items-center gap-0.5 rounded-md border border-[var(--ink-4)] p-0.5">
          {SCALES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScale(s.key)}
              aria-pressed={scale === s.key}
              className={`min-h-11 rounded px-2 py-1 text-[11.5px] font-medium transition-colors ${
                scale === s.key ? 'bg-[var(--ink-4)] text-[var(--fg-1)]' : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]'
              }`}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      <p className="mb-3 text-xs leading-relaxed text-[var(--fg-4)]">
        {scale === 'months' ? 'Compteurs mensuels conservés, distincts des traces de requêtes. Le mois en cours est incomplet.' : scale === 'h24' ? '24 heures glissantes, lues à l’ouverture de cette échelle. Les heures aux deux extrémités peuvent être incomplètes ; refus HTTP 4xx et 5xx en rouge.' : 'Journées UTC des traces conservées. Les périodes incomplètes sont plus claires ; entrées rejetées HTTP 400 en rouge.'}
      </p>
      {hoursLoading ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--fg-4)]">Chargement des dernières 24 h…</p>
      ) : scale === 'h24' && hoursError ? (
        <p className="py-6 text-center text-[12.5px] text-[var(--fg-4)]">
          Lecture des dernières 24 h indisponible.
          <button type="button" className="ml-2 min-h-11 rounded border border-[var(--ink-4)] px-3 text-[var(--fg-2)]" onClick={() => setHoursError(false)}>Réessayer</button>
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
                  title={`${b.label} : ${formatGrouped(b.count, 'fr')} appel${b.count > 1 ? 's' : ''}${
                    b.bad > 0 ? ` (dont ${formatGrouped(b.bad, 'fr')} refus)` : ''
                  }${b.partial ? ' · période incomplète' : ''}`}
                  className="flex min-w-[3px] flex-1 flex-col justify-end"
                  style={{ height: '100%', opacity: b.partial ? 0.5 : 1 }}
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
            <span>max {formatGrouped(max, 'fr')}</span>
            <span>{bars[bars.length - 1]?.label}</span>
          </div>
          <details className="mt-3 rounded-lg border border-[var(--ink-4)] text-xs">
            <summary className="min-h-11 cursor-pointer px-3 py-3 text-[var(--fg-3)]">Voir les valeurs du graphique</summary>
            <div className="max-h-64 overflow-auto px-3 pb-3" tabIndex={0} role="region" aria-label="Valeurs de l’activité">
              <table className="w-full text-left"><thead><tr><th className="py-2">Période UTC</th><th className="px-2 text-right">Appels</th><th className="text-right">{scale === 'h24' ? 'Refus' : 'Entrées rejetées'}</th></tr></thead><tbody>
                {bars.map(b => <tr key={b.key} className="border-t border-[var(--ink-4)]"><th className="py-2 font-normal">{b.label}{b.partial ? ' · incomplet' : ''}</th><td className="px-2 text-right tabular-nums">{formatGrouped(b.count, 'fr')}</td><td className="text-right tabular-nums">{scale === 'months' ? '—' : formatGrouped(b.bad, 'fr')}</td></tr>)}
              </tbody></table>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
