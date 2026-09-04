'use client';

import { useState } from 'react';

import type { MailFilter, MailFilterKey, RowSelection } from '@/lib/crm/mail-rows';
import { POPULATION_KEYS, REFINE_KEYS, WORK_KEYS, segmentLabel } from '@/lib/crm/table-view';

/**
 * The one bar above the contacts table: search, the day's work, who, and a
 * refinement. Full width, four groups, and it wraps rather than scrolls — with
 * one exception, the segmented control, which is a single atom too wide for a
 * phone and therefore pans inside its own box. Wrapping is for the bar; the
 * page itself never moves sideways.
 *
 * It replaces a row of eleven equal tabs in a 296px column, where "À répondre"
 * and "Payants" looked like the same kind of thing and the eleventh had to be
 * hunted for. The three groups are not decoration: they are the three
 * independent axes selectedRows() intersects, drawn so that the axis is visible
 * before the click.
 *
 *   tiles      what the day OWES — countable work, toggles on and off
 *   segment    WHO — exactly one, always
 *   chips      a refinement over the two above — at most one
 *
 * Every count comes from mailFilters(), read against the whole base and never
 * against what is currently shown: "À répondre 9" means nine threads are
 * waiting on us, whatever segment is pressed. See mail-rows.ts.
 *
 * No rule of its own, same discipline as the list this grew out of: which key
 * belongs in which group lives in lib/crm/table-view.ts, where a test can prove
 * the three groups still cover every filter.
 */

/**
 * The counted work tiles. Amber while there is something in them, quiet at
 * zero: a tile shouting "Relances 0" trains the eye to stop reading tiles.
 */
function WorkTile({
  filter,
  on,
  onToggle,
}: {
  filter: MailFilter;
  on: boolean;
  onToggle: () => void;
}) {
  const empty = filter.count === 0;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      // Two signals that used to share one colour: « there is work » (an
      // amber count) and « I am filtering on this » (an amber outline two
      // pixels wide). Pressed is now a solid tile with its own cross; unpressed
      // is a border, whatever the count.
      className={[
        'flex shrink-0 items-baseline gap-1.5 rounded-lg border px-2.5 py-1 transition-colors',
        on
          ? 'border-[var(--amber-500)] bg-[var(--amber-500)] text-[var(--ink-0)]'
          : empty
            ? 'border-[var(--ink-4)] bg-transparent hover:border-[var(--ink-5)]'
            : 'border-[var(--amber-500)]/50 bg-transparent hover:bg-[var(--amber-500)]/[0.08]',
      ].join(' ')}
    >
      <span
        className={`text-[11.5px] font-semibold ${
          on ? 'text-[var(--ink-0)]' : empty ? 'text-[var(--fg-4)]' : 'text-[var(--amber-500)]'
        }`}
      >
        {filter.label}
      </span>
      <span
        className={`font-mono text-[15px] font-semibold tabular-nums ${on ? 'text-[var(--ink-0)]' : 'text-[var(--fg-1)]'}`}
      >
        {filter.count}
      </span>
      {on && (
        <span aria-hidden className="text-[11px] font-bold text-[var(--ink-0)]/80">
          ✕
        </span>
      )}
    </button>
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
  const byKey = new Map(filters.map((f) => [f.key, f]));
  const filterOf = (key: MailFilterKey): MailFilter =>
    byKey.get(key) ?? { key, label: key, count: 0 };

  /** A tile and a chip toggle; the segment cannot be emptied. */
  const toggle = (axis: 'work' | 'refine', key: MailFilterKey) =>
    onSelection({ ...selection, [axis]: selection[axis] === key ? null : key });

  // Under sm the six chips cost two rows above a list that starts past half
  // the screen; they fold behind one word, and unfold by themselves when one
  // is pressed so a filter never hides the control that armed it.
  const [refineOpen, setRefineOpen] = useState(false);
  const refineShown = refineOpen || !!selection.refine;

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

      {WORK_KEYS.map((key) => {
        const filter = filterOf(key);
        // Brouillons only exists when one is waiting. An empty queue of unsent
        // mails is not a fact worth a permanent tile, and its absence is
        // itself the answer to "have I left anything unsent".
        //
        // Unless it is the pressed one, and that clause is the whole ordinary
        // path: press Brouillons, open the draft, send it, the payload
        // refreshes and the count falls to zero. Without it the tile would
        // vanish while still selected, leaving an empty table, no lit control
        // anywhere on the bar, and no way to un-press what cannot be seen. A
        // tile reading "Brouillons 0" while it is the selection is honest; an
        // invisible selection is not.
        if (key === 'drafts' && filter.count === 0 && selection.work !== 'drafts') return null;
        return (
          <WorkTile
            key={key}
            filter={filter}
            on={selection.work === key}
            onToggle={() => toggle('work', key)}
          />
        );
      })}

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

      {/* The refinements. Quiet on purpose: they narrow, they do not announce. */}
      <button
        type="button"
        onClick={() => setRefineOpen((o) => !o)}
        aria-expanded={refineShown}
        className="text-[12px] text-[var(--fg-3)] underline decoration-dotted underline-offset-2 sm:hidden"
      >
        {refineShown ? 'Affiner ▴' : 'Affiner ▾'}
      </button>
      <div
        role="group"
        aria-label="Affiner"
        className={`${refineShown ? 'flex' : 'hidden'} flex-wrap items-center gap-1.5 sm:flex`}
      >
        {REFINE_KEYS.map((key) => {
          const filter = filterOf(key);
          const on = selection.refine === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle('refine', key)}
              aria-pressed={on}
              className={[
                'shrink-0 rounded-full border px-2 py-0.5 text-[11.5px] whitespace-nowrap transition-colors',
                on
                  ? 'border-[var(--amber-500)]/60 bg-[var(--amber-500)]/10 text-[var(--amber-500)]'
                  : 'border-[var(--ink-4)] text-[var(--fg-3)] hover:border-[var(--ink-5)] hover:text-[var(--fg-2)]',
                // A colour that is measured, not an opacity that is not: at
                // opacity-50 × opacity-70 a zero count sat at 1.9:1.
                filter.count === 0 && !on ? 'text-[var(--fg-4)]' : '',
              ].join(' ')}
            >
              {filter.label}
              <span className={`ml-1 font-mono tabular-nums ${on ? '' : 'text-[var(--fg-4)]'}`}>
                {filter.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
