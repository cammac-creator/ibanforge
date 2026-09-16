'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import {
  audienceDate,
  DEVICE_COUNTERS,
  INDICATORS,
  TRIAL_INDICATORS,
  type AudienceBucket,
  type AudienceFunnel,
  type AudienceIndicator,
  type IndicatorKey,
} from '@/lib/dashboard/audience-model';
import { Metric, Panel, Unavailable } from './primitives';
import styles from './audience.module.css';

export function IndicatorCard({
  name,
  indicator,
  compact = false,
}: {
  name: IndicatorKey;
  indicator: AudienceIndicator;
  compact?: boolean;
}) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  const pct = (value: number) => `${formatGrouped(value * 100, locale, 1)} %`;
  return (
    <article className={styles.indicator}>
      <h3>{t(`indicator.${name}`)}</h3>
      <strong>{indicator.value === null ? '—' : pct(indicator.value)}</strong>
      <p>
        {indicator.value === null
          ? t('notMeasurable')
          : t('sample', {
              n: formatGrouped(indicator.numerator, locale),
              d: formatGrouped(indicator.denominator, locale),
            })}
      </p>
      <div className={styles.progress} aria-hidden>
        <span style={{ width: `${(indicator.value ?? 0) * 100}%` }} />
      </div>
      {!compact && <small>{t(`indicatorNote.${name}`)}</small>}
      <div className={styles.indicatorFoot}>
        <span>{t('pending', { count: indicator.pending })}</span>
        {!compact && (
          <span>
            {t('coverage', { value: indicator.coverage === null ? '—' : pct(indicator.coverage) })}
          </span>
        )}
      </div>
    </article>
  );
}

function Buckets({
  title,
  note,
  rows,
  families = false,
}: {
  title: string;
  note: string;
  rows: AudienceBucket[];
  families?: boolean;
}) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  const label = (name: string) =>
    name === '(none)'
      ? t(families ? 'neverActivated' : 'unknown')
      : name === '(unknown)'
        ? t('unrecordedClient')
        : name === '(other)'
          ? t('otherSources')
          : name;
  return (
    <Panel title={title} note={note}>
      <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={title}>
        <table>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th>{t('origin')}</th>
              <th>{t('trialIdentities')}</th>
              {TRIAL_INDICATORS.map((k) => (
                <th key={k}>{t(`indicator.${k}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...rows]
              .sort((a, b) => b.lineages - a.lineages)
              .map((r) => (
                <tr key={r.name}>
                  <th>{label(r.name)}</th>
                  <td>{formatGrouped(r.lineages, locale)}</td>
                  {TRIAL_INDICATORS.map((k) => (
                    <td key={k}>
                      <strong>
                        {r[k].value === null
                          ? '—'
                          : `${formatGrouped(r[k].value * 100, locale, 1)} %`}
                      </strong>
                      <small>
                        {t('sample', { n: r[k].numerator, d: r[k].denominator })}
                        <br />
                        {t('pending', { count: r[k].pending })}
                      </small>
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className={styles.empty}>{t('empty')}</p>}
    </Panel>
  );
}

export function JourneyPanel({ funnel }: { funnel: AudienceFunnel | null }) {
  const t = useTranslations('dashboard.audience'),
    locale = useLocale();
  if (!funnel) return <Unavailable />;
  const d = funnel.device,
    fmt = (v: number) => formatGrouped(v, locale);
  return (
    <div className={styles.stack}>
      <div className={styles.sectionIntro}>
        <h2>{t('journeyTitle')}</h2>
        <p>{t('journeyNote')}</p>
      </div>
      <div className={styles.twoColumns}>
        <Metric
          label={t('trialIdentities')}
          value={fmt(funnel.lineages.admissible)}
          note={t('bornBetween', {
            from: audienceDate(funnel.window.from),
            to: audienceDate(funnel.window.to),
          })}
          accent
        />
        <Metric
          label={t('measurementStart')}
          value={audienceDate(funnel.measurement_started_at)}
          note={t('lineageNote')}
        />
      </div>
      <p className={styles.notice}>{t('maturityNote')}</p>
      <div className={styles.threeColumns}>
        {INDICATORS.map((k) => (
          <IndicatorCard key={k} name={k} indicator={funnel.indicators[k]} />
        ))}
      </div>
      <Panel title={t('measurementQuality')} note={t('qualityNote')}>
        <div className={styles.twoColumns}>
          {(['unknown_context_share', 'paid_link_coverage'] as const).map((k) => (
            <Metric
              key={k}
              label={t(k)}
              value={
                funnel[k].value === null
                  ? '—'
                  : `${formatGrouped(funnel[k].value * 100, locale, 1)} %`
              }
              note={t('sample', { n: fmt(funnel[k].numerator), d: fmt(funnel[k].denominator) })}
            />
          ))}
        </div>
      </Panel>
      <Buckets
        title={t('birthSources')}
        note={t('birthSourcesNote')}
        rows={funnel.by_birth_source}
      />
      <Buckets
        title={t('firstClients')}
        note={t('firstClientsNote')}
        rows={funnel.by_first_client}
        families
      />
      <Panel
        title={t('deviceTitle')}
        note={t('deviceNote', {
          from: audienceDate(d.window_days.from),
          to: audienceDate(d.window_days.to),
        })}
      >
        <div className={styles.deviceSteps}>
          {(['opened', 'approved', 'delivered'] as const).map((k, i) => (
            <div key={k}>
              <span>{String(i + 1).padStart(2, '0')}</span>
              <strong>{fmt(d.counters[k])}</strong>
              <p>{t(`device.${k}`)}</p>
            </div>
          ))}
        </div>
        <div className={styles.twoColumns}>
          {(['approved_of_opened', 'delivered_of_approved'] as const).map((k) => (
            <Metric
              key={k}
              label={t(k)}
              value={
                d.chain[k].value === null
                  ? '—'
                  : `${formatGrouped(d.chain[k].value * 100, locale, 1)} %`
              }
              note={t('sample', { n: fmt(d.chain[k].numerator), d: fmt(d.chain[k].denominator) })}
            />
          ))}
        </div>
        <div className={styles.counterRow}>
          {DEVICE_COUNTERS.filter((k) => !['opened', 'approved', 'delivered'].includes(k)).map(
            (k) => (
              <div key={k}>
                <strong>{fmt(d.counters[k])}</strong>
                <span>{t(`device.${k}`)}</span>
              </div>
            ),
          )}
        </div>
        <details className={styles.disclosure}>
          <summary>{t('deviceDoors')}</summary>
          <div
            className={styles.tableScroll}
            tabIndex={0}
            role="region"
            aria-label={t('deviceDoors')}
          >
            <table>
              <thead>
                <tr>
                  <th>{t('origin')}</th>
                  {DEVICE_COUNTERS.filter((k) => k !== 'approved').map((k) => (
                    <th key={k}>{t(`device.${k}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.by_door.map((r) => (
                  <tr key={r.source}>
                    <th>{r.source}</th>
                    {DEVICE_COUNTERS.filter((k) => k !== 'approved').map((k) => (
                      <td key={k}>{fmt(r[k as keyof Omit<typeof r, 'source'>])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className={styles.bodyText}>
          {t('deviceCohort', { count: fmt(d.lineages.admissible) })} {t('deviceBoundary')}
        </p>
        <div className={styles.threeColumns}>
          {TRIAL_INDICATORS.map((k) => (
            <IndicatorCard key={k} name={k} indicator={d.indicators[k]} />
          ))}
        </div>
      </Panel>
      <Panel title={t('mcpTitle')} note={t('mcpNote')}>
        <div className={styles.threeColumns}>
          {(['sessions', 'tool_calls', 'key_requests'] as const).map((k) => (
            <Metric
              key={k}
              label={t(`mcp.${k}`)}
              value={fmt(d.mcp_remote[k])}
              note={t('anonymousMeasure')}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}
