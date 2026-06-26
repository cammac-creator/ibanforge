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

  const current = Number(searchParams.get('period') ?? 30);
  const period = PERIODS.includes(current) ? current : 30;

  function periodHref(p: number): string {
    return `${pathname}?period=${p}`;
  }

  return (
    <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-950 px-4 py-3">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="inline-flex h-6 w-6 select-none items-center justify-center rounded bg-amber-500 text-[10px] font-black tracking-tight text-zinc-950">
          IF
        </span>
        <span className="text-sm font-semibold text-white">IBANforge</span>
        <span className="ml-1 hidden text-xs font-medium text-zinc-600 sm:inline">· Dashboard</span>
      </div>

      {/* Right: period pills + back link */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => {
            const active = period === p;
            return (
              <Link
                key={p}
                href={periodHref(p)}
                className={[
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border border-amber-500/30 bg-amber-500/15 text-amber-400'
                    : 'text-zinc-500 hover:text-zinc-300',
                ].join(' ')}
              >
                {p}d
              </Link>
            );
          })}
        </div>

        <div className="h-4 w-px bg-zinc-800" />

        <Link href={`/${locale}`} className="text-xs text-zinc-500 transition-colors hover:text-zinc-300">
          {t('topNav.backToSite')}
        </Link>
      </div>
    </div>
  );
}
