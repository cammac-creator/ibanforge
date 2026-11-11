import type { LateReadsSummary } from '@/lib/crm/build-contacts';

/**
 * What a CRM page says when a read did not come back within the deadline
 * (C23, 11/11/2026), instead of « API injoignable » for the whole page.
 *
 * - `LateReadsPanel`: a load-bearing read is late (keys, prospects, mail), so
 *   the page shows this in its place rather than figures that would be false.
 * - `LateReadsBanner`: an optional read is late, the page is drawn without it,
 *   and this line says which.
 *
 * No hook, no `Intl`: rendered by server pages, with a sentence built once in
 * `lateReadsSummary`.
 */
export function LateReadsPanel({ summary, page }: { summary: LateReadsSummary; page: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center"
    >
      <p className="font-medium text-[var(--fg-2)]">Lecture trop lente</p>
      <p className="mt-1 text-sm text-[var(--fg-3)]">
        {summary.text} {page} ne s’affiche pas sans cette lecture, pour ne pas montrer des comptes
        faux. Rechargez la page dans un moment.
      </p>
    </div>
  );
}

export function LateReadsBanner({ summary }: { summary: LateReadsSummary }) {
  return (
    <p
      role="status"
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm text-[var(--fg-2)]"
    >
      {summary.text} La page s’affiche sans cette lecture ; rechargez-la pour la compléter.
    </p>
  );
}
