import { CrmApp } from '@/components/crm/crm-app';
import { AliasRules } from '@/components/crm/alias-rules';
import { NoReplyRules } from '@/components/crm/no-reply-rules';
import { FreshnessBadge } from '@/components/crm/freshness-badge';
import { fetchCrmData } from '@/lib/crm/build-contacts';
import { HARD_CAP, SOFT_CAP } from '@/lib/crm/sent-today';
import { crmSnapshot } from '@/lib/crm/snapshot';

/**
 * The single CRM page: clients and prospects in one list, one vocabulary, one
 * detail pane. Replaces the two near-twin pages that each had their own list,
 * filters, search and thread.
 *
 * This is the page the owner answers customers on, so it holds the work and
 * nothing else. The podium, the six figure cards and the campaign band that
 * used to stack above the CRM were about 640px of watching before the first
 * conversation; they live on the overview now. What is left above the thread is
 * one line of context, and every figure on it comes from lib/crm/snapshot.ts,
 * which the overview reads too: one origin, so the two pages cannot disagree.
 */
export default async function ContactsPage() {
  const data = await fetchCrmData();

  if (!data) {
    return (
      <div className="rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-8 text-center">
        <p className="font-medium text-[var(--fg-2)]">Données indisponibles</p>
        <p className="mt-1 text-sm text-[var(--fg-3)]">
          ADMIN_SECRET non configuré, ou API injoignable.
        </p>
      </div>
    );
  }

  // One reading of the base, and the only one this page makes. Nothing below
  // derives a figure of its own.
  const { contacts, situations, snoozed, woke, active, sentToday } =
    crmSnapshot(data);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <header>
        <p className="mb-2 hidden text-xs text-[var(--fg-4)] sm:block">CRM / Relations</p>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-semibold text-white">Contacts</h1>
          <FreshnessBadge fetchedAtIso={new Date().toISOString()} />
        </div>
        <p className="mt-2 hidden text-sm text-[var(--fg-3)] sm:block">Retrouver un échange, répondre et préparer la suite.</p>
        <p className="mt-3 text-xs text-[var(--fg-4)]">
          {active.length} contact{active.length > 1 ? 's' : ''} suivi{active.length > 1 ? 's' : ''}
          {' · '}
          <span className={sentToday >= HARD_CAP ? 'font-medium text-red-400' : sentToday >= SOFT_CAP ? 'text-amber-400' : undefined}>
            {sentToday} envoyé{sentToday > 1 ? 's' : ''} aujourd’hui
            {sentToday >= HARD_CAP ? ' · plafond de prospection atteint pour aujourd’hui' : sentToday >= SOFT_CAP ? ` · encore ${HARD_CAP - sentToday} avant le plafond` : ''}
          </span>
        </p>
      </header>

      <CrmApp
        contacts={contacts}
        situations={situations}
        snoozed={snoozed}
        woke={woke}
        sentToday={sentToday}
        todayIso={new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(
          new Date(),
        )}
      />

      {/* The standing sender rules, listable after the fact — the undo that
          used to live only in the breath after setting one. Folded shut, at
          the very bottom: consulted rarely, but findable the day an address
          arrives pre-marked and the operator asks why. */}
      <NoReplyRules />
      <AliasRules />
    </div>
  );
}
