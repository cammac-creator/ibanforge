'use client';

import { useLocale } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { routing } from '@/i18n/routing';

const LABELS: Record<string, string> = { en: 'EN', fr: 'FR', de: 'DE' };

export function LocaleSwitcher() {
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();

  function switchLocale(newLocale: string) {
    const segments = pathname.split('/');
    segments[1] = newLocale;
    router.push(segments.join('/'));
  }

  return (
    <div className="relative group">
      <button
        className="text-xs font-mono font-semibold text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border"
        aria-label="Change language"
      >
        {LABELS[locale] ?? 'EN'}
      </button>
      <div className="absolute right-0 top-full mt-1 hidden group-hover:flex flex-col bg-zinc-900 border border-border rounded-lg shadow-lg overflow-hidden z-50 min-w-[48px]">
        {routing.locales.map((loc) => (
          <button
            key={loc}
            onClick={() => switchLocale(loc)}
            className={`px-4 py-2 text-xs font-mono text-left hover:bg-zinc-800 transition-colors ${
              loc === locale ? 'text-amber-500 font-semibold' : 'text-muted-foreground'
            }`}
          >
            {LABELS[loc]}
          </button>
        ))}
      </div>
    </div>
  );
}
