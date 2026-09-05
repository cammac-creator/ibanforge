'use client';

import { usePathname } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { useTranslations } from 'next-intl';
import { routing } from '@/i18n/routing';

export function ConditionalShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('common');
  const skipLabel = t('skipToContent');
  const pathname = usePathname();
  // pathname now includes locale prefix: /en/dashboard, /fr/dashboard, etc.
  const segments = pathname?.split('/') ?? [];
  // English has no prefix since 2026-09-05: the first segment is either a
  // locale (/fr/dashboard) or already the section (/dashboard).
  const section = (routing.locales as readonly string[]).includes(segments[1] ?? '') ? segments[2] : segments[1];
  const isDashboard = section === 'dashboard';
  // The "famille" page is a standalone, light-themed, immersive page for family.
  // It renders without the (dark) site header/footer to avoid a theme clash.
  const isFamille = section === 'famille';

  if (isDashboard || isFamille) {
    return <>{children}</>;
  }

  return (
    <>
      {/* WCAG 2.4.1 (Bypass Blocks). Someone navigating by keyboard or with a
          screen reader otherwise walks the whole header on every single page
          before reaching the content. Visually hidden until focused, which is
          the one case where hiding something from sight is the correct
          behaviour rather than a shortcut. */}
      <a
        href="#content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {skipLabel}
      </a>
      <SiteHeader />
      <main id="content" tabIndex={-1} className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
