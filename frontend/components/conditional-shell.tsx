'use client';

import { usePathname } from 'next/navigation';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

export function ConditionalShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // pathname now includes locale prefix: /en/dashboard, /fr/dashboard, etc.
  const segments = pathname?.split('/') ?? [];
  const isDashboard = segments.length >= 3 && segments[2] === 'dashboard';

  if (isDashboard) {
    return <>{children}</>;
  }

  return (
    <>
      <SiteHeader />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </>
  );
}
