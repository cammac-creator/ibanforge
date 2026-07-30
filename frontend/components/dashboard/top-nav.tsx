'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations, useLocale } from 'next-intl';

const PERIODS = [7, 30, 90];

export function TopNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard');
  const locale = useLocale();

  // Clients and prospects were two tabs over two near-twin pages, merged into
  // Contacts. The Clients tab that came back on 30/07/2026 is a different
  // thing: Contacts is the conversation, Clients is what they do with the API.
  const onContacts = pathname.includes('/dashboard/contacts');
  const onClients = pathname.includes('/dashboard/clients');
  const onOverview = !onContacts && !onClients;
  const current = Number(searchParams.get('period') ?? 30);
  const period = PERIODS.includes(current) ? current : 30;

  const TABS = [
    { key: 'overview', href: `/${locale}/dashboard`, label: t('topNav.overview'), active: onOverview },
    { key: 'contacts', href: `/${locale}/dashboard/contacts`, label: t('topNav.contacts'), active: onContacts },
    { key: 'clients', href: `/${locale}/dashboard/clients`, label: 'Clients', active: onClients },
  ];

  return (
    <div className="flex items-center justify-between border-b border-[var(--ink-4)] bg-[var(--ink-0)] px-4 py-3">
      {/* Logo + tabs */}
      <div className="flex items-center gap-5">
        <div className="flex shrink-0 items-center gap-2">
          <span className="inline-flex h-6 w-6 select-none items-center justify-center rounded bg-amber-500 text-[10px] font-black tracking-tight text-amber-foreground">
            IF
          </span>
          <span className="text-sm font-semibold text-white">IBANforge</span>
        </div>
        <nav className="flex items-center gap-1">
          {TABS.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className={[
                'rounded px-3 py-1.5 text-sm font-medium transition-colors',
                tab.active
                  ? 'bg-[var(--ink-4)] text-white'
                  : 'text-[var(--fg-4)] hover:bg-[var(--ink-4)]/50 hover:text-[var(--fg-2)]',
              ].join(' ')}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      </div>

      {/* Right: period pills (overview only) + back link */}
      <div className="flex items-center gap-3">
        {onOverview && (
          <div className="flex items-center gap-1">
            {PERIODS.map((p) => (
              <Link
                key={p}
                href={`${pathname}?period=${p}`}
                className={[
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  period === p
                    ? 'border border-amber-500/30 bg-amber-500/15 text-amber-400'
                    : 'text-[var(--fg-4)] hover:text-[var(--fg-2)]',
                ].join(' ')}
              >
                {p}d
              </Link>
            ))}
          </div>
        )}
        <div className="h-4 w-px bg-[var(--ink-4)]" />
        <Link href={`/${locale}`} className="text-xs text-[var(--fg-4)] transition-colors hover:text-[var(--fg-2)]">
          {t('topNav.backToSite')}
        </Link>
      </div>
    </div>
  );
}
