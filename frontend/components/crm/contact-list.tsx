'use client';

import { useMemo, useState } from 'react';
import { isArchived } from '@/lib/crm/archived';
import { dueToday, followupDue, neverContacted } from '@/lib/crm/buckets';
import { byPriority, priorityOf, type Priority } from '@/lib/crm/priority';
import type { Contact, Situation } from '@/lib/crm/types';

export type FilterKey = 'today' | 'first' | 'all' | 'followup' | 'prospects' | 'clients' | 'archived';

/**
 * One predicate per filter, used BOTH to count and to select. That is the whole
 * point of this shape: a chip cannot advertise a number the list then fails to
 * show, because there is no second copy of the rule to drift from.
 *
 * The two bucket rules come from buckets.ts rather than being spelled out here,
 * which extends the same guarantee one ring outwards: the day rail's sections
 * and the page's stat cards read those very functions, so a chip cannot
 * advertise a number the rail beside it contradicts either.
 *
 * The situation may be missing: the page builds one entry per contact id, so an
 * absent one is a programming error rather than data, and the predicates simply
 * decline to claim the row instead of throwing in the operator's face.
 */
const FILTERS: Array<{
  key: FilterKey;
  label: string;
  test: (c: Contact, s: Situation | undefined, snoozed: boolean) => boolean;
}> = [
  { key: 'today', label: "Aujourd'hui", test: dueToday },
  // Placed second, right after the day's queue: these rows appear in no other
  // bucket, so anywhere further down is where they were already being missed.
  { key: 'first', label: 'Jamais contactés', test: neverContacted },
  { key: 'all', label: 'Tous', test: (c, s) => !isArchived(c, s) },
  { key: 'followup', label: 'Relances dues', test: followupDue },
  { key: 'prospects', label: 'Prospects', test: (c, s) => !isArchived(c, s) && c.kind === 'prospect' },
  { key: 'clients', label: 'Clients', test: (c, s) => !isArchived(c, s) && c.kind === 'client' },
  { key: 'archived', label: 'Archivés', test: (c, s) => isArchived(c, s) },
];

const DEFAULT_FILTER = FILTERS[0];

/**
 * Ordering used to be: our turn, then the followups, then the rest, and inside
 * each of those, the longest silence. That last step was the whole ordering in
 * practice, because the follow-up bucket held fifty of the rows at once, and
 * silence is the least informative thing known about a thread. priority.ts
 * replaces it with a ladder and hands back the reason, which the row shows.
 */

/**
 * Tint per rung. Warm where the row is worth the next send, neutral where it
 * is not, so the column reads at a glance without having to parse the words.
 * Every value is a --fg token or a 300-level colour on a /15 tint, the pairing
 * ruled AA during the refactor.
 */
const PRIORITY_TINT: Record<Priority['key'], string> = {
  answer: 'bg-blue-500/15 text-blue-300',
  client: 'bg-purple-500/15 text-purple-300',
  replied: 'bg-emerald-500/15 text-emerald-300',
  high: 'bg-amber-500/15 text-amber-300',
  medium: 'bg-[var(--ink-5)] text-[var(--fg-2)]',
  low: 'bg-[var(--ink-4)] text-[var(--fg-3)]',
  unknown: 'bg-[var(--ink-4)] text-[var(--fg-3)]',
  snoozed: 'bg-[var(--ink-4)] text-[var(--fg-3)]',
};

/** The one-line status shown under a contact, or null when we know nothing. */
function statusLine(s: Situation | undefined): string | null {
  if (!s) return null;
  if (s.ballInCourt === 'us') return `balle chez toi · ${s.silenceDays ?? 0} j`;
  if (s.followupDue) return `relance due · ${s.silenceDays ?? 0} j`;
  if (s.nextAction === 'first_mail') return 'jamais contacté';
  return `en attente · ${s.silenceDays ?? 0} j`;
}

/**
 * The single contact column: search, counted filters, then the rows.
 *
 * Situations arrive as a prop rather than being derived here on purpose. They
 * depend on the current instant and on how the runtime reads a timezone-less
 * stored date, and this component is server-rendered then hydrated, so deriving
 * them on both sides would make the two renders disagree. The page computes
 * them once, server-side, against a single clock.
 */
export function ContactList({
  contacts,
  situations,
  snoozed,
  selectedId,
  onSelect,
}: {
  contacts: Contact[];
  /** Keyed by Contact.id, one entry per contact, built by the page. */
  situations: Record<string, Situation>;
  /** Keyed the same way, same clock. See CrmApp. */
  snoozed: Record<string, boolean>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('today');
  const [q, setQ] = useState('');

  const rows = useMemo(
    () =>
      contacts.map((c) => {
        const s = situations[c.id] as Situation | undefined;
        const asleep = snoozed[c.id] === true;
        return { c, s, asleep, p: priorityOf(c, s, asleep) };
      }),
    [contacts, situations, snoozed],
  );

  // Counts describe the buckets, so they stay stable while the operator types:
  // a chip that dropped to 0 or 1 on every keystroke would stop being a way to
  // navigate. The search narrows what is shown, never what is counted.
  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const f of FILTERS) out[f.key] = rows.filter(({ c, s, asleep }) => f.test(c, s, asleep)).length;
    return out;
  }, [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.key === filter) ?? DEFAULT_FILTER;
    return rows
      .filter(({ c, s, asleep }) => f.test(c, s, asleep))
      .filter(({ c }) => !term || `${c.company ?? ''} ${c.email}`.toLowerCase().includes(term))
      .sort((a, b) => {
        // Unread still wins outright: a person wrote and it has not been read.
        // Robots no longer reach this test (thread-unread.ts), so the top of
        // the queue cannot be taken by a ticket acknowledgement any more.
        if (a.c.unread !== b.c.unread) return a.c.unread ? -1 : 1;
        return byPriority(a, b);
      });
  }, [rows, filter, q]);

  return (
    // min-w-0 so a long address in a row cannot set a min-content floor on this
    // grid item and widen the whole page. See the note in thread.tsx.
    <div className="flex h-full min-w-0 flex-col rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      <div className="space-y-2 border-b border-[var(--ink-4)]/60 p-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher…"
          aria-label="Rechercher un contact"
          className="w-full min-w-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-3 py-1.5 text-sm text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:border-amber-500/40 focus:outline-none"
        />
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`cursor-pointer rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                filter === f.key
                  ? 'bg-amber-500/15 text-amber-400'
                  : 'text-[var(--fg-3)] hover:text-[var(--fg-1)]'
              }`}
            >
              {f.label}
              <span className="ml-1 tabular-nums opacity-80">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {shown.length === 0 && (
          // --fg-3 rather than the --fg-5 first drafted: the same token, at the
          // same sizes, was ruled under AA twice during task 5 and lifted there.
          <p className="p-4 text-sm text-[var(--fg-3)]">Aucun contact.</p>
        )}
        {shown.map(({ c, s, p }) => {
          const status = statusLine(s);
          // 'answer' would repeat the status line word for word, so the reason
          // is shown only where it says something the status does not: why THIS
          // row sits where it does among the fifty that all read "relance due".
          const reason = p.key === 'answer' ? null : p.reason;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              // aria-pressed, not aria-current: this is a selection toggle, not
              // a link marking the current page or step.
              aria-pressed={c.id === selectedId}
              className={`flex w-full min-w-0 cursor-pointer flex-col gap-1 border-b border-[var(--ink-4)]/40 px-3 py-2.5 text-left transition-colors ${
                c.id === selectedId
                  ? 'bg-[var(--ink-4)]/60'
                  : c.unread
                    ? 'bg-blue-500/10'
                    : 'hover:bg-[var(--ink-4)]/30'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {/* The list's primary signal, and colour alone does not carry
                    it. Both legacy workspaces named the same dot this way. */}
                {c.unread && (
                  <span
                    className="h-2 w-2 shrink-0 rounded-full bg-blue-500"
                    role="img"
                    aria-label="Réponse non lue"
                    title="Réponse non lue"
                  />
                )}
                {/* truncate, not wrap-anywhere: overflow:hidden drops this flex
                    item's automatic minimum size to zero, so a long address
                    clips here instead of widening the column. */}
                <span
                  className="truncate text-sm font-medium text-[var(--fg-1)]"
                  title={c.company || c.email || undefined}
                >
                  {c.company || c.email || 'Sans nom'}
                </span>
                <span className="ml-auto shrink-0 text-[9px] uppercase text-[var(--fg-3)]">
                  {c.kind === 'client' ? 'client' : 'prospect'}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-1.5 pl-4">
                {status && <span className="truncate text-[10px] text-[var(--fg-3)]">{status}</span>}
                {reason && (
                  <span
                    className={`shrink-0 rounded px-1 py-px text-[9px] ${PRIORITY_TINT[p.key]}`}
                    title="Pourquoi ce contact est placé ici dans la file"
                  >
                    {reason}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
