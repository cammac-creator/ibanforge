import { InfoDot } from './info-dot';

/**
 * Where signups come from and what they become. Left: signup sources of the
 * period with how many actually called (a channel that brings signups who
 * never call is noise, not reach). Right: 8 weekly signup cohorts with their
 * activation and purchase rates — the drumbeat view of whether acquisition
 * quality is drifting.
 */
export interface AcquisitionSourceRow {
  source: string;
  signups: number;
  called: number;
  paying: number;
}

export interface AcquisitionCohortRow {
  week_start: string;
  signups: number;
  called_pct: number;
  paid_pct: number;
}

export function AcquisitionPanel({
  sources,
  cohorts,
  locale,
}: {
  sources: AcquisitionSourceRow[];
  cohorts: AcquisitionCohortRow[];
  locale: string;
}) {
  const maxSignups = Math.max(...sources.map((s) => s.signups), 1);
  const maxCohort = Math.max(...cohorts.map((c) => c.signups), 1);
  const weekLabel = (w: string) =>
    new Date(`${w}T00:00:00Z`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', timeZone: 'UTC' });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--fg-2)]">Provenance des inscrits</p>
          <InfoDot>
            Source déclarée à la création de la clé (paramètre src du funnel d&rsquo;inscription), sur la même période
            que le funnel d&rsquo;activation. « direct » = aucune source enregistrée. La colonne décisive est « ont
            appelé » : un canal qui amène des inscrits muets n&rsquo;apporte rien.
          </InfoDot>
        </div>
        {sources.length === 0 ? (
          <div className="flex h-24 items-center justify-center text-sm text-[var(--fg-5)]">
            Aucun inscrit sur la période.
          </div>
        ) : (
          <div className="space-y-2.5">
            {sources.map((s) => (
              <div key={s.source} className="flex items-center gap-3">
                <span className="w-24 truncate text-right text-xs text-[var(--fg-3)]" title={s.source}>
                  {s.source}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-4)]">
                  <div
                    className="h-full rounded-full bg-violet-500/50"
                    style={{ width: `${(s.signups / maxSignups) * 100}%` }}
                  />
                </div>
                <span className="w-40 shrink-0 font-mono text-xs text-[var(--fg-4)]">
                  {s.signups} · {s.called} ont appelé
                  {s.paying > 0 ? <span className="text-emerald-400"> · {s.paying} 💰</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-gradient-to-br from-[var(--ink-2)] to-[var(--ink-2)]/60 p-5">
        <div className="mb-4 flex items-center gap-2">
          <p className="text-sm font-medium text-[var(--fg-2)]">Cohortes d&rsquo;inscription — 8 semaines</p>
          <InfoDot>
            Chaque colonne = les inscrits d&rsquo;une semaine (lundi affiché). Sous la barre : % ayant fait au moins un
            appel, puis % ayant acheté. À surveiller : un « % appelé » qui glisse vers le bas signale une acquisition
            qui se vide de sa substance.
          </InfoDot>
        </div>
        <div className="flex items-end justify-between gap-2">
          {cohorts.map((c) => (
            <div key={c.week_start} className="flex flex-1 flex-col items-center gap-1">
              <span className="font-mono text-[10px] text-[var(--fg-4)]">{c.signups}</span>
              <div className="flex h-24 w-full max-w-[28px] items-end overflow-hidden rounded bg-[var(--ink-4)]/40">
                <div
                  className="w-full rounded-t bg-violet-500/60"
                  style={{ height: `${(c.signups / maxCohort) * 100}%` }}
                />
              </div>
              <span className="text-[10px] text-[var(--fg-5)]">{weekLabel(c.week_start)}</span>
              <span className="font-mono text-[10px] text-blue-400" title="% ayant appelé">
                {c.signups > 0 ? `${c.called_pct}%` : '·'}
              </span>
              <span className="font-mono text-[10px] text-emerald-400" title="% ayant acheté">
                {c.signups > 0 ? `${c.paid_pct}%` : '·'}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-right text-[10px] text-[var(--fg-5)]">
          <span className="text-blue-400">bleu</span> = % appelé · <span className="text-emerald-400">vert</span> = %
          acheté
        </p>
      </div>
    </div>
  );
}
