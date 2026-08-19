import { InfoDot } from './info-dot';

/**
 * Discreet case-study panel: what the two known signup cohorts did to the
 * indicators, read from the very rows the business views exclude. Folded shut by
 * default and rendered last, so it never competes with the real numbers — it is
 * there to learn from bounded, known bursts, not to report daily activity.
 *
 * Fed by /stats/cohort-footprint. Renders nothing when there is no cohort, so
 * the panel simply disappears once the dossiers are cleared.
 */
export interface CohortFootprint {
  cohorts: Array<{
    address: string;
    keys: number;
    units: number;
    first_seen: string | null;
    last_seen: string | null;
    top_countries: Array<{ country: string; count: number }>;
    by_type: Array<{ type: string; count: number }>;
    top_client: string | null;
  }>;
  timeline: Array<{ day: string; count: number }>;
  countries_with: Array<{ country: string; count: number }>;
  countries_without: Array<{ country: string; count: number }>;
  totals: { cohorts: number; keys: number; units: number };
}

const AMBER = '#d0a548';

function fmt(n: number): string {
  return n.toLocaleString('fr-CH').replace(/ /g, ' ');
}

function shortAddress(address: string): string {
  return address.replace('@cohorte.invalid', '');
}

function shortDate(iso: string | null): string {
  if (!iso) return '—';
  return iso.slice(0, 10).split('-').reverse().slice(0, 2).join('.');
}

export function CohortStudyPanel({ data }: { data: CohortFootprint | null }) {
  if (!data || data.totals.keys === 0) return null;

  const maxDay = Math.max(1, ...data.timeline.map((d) => d.count));
  // Which countries the cohorts inflated: rank/among the public "without" list.
  const withoutByCountry = new Map(data.countries_without.map((c) => [c.country, c.count]));

  return (
    <details className="group rounded-xl border border-[var(--ink-4)]/50 bg-[var(--ink-2)]/40 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4">
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs transition-transform group-open:rotate-90"
          style={{ color: AMBER, backgroundColor: `${AMBER}1a` }}
          aria-hidden
        >
          ▸
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[var(--fg-3)]">
            Cas d&rsquo;étude · empreinte des inscriptions automatiques
          </p>
          <p className="truncate text-xs text-[var(--fg-5)]">
            {data.totals.cohorts} cohorte{data.totals.cohorts > 1 ? 's' : ''} · {fmt(data.totals.keys)} clés ·{' '}
            {fmt(data.totals.units)} validations — hors des indicateurs métier
          </p>
        </div>
        <InfoDot>
          Ce que les deux vagues connues ont produit sur les indicateurs, lu dans les lignes que les vues métier
          écartent. Elles ne polluent aucun chiffre réel : ce panneau existe pour apprendre de cobayes bornés et
          connus. Repliez-le, il ne s&rsquo;impose jamais.
        </InfoDot>
      </summary>

      <div className="space-y-6 border-t border-[var(--ink-4)]/40 px-5 py-5">
        {/* Timeline — the bursts, day by day */}
        {data.timeline.length > 0 && (
          <div>
            <p className="mb-3 text-xs uppercase tracking-wide text-[var(--fg-4)]">Validations par jour</p>
            <div className="flex items-end gap-1 overflow-x-auto" style={{ height: 88 }}>
              {data.timeline.map((d) => (
                <div key={d.day} className="flex min-w-[10px] flex-1 flex-col items-center gap-1" title={`${d.day} · ${fmt(d.count)}`}>
                  <div
                    className="w-full rounded-sm"
                    style={{ height: `${Math.max(2, (d.count / maxDay) * 72)}px`, backgroundColor: AMBER, opacity: 0.85 }}
                  />
                  <span className="text-[9px] text-[var(--fg-5)]">{d.day.slice(8, 10)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* One card per cohort */}
        <div className="grid gap-3 sm:grid-cols-2">
          {data.cohorts.map((c) => (
            <div key={c.address} className="rounded-lg border border-[var(--ink-4)]/40 bg-[var(--ink-1)]/40 p-4">
              <div className="mb-3 flex items-baseline justify-between gap-2">
                <p className="truncate font-mono text-sm text-[var(--fg-2)]" title={c.address}>
                  {shortAddress(c.address)}
                </p>
                <span className="shrink-0 text-xs text-[var(--fg-5)]">
                  {shortDate(c.first_seen)}–{shortDate(c.last_seen)}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--fg-5)]">Clés</p>
                  <p className="font-mono font-semibold text-[var(--fg-2)]">{fmt(c.keys)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--fg-5)]">Validations</p>
                  <p className="font-mono font-semibold" style={{ color: AMBER }}>
                    {fmt(c.units)}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {c.top_countries.slice(0, 4).map((tc) => (
                  <span
                    key={tc.country}
                    className="rounded-sm px-1.5 py-0.5 font-mono text-[11px]"
                    style={{ color: AMBER, backgroundColor: `${AMBER}14` }}
                  >
                    {tc.country} {fmt(tc.count)}
                  </span>
                ))}
              </div>
              {c.top_client && (
                <p className="mt-3 truncate font-mono text-[11px] text-[var(--fg-5)]" title={c.top_client}>
                  {c.top_client}
                </p>
              )}
            </div>
          ))}
        </div>

        {/* The distortion, made visible: the public ranking vs the polluted one */}
        <div>
          <p className="mb-3 text-xs uppercase tracking-wide text-[var(--fg-4)]">
            Classement des pays — réel <span className="text-[var(--fg-5)]">vs</span> avec les cohortes
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-medium text-[var(--fg-4)]">Réel (ce que la page publique montre)</p>
              <ol className="space-y-1">
                {data.countries_without.slice(0, 5).map((c, i) => (
                  <li key={c.country} className="flex items-center gap-2 text-sm text-[var(--fg-3)]">
                    <span className="w-4 text-right font-mono text-xs text-[var(--fg-5)]">{i + 1}</span>
                    <span className="font-mono">{c.country}</span>
                    <span className="ml-auto font-mono text-xs text-[var(--fg-4)]">{fmt(c.count)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-medium" style={{ color: AMBER }}>
                Avec les cohortes (la distorsion)
              </p>
              <ol className="space-y-1">
                {data.countries_with.slice(0, 5).map((c, i) => {
                  const inflated = (c.count - (withoutByCountry.get(c.country) ?? 0)) > 0;
                  return (
                    <li key={c.country} className="flex items-center gap-2 text-sm text-[var(--fg-3)]">
                      <span className="w-4 text-right font-mono text-xs text-[var(--fg-5)]">{i + 1}</span>
                      <span className="font-mono" style={inflated ? { color: AMBER } : undefined}>
                        {c.country}
                      </span>
                      <span className="ml-auto font-mono text-xs text-[var(--fg-4)]">{fmt(c.count)}</span>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}
