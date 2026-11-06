'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import { formatMinorMap } from '@/lib/dashboard/stripe-revenue';
import { salesPeriod, type SalesDay } from '@/lib/dashboard/stripe-sales';
import styles from './stripe-revenue.module.css';

/** Les montants restent séparés par devise ; seul le nombre de paiements partage un total. */
export function StripeSalesHistory({ days, readAt }: { days: Record<string, SalesDay>; readAt: string }) {
  const t = useTranslations('dashboard.overview');
  const locale = useLocale();
  const [length, setLength] = useState<7 | 30 | 90>(30);
  const period = salesPeriod(days, readAt, length);
  const currencies = Object.keys(period.gross).sort();
  return (
    <section className={styles.history} aria-label={t('money.premium.sales')} data-stripe-history>
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>IBANforge · Stripe</p><h3>{t('money.premium.sales')}</h3></div>
        <div className={styles.periods} role="group" aria-label={t('money.premium.period')}>
          {([7, 30, 90] as const).map((n) => <button key={n} type="button" aria-pressed={n === length}
            onClick={() => setLength(n)}>{t('money.premium.days', { count: n })}</button>)}
        </div>
      </div>
      <p className={styles.note}>{t('money.premium.range', { start: period.start, end: period.end })}</p>
      <dl className={styles.metrics}>
        <div><dt>{t('money.premium.gross')}</dt><dd><span data-period-gross>{formatMinorMap(period.gross, locale)}</span><p>{t('money.premium.grossNote')}</p></dd></div>
        <div><dt>{t('money.premium.payments')}</dt><dd><span data-period-count>{formatGrouped(period.count, locale)}</span><p>{t('money.premium.paymentsNote')}</p></dd></div>
        <div><dt>{t('money.premium.refunds')}</dt><dd>{formatMinorMap(period.refunded, locale)}<p>{t('money.premium.refundsNote')}</p></dd></div>
      </dl>
      <p className={styles.note}>{t('money.premium.partialDay')}</p>
      <div className={styles.charts} aria-hidden="true">
        {currencies.map((currency) => {
          const max = Math.max(0, ...period.days.map((d) => d.gross[currency] ?? 0));
          return <div key={currency}>
            <div className={styles.chartHeading}><span>{currency.toUpperCase()} · {t('money.premium.gross')}</span><span>{formatMinorMap({ [currency]: max }, locale)}</span></div>
            <svg viewBox="0 0 900 120" preserveAspectRatio="none" className={styles.chart}>
              <line x1="0" y1="116" x2="900" y2="116" stroke="currentColor" opacity="0.2" />
              {period.days.map((d, i) => {
                const height = max > 0 ? (d.gross[currency] ?? 0) / max * 108 : 0;
                const width = 900 / length;
                return <rect key={d.day} x={i * width + width * 0.15} y={116 - height}
                  width={width * 0.7} height={height} rx="2" fill="currentColor" opacity={d.partial ? 0.4 : 0.85} />;
              })}
            </svg>
            <div className={styles.chartHeading}><span>{period.start}</span><span>{period.end}</span></div>
          </div>;
        })}
      </div>
      {period.count === 0 && <p className={styles.note}>{t('money.premium.noPayments')}</p>}
      <details className={styles.details}>
        <summary>{t('money.premium.dailyDetails')}</summary>
        <p className={styles.note}>{t('money.premium.feesNote')} {period.net_unknown > 0 && t('money.premium.feesUnknown', { count: period.net_unknown })}</p>
        <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t('money.premium.dailyDetails')}>
          <table><caption className="sr-only">{t('money.premium.range', { start: period.start, end: period.end })}</caption>
            <thead><tr><th scope="col">{t('money.premium.day')}</th><th scope="col">{t('money.premium.payments')}</th><th scope="col">{t('money.premium.gross')}</th><th scope="col">{t('money.premium.refunds')}</th><th scope="col">{t('money.premium.fees')}</th></tr></thead>
            <tbody>{period.days.map((d) => <tr key={d.day}><th scope="row">{d.day}{d.partial ? ' *' : ''}</th>
              <td>{formatGrouped(d.count, locale)}</td><td>{formatMinorMap(d.gross, locale)}</td><td>{formatMinorMap(d.refunded, locale)}</td>
              <td>{d.net_unknown === d.count && d.count > 0 ? '—' : formatMinorMap(d.fees, locale)}{d.net_unknown > 0 && <span> · {t('money.premium.feesUnknown', { count: d.net_unknown })}</span>}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
