import { getTranslations } from 'next-intl/server';
import { StatCardV2 } from '../stat-card-v2';
import { LivingToolCard, type SourceFreshnessEntry } from '../living-tool-card';
import type { StatusByPathRow } from '../status-by-path-table';
import { brokenLevel, refusalPaths, serverErrorPaths } from '@/lib/dashboard-overview';
import { type Fetched } from './fetching';
import {
  readServiceStatuses,
  readServiceSources,
  readServiceErrorRates,
  validIbanShare,
} from '@/lib/dashboard/service-signals';
import { OverviewSection, overviewCard } from './section';
import type { ErrorsResponse, StatsResponse } from './types';

/**
 * Section 3 — what is broken.
 *
 * Before this band, the answer took five scrolls. The 5xx were an invisible
 * red sliver inside a chart of thousands of bars at 1 200 px; the massive 4xx
 * refusals were amber pills at 5 300 px, coloured by HTTP class rather than by
 * whether they mattered; register freshness was on a card near the top; and
 * bounced mail had no block at all.
 *
 * One verdict line, green and single when everything is fine, that opens and
 * NAMES the culprit otherwise. The rule the band exists to enforce: a reader
 * that failed is louder than a calm day, never quieter (ENS-04, ENS-07).
 */

const LEVEL_STYLE = {
  ok: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
  unknown: 'border-[var(--ink-5)] bg-[var(--ink-4)]/30 text-[var(--fg-3)]',
  warn: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  alert: 'border-red-500/40 bg-red-500/10 text-red-300',
} as const;

export async function BrokenSection({
  period,
  statsPromise,
  errorsPromise,
  statusByPathPromise,
  healthPromise,
}: {
  period: number;
  statsPromise: Promise<Fetched<StatsResponse>>;
  errorsPromise: Promise<Fetched<ErrorsResponse>>;
  statusByPathPromise: Promise<Fetched<{ rows: StatusByPathRow[] }>>;
  healthPromise: Promise<Fetched<{ bic_sources?: SourceFreshnessEntry[] }>>;
}) {
  const t = await getTranslations('dashboard.overview');
  const [statsRes, errorsRes, statusRes, healthRes] = await Promise.all([
    statsPromise,
    errorsPromise,
    statusByPathPromise,
    healthPromise,
  ]);

  const statusRows = statusRes.ok ? readServiceStatuses(statusRes.data) : null;
  const rows = statusRows ?? [];
  const fiveXX = serverErrorPaths(rows);
  const refusals = refusalPaths(rows);
  const sourceRows = healthRes.ok ? readServiceSources(healthRes.data) : null;
  const sources = sourceRows ?? [];
  const stale = sources.filter((s) => s.stale);
  // Ce qui compte pour la bande « qu'est-ce qui est cassé » : ce qu'un geste
  // peut réparer. Un amont figé (le répertoire SWIFT redistribué, dont
  // l'éditeur ne publie plus) est vieux pour toujours — le compter ici mettrait
  // le tableau de bord en alerte permanente, et une alerte permanente ne se lit
  // plus. Il reste affiché avec ses deux dates dans la boucle « fraîcheur »,
  // juste en dessous. Un `stale_reason` absent (API antérieure au 22/09/2026)
  // garde l'ancien comportement.
  const broken = stale.filter((s) => s.stale_reason !== 'source_frozen');

  // Un HTTP 200 illisible ne permet pas davantage de conclure qu’une lecture échouée.
  const errors = errorsRes.ok ? readServiceErrorRates(errorsRes.data) : null;
  const unreadable = [statusRows, errors, sourceRows].filter((value) => value === null).length;
  const level = brokenLevel({
    serverErrors: fiveXX.length,
    staleSources: broken.length,
    unreadable,
  });

  const successRate = statsRes.ok ? validIbanShare(statsRes.data) : null;

  // The refusal list is information under the verdict, never a reason to raise
  // it: see the note beside brokenLevel in lib/dashboard-overview.ts.
  const hasDetail = level !== 'ok' || unreadable > 0 || refusals.length > 0;

  return (
    <OverviewSection step={4} title={t('broken.title')} lead={t('broken.lead')}>
      <div className={`rounded-xl border p-4 ${LEVEL_STYLE[level]}`}>
        <p className="text-sm font-medium">
          {t(`broken.verdict.${level}` as 'broken.verdict.ok', { days: period })}
        </p>

        {hasDetail && (
          <ul className="mt-2.5 flex flex-col gap-1.5 text-[12px] text-[var(--fg-3)]">
            {fiveXX.length > 0 && (
              <li>
                <b className="text-red-300">{t('broken.serverErrors')}</b>{' '}
                {fiveXX.slice(0, 4).map((p, i) => (
                  <span key={p.path}>
                    {i > 0 && ' · '}
                    <span className="font-mono text-[var(--fg-2)]">{p.path}</span> {p.errors}×
                  </span>
                ))}
              </li>
            )}
            {refusals.length > 0 && (
              <li>
                <b className="text-amber-300">{t('broken.refusals')}</b>{' '}
                {refusals.map((p, i) => (
                  <span key={p.path}>
                    {i > 0 && ' · '}
                    <span className="font-mono text-[var(--fg-2)]">{p.path}</span> {p.ratio}%
                  </span>
                ))}
              </li>
            )}
            {statusRows === null && (
              <li className="text-amber-300">
                {t('broken.unreadable', { name: t('broken.statusReader') })}
              </li>
            )}
            {errors === null && (
              <li className="text-amber-300">
                {t('broken.unreadable', { name: t('broken.errorsReader') })}
              </li>
            )}
            {sourceRows === null && (
              <li>{t('broken.unreadable', { name: t('broken.sourcesReader') })}</li>
            )}
          </ul>
        )}

        {/* Registers: loop 3 of the 🌱 card, brought here because an outdated
            register is a broken product, not a growth signal. */}
        <div className="mt-3 border-t border-white/10 pt-2.5">
          <LivingToolCard
            bare
            loops={['freshness']}
            gaps={null}
            feedbackOpen={0}
            reports={[]}
            sources={sources}
            sourcesFailed={healthRes.ok ? null : healthRes.status}
          />
        </div>

        {/* Undelivered mail has NO source: drafts and sends go through the VPS
            and a bounce reaches no endpoint this page can read. Said in grey,
            because printing "no bounce" here would be the exact ENS-04 lie
            corrected two blocks above. */}
        <p className="mt-2.5 border-t border-white/10 pt-2.5 text-[12px] text-[var(--fg-5)]">
          {t('broken.mailUnwired')}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* Ces pourcentages décrivent les données soumises. Sans variation comparable,
            aucune flèche ne les présente comme une hausse ou une baisse du service. */}
        <StatCardV2
          title={t('broken.successRate')}
          value={successRate !== null ? `${successRate.toFixed(1)}%` : '—'}
          accentColor="#3b82f6"
          hint={t('broken.successRateHint')}
        />
        <StatCardV2
          title={t('broken.ibanErrorRate', { days: period })}
          value={errors ? `${errors.iban_validate.rate.toFixed(2)}%` : '—'}
          sparkline={errors?.iban_validate.trend ?? []}
          accentColor="#ef4444"
          hint={t('broken.ibanErrorRateHint', { days: period })}
        />
        <StatCardV2
          title={t('broken.bicMissRate', { days: period })}
          value={errors ? `${errors.bic_lookup.rate.toFixed(2)}%` : '—'}
          sparkline={errors?.bic_lookup.trend ?? []}
          accentColor="#eab308"
          hint={t('broken.bicMissRateHint', { days: period })}
        />
      </div>

      {refusals.length > 0 && (
        <p className={`${overviewCard} text-[12px] text-[var(--fg-4)]`}>
          {t('broken.refusalsHint')}
        </p>
      )}
    </OverviewSection>
  );
}
