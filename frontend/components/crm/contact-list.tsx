'use client';

import { useMemo, useState } from 'react';
import type { Contact, Situation } from '@/lib/crm/types';

export type FilterKey = 'today' | 'all' | 'followup' | 'prospects' | 'clients';

/**
 * One predicate per filter, used BOTH to count and to select. That is the whole
 * point of this shape: a chip cannot advertise a number the list then fails to
 * show, because there is no second copy of the rule to drift from.
 *
 * The situation may be missing: the page builds one entry per contact id, so an
 * absent one is a programming error rather than data, and the predicates simply
 * decline to claim the row instead of throwing in the operator's face.
 */
const FILTERS: Array<{
  key: FilterKey;
  label: string;
  test: (c: Contact, s: Situation | undefined) => boolean;
}> = [
  { key: 'today', label: "Aujourd'hui", test: (_c, s) => s?.ballInCourt === 'us' || s?.followupDue === true },
  { key: 'all', label: 'Tous', test: () => true },
  { key: 'followup', label: 'Relances dues', test: (_c, s) => s?.followupDue === true },
  { key: 'prospects', label: 'Prospects', test: (c) => c.kind === 'prospect' },
  { key: 'clients', label: 'Clients', test: (c) => c.kind === 'client' },
];

const DEFAULT_FILTER = FILTERS[0];

/** Ordering rank: our turn first, then the followups, then everything else. */
function rankOf(s: Situation | undefined): number {
  if (s?.ballInCourt === 'us') return 0;
  if (s?.followupDue) return 1;
  return 2;
}

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
  selectedId,
  onSelect,
}: {
  contacts: Contact[];
  /** Keyed by Contact.id, one entry per contact, built by the page. */
  situations: Record<string, Situation>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [filter, setFilter] = useState<FilterKey>('today');
  const [q, setQ] = useState('');

  const rows = useMemo(
    () => contacts.map((c) => ({ c, s: situations[c.id] as Situation | undefined })),
    [contacts, situations],
  );

  // Counts describe the buckets, so they stay stable while the operator types:
  // a chip that dropped to 0 or 1 on every keystroke would stop being a way to
  // navigate. The search narrows what is shown, never what is counted.
  const counts = useMemo(() => {
    const out = {} as Record<FilterKey, number>;
    for (const f of FILTERS) out[f.key] = rows.filter(({ c, s }) => f.test(c, s)).length;
    return out;
  }, [rows]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const f = FILTERS.find((x) => x.key === filter) ?? DEFAULT_FILTER;
    return rows
      .filter(({ c, s }) => f.test(c, s))
      .filter(({ c }) => !term || `${c.company ?? ''} ${c.email}`.toLowerCase().includes(term))
      .sort((a, b) => {
        if (a.c.unread !== b.c.unread) return a.c.unread ? -1 : 1;
        if (rankOf(a.s) !== rankOf(b.s)) return rankOf(a.s) - rankOf(b.s);
        return (b.s?.silenceDays ?? 0) - (a.s?.silenceDays ?? 0);
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
        {shown.map(({ c, s }) => {
          const status = statusLine(s);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              aria-current={c.id === selectedId}
              className={`flex w-full min-w-0 cursor-pointer flex-col gap-1 border-b border-[var(--ink-4)]/40 px-3 py-2.5 text-left transition-colors ${
                c.id === selectedId
                  ? 'bg-[var(--ink-4)]/60'
                  : c.unread
                    ? 'bg-blue-500/10'
                    : 'hover:bg-[var(--ink-4)]/30'
              }`}
            >
              <div className="flex min-w-0 items-center gap-2">
                {c.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-blue-500" />}
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
              {status && <span className="pl-4 text-[10px] text-[var(--fg-3)]">{status}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
