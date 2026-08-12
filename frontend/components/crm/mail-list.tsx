'use client';

import { useState } from 'react';
import {
  mailFilters,
  mailRows,
  searchRows,
  type MailFilterKey,
  type RowsInput,
} from '@/lib/crm/mail-rows';

/**
 * The left column. Holds no rule of its own: it asks mail-rows.ts what the
 * filters and the rows are, and draws them. That split is what makes this half
 * of the screen testable, since the vitest config covers lib/ and app/ only.
 *
 * Deliberately without a single capsule or badge: the owner's constraint. An
 * active filter is lighter, bolder and underlined; urgency is the accent colour
 * plus a thin rule down the left edge.
 *
 * The accent is --amber-500 rather than --accent. The latter exists but is
 * theme-dependent, near-white under :root and amber only under .dark, so it
 * would print white-on-dark rules on a light theme. --amber-500 is the stable
 * token the rest of the CRM already reads.
 */
export function MailList({
  input,
  selectedId,
  onSelect,
}: {
  input: RowsInput;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  // 'reply' rather than 'all': the column opens on what the day owes. Local
  // state, because nothing outside this column needs to know which filter is on.
  const [active, setActive] = useState<MailFilterKey>('reply');
  // The query narrows the rows below and never the counted filters: those read
  // the unnarrowed input, so the counts hold still while the operator types.
  // Both rules live in searchRows; this component only holds the input's state.
  const [q, setQ] = useState('');
  const filters = mailFilters(input);
  const rows = searchRows(mailRows(input, active), q);

  return (
    <div className="flex min-w-0 flex-col border-r border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      {/* The search the deleted contact list carried, restored as the column's
          first row. No capsule and no box, per the owner's idiom: a bordered
          row like the filter bar under it, and the border says focus the way
          the active filter says itself, by taking the accent colour. */}
      <div className="border-b border-[var(--ink-4)]/60 focus-within:border-[var(--amber-500)]/50">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher…"
          aria-label="Rechercher un contact"
          className="w-full min-w-0 bg-transparent px-4 py-2 text-[13.5px] text-[var(--fg-1)] placeholder:text-[var(--fg-3)] focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-4 border-b border-[var(--ink-4)]/60 px-4 pt-3">
        {filters.map((f) => {
          const on = f.key === active;
          const accent = f.key === 'reply';
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setActive(f.key)}
              // aria-pressed, not aria-current: this is a toggle, not a link
              // marking the current page. Same choice as the two columns this
              // replaces, and the state is otherwise carried by colour alone.
              aria-pressed={on}
              className={[
                'border-b-2 pb-[9px] text-[13.5px] whitespace-nowrap',
                on ? 'font-semibold' : '',
                accent
                  ? 'text-[var(--amber-500)]'
                  : on
                    ? 'text-[var(--fg-1)]'
                    : 'text-[var(--fg-3)]',
                on
                  ? accent
                    ? 'border-b-[var(--amber-500)]'
                    : 'border-b-[var(--fg-3)]'
                  : 'border-transparent',
              ].join(' ')}
            >
              {f.label} <span className="ml-1 tabular-nums opacity-75">{f.count}</span>
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {rows.length === 0 ? (
          // Two different absences: a filter can be empty, and a search can
          // empty a filter that is not. Blaming the filter while a query
          // stands would send the operator to the wrong control.
          <p className="px-4 py-6 text-center text-[13.5px] text-[var(--fg-3)]">
            {q.trim() ? 'Aucun contact ne correspond.' : 'Rien dans ce filtre.'}
          </p>
        ) : (
          rows.map((r) => {
            const on = r.id === selectedId;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => onSelect(r.id)}
                // Which row is open is otherwise said by a tint and a border
                // colour, so without this it is said by colour only.
                aria-pressed={on}
                className={[
                  'block w-full border-l-2 px-3.5 py-2.5 text-left',
                  on ? 'bg-white/5' : '',
                  r.urgent
                    ? on
                      ? 'border-l-[var(--amber-500)]'
                      : 'border-l-[var(--amber-500)]/45'
                    : on
                      ? 'border-l-[var(--fg-3)]'
                      : 'border-transparent',
                ].join(' ')}
              >
                <span className="flex items-baseline justify-between gap-2.5">
                  {/* min-w-0 as well as truncate: a flex child will not shrink
                      below its content without it, and `who` falls back to the
                      email address, which is one unbreakable token. The title
                      gives the full value back on hover, since clipping is the
                      only thing a 296px column can do with it. */}
                  <span
                    title={r.who}
                    className={`min-w-0 truncate text-sm text-[var(--fg-1)] ${
                      r.unread || on ? 'font-semibold' : ''
                    }`}
                  >
                    {r.who}
                  </span>
                  {/* Unread is said by weight alone, on the owner's rule: no
                      pill. Weight is silent to a screen reader, so the state
                      is written here invisibly, in the words the deleted
                      list's dot carried. Nothing becomes visible. */}
                  {r.unread && <span className="sr-only">Réponse non lue</span>}
                  <span
                    className={`shrink-0 text-[13.5px] tabular-nums ${
                      r.urgent ? 'text-[var(--amber-500)]' : 'text-[var(--fg-3)]'
                    }`}
                  >
                    {r.age}
                  </span>
                </span>
                <span
                  className={`mt-0.5 block truncate text-[13px] ${
                    r.unread ? 'font-medium text-[var(--fg-1)]' : 'text-[var(--fg-2)]'
                  }`}
                >
                  {r.subject}
                </span>
                <span className="mt-px block truncate text-[13.5px] text-[var(--fg-3)]">
                  {r.preview}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
