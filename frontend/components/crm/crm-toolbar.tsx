'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';

import type { MailFilter, MailFilterKey, RowSelection } from '@/lib/crm/mail-rows';
import {
  POPULATION_KEYS,
  REFINE_KEYS,
  WORK_KEYS,
  segmentLabel,
  selectLabel,
} from '@/lib/crm/table-view';
import { localePath } from '@/lib/locale-path';

/**
 * The one bar above the contacts table: search, who, what the day owes, a
 * refinement, and the way out to the journal.
 *
 * ## What it is not, any more
 *
 * It carried fourteen buttons in one row — three counted tiles, four segments,
 * seven chips — and the owner reported on 07/09/2026 that he could not find
 * anything in it: « à répondre, relance, brouillons, tous, clients, prospects,
 * correspondants, nouveau, payant, à la limite, endormis, jamais écrit, à
 * enrichir, classés ». Read out loud, that is the whole complaint. Grouping
 * them into three axes had made the axes visible; it had not made the bar
 * shorter, and eleven of those fourteen were controls consulted on the day a
 * question comes up, each spending width every other day of the year.
 *
 * ## What survives, and why
 *
 * The MODEL is untouched: selectedRows() still intersects three independent
 * axes, the counts still come from mailFilters() read against the whole base,
 * and lib/crm/table-view.ts still owns which key belongs to which axis, where a
 * test can prove the three groups cover every filter. Only the drawing changed.
 *
 *   segment    WHO — exactly one, always. It stays a segment because four
 *              short words that are all worth seeing is precisely the case a
 *              segmented control is for, and it is the axis moved most.
 *   « À faire »   the day's three counted queues, one control, one value.
 *   « Affiner »   the seven retrieval paths, likewise.
 *
 * A dropdown states its current value without spending a row on the six it is
 * not, which is the one thing a row of chips cannot do. The counts ride in the
 * option text, so the numbers that made the tiles worth reading are still there
 * — « À répondre (9) » — one glance further away.
 */

/**
 * One axis behind one control: a dropdown showing its current value, or « — »
 * when the axis asks nothing.
 *
 * The empty option is the axis's OFF switch, and it is why this is a select and
 * not a listbox of pressed buttons: the chip that toggled itself off is gone,
 * so the way back to "no refinement" has to be a value like any other rather
 * than a second click on the thing already chosen.
 */
function FilterSelect({
  label,
  keys,
  filterOf,
  value,
  onChange,
}: {
  /** The axis, in words. Visible: a bare dropdown says nothing about what it filters. */
  label: string;
  keys: readonly MailFilterKey[];
  filterOf: (key: MailFilterKey) => MailFilter;
  value: MailFilterKey | null;
  onChange: (next: MailFilterKey | null) => void;
}) {
  const on = value !== null;
  return (
    // A <label> around the control rather than an aria-label on it: the word is
    // on screen anyway, and wrapping makes it the accessible name and the
    // click target at once.
    <label className="flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium text-[var(--fg-4)]">
      {label}
      <select
        value={value ?? ''}
        // The empty string is the only value that is not a key, so it is the
        // only one that can mean "nothing". Cast once, here.
        onChange={(e) => onChange((e.target.value || null) as MailFilterKey | null)}
        className={[
          'rounded-lg border bg-[var(--ink-0)] px-2 py-1.5 text-[12.5px] transition-colors focus:outline-none',
          // Lit when it is doing something. The old tiles said « I am
          // filtering on this » with an amber outline; a dropdown that looks
          // identical whether it holds « — » or « Brouillons » would hide the
          // very state the operator has to be able to undo.
          on
            ? 'border-[var(--amber-500)]/60 text-[var(--amber-500)]'
            : 'border-[var(--ink-4)] text-[var(--fg-2)] focus:border-[var(--amber-500)]/50',
        ].join(' ')}
      >
        <option value="">—</option>
        {keys.map((key) => {
          const filter = filterOf(key);
          return (
            <option key={key} value={key}>
              {selectLabel(key, filter.label)} ({filter.count})
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function CrmToolbar({
  filters,
  selection,
  onSelection,
  query,
  onQuery,
}: {
  /** mailFilters(input) — absolute counts, one per key. */
  filters: MailFilter[];
  selection: RowSelection;
  onSelection: (next: RowSelection) => void;
  query: string;
  onQuery: (next: string) => void;
}) {
  const locale = useLocale();
  const byKey = new Map(filters.map((f) => [f.key, f]));
  const filterOf = (key: MailFilterKey): MailFilter =>
    byKey.get(key) ?? { key, label: key, count: 0 };

  /**
   * Brouillons only exists when one is waiting. An empty queue of unsent mails
   * is not a fact worth a permanent option, and its absence is itself the
   * answer to "have I left anything unsent".
   *
   * Unless it is the current value, and that clause is the whole ordinary path:
   * choose Brouillons, open the draft, send it, the payload refreshes and the
   * count falls to zero. Dropped then, the select would hold a value matching
   * no option — which a browser renders as blank, or by snapping to the first
   * option, so the control would either lie about what it is filtering on or
   * silently change the filter. An option reading « Brouillons (0) » while it
   * is the selection is honest; an invisible selection is not.
   */
  const workKeys = WORK_KEYS.filter(
    (key) => key !== 'drafts' || filterOf(key).count > 0 || selection.work === 'drafts',
  );

  return (
    // Sticky on a phone: scrolling the list used to scroll the search and the
    // filters away, and coming back to them meant coming back to the top.
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-[var(--ink-4)]/60 bg-[var(--ink-2)] px-3 py-2.5 sm:static sm:bg-transparent">
      <input
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Rechercher (nom, adresse, contenu)…"
        aria-label="Rechercher un contact"
        className="min-w-[180px] flex-1 basis-[220px] rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-2.5 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:border-[var(--amber-500)]/50 focus:outline-none sm:text-[13px]"
      />

      {/* Who. One press always stands, so this control has no empty state.

          Two elements and not one. The inner one is the control: it is what
          carries the border and the rounded corners, and its overflow-hidden is
          what clips the four buttons to that radius, so it cannot be the thing
          that scrolls — the border would scroll with them. The outer one is a
          viewport onto it: `max-w-full` caps it at the bar's own width and
          `min-w-0` lets it be capped at all (a flex item will not shrink below
          its content otherwise), and `overflow-x-auto` turns the overflow into
          a pan instead of a cut.

          Measured need: the four buttons and their counts run 352-379px, while
          the bar offers 262px at 320px of viewport, 317px at 375px and 332px at
          390px. Without this, "Correspondants" was cropped mid-label — its
          count invisible, a ~30px sliver at 320px — inside an ancestor that
          clips rather than scrolls (contact-table.tsx), so it could not be
          reached at all. The PAGE must never pan sideways; a control may. */}
      <div className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--ink-5)]">
        <div
          role="group"
          aria-label="Population"
          className="flex w-max overflow-hidden rounded-lg border border-[var(--ink-4)]"
        >
          {POPULATION_KEYS.map((key) => {
            const filter = filterOf(key);
            const on = selection.population === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelection({ ...selection, population: key })}
                aria-pressed={on}
                className={[
                  'shrink-0 border-r border-[var(--ink-4)] px-2.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap last:border-r-0 transition-colors',
                  on
                    ? 'bg-[var(--ink-3)] text-[var(--fg-1)] shadow-[inset_0_-2px_0_var(--amber-500)]'
                    : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]',
                ].join(' ')}
              >
                {segmentLabel(key, filter.label)}
                <span className="ml-1 font-mono text-[11px] font-normal tabular-nums text-[var(--fg-4)]">
                  {filter.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <FilterSelect
        label="À faire"
        keys={workKeys}
        filterOf={filterOf}
        value={selection.work ?? null}
        onChange={(work) => onSelection({ ...selection, work })}
      />

      <FilterSelect
        label="Affiner"
        keys={REFINE_KEYS}
        filterOf={filterOf}
        value={selection.refine ?? null}
        onChange={(refine) => onSelection({ ...selection, refine })}
      />

      {/* The way out to the journal, and the reason the bar can afford to be
          this short: "what went out, and did I send it" is a different question
          from "who do I answer next", and it now has its own page instead of
          being a filter here. */}
      <Link
        href={localePath(locale, '/dashboard/courrier')}
        className="ml-auto shrink-0 text-[12px] text-[var(--fg-3)] underline decoration-dotted underline-offset-2 hover:text-[var(--fg-1)]"
      >
        Courrier ↗
      </Link>
    </div>
  );
}
