'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Activity, ChartNoAxesCombined, CircleDollarSign, Sun } from 'lucide-react';
import { OVERVIEW_VIEWS, overviewHref, type OverviewView } from '@/lib/dashboard/workspace';
import styles from '../workspace.module.css';
import { InfoDot } from '../info-dot';

const ICONS = {
  today: Sun,
  revenue: CircleDollarSign,
  growth: ChartNoAxesCombined,
  service: Activity,
};

export function OverviewNavigation({ view, period }: { view: OverviewView; period: number }) {
  const pathname = usePathname();
  const audience = useSearchParams().get('audience') ?? undefined;
  const w = useTranslations('dashboard.workspace');
  const o = useTranslations('dashboard.overview');
  return (
    <div>
      <div className={styles.viewBar}>
        <nav className={styles.views} aria-label={w('views')}>
          {OVERVIEW_VIEWS.map((key) => {
            const Icon = ICONS[key];
            return (
              <Link
                key={key}
                href={overviewHref(pathname, key, period)}
                prefetch={false}
                aria-current={view === key ? 'page' : undefined}
                className={styles.viewLink}
              >
                <Icon size={17} aria-hidden />
                {w(key)}
              </Link>
            );
          })}
        </nav>
        <nav className={styles.periods} aria-label={w('period')}>
          <span>{w('period')}</span>
          <InfoDot>{o('periodNote')}</InfoDot>
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
      </div>
      {view !== 'growth' && <p className={styles.viewIntro}>{w(`${view}Intro`)}</p>}
    </div>
  );
}
