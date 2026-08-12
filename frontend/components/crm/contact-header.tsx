import { UsageChart } from '@/components/dashboard/usage-chart';
import type { Contact, ProspectSourcing } from '@/lib/crm/types';
import { OutcomeBadge, OutcomeControl } from './outcome-control';
import { ProspectStatusBadge, ProspectStatusControl } from './prospect-status';

/** Segment labels, lifted from the prospect page so the wording does not drift. */
const SEGMENT: Record<string, string> = {
  'x402-mcp': 'x402 / MCP / agents IA',
  editeurs: 'Éditeur logiciel CH/EU',
  'api-concurrentes': 'Migration API concurrente',
  fintech: 'Fintech / PSP / néobanque',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  high: '#22c55e',
  medium: '#f59e0b',
  low: '#ef4444',
};

/**
 * Which of the qualification blocks have anything to say. The wrapper is gated
 * on the union of these three rather than on "does sourcing hold any field at
 * all", so the gate cannot say yes while every block inside says no.
 *
 * The first version gated on three of the ten fields, and a prospect qualified
 * through whatTheyDo and fitReason rendered a name and nothing else. Listing
 * the ten instead only moved the seam: segment and confidence are shown in the
 * identity line above, not in this wrapper, so a prospect carrying nothing but
 * a confidence score opened an empty box. Deriving the gate from the blocks
 * removes the seam rather than moving it again.
 */
function blocksOf(s: ProspectSourcing, hasEmail: boolean) {
  const fit = !!(s.whatTheyDo || s.fitReason);
  const signal = !!(s.buyingSignal || s.signalSourceUrl);
  // The Contact block earns its place only when it adds something the identity
  // line does not already carry: a named human, a proof of the address, the
  // hook, the unverified warning, or the reminder never to guess an address.
  const contact = !!(
    s.contactName ||
    s.contactRole ||
    s.emailSourceUrl ||
    s.personalizationHook ||
    s.status === 'a_enrichir' ||
    !hasEmail
  );
  return { fit, signal, contact, any: fit || signal || contact };
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[12px] uppercase tracking-wide text-[var(--fg-3)]">{label}</p>
      <p className="mt-0.5 wrap-anywhere text-sm text-[var(--fg-2)]">{value}</p>
    </div>
  );
}

/**
 * Who this is, in one strip: the name, the address, and for a prospect the
 * stored status. Small on purpose, because the panel pins it.
 *
 * The header used to be one block, identity and dossier together, and it was
 * measured taking 231 to 370px of a panel capped at 76vh. With the composer
 * open that left the thread nothing at all, so the operator could not read the
 * message they were answering while they answered it. The split is what fixes
 * that: this part stays in view, the dossier below scrolls with the thread.
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
export function ContactIdentity({ contact: c }: { contact: Contact }) {
  const sourcing = c.sourcing;
  const segment = sourcing?.segment ? (SEGMENT[sourcing.segment] ?? sourcing.segment) : null;

  return (
    <div className="min-w-0 border-b border-[var(--ink-4)]/60 pb-2">
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
                className="shrink-0 text-[13px] text-amber-400 hover:underline"
              >
                site ↗
              </a>
            )}
          </div>
          <p className="mt-0.5 wrap-anywhere text-[13px] text-[var(--fg-3)]">
            {c.email || 'pas d’email vérifié'}
            {c.country ? ` · ${c.country}` : ''}
            {segment ? ` · ${segment}` : ''}
            {sourcing?.confidence ? (
              <>
                {' · '}
                <span style={{ color: CONFIDENCE_COLOR[sourcing.confidence] ?? '#a1a1aa' }}>
                  confiance {sourcing.confidence}
                </span>
              </>
            ) : null}
          </p>
        </div>
        {c.kind === 'prospect' && <ProspectStatusBadge status={c.sourcing.status} />}
        {/* Where the relationship stands, beside where the sourcing stands.
            Shown for a converted client too: the outcome outlives the
            conversion, and a client marked "pas maintenant" on an upsell is a
            real thing to record. */}
        {sourcing && <OutcomeBadge sourcing={sourcing} />}
      </div>
    </div>
  );
}

/**
 * The dossier: whatever the nature of the contact actually justifies. The key
 * and usage block for a client, the sourcing blocks for a contact that came out
 * of the prospect list, and the triage control for a prospect. A client that
 * converted from prospecting shows both, and neither kind ever renders the
 * other's empty fields.
 *
 * Rendered at the top of the scrolling region, above the thread, rather than
 * pinned. Nothing is lost: it scrolls into view like the oldest message does,
 * and it is fully visible without scrolling in the case that needs it most, a
 * cold prospect, whose thread is empty by definition.
 */
export function ContactDetail({ contact: c }: { contact: Contact }) {
  const sourcing = c.sourcing;
  const blocks = sourcing ? blocksOf(sourcing, !!c.email) : null;

  return (
    <div className="mb-3 min-w-0 border-b border-[var(--ink-4)]/60 pb-3">
      {c.kind === 'client' && (
        // No shrink-0, and this stacks below sm. Measured at a 375px viewport:
        // with shrink-0 the block held its 526px preferred width, the flex row
        // could not absorb it and the page scrolled sideways (body.scrollWidth
        // 559 for a 375 window). min-w-0 lets it go under its min-content,
        // which the usage chart needs since its columns each claim a few
        // pixels, and stacking gives the chart the full row instead of what is
        // left beside the quota.
        <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
          <div>
            <p className="text-[12px] uppercase tracking-wide text-[var(--fg-3)]">
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

      {sourcing && blocks?.any && (
        // Grouping taken from the prospect page rather than invented: why they
        // are a fit, then the buying signal with its proof, then the human to
        // write to with the proof of the address. Those last two are what the
        // operator acts on, so they are not folded away.
        //
        // first:mt-0 because the client block above is absent for a prospect,
        // which makes this the first child and its top margin a stray gap.
        <div className="mt-3 flex min-w-0 flex-col gap-3 first:mt-0">
          {blocks.fit && (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Field label="Ce qu’ils font" value={sourcing.whatTheyDo} />
              <Field label="Pourquoi IBANforge leur sert" value={sourcing.fitReason} />
            </div>
          )}

          {blocks.signal && (
            <div className="min-w-0 rounded-lg border border-[var(--ok)]/20 bg-[var(--ok)]/5 px-3 py-2">
              <p className="text-[12px] uppercase tracking-wide text-[var(--ok)]">Signal d’achat</p>
              {sourcing.buyingSignal && (
                <p className="mt-0.5 wrap-anywhere text-sm text-[var(--fg-1)]">{sourcing.buyingSignal}</p>
              )}
              {sourcing.signalSourceUrl && (
                <a
                  href={sourcing.signalSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-[12px] text-[var(--ok)] hover:underline"
                >
                  preuve ↗
                </a>
              )}
            </div>
          )}

          {blocks.contact && (
          <div className="min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)]/50 px-3 py-2">
            <p className="text-[12px] uppercase tracking-wide text-[var(--fg-3)]">Contact</p>
            {(sourcing.contactName || sourcing.contactRole) && (
              <p className="mt-0.5 wrap-anywhere text-sm text-[var(--fg-1)]">
                {sourcing.contactName || 'nom inconnu'}
                {sourcing.contactRole ? ` · ${sourcing.contactRole}` : ''}
              </p>
            )}
            {c.email ? (
              <p className="wrap-anywhere text-[13px] text-[var(--fg-3)]">
                {c.email}
                {sourcing.emailSourceUrl && (
                  <>
                    {' · '}
                    <a
                      href={sourcing.emailSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-400 hover:underline"
                    >
                      source ↗
                    </a>
                  </>
                )}
                {sourcing.status === 'a_enrichir' && (
                  <span className="text-amber-400"> · à confirmer (non vérifié)</span>
                )}
              </p>
            ) : (
              <p className="wrap-anywhere text-[13px] text-amber-400">
                Pas d’email vérifié, à enrichir (on ne devine jamais une adresse).
                {/* The source link used to live only in the branch above, so a
                    prospect with a proof URL and no address lost the one lead
                    that would let the operator find the address. */}
                {sourcing.emailSourceUrl && (
                  <>
                    {' · '}
                    <a
                      href={sourcing.emailSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-400 underline hover:no-underline"
                    >
                      source ↗
                    </a>
                  </>
                )}
              </p>
            )}
            {sourcing.personalizationHook && (
              <p className="mt-1 wrap-anywhere text-[12px] text-[var(--fg-3)]">
                <span className="text-[var(--fg-2)]">Accroche :</span> {sourcing.personalizationHook}
              </p>
            )}
          </div>
          )}
        </div>
      )}

      {c.kind === 'prospect' && (
        <ProspectStatusControl
          prospectId={c.sourcing.prospectId}
          status={c.sourcing.status}
          hasEmail={!!c.email}
        />
      )}

      {/* Anything carrying a prospect row can hold an outcome, client included:
          the row survives the conversion and so does what was learned. */}
      {sourcing && <OutcomeControl sourcing={sourcing} />}
    </div>
  );
}
