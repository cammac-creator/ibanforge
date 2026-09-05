'use client';

import { useState, useRef, useEffect } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';

const LABELS: Record<string, string> = { en: 'EN', fr: 'FR', de: 'DE' };

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('header');
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  function switchLocale(newLocale: string) {
    // the current path with its locale prefix stripped, if it has one
    // (English has none since 2026-09-05), then the target's prefix added
    const segments = pathname.split('/');
    const hasPrefix = (routing.locales as readonly string[]).includes(segments[1] ?? '');
    const rest = `/${segments.slice(hasPrefix ? 2 : 1).join('/')}`;
    router.push(localePath(newLocale, rest));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-mono font-semibold text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border"
        // The accessible name carries the visible text, in the page's language
        // (Lighthouse label-content-name-mismatch, 2026-09-05).
        aria-label={t('changeLanguage', { locale: LABELS[locale] ?? 'EN' })}
      >
        {LABELS[locale] ?? 'EN'}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 flex flex-col bg-[var(--ink-2)] border border-border rounded-lg shadow-lg overflow-hidden z-50 min-w-[48px]">
          {routing.locales.map((loc) => (
            <button
              key={loc}
              onClick={() => switchLocale(loc)}
              className={`px-4 py-2 text-xs font-mono text-left hover:bg-[var(--ink-4)] transition-colors ${
                loc === locale ? 'text-amber-500 font-semibold' : 'text-muted-foreground'
              }`}
            >
              {LABELS[loc]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
