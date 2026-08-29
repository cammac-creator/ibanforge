'use client';

import { Fragment, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  mailFilters,
  searchRows,
  selectedRows,
  type MailRow,
  type RowSelection,
  type RowsInput,
} from '@/lib/crm/mail-rows';
import { REPLY_GROUP_LABEL } from '@/lib/crm/business';
import { flameOf } from '@/lib/crm/heat';
import { localDay } from '@/lib/crm/snooze';
import { kindWord, railColorOf, rowStatus, shortAge } from '@/lib/crm/table-view';
import { CrmToolbar } from './crm-toolbar';
import { NewInstitutionForm } from './new-institution';

/**
 * The contacts table: one bar, then every contact across the full width.
 *
 * It replaces a 296px column that carried the entire tool while three quarters
 * of the screen said "Sélectionne un contact". Nothing about the ROWS is new —
 * the same projection, the same sorts, the same search, the same hover and
 * swipe gestures — but a row now spends its width on columns that compare:
 * who, their last message, what state the thread is in, and how long it has
 * waited. The last of those is the one the operator scans; it is right-aligned
 * and tabular so a column of durations reads as a column.
 *
 * Holds no rule of its own, exactly as the list before it did not: it asks
 * mail-rows.ts what the filters and the rows are, table-view.ts how a row reads
 * in a narrow cell, and draws the answer. That split is what makes this half of
 * the screen testable, since the vitest config covers lib/ and app/ only.
 *
 * The accent is --amber-500 rather than --accent. The latter exists but is
 * theme-dependent, near-white under :root and amber only under .dark, so it
 * would print white-on-dark rules on a light theme. --amber-500 is the stable
 * token the rest of the CRM already reads.
 */

/** The +7 days quick-snooze target, in the operator's own calendar. */
function snoozeTarget(): string {
  return localDay(new Date(Date.now() + 7 * 86_400_000));
}

/**
 * The hover gestures: clear the day's queue without opening anything. Snooze
 * and archive need a prospect row to write on, so a client with no sourcing
 * only offers "lu". Every action refreshes the server payload afterwards —
 * the row's disappearance from the filter IS the confirmation.
 */
export async function rowAction(
  row: MailRow,
  kind: 'snooze' | 'archive' | 'read',
): Promise<boolean> {
  async function post(url: string, body: unknown): Promise<boolean> {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return r.ok;
    } catch {
      return false;
    }
  }
  if (kind === 'snooze' && row.prospectId) {
    return post('/api/crm/prospect-status', { id: row.prospectId, wakeUpAt: snoozeTarget() });
  }
  if (kind === 'archive' && row.prospectId) {
    return post('/api/crm/prospect-status', { id: row.prospectId, status: 'archive' });
  }
  if (kind === 'read' && row.email) {
    return post('/api/crm/thread-read', { email: row.email });
  }
  return false;
}

function RowActions({
  row,
  onDone,
  onBusy,
}: {
  row: MailRow;
  onDone: () => void;
  onBusy: (b: boolean) => void;
}) {
  async function act(kind: 'snooze' | 'archive' | 'read', e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (
      kind === 'archive' &&
      !window.confirm(`Archiver ${row.who} ? (statut terminal côté prospection)`)
    )
      return;
    onBusy(true);
    const ok = await rowAction(row, kind);
    onBusy(false);
    if (ok) onDone();
  }

  const btn =
    'rounded border border-[var(--ink-5)] bg-[var(--ink-1)] px-1.5 py-0.5 text-[11px] text-[var(--fg-2)] hover:border-[var(--amber-500)]/60 hover:text-[var(--fg-1)]';

  if (!row.prospectId && !row.unread) return null;

  return (
    // Over the last two columns, which hide themselves on hover (the age and
    // the unread dot both carry group-hover:invisible). A solid background
    // rather than a translucent one: these sit on top of a highlighted row.
    //
    // Below 900px the row is two lines and this stays centred on the pair, so
    // it covers the right end of the subject line while the pointer is on the
    // row. Accepted: the same cluster already covers the age and the dot, the
    // occlusion lasts exactly as long as the hover, and a phone — the width
    // this breakpoint is for — has no hover at all.
    <span className="pointer-events-none absolute right-1.5 top-1/2 hidden -translate-y-1/2 gap-1 rounded-md bg-[var(--ink-1)] p-0.5 shadow-lg group-hover:flex">
      <span className="pointer-events-auto flex gap-1">
        {row.prospectId && (
          <button
            type="button"
            className={btn}
            title="Mettre en veille 7 jours"
            onClick={(e) => act('snooze', e)}
          >
            💤 7 j
          </button>
        )}
        {row.prospectId && (
          <button
            type="button"
            className={btn}
            title="Archiver (terminal)"
            onClick={(e) => act('archive', e)}
          >
            📥
          </button>
        )}
        {row.unread && (
          <button
            type="button"
            className={btn}
            title="Marquer lu sans ouvrir"
            onClick={(e) => act('read', e)}
          >
            ✓ lu
          </button>
        )}
      </span>
    </span>
  );
}

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: 'haute', cls: 'text-[var(--ok,#22c55e)]' },
  medium: { label: 'moy.', cls: 'text-[var(--amber-500)]' },
  low: { label: 'faible', cls: 'text-[var(--err,#ef4444)]' },
};

/**
 * The six columns, written once and worn by both the header and every row.
 *
 * Below 900px the grid narrows to four tracks and the thread's state folds
 * away — it is one of five words, re-read in a breath inside the drawer. What
 * does NOT fold is the last message: the list this table replaces showed the
 * subject and the preview at 375px, on two extra lines under the name, and
 * losing them would mean triaging a phone screen by opening every contact. It
 * moves to a second line instead (CELLS below), which is where those two lines
 * already were.
 *
 * The header wears this too, and stays one line: `display:none` removes a
 * folded span from grid placement altogether, so what is left flows into the
 * four tracks on its own.
 */
const GRID =
  'grid items-center gap-x-3.5 max-[900px]:gap-y-0.5 grid-cols-[3px_15rem_1fr_9.5rem_5.5rem_1.75rem] max-[900px]:grid-cols-[3px_1fr_5rem_1.75rem]';

/** Folded away with the column it belongs to. */
const FOLDS = 'max-[900px]:hidden';

/**
 * Where each cell of a ROW sits once the grid narrows.
 *
 * Explicit rather than left to auto-placement, and only on the rows: the
 * subject cell stops being `display:none` under 900px, so it would otherwise
 * take the third track of the first line and push the age and the dot onto a
 * line of their own. Written as coordinates, the row reads
 *
 *     rail | who        age  •
 *          | subject — preview
 */
const AT = {
  rail: 'max-[900px]:row-span-2 max-[900px]:h-auto max-[900px]:self-stretch',
  who: 'max-[900px]:col-start-2 max-[900px]:row-start-1',
  message: 'max-[900px]:col-start-2 max-[900px]:col-span-3 max-[900px]:row-start-2',
  age: 'max-[900px]:col-start-3 max-[900px]:row-start-1',
  dot: 'max-[900px]:col-start-4 max-[900px]:row-start-1',
};

export function ContactTable({
  input,
  selectedId,
  onSelect,
  initialSelection,
}: {
  input: RowsInput;
  selectedId: string | null;
  onSelect: (id: string, trigger?: HTMLElement | null) => void;
  /** Deep-linked landing selection (e.g. the Prospects nav entry). */
  initialSelection?: RowSelection;
}) {
  const router = useRouter();
  // The day's work rather than the whole base: the page opens on what it owes,
  // which is what the single-key list did with 'reply' as its default. Local
  // state, because nothing outside this table needs to know what is pressed.
  const [selection, setSelection] = useState<RowSelection>(
    initialSelection ?? { population: 'all', work: 'reply' },
  );
  // The query narrows the rows below and never the counted filters: those read
  // the unnarrowed input, so the counts hold still while the operator types.
  // Both rules live in searchRows; this component only holds the input's state.
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const filters = useMemo(() => mailFilters(input), [input]);
  // Memoised on purpose. The projection sorts the base, scores heat and folds
  // a search haystack per contact, and this component re-renders on every
  // keystroke and every hover-driven busy flip; without the memo the whole
  // table would be rebuilt to redraw one highlighted row.
  const rows = useMemo(() => searchRows(selectedRows(input, selection), q), [input, selection, q]);

  // Touch swipe: left = snooze (needs a prospect row), right = mark read
  // (needs an unread thread). 64px of travel commits; less snaps back. Held
  // as (id, dx) so only the touched row translates.
  const touch = useRef<{ id: string; x: number } | null>(null);
  const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);

  function onTouchStart(id: string, e: React.TouchEvent) {
    touch.current = { id, x: e.touches[0].clientX };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!touch.current) return;
    const dx = e.touches[0].clientX - touch.current.x;
    if (Math.abs(dx) > 8) setDrag({ id: touch.current.id, dx: Math.max(-96, Math.min(96, dx)) });
  }
  async function onTouchEnd() {
    const d = drag;
    touch.current = null;
    setDrag(null);
    if (!d || Math.abs(d.dx) < 64) return;
    const row = rows.find((r) => r.id === d.id);
    if (!row) return;
    const kind = d.dx < 0 ? 'snooze' : 'read';
    if (kind === 'snooze' && !row.prospectId) return;
    if (kind === 'read' && !row.unread) return;
    setBusy(true);
    const ok = await rowAction(row, kind);
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      <CrmToolbar
        filters={filters}
        selection={selection}
        onSelection={setSelection}
        query={q}
        onQuery={setQ}
      />

      {/* Only under Correspondants. Registering an address is the gesture that
          segment is FOR — nothing else on this page can make an institution's
          thread appear — and it would be noise above the day's reply queue. */}
      {selection.population === 'institution' && <NewInstitutionForm />}

      {/* Decorative: the row below is a button whose content already reads in
          this order, and a screen reader announcing six column names before
          every one of two hundred rows would bury the rows. */}
      <div
        aria-hidden
        className={`${GRID} border-b border-[var(--ink-4)]/60 px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--fg-4)]`}
      >
        <span />
        <span>Contact</span>
        <span className={FOLDS}>Dernier message</span>
        <span className={FOLDS}>Statut</span>
        <span className="text-right">Attente</span>
        <span className="text-center" title="Non lu">
          •
        </span>
      </div>

      <div className={busy ? 'opacity-60' : ''}>
        {rows.length === 0 ? (
          // Three different absences: a search can empty a view that is not
          // empty, the correspondents' segment is empty until an address is
          // registered, and a composed view can simply hold nobody. Blaming the
          // wrong control would send the operator to the wrong place.
          <p className="px-4 py-10 text-center text-[13.5px] text-[var(--fg-3)]">
            {q.trim()
              ? 'Aucun contact ne correspond.'
              : selection.population === 'institution' && !selection.work && !selection.refine
                ? 'Aucun correspondant enregistré. Ajoute une adresse pour que son fil remonte ici.'
                : 'Personne dans cette sélection.'}
          </p>
        ) : (
          rows.map((r, i) => {
            const on = r.id === selectedId;
            // A shelf label above the first row of each group. The rows arrive
            // already ordered urgent → week → later (see mail-rows), so this
            // only ever cuts the sequence.
            const shelf =
              r.group && r.group !== rows[i - 1]?.group ? REPLY_GROUP_LABEL[r.group] : null;
            const flame = flameOf(r.heat);
            const status = rowStatus(r);
            const confidence =
              selection.refine === 'prospect' && r.confidence
                ? CONFIDENCE_BADGE[r.confidence]
                : null;
            return (
              // The shelf is a SIBLING of the row's positioned wrapper, not a
              // child of it. Inside, it would stretch the box the hover actions
              // are centred in, and `top-1/2` would place them halfway down
              // shelf-plus-row — riding up into the label on the first row of
              // every band, which on the landing view is three rows out of the
              // first dozen.
              <Fragment key={r.id}>
                {shelf && (
                  <p className="border-y border-[var(--ink-4)]/40 bg-white/[0.02] px-3 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em] text-[var(--fg-3)]">
                    {shelf}
                  </p>
                )}
                {/* data-crm-row on the WRAPPER, not on the button. It is what
                    the drawer's outside-click rule looks for
                    (contact-drawer.tsx), and the hover actions are a sibling of
                    the button rather than a child of it: carried by the button
                    alone, `closest()` never matched them and triaging a row
                    while reading a fiche closed the fiche. The wrapper is the
                    row's territory — the button and its actions both. */}
                <div className="group relative" data-crm-row>
                  <button
                    type="button"
                    onClick={(e) => onSelect(r.id, e.currentTarget)}
                    onTouchStart={(e) => onTouchStart(r.id, e)}
                    onTouchMove={onTouchMove}
                    onTouchEnd={onTouchEnd}
                    style={
                      drag?.id === r.id
                        ? { transform: `translateX(${drag.dx}px)`, transition: 'none' }
                        : undefined
                    }
                    aria-pressed={on}
                    className={`${GRID} w-full border-b border-[var(--ink-4)]/40 px-3 py-2 text-left ${
                      on ? 'bg-white/[0.07]' : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    {/* The kind, as the one mark every row carries. Chips are
                      deliberately rare (business.ts), so without this an
                      ordinary active client would be an unlabelled line. */}
                    <span
                      aria-hidden
                      className={`h-[2.1em] w-[3px] rounded-sm ${AT.rail}`}
                      style={{ backgroundColor: railColorOf(r.kind) }}
                    />

                    <span className={`flex min-w-0 items-baseline gap-1.5 ${AT.who}`}>
                      <span className="sr-only">{kindWord(r.kind)} : </span>
                      {/* min-w-0 as well as truncate: a flex child will not shrink
                        below its content without it, and `who` falls back to the
                        email address, which is one unbreakable token. */}
                      <span
                        title={r.who}
                        className={`min-w-0 truncate text-[13.5px] text-[var(--fg-1)] ${
                          r.unread || on ? 'font-semibold' : ''
                        }`}
                      >
                        {r.who}
                      </span>
                      {/* Unread is said by weight and by the dot; the words live
                        here for a screen reader, invisible on screen. */}
                      {r.unread && <span className="sr-only">Réponse non lue</span>}
                      {/* The return of a sleeper: its wake date arrived. Ahead of
                        the business chip because the date is why the row is
                        here today, whatever else the row is. */}
                      {r.woke && (
                        <span
                          title="Sa date de réveil est arrivée"
                          className="shrink-0 self-center rounded bg-violet-500/15 px-1 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-violet-300"
                        >
                          {/* The word the deleted list printed in full, kept
                              for the readers a `title` never reaches: it does
                              not appear on touch and is not reliably announced,
                              and this badge is the row's only explanation of
                              why it leads its queue. */}
                          <span className="sr-only">Réveillé : sa date de réveil est arrivée</span>
                          <span aria-hidden>⏰</span>
                        </span>
                      )}
                      {/* A closed dossier met outside its own filter (under
                          Tous, Prospects…) must say why it is not in the day's
                          queues, or the operator re-reads a thread he already
                          judged. */}
                      {r.closed && (
                        <span
                          title="Dossier classé (pas intéressé / mauvaise personne) — un nouveau message de sa part le rouvrira"
                          className="shrink-0 self-center rounded bg-zinc-500/15 px-1 py-0.5 text-[9.5px] font-bold uppercase tracking-wide text-zinc-400"
                        >
                          classé
                        </span>
                      )}
                      {r.chip && (
                        <span
                          className="shrink-0 self-center rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                          style={{ color: r.chip.color, backgroundColor: r.chip.bg }}
                        >
                          {r.chip.label}
                        </span>
                      )}
                      {flame && (
                        <span
                          className={`shrink-0 text-[11px] ${flame.dim ? 'opacity-45' : ''}`}
                          title={`Chaleur ${r.heat}/100 — détail dans le dossier`}
                        >
                          {flame.glyph}
                        </span>
                      )}
                    </span>

                    {/* The last message, readable without opening anything: what
                      it was about, then how it started. Third column on a wide
                      screen, second line under the name below 900px — the shape
                      the deleted list had at 375px. */}
                    <span className={`${AT.message} min-w-0 truncate text-[12.5px]`}>
                      <span className={r.unread ? 'text-[var(--fg-1)]' : 'text-[var(--fg-2)]'}>
                        {r.subject}
                      </span>
                      {r.preview && <span className="text-[var(--fg-4)]"> — {r.preview}</span>}
                    </span>

                    {/* What the thread is waiting for, in the words its kind
                      calls for. Same five states as the banner in the drawer,
                      shortened, never renamed. */}
                    <span className={`${FOLDS} min-w-0`}>
                      <span
                        className={`inline-block max-w-full truncate rounded-full border px-1.5 py-px text-[11px] ${
                          status.pressing
                            ? 'border-[var(--amber-500)]/50 text-[var(--amber-500)]'
                            : 'border-[var(--ink-4)] text-[var(--fg-3)]'
                        }`}
                      >
                        {status.label}
                      </span>
                    </span>

                    {/* The column the eye scans. Under the prospecting chip a
                      never-contacted row has no silence to show, so it shows
                      what does rank it there instead — same swap the column
                      list made. */}
                    {confidence ? (
                      <span
                        className={`${AT.age} truncate text-right text-[11.5px] group-hover:invisible ${confidence.cls}`}
                      >
                        {confidence.label}
                      </span>
                    ) : (
                      <span
                        className={`${AT.age} text-right font-mono text-[12px] tabular-nums group-hover:invisible ${
                          r.urgent ? 'text-[var(--amber-500)]' : 'text-[var(--fg-4)]'
                        }`}
                      >
                        {shortAge(r.age)}
                      </span>
                    )}

                    <span aria-hidden className={`${AT.dot} text-center group-hover:invisible`}>
                      {r.unread && (
                        <span className="inline-block h-2 w-2 rounded-full bg-[var(--amber-500)]" />
                      )}
                    </span>
                  </button>
                  <RowActions row={r} onBusy={setBusy} onDone={() => router.refresh()} />
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
