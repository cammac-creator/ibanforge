import { UsageChart } from '@/components/dashboard/usage-chart';
import type { Contact } from '@/lib/crm/types';

/**
 * Identity first, then whatever the nature of the contact actually justifies:
 * the key and usage block for a client, the sourcing block for a contact that
 * came out of the prospect list. A client that converted from prospecting shows
 * both, and neither kind ever renders the other's empty fields.
 *
 * No 'use client' here: nothing in this file holds state. It is pulled into the
 * client bundle anyway because crm-app.tsx imports it across the boundary, but
 * the directive would also make it impossible to render it on the server later.
 *
 * wrap-anywhere and min-w-0 throughout, not decoration. An address or a URL in
 * a buying signal is one unbroken token, every flex item defaults to
 * min-width:auto, and overflow-wrap:break-word breaks the line without reducing
 * the min-content contribution, so such a token widens the whole page rather
 * than its own box. Only overflow-wrap:anywhere shrinks that contribution.
 */
export function ContactHeader({ contact: c }: { contact: Contact }) {
  const sourcing = c.sourcing;
  const hasSourcingDetail = !!(
    sourcing &&
    (sourcing.buyingSignal || sourcing.personalizationHook || sourcing.signalSourceUrl)
  );

  return (
    <div className="min-w-0 border-b border-[var(--ink-4)]/60 pb-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="min-w-0 wrap-anywhere text-lg font-semibold text-white">
              {c.company || c.email || 'Sans nom'}
            </h2>
            {c.website && (
              <a
                href={c.website}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-xs text-amber-400 hover:underline"
              >
                site ↗
              </a>
            )}
          </div>
          <p className="mt-0.5 wrap-anywhere text-xs text-[var(--fg-3)]">
            {c.email || 'pas d’email vérifié'}
            {c.country ? ` · ${c.country}` : ''}
          </p>
        </div>
        {c.kind === 'client' && (
          // No shrink-0, and this stacks below sm. Measured at a 375px
          // viewport: with shrink-0 the block held its 526px preferred width,
          // the flex row could not absorb it and the page scrolled sideways
          // (body.scrollWidth 559 for a 375 window). min-w-0 lets it go under
          // its min-content, which the usage chart needs since its columns each
          // claim a few pixels, and stacking gives the chart the full row
          // instead of what is left beside the quota.
          <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-4 sm:text-right">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-[var(--fg-3)]">
                {c.apiKey.paid ? 'Crédits' : 'Quota'}
              </p>
              <p className="font-mono text-sm text-[var(--fg-2)]">
                {c.apiKey.paid
                  ? `${(c.apiKey.creditsTotal ?? 0) - (c.apiKey.creditsRemaining ?? 0)}/${c.apiKey.creditsTotal ?? 0}`
                  : `${c.apiKey.usedAllTime}/${c.apiKey.monthlyLimit ?? 200}`}
              </p>
            </div>
            <UsageChart days={c.usage.days} series={c.usage.series} months={c.usage.months} />
          </div>
        )}
      </div>

      {sourcing && hasSourcingDetail && (
        <div className="mt-3 min-w-0 rounded-lg border border-[var(--ok)]/20 bg-[var(--ok)]/5 px-3 py-2">
          {sourcing.buyingSignal && (
            <>
              <p className="text-[10px] uppercase tracking-wide text-[var(--ok)]">Signal d’achat</p>
              <p className="mt-0.5 wrap-anywhere text-sm text-[var(--fg-1)]">{sourcing.buyingSignal}</p>
            </>
          )}
          {sourcing.personalizationHook && (
            <p className="mt-1 wrap-anywhere text-[11px] text-[var(--fg-3)]">
              <span className="text-[var(--fg-2)]">Accroche :</span> {sourcing.personalizationHook}
            </p>
          )}
          {sourcing.signalSourceUrl && (
            <a
              href={sourcing.signalSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[11px] text-[var(--ok)] hover:underline"
            >
              preuve ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
