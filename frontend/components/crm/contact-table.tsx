'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  type MailFilterKey,
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
import { Archive, BellOff, Check, Clock3, MoreHorizontal, SearchX } from 'lucide-react';
import styles from './workspace.module.css';

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
  kind: 'snooze' | 'archive' | 'read' | 'noreply',
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
  // The same message the drawer's control marks: lastInboundMessage picks it
  // on both roads, so the badge, the band and this gesture cannot disagree.
  if (kind === 'noreply' && row.lastInboundId) {
    return post('/api/crm/no-reply', { id: row.lastInboundId, value: true });
  }
  if (kind === 'read' && row.email) {
    return post('/api/crm/thread-read', { email: row.email });
  }
  return false;
}

function RowActions({
  row,
  onDone,
  onError,
}: {
  row: MailRow;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [pending, setPending] = useState(false);
  const canNoReply = row.nextAction === 'reply' && !!row.lastInboundId;
  if (!row.prospectId && !row.unread && !canNoReply) return null;

  async function act(kind: 'snooze' | 'archive' | 'read' | 'noreply') {
    if (pending) return;
    if (kind === 'archive' && !window.confirm(`Archiver ${row.who} ?`)) return;
    setPending(true);
    onError('');
    const ok = await rowAction(row, kind);
    setPending(false);
    if (ok) {
      if (menu.current) menu.current.open = false;
      onDone();
    } else {
      onError('Cette action n’a pas pu être enregistrée. Réessaie dans un instant.');
    }
  }

  return (
    <details ref={menu} className={styles.actions} name="contact-row-actions">
      <summary aria-label={`Actions pour ${row.who}`}>
        <MoreHorizontal size={18} aria-hidden />
      </summary>
      <div className={styles.actionMenu}>
        {row.unread && (
          <button type="button" disabled={pending} onClick={() => void act('read')}>
            <Check size={16} aria-hidden />
            Marquer comme lu
          </button>
        )}
        {canNoReply && (
          <button type="button" disabled={pending} onClick={() => void act('noreply')}>
            <BellOff size={16} aria-hidden />
            Rien à répondre
          </button>
        )}
        {row.prospectId && (
          <button type="button" disabled={pending} onClick={() => void act('snooze')}>
            <Clock3 size={16} aria-hidden />
            Mettre en veille 7 jours
          </button>
        )}
        {row.prospectId && (
          <button type="button" disabled={pending} onClick={() => void act('archive')}>
            <Archive size={16} aria-hidden />
            Archiver
          </button>
        )}
      </div>
    </details>
  );
}

const CONFIDENCE_BADGE: Record<string, { label: string; cls: string }> = {
  high: { label: 'haute', cls: 'text-[var(--ok,#22c55e)]' },
  medium: { label: 'moy.', cls: 'text-[var(--amber-500)]' },
  low: { label: 'faible', cls: 'text-[var(--err,#ef4444)]' },
};

/** La grille suit la largeur disponible, y compris à côté de la navigation. */
const GRID = styles.grid;
const FOLDS = styles.desktop;
const AT = { rail: styles.avatar, who: styles.who, message: styles.message, age: styles.age, dot: styles.dot };

export function ContactTable({
  input,
  selectedId,
  onSelect,
  onRowsChange,
  initialSelection,
}: {
  input: RowsInput;
  selectedId: string | null;
  onSelect: (id: string, trigger?: HTMLElement | null) => void;
  /** The rows as ordered and filtered here, so the drawer can offer « suivant ». */
  onRowsChange?: (ids: string[]) => void;
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
  const [actionError, setActionError] = useState('');

  const filters = useMemo(() => mailFilters(input), [input]);
  const queueCounts = useMemo(() => Object.fromEntries(
    [null, 'reply', 'followup', 'drafts'].map((work) => [work ?? 'all', selectedRows(input, {
      ...selection, work: work as MailFilterKey | null,
    }).length]),
  ), [input, selection]);
  // Memoised on purpose. The projection sorts the base, scores heat and folds
  // a search haystack per contact, and this component re-renders on every
  // keystroke and every hover-driven busy flip; without the memo the whole
  // table would be rebuilt to redraw one highlighted row.
  const liveRows = useMemo(
    () => searchRows(selectedRows(input, selection), q),
    [input, selection, q],
  );

  // While a file is open, the order and the shelves are frozen as they were
  // when it was opened. Reading a row clears its unread mark, which used to
  // re-sort it and move it from « urgent » to the freshest shelf under the
  // cursor, so the row one came from was never where one left it. Membership
  // is NOT frozen: a row that leaves the filter (an answer sent) still
  // disappears, and that disappearance stays the confirmation the gesture
  // gives. Released when the file closes or the selection or the query moves.
  // The snapshot used to be a ref written during render, which is the one
  // thing the React Compiler rules refuse outright (react-hooks/refs, rules
  // turned on 2026-09-07). A memo keyed on « which file is open, under which
  // selection and which query » says exactly the same thing where React can
  // see it: the key changes when the freeze must be retaken, and only then.
  // `liveRows` is deliberately absent from the dependencies — re-reading it is
  // precisely what the freeze exists to prevent — so this memo carries meaning
  // rather than speed. Should React ever drop the cache, the cost is one
  // re-sorted list under the cursor, never a wrong row.
  const freezeKey = selectedId === null ? null : `${JSON.stringify(selection)}|${q}`;
  const frozen = useMemo(() => {
    if (freezeKey === null) return null;
    return {
      order: new Map(liveRows.map((r, i) => [r.id, i])),
      group: new Map(liveRows.map((r) => [r.id, r.group])),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freezeKey]);
  const rows = useMemo(() => {
    if (!frozen) return liveRows;
    return [...liveRows]
      .sort((a, b) => (frozen.order.get(a.id) ?? Infinity) - (frozen.order.get(b.id) ?? Infinity))
      .map((r) => (frozen.group.has(r.id) ? { ...r, group: frozen.group.get(r.id) ?? null } : r));
  }, [liveRows, frozen]);
  useEffect(() => {
    onRowsChange?.(rows.map((r) => r.id));
  }, [rows, onRowsChange]);


  return (
    <div className={styles.table}>
      <CrmToolbar
        filters={filters}
        queueCounts={queueCounts}
        selection={selection}
        onSelection={setSelection}
        query={q}
        onQuery={setQ}
      />

      <div className={styles.results} aria-live="polite" aria-atomic="true">
        <span>{rows.length} contact{rows.length > 1 ? 's' : ''} affiché{rows.length > 1 ? 's' : ''}</span>
        {[selection.population !== 'all' ? selection.population : null, selection.refine].filter((k): k is MailFilterKey => !!k).map((key) => (
          <button type="button" key={key} onClick={() => setSelection(key === selection.population ? { ...selection, population: 'all' } : { ...selection, refine: null })}
            aria-label={`Retirer le filtre ${filters.find((f) => f.key === key)?.label ?? key}`}>
            {filters.find((f) => f.key === key)?.label ?? key} ×
          </button>
        ))}
      </div>
      {actionError && <p role="alert" className="border-b border-red-400/30 bg-red-500/10 p-3 text-sm text-red-300">{actionError}</p>}
      {/* Only under Correspondants. Registering an address is the gesture that
          segment is FOR — nothing else on this page can make an institution's
          thread appear — and it would be noise above the day's reply queue. */}
      {selection.population === 'institution' && <NewInstitutionForm />}

      {/* Decorative: the row below is a button whose content already reads in
          this order, and a screen reader announcing six column names before
          every one of two hundred rows would bury the rows. */}
      <div
        aria-hidden
        className={`${GRID} ${styles.columns} border-b border-[var(--ink-4)]/60 px-3 py-1.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-[var(--fg-4)]`}
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

      <div>
        {rows.length === 0 ? (
          // Three different absences: a search can empty a view that is not
          // empty, the correspondents' segment is empty until an address is
          // registered, and a composed view can simply hold nobody. Blaming the
          // wrong control would send the operator to the wrong place.
          <div className="px-4 py-10 text-center text-[13.5px] text-[var(--fg-3)]">
            {q.trim() ? (
              <><SearchX size={30} className="mx-auto mb-3 text-[var(--fg-4)]" aria-hidden /><p>Aucun contact ne correspond à cette recherche.</p><button type="button" onClick={() => setQ('')} className={styles.reset}>Effacer la recherche</button></>
            ) : selection.population === 'institution' && !selection.work && !selection.refine ? (
              'Aucun correspondant enregistré. Ajoute une adresse pour que son fil remonte ici.'
            ) : selection.work || selection.refine ? (
              // The controls that emptied the view, named, each with its own
              // way out. « Correspondants 16 » above zero rows with an « À faire »
              // queue still armed from the previous session read as a broken tool:
              // the counts are absolute, the view is an intersection, and only
              // this sentence says so.
              <>
                <p>
                  Aucun contact ne réunit{' '}
                  {[selection.population, selection.work, selection.refine]
                    .filter((k): k is MailFilterKey => !!k && k !== 'all')
                    .map((k) => filters.find((f) => f.key === k)?.label ?? k)
                    .map((label, i) => (
                      <span key={label}>
                        {i > 0 ? ' + ' : ''}
                        <strong className="text-[var(--fg-1)]">{label}</strong>
                      </span>
                    ))}
                  .
                </p>
                <p className="mt-2 flex flex-wrap justify-center gap-2 text-[12.5px]">
                  {selection.work && (
                    <button
                      type="button"
                      onClick={() => setSelection({ ...selection, work: null })}
                      className="rounded border border-[var(--ink-4)] px-2 py-0.5 hover:text-[var(--fg-1)]"
                    >
                      retirer {filters.find((f) => f.key === selection.work)?.label}
                    </button>
                  )}
                  {selection.refine && (
                    <button
                      type="button"
                      onClick={() => setSelection({ ...selection, refine: null })}
                      className="rounded border border-[var(--ink-4)] px-2 py-0.5 hover:text-[var(--fg-1)]"
                    >
                      retirer {filters.find((f) => f.key === selection.refine)?.label}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setSelection({ population: 'all' })}
                    className="rounded border border-[var(--ink-4)] px-2 py-0.5 hover:text-[var(--fg-1)]"
                  >
                    tout remettre à zéro
                  </button>
                </p>
              </>
            ) : (
              'Personne dans cette sélection.'
            )}
          </div>
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
            // On the two prospecting refinements the right column ranks the row
            // rather than dating it; a file with no address says so, in the place the
            // eye already reads, instead of opening on « envoi impossible ».
            const confidence =
              (selection.refine === 'prospect' || selection.refine === 'enrich') && !r.email
                ? { label: 'sans adresse', cls: 'text-[var(--amber-500)]' }
                : (selection.refine === 'prospect' || selection.refine === 'enrich') && r.confidence
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
                    aria-pressed={on}
                    className={`${GRID} ${styles.row} w-full border-b border-[var(--ink-4)]/50 text-left ${
                      on ? 'bg-white/[0.04]' : ''
                    }`}
                  >
                    {/* The kind, as the one mark every row carries. Chips are
                      deliberately rare (business.ts), so without this an
                      ordinary active client would be an unlabelled line. */}
                    <span
                      aria-hidden
                      className={AT.rail}
                      data-unread={r.unread || undefined}
                      style={{ color: railColorOf(r.kind), backgroundColor: `${railColorOf(r.kind)}18`, border: `1px solid ${railColorOf(r.kind)}30` }}
                    >{r.who.split(/\s+/).map((word) => word[0]).slice(0, 2).join('').toUpperCase()}</span>

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
                          className="shrink-0 self-center rounded bg-violet-500/15 px-1 py-0.5 text-[11px] font-bold uppercase tracking-wide text-violet-300"
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
                          className="shrink-0 self-center rounded bg-zinc-500/15 px-1 py-0.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400"
                        >
                          classé
                        </span>
                      )}
                      {/* Their last word needed no answer. Without this the row
                          reads as an unanswered message that the queues
                          mysteriously ignore — and the Statut column, which
                          reads the situation, still says « À répondre ». */}
                      {r.noReply && (
                        <span
                          title="Rien à répondre — leur dernier message ne demande pas de réponse. Un nouveau message de leur part remettra le fil dans la file."
                          className="shrink-0 self-center rounded bg-sky-500/15 px-1 py-0.5 text-[11px] font-bold uppercase tracking-wide text-sky-300"
                        >
                          {/* The button's own words, not an abbreviation of
                              them. The badge is rare enough to afford the three
                              words, and a second name for one thing is how a
                              vocabulary starts to drift — see the three
                              deliberate namings in situation.ts. */}
                          rien à répondre
                        </span>
                      )}
                      {r.chip && (
                        <span
                          className="shrink-0 self-center rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
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
                      {r.preview && (
                        <span className="text-[var(--fg-4)]">
                          {r.lastFromUs && <span className="text-amber-400/80">toi : </span>}
                          {r.preview}
                        </span>
                      )}
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
                      {selection.work === 'followup' && r.rankReason && (
                        <span
                          className="block truncate text-[11px] text-[var(--fg-4)]"
                          title="Ce qui place cette relance ici"
                        >
                          {r.rankReason}
                        </span>
                      )}
                    </span>

                    {/* The column the eye scans. Under a prospecting refinement
                      a never-contacted row has no silence to show, so it shows
                      what does rank it there instead — same swap the column
                      list made. */}
                    {confidence ? (
                      <span
                        className={`${AT.age} truncate text-right text-[11.5px]  ${confidence.cls}`}
                      >
                        {confidence.label}
                      </span>
                    ) : (
                      <span
                        className={`${AT.age} text-right font-mono text-[12px] tabular-nums  ${
                          r.urgent ? 'text-[var(--amber-500)]' : 'text-[var(--fg-4)]'
                        }`}
                      >
                        {shortAge(r.age)}
                      </span>
                    )}

                    <span aria-hidden className={AT.dot} />
                  </button>
                  <RowActions row={r} onError={setActionError} onDone={() => router.refresh()} />
                </div>
              </Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}
