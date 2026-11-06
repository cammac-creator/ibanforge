'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { overviewHref, type OverviewView } from '@/lib/dashboard/workspace';
import styles from '../workspace.module.css';
import { InfoDot } from '../info-dot';

export function OverviewNavigation({ view, period }: { view: OverviewView; period: number }) {
  const pathname = usePathname();
  const audience = useSearchParams().get('audience') ?? undefined;
  const w = useTranslations('dashboard.workspace');
  const o = useTranslations('dashboard.overview');
  const p = useTranslations('dashboard.pilot');
  if (view === 'revenue') {
    return <p className="max-w-3xl text-xs leading-relaxed text-[var(--fg-3)]">{p('revenuePeriod')}</p>;
  }
  return (
    <nav className={styles.periods} aria-label={w('period')}>
      <span>{view === 'today' ? p('chartPeriod') : w('period')}</span>
      <InfoDot>{view === 'today' ? p('chartPeriodHint') : o('periodNote')}</InfoDot>
      {[7, 30, 90].map((days) => (
        <Link
          key={days}
          href={overviewHref(pathname, view, days, audience)}
          prefetch={false}
          aria-current={days === period ? 'true' : undefined}
        >
          {w('days', { count: days })}
        </Link>
      ))}
    </nav>
  );
}
