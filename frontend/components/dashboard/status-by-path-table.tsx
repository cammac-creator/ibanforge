'use client';

import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatGrouped } from '@/lib/format-grouped';
import { readServiceStatuses } from '@/lib/dashboard/service-signals';
import { readResponseDetails, responsePathFamily } from '@/lib/dashboard/response-details';
import styles from './status-by-path.module.css';

export interface StatusByPathRow {
  path: string;
  total: number;
  s2xx: number;
  s3xx: number;
  s4xx: number;
  s5xx: number;
  avg_ms: number | null;
  by_status?: Record<string, number>;
  by_method?: Record<string, number>;
}

const CLASSES = [
  { key: 's2xx', label: 'success', code: '2xx', color: 'var(--ok)' },
  { key: 's3xx', label: 'redirect', code: '3xx', color: 'var(--fg-4)' },
  { key: 's4xx', label: 'refused', code: '4xx', color: 'var(--warn)' },
  { key: 's5xx', label: 'server', code: '5xx', color: 'var(--danger, #b42318)' },
] as const;
const KNOWN_CODES = new Set(['200', '201', '202', '204', '301', '302', '304', '307', '308', '400', '401', '402', '403', '404', '405', '409', '422', '429', '500', '501', '502', '503', '504']);

/** Lecture des réponses observées, sans attribuer une cause ni diagnostiquer une panne actuelle. */
export function StatusByPathTable({ rows }: { rows: unknown }) {
  const locale = useLocale(), t = useTranslations('dashboard.responses'), searchId = useId();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 's4xx' | 's5xx'>('all');
  const [limit, setLimit] = useState(12);
  const fmt = (value: number, decimals = 0) => formatGrouped(value, locale, decimals);
  const read = readServiceStatuses({ rows });
  if (!read) return <p role="status" data-api-responses-unavailable>{t('unavailable')}</p>;
  if (!read.length) return <p data-api-responses-empty>{t('empty')}</p>;
  const sorted = [...read].sort((a, b) => b.total - a.total || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const found = sorted.filter(row => row.path.toLowerCase().includes(query.trim().toLowerCase()) && (filter === 'all' || row[filter] > 0));
  const shown = found.slice(0, limit);
  return <section data-api-responses className={styles.panel} aria-label={t('title')}>
    <p className={styles.note}>{t('scope')}</p>
    <div className={styles.controls}>
      <label htmlFor={searchId}>{t('search')}</label>
      <input id={searchId} type="search" value={query} onChange={event => { setQuery(event.target.value); setLimit(12); }} />
      <div className={styles.filters} role="group" aria-label={t('filter')}>
        {(['all', 's4xx', 's5xx'] as const).map(value => <button key={value} type="button" aria-pressed={filter === value}
          onClick={() => { setFilter(value); setLimit(12); }}>{t(value)}</button>)}
      </div>
    </div>
    <p role="status" className={styles.note}>{t('showing', { visible: fmt(shown.length), matched: fmt(found.length), total: fmt(read.length) })}</p>
    {!shown.length && <p>{t('noMatch')}</p>}
    <div className={styles.cards}>
      {shown.map(row => {
        const codes = readResponseDetails(row, 'status'), methods = readResponseDetails(row, 'method');
        const other = row.total - CLASSES.reduce((sum, item) => sum + row[item.key], 0);
        return <article key={row.path} className={styles.card} data-api-response-path={row.path}>
          <h4 className={styles.path}>{row.path}</h4>
          <p className={styles.note}>{t(`family.${responsePathFamily(row.path)}`)}</p>
          <dl className={styles.metrics}>
            <div><dt>{t('requests')}</dt><dd>{fmt(row.total)}</dd></div>
            <div><dt>{t('average')}</dt><dd>{row.avg_ms === null ? t('unmeasured') : `${fmt(row.avg_ms, 1)} ms`}</dd></div>
          </dl>
          <div className={styles.bar} aria-hidden="true">
            {CLASSES.map(item => <span key={item.key} style={{ width: `${row.total ? row[item.key] / row.total * 100 : 0}%`, background: item.color }} />)}
          </div>
          <dl className={styles.classes}>
            {CLASSES.map(item => <div key={item.key}><dt><span>{t(item.label)}</span> <code>{item.code}</code></dt><dd>{fmt(row[item.key])}</dd></div>)}
            {other > 0 && <div><dt>{t('other')}</dt><dd>{fmt(other)}</dd></div>}
          </dl>
          <details className={styles.details}>
            <summary>{t('details')}<span className="sr-only"> {row.path}</span></summary>
            <p className={styles.note}>{t('interpretation')}</p>
            <h5>{t('codes')}</h5>
            {codes === null ? <p>{t('detailUnknown')}</p> : !codes.length ? <p>{t('none')}</p> : <ul className={styles.breakdown}>
              {codes.map(([code, n]) => <li key={code}><div><code>HTTP {code}</code><strong>{fmt(n)}</strong></div>
                <p>{t(KNOWN_CODES.has(code) ? `code.${code}` : 'code.other')}</p></li>)}
            </ul>}
            <h5>{t('methods')}</h5>
            {methods === null ? <p>{t('detailUnknown')}</p> : !methods.length ? <p>{t('none')}</p> : <dl className={styles.methods}>
              {methods.map(([method, n]) => <div key={method}><dt><code>{method}</code></dt><dd>{fmt(n)}</dd></div>)}
            </dl>}
            <p className={styles.note}>{t('latencyNote')}</p>
          </details>
        </article>;
      })}
    </div>
    {shown.length < found.length && <button className={styles.more} type="button" onClick={() => setLimit(found.length)}>{t('showAll', { count: fmt(found.length) })}</button>}
  </section>;
}
