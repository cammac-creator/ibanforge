'use client';

import { useState } from 'react';

export interface ClientActivity {
  endpoints: Array<{ path: string; count: number }>;
  days: Array<{ day: string; count: number }>;
}

const TOOL_LABELS: Record<string, string> = {
  '/v1/iban/validate': 'Validation IBAN',
  '/v1/iban/batch': 'Batch IBAN',
  '/v1/bic/:code': 'Lookup BIC',
  '/v1/ch/clearing/:iid': 'Clearing CH',
  '/v1/iban/compliance': 'Compliance',
  '/v1/iban/format': 'Format IBAN',
  '/v1/iban/compliance/batch': 'Compliance batch',
};

const VIOLET = '#a855f7';

export function CustomerActivity({
  name,
  months,
  series,
  lastActive,
  activity,
}: {
  name: string;
  months: string[];
  series: number[];
  lastActive: string | null;
  activity?: ClientActivity;
}) {
  const [open, setOpen] = useState(false);
  const max = Math.max(...series, 1);
  const hasAny = series.some((v) => v > 0) || !!(activity && (activity.endpoints.length || activity.days.length));

  return (
    <>
      <button
        type="button"
        onClick={() => hasAny && setOpen(true)}
        disabled={!hasAny}
        className={`inline-flex items-end gap-[2px] ${hasAny ? 'cursor-pointer' : 'cursor-default'}`}
        title={hasAny ? 'Voir l’activité détaillée' : undefined}
      >
        {series.map((v, i) => (
          <span
            key={i}
            className="w-1.5 rounded-sm"
            style={{
              height: `${Math.max(2, (v / max) * 22)}px`,
              backgroundColor: i === series.length - 1 ? VIOLET : '#6d28d9',
              opacity: v === 0 ? 0.25 : 1,
            }}
          />
        ))}
        <span className="ml-1.5 text-[10px] text-[var(--fg-4)]">{lastActive ?? '—'}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOpen(false)}>
          <div
            className="max-h-[82vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--ink-4)] bg-[var(--ink-2)] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-white">{name} — activité</p>
              <button type="button" onClick={() => setOpen(false)} className="text-lg text-[var(--fg-4)] hover:text-white">
                ✕
              </button>
            </div>

            <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--fg-4)]">Appels par mois (6 mois)</p>
            <div className="mb-5 flex items-end gap-2">
              {series.map((v, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <span className="font-mono text-[10px] text-[var(--fg-3)]">{v}</span>
                  <div
                    className="w-full rounded-sm"
                    style={{ height: `${Math.max(3, (v / max) * 56)}px`, backgroundColor: VIOLET, opacity: v === 0 ? 0.2 : 0.8 }}
                  />
                  <span className="text-[9px] text-[var(--fg-5)]">{(months[i] ?? '').slice(5) || i + 1}</span>
                </div>
              ))}
            </div>

            <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--fg-4)]">Outils utilisés</p>
            {activity && activity.endpoints.length ? (
              <div className="mb-5 space-y-1.5">
                {activity.endpoints.slice(0, 6).map((e) => {
                  const m = Math.max(...activity.endpoints.map((x) => x.count), 1);
                  return (
                    <div key={e.path} className="flex items-center gap-2">
                      <span className="w-32 truncate text-xs text-[var(--fg-2)]">{TOOL_LABELS[e.path] ?? e.path}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-4)]">
                        <div className="h-full rounded-full bg-amber-500/50" style={{ width: `${(e.count / m) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right font-mono text-[10px] text-[var(--fg-4)]">{e.count}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="mb-5 text-xs text-[var(--fg-5)]">Pas encore de détail par outil — se construit dès les prochains appels.</p>
            )}

            <p className="mb-2 text-[11px] uppercase tracking-wide text-[var(--fg-4)]">Jours actifs (30 j)</p>
            {activity && activity.days.length ? (
              <div className="flex flex-wrap gap-1">
                {activity.days.map((d) => (
                  <span
                    key={d.day}
                    className="rounded bg-violet-500/10 px-1.5 py-0.5 text-[10px] text-violet-300"
                    title={`${d.count} appel(s)`}
                  >
                    {d.day.slice(5)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[var(--fg-5)]">Pas encore de dates précises — se construit dès les prochains appels.</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
