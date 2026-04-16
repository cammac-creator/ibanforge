'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';

interface TopNavProps {
  period?: number;
}

export function TopNav({ period = 30 }: TopNavProps) {
  const pathname = usePathname();
  const t = useTranslations('dashboard');
  const locale = useLocale();

  const NAV_TABS = [
    { key: 'overview', href: `/${locale}/dashboard`, label: t('topNav.overview'), exact: true },
    { key: 'customers', href: `/${locale}/dashboard/customers`, label: t('topNav.customers'), exact: false },
    { key: 'analytics', href: `/${locale}/dashboard/analytics`, label: t('topNav.analytics'), exact: false },
    { key: 'quality', href: `/${locale}/dashboard/quality`, label: t('topNav.quality'), exact: false },
    { key: 'monitoring', href: `/${locale}/dashboard/monitoring`, label: t('topNav.monitoring'), exact: false },
  ];

  const PERIODS = [7, 30, 90];

  function isActive(href: string, exact: boolean): boolean {
    if (exact) return pathname === href;
    return pathname.startsWith(href);
  }

  function periodHref(p: number): string {
    const params = new URLSearchParams();
    params.set('period', String(p));
    return `${pathname}?${params.toString()}`;
  }

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-0 bg-zinc-950">
      {/* Logo */}
      <div className="flex items-center gap-2 py-3 shrink-0">
        <span className="inline-flex items-center justify-center h-6 w-6 rounded bg-amber-500 text-zinc-950 text-[10px] font-black tracking-tight select-none">
          IF
        </span>
        <span className="text-sm font-semibold text-white">IBANforge</span>
      </div>

      {/* Tabs */}
      <nav className="flex items-end gap-1 ml-6 self-stretch">
        {NAV_TABS.map((tab) => {
          const active = isActive(tab.href, tab.exact);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={[
                'px-3 py-3 text-sm font-medium transition-colors border-b-2 -mb-px',
                active
                  ? 'text-white bg-zinc-800 border-amber-500'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 border-transparent',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {/* Right side: period pills + back link */}
      <div className="flex items-center gap-3 ml-auto py-3">
        {/* Period pills */}
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => {
            const active = period === p;
            return (
              <Link
                key={p}
                href={periodHref(p)}
                className={[
                  'px-2.5 py-1 rounded text-xs font-medium transition-colors',
                  active
                    ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                    : 'text-zinc-500 hover:text-zinc-300',
                ].join(' ')}
              >
                {p}d
              </Link>
            );
          })}
        </div>

        {/* Separator */}
        <div className="h-4 w-px bg-zinc-800" />

        {/* Back to site */}
        <Link
          href={`/${locale}`}
          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          {t('topNav.backToSite')}
        </Link>
      </div>
    </div>
  );
}
