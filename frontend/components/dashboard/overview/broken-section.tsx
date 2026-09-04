import { getTranslations } from 'next-intl/server';
import { StatCardV2 } from '../stat-card-v2';
import { LivingToolCard, type SourceFreshnessEntry } from '../living-tool-card';
import type { StatusByPathRow } from '../status-by-path-table';
import { brokenLevel, refusalPaths, serverErrorPaths } from '@/lib/dashboard-overview';
import { type Fetched } from './fetching';
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

  const rows = statusRes.data?.rows ?? [];
  const fiveXX = serverErrorPaths(rows);
  const refusals = refusalPaths(rows);
  const sources = healthRes.data?.bic_sources ?? [];
  const stale = sources.filter((s) => s.stale);

  // Each failed reader makes the verdict unknowable rather than green.
  const unreadable = [statusRes, errorsRes, healthRes].filter((r) => !r.ok).length;
  const level = brokenLevel({
    serverErrors: fiveXX.length,
    staleSources: stale.length,
    unreadable,
  });

  const ibanTotal = statsRes.data?.by_type?.iban_validate?.total ?? 0;
  const ibanValid = statsRes.data?.by_type?.iban_validate?.valid_count ?? 0;
  const successRate =
    statsRes.ok && ibanTotal > 0 ? ((ibanValid / ibanTotal) * 100).toFixed(1) : null;

  const errors = errorsRes.data;
  // The refusal list is information under the verdict, never a reason to raise
  // it: see the note beside brokenLevel in lib/dashboard-overview.ts.
  const hasDetail = level !== 'ok' || unreadable > 0 || refusals.length > 0;

  return (
    <OverviewSection step={4} title={t('broken.title')} lead={t('broken.lead')}>
      <div className={`rounded-xl border p-4 ${LEVEL_STYLE[level]}`}>
        <p className="text-sm font-medium">{t(`broken.verdict.${level}` as 'broken.verdict.ok')}</p>

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
            {!statusRes.ok && (
              <li className="text-amber-300">
                {t('broken.reader', { name: t('broken.statusReader'), status: statusRes.status })}
              </li>
            )}
            {!errorsRes.ok && (
              <li className="text-amber-300">
                {t('broken.reader', { name: t('broken.errorsReader'), status: errorsRes.status })}
              </li>
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

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {/* ENS-02: the "↓ 92.7 %" badge was the VALUE with a down arrow, not a
            variation, and it read as a collapse. No badge until there is a
            real delta to show; the target lives in the hint instead. */}
        <StatCardV2
          title={t('broken.successRate')}
          value={successRate !== null ? `${successRate}%` : '—'}
          accentColor="#3b82f6"
          hint={t('broken.successRateHint')}
        />
        <StatCardV2
          title={t('broken.ibanErrorRate', { days: period })}
          value={
            errorsRes.ok && errors ? `${errors.error_rate.iban_validate.rate.toFixed(2)}%` : '—'
          }
          sparkline={errors?.error_rate?.iban_validate?.trend ?? []}
          accentColor="#ef4444"
          hint={t('broken.ibanErrorRateHint', { days: period })}
        />
        <StatCardV2
          title={t('broken.bicMissRate', { days: period })}
          value={errorsRes.ok && errors ? `${errors.error_rate.bic_lookup.rate.toFixed(2)}%` : '—'}
          sparkline={errors?.error_rate?.bic_lookup?.trend ?? []}
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
