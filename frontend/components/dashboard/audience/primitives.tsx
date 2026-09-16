'use client';

import { useId, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { formatGrouped } from '@/lib/format-grouped';
import type { Ranking } from '@/lib/dashboard/audience-model';
import styles from './audience.module.css';

export function useActionLabel() {
  const names = useTranslations('dashboard.audience.actionNames');
  return (name: string): string => {
    const key = name.replace(/[^a-z0-9]/g, '_');
    return names.has(key) ? names(key) : name;
  };
}

export function Panel({
  title,
  note,
  children,
  action,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHead}>
        <div>
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Unavailable() {
  const t = useTranslations('dashboard.audience');
  return (
    <p className={styles.notice} role="status">
      {t('unavailable')}
    </p>
  );
}
export function Metric({
  label,
  value,
  note,
  accent = false,
}: {
  label: string;
  value: string;
  note: string;
  accent?: boolean;
}) {
  return (
    <div className={styles.metric} data-accent={accent || undefined}>
      <p>{label}</p>
      <strong>{value}</strong>
      <small>{note}</small>
    </div>
  );
}
export function RankingList({
  title,
  rows,
  note,
  unit,
}: {
  title: string;
  rows: Ranking[];
  note?: string;
  unit: string;
}) {
  const t = useTranslations('dashboard.audience');
  const locale = useLocale(),
    id = useId();
  const [search, setSearch] = useState(''),
    [expanded, setExpanded] = useState(false);
  const filtered = rows.filter((r) => r.label.toLowerCase().includes(search.trim().toLowerCase()));
  const visible = search.trim() || expanded ? filtered : filtered.slice(0, 6);
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <Panel title={title} note={note}>
      {rows.length > 6 && (
        <label className={styles.search} htmlFor={id}>
          <Search size={16} aria-hidden />
          <span className="sr-only">{t('searchIn', { title })}</span>
          <input
            id={id}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('search')}
            type="search"
          />
        </label>
      )}
      <p className={styles.unit}>{unit}</p>
      {visible.length ? (
        <ol className={styles.ranking}>
          {visible.map((r, i) => (
            <li key={r.label}>
              <div className={styles.rankLine}>
                <span className={styles.rankIndex}>{i + 1}</span>
                <span className={styles.rankLabel}>{r.label || t('unknown')}</span>
                <strong>{formatGrouped(r.value, locale)}</strong>
              </div>
              <div className={styles.track} aria-hidden>
                <span style={{ width: `${(r.value / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.empty}>{t(search ? 'noResults' : 'empty')}</p>
      )}
      {rows.length > 6 && !search.trim() && (
        <button
          className={styles.textButton}
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {expanded ? t('less') : t('all', { count: rows.length })}
        </button>
      )}
    </Panel>
  );
}
