import { SectionSkeleton } from '@/components/dashboard/overview/section';

/**
 * The five sections, before they exist (ENS-05, 2026-09-01).
 *
 * Measured on 01/09/2026 against a cold upstream, the overview took about
 * three seconds to its first byte where every other tab took half of one — it
 * is the tab that pays for waking the whole API. That part is arguable; what
 * was not arguable is that NOTHING moved during those three seconds. With
 * neither a loading.tsx under (protected)/ nor a single Suspense boundary in
 * the page, the App Router keeps the previous screen intact until the new one
 * is ready, so the first gesture of the morning looked like a click that had
 * been ignored.
 *
 * This file covers the navigation itself; the <Suspense> boundaries inside the
 * page then fill the sections one by one as their reads land, so the screen
 * keeps moving instead of freezing once and unfreezing at the end.
 *
 * It sits at the route-group level, so the four CRM tabs get it too — Clients
 * Bot is the other slow one.
 */
export default function DashboardLoading() {
  return (
    <div className="flex min-w-0 flex-col gap-7">
      <div className="flex animate-pulse items-baseline gap-3" aria-hidden>
        <div className="h-4 w-40 rounded bg-[var(--ink-4)]/70" />
        <div className="ml-auto h-3 w-24 rounded bg-[var(--ink-4)]/50" />
      </div>
      <div className="h-[70px] animate-pulse rounded-xl bg-[var(--ink-2)]/60" aria-hidden />
      <SectionSkeleton rows={4} />
      <SectionSkeleton tall />
      <SectionSkeleton rows={3} />
      <SectionSkeleton tall />
      <SectionSkeleton />
      <span className="sr-only">Chargement du tableau de bord…</span>
    </div>
  );
}
