'use client';

import { useState, useRef, useEffect, useId } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { routing } from '@/i18n/routing';
import { localePath } from '@/lib/locale-path';

const LABELS: Record<string, string> = { en: 'EN', fr: 'FR', de: 'DE' };

/**
 * The page being read, with its locale prefix stripped if it has one.
 *
 * English has no prefix since 2026-09-05, but a prerendered English page is
 * generated under `/en/…` and only reaches the browser at `/…` through the
 * middleware's rewrite: the server reads `/en/pricing` where the browser reads
 * `/pricing`. Both must give the same result, or the links below would differ
 * between the served HTML and the hydrated page.
 */
export function unprefixedPath(pathname: string | null): string {
  const segments = (pathname ?? '/').split('/');
  const hasPrefix = (routing.locales as readonly string[]).includes(segments[1] ?? '');
  return `/${segments.slice(hasPrefix ? 2 : 1).join('/')}`;
}

export function LocaleSwitcher() {
  const locale = useLocale();
  const t = useTranslations('header');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const rest = unprefixedPath(pathname);

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

  function rememberLocale(newLocale: string) {
    // The middleware reads this cookie to pick the locale of an unprefixed
    // path: without it, a reader who once opened /fr could never reach the
    // English pages again (they bounced back to /fr/…, 2026-09-05). The link's
    // own click handler runs before Next navigates, and on a Cmd/Ctrl-click
    // too, so the new tab asks for the page with the right cookie.
    //
    // react-hooks/immutability sees `document` as a value defined outside the
    // component and refuses the assignment. It is not a render-phase write:
    // this runs from a click, which is where the rule's own advice — "consider
    // using an effect" — would put it anyway, one render later and for no gain.
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `NEXT_LOCALE=${newLocale}; path=/; max-age=31536000; samesite=lax; secure`;
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-mono font-semibold text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded border border-border"
        // The accessible name carries the visible text, in the page's language
        // (Lighthouse label-content-name-mismatch, 2026-09-05).
        aria-label={t('changeLanguage', { locale: LABELS[locale] ?? 'EN' })}
        aria-expanded={open}
        aria-controls={menuId}
      >
        {LABELS[locale] ?? 'EN'}
      </button>
      {/* Real links, rendered even while the menu is closed (2026-09-24).
          Until then each language was a <button> calling router.push, only
          mounted once the menu opened: the served HTML held no link from an
          English page to /fr or /de, and Google does not follow a script
          event, so both trees were found through the sitemap alone. Closed,
          `hidden` (display: none) keeps the links out of the tab order and
          the accessibility tree, as before, while they stay in the HTML.
          The class, not the attribute: a `flex` class next to the `hidden`
          attribute would override it.

          `prefetch={false}`: a prefetch of /pricing from a French page would
          travel with NEXT_LOCALE=fr, the middleware would answer with the
          French page, and the router could serve that cached answer on the
          click. next-intl's own locale-changing Link makes the same choice. */}
      <div
        id={menuId}
        className={`absolute right-0 top-full mt-1 ${open ? 'flex' : 'hidden'} flex-col bg-[var(--ink-2)] border border-border rounded-lg shadow-lg overflow-hidden z-50 min-w-[48px]`}
      >
        {routing.locales.map((loc) => (
          <Link
            key={loc}
            href={localePath(loc, rest)}
            hrefLang={loc}
            prefetch={false}
            aria-current={loc === locale ? 'true' : undefined}
            onClick={() => rememberLocale(loc)}
            className={`px-4 py-2 text-xs font-mono text-left hover:bg-[var(--ink-4)] transition-colors ${
              loc === locale ? 'text-amber-500 font-semibold' : 'text-muted-foreground'
            }`}
          >
            {LABELS[loc]}
          </Link>
        ))}
      </div>
    </div>
  );
}
