'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { contactsOpenHref } from '@/lib/crm/deep-link';
import { formatStamp } from '@/lib/crm/format';
import {
  DEFAULT_JOURNAL_FILTER,
  JOURNAL_PERIODS,
  filterJournal,
  groupByDay,
  journalSummary,
  withinPeriod,
  type JournalDirection,
  type JournalFilter,
  type JournalRow,
  type SendOrigin,
} from '@/lib/crm/journal';
import { kindWord, railColorOf } from '@/lib/crm/table-view';

/**
 * The Courrier page: every mail, in one list, newest first.
 *
 * Contacts answers "where is this conversation"; this answers "what happened,
 * and did I do it". Since part of the mail leaves without a click, the second
 * question needed a screen of its own — inside a fiche, a letter is only
 * findable by somebody who already suspects it is there.
 *
 * Nothing is derived here. journal.ts holds the window, the axes, the shelves
 * and the summary, because those are the rules and the vitest config covers
 * lib/ only. This file is the controls and the ink.
 */

/** The four positions of the segmented control, in the order they read. */
const DIRECTIONS: ReadonlyArray<{ key: JournalDirection | 'all'; label: string }> = [
  { key: 'all', label: 'Tout' },
  { key: 'in', label: 'Reçus' },
  { key: 'out', label: 'Envoyés' },
  { key: 'draft', label: 'Brouillons' },
];

const ORIGIN_OPTIONS: ReadonlyArray<{ key: SendOrigin | 'all'; label: string }> = [
  { key: 'all', label: 'Toutes origines' },
  { key: 'claude', label: 'Envoyés par Claude' },
  { key: 'dashboard', label: 'Envoyés du tableau de bord' },
  { key: 'mailbox', label: 'Envoyés depuis la messagerie' },
];

/** What a line says about itself, before anything else on the row. */
const DIRECTION_BADGE: Record<JournalDirection, { label: string; className: string }> = {
  in: { label: 'reçu', className: 'bg-blue-500/15 text-blue-300' },
  out: { label: 'envoyé', className: 'bg-amber-500/15 text-amber-300' },
  draft: { label: 'brouillon', className: 'bg-[var(--ink-4)] text-[var(--fg-2)]' },
};

/**
 * The origin badge, on departures only.
 *
 * « par Claude » is the loud one, in the violet nothing else on this page uses.
 * It is the single fact the page exists to surface, and a reader scanning a
 * fortnight has to be able to find it without reading a word. The other two are
 * quiet: one says the operator clicked, the other says nobody recorded who
 * wrote it — neither is news.
 */
const ORIGIN_BADGE: Record<SendOrigin, { label: string; className: string; title: string }> = {
  claude: {
    label: 'par Claude',
    className: 'bg-violet-500/20 text-violet-200',
    title: 'Rédigé et envoyé par l’agent, sans clic de ta part.',
  },
  dashboard: {
    label: 'tableau de bord',
    className: 'bg-[var(--ink-4)] text-[var(--fg-2)]',
    title: 'Envoyé depuis le composeur du tableau de bord.',
  },
  mailbox: {
    label: 'messagerie',
    className: 'border border-[var(--ink-4)] text-[var(--fg-3)]',
    title:
      'Copie relue par la synchronisation de la boîte : rien n’indique depuis quelle surface ce mail a été écrit.',
  },
};

function Badge({
  className,
  children,
  title,
}: {
  className: string;
  children: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap ${className}`}
    >
      {children}
    </span>
  );
}

function JournalLine({ row, locale }: { row: JournalRow; locale: string }) {
  const badge = DIRECTION_BADGE[row.direction];
  const origin = row.origin ? ORIGIN_BADGE[row.origin] : null;
  return (
    <li className="grid grid-cols-1 gap-x-3 gap-y-0.5 border-b border-[var(--ink-4)]/40 px-3 py-2 last:border-b-0 sm:grid-cols-[82px_minmax(0,1fr)]">
      <span
        // The shelf above already names the day; this repeats it in the compact
        // form because the eye scanning a fortnight of lines should not have to
        // look back up to know what it is reading. Tabular so the column stays
        // a column, and the raw stamp is on the title for the seconds.
        title={row.date}
        className="font-mono text-[12px] tabular-nums text-[var(--fg-4)]"
      >
        {formatStamp(row.date)}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge className={badge.className}>{badge.label}</Badge>
          {origin && (
            <Badge className={origin.className} title={origin.title}>
              {origin.label}
            </Badge>
          )}
          <Link
            href={contactsOpenHref(locale, row.contact.id)}
            className="inline-flex min-w-0 items-center gap-1.5 text-[13px] text-[var(--fg-2)] underline decoration-[var(--ink-5)] underline-offset-2 hover:text-[var(--fg-1)] hover:decoration-[var(--fg-3)]"
          >
            {/* The kind, in the colour the contacts table already gives it, so
                the rail and this dot never disagree about the same person. The
                colour cannot be read aloud, hence the word beside it. */}
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: railColorOf(row.contact.kind) }}
            />
            <span className="sr-only">{kindWord(row.contact.kind)} : </span>
            <span className="truncate">{row.contact.label}</span>
          </Link>
        </div>
        {row.subject && (
          <p className="mt-0.5 truncate text-[13.5px] text-[var(--fg-1)]">{row.subject}</p>
        )}
        {row.snippet && <p className="truncate text-[12.5px] text-[var(--fg-3)]">{row.snippet}</p>}
      </div>
    </li>
  );
}

export function JournalApp({
  rows,
  todayIso,
  unattached,
}: {
  /** Every datable message of every contact, newest first (journalRows). */
  rows: JournalRow[];
  /** The page's day in Zurich: the one clock every window and shelf reads. */
  todayIso: string;
  /** Stored messages no contact claims. See unattachedCount. */
  unattached: number;
}) {
  const locale = useLocale();
  const [filter, setFilter] = useState<JournalFilter>(DEFAULT_JOURNAL_FILTER);
  const set = (over: Partial<JournalFilter>) => setFilter({ ...filter, ...over });

  // The period alone, which is what the sentence below describes: counted
  // before the three axes, or "5 envoyés" while standing on Envoyés would be
  // saying nothing at all. See journalSummary.
  const summary = useMemo(
    () => journalSummary(withinPeriod(rows, filter.days, todayIso)),
    [rows, filter.days, todayIso],
  );
  const shown = useMemo(() => filterJournal(rows, filter, todayIso), [rows, filter, todayIso]);
  const days = useMemo(() => groupByDay(shown, todayIso), [shown, todayIso]);

  const narrowed =
    filter.direction !== 'all' || filter.origin !== 'all' || filter.query.trim() !== '';

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/40">
      {/* Sticky on a phone, for the same reason as the Contacts bar: scrolling
          a long list used to scroll its own controls away, and coming back to
          them meant coming back to the top. */}
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-[var(--ink-4)]/60 bg-[var(--ink-2)] px-3 py-2.5 sm:static sm:bg-transparent">
        <input
          value={filter.query}
          onChange={(e) => set({ query: e.target.value })}
          placeholder="Rechercher (contact, objet, aperçu)…"
          aria-label="Rechercher dans le courrier"
          className="min-w-[180px] flex-1 basis-[220px] rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-2.5 py-1.5 text-base text-[var(--fg-1)] placeholder:text-[var(--fg-4)] focus:border-[var(--amber-500)]/50 focus:outline-none sm:text-[13px]"
        />

        {/* The sense. A segmented control and not a select: four positions that
            are always all worth seeing, and the one axis the reader changes
            most. Same shape as the population control on Contacts — and the
            same viewport around it, since four labelled buttons overflow a
            narrow phone and the PAGE must never pan sideways. */}
        <div className="min-w-0 max-w-full overflow-x-auto [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--ink-5)]">
          <div
            role="group"
            aria-label="Sens"
            className="flex w-max overflow-hidden rounded-lg border border-[var(--ink-4)]"
          >
            {DIRECTIONS.map((d) => {
              const on = filter.direction === d.key;
              return (
                <button
                  key={d.key}
                  type="button"
                  onClick={() => set({ direction: d.key })}
                  aria-pressed={on}
                  className={[
                    'shrink-0 border-r border-[var(--ink-4)] px-2.5 py-1.5 text-[12.5px] font-semibold whitespace-nowrap last:border-r-0 transition-colors',
                    on
                      ? 'bg-[var(--ink-3)] text-[var(--fg-1)] shadow-[inset_0_-2px_0_var(--amber-500)]'
                      : 'text-[var(--fg-3)] hover:text-[var(--fg-2)]',
                  ].join(' ')}
                >
                  {d.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Two selects, deliberately. Origin has four values that only narrow
            departures and period has four that are pure arithmetic: neither is
            worth a row of buttons above a list, and a select says its current
            value without one. */}
        <select
          value={filter.origin}
          onChange={(e) => set({ origin: e.target.value as JournalFilter['origin'] })}
          aria-label="Origine des envois"
          className="shrink-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-[12.5px] text-[var(--fg-2)] focus:border-[var(--amber-500)]/50 focus:outline-none"
        >
          {ORIGIN_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          value={filter.days}
          onChange={(e) => set({ days: Number(e.target.value) })}
          aria-label="Période"
          className="shrink-0 rounded-lg border border-[var(--ink-4)] bg-[var(--ink-0)] px-2 py-1.5 text-[12.5px] text-[var(--fg-2)] focus:border-[var(--amber-500)]/50 focus:outline-none"
        >
          {JOURNAL_PERIODS.map((d) => (
            <option key={d} value={d}>
              {d} derniers jours
            </option>
          ))}
        </select>
      </div>

      {/* The period, said in one sentence, whatever the three axes are doing.
          The first clause is the one worth the accent: it is the whole reason
          this page exists. */}
      <p className="border-b border-[var(--ink-4)]/60 px-3 py-2 text-[13px] text-[var(--fg-3)]">
        <span className="font-medium text-[var(--fg-2)]">{filter.days} derniers jours</span> :{' '}
        <span className="text-amber-400">
          {summary.sent} envoyé{summary.sent > 1 ? 's' : ''}
        </span>
        {summary.sent > 0 && (
          <>
            , dont{' '}
            <span className={summary.byClaude > 0 ? 'text-violet-300' : undefined}>
              {summary.byClaude} par Claude
            </span>{' '}
            et {summary.byDashboard} depuis le tableau de bord
            {/* Named rather than folded into one of the two above: a departure
                nobody recorded is neither, and quietly counting it as the
                operator's own would be the exact lie this page is against. */}
            {summary.byMailbox > 0 && <> et {summary.byMailbox} depuis la messagerie</>}
          </>
        )}
        {' · '}
        {summary.received} reçu{summary.received > 1 ? 's' : ''}
        {' · '}
        {summary.drafts} brouillon{summary.drafts > 1 ? 's' : ''} en attente
      </p>

      {days.length === 0 ? (
        <div className="px-4 py-10 text-center text-[13.5px] text-[var(--fg-3)]">
          <p>Rien sur cette période avec ces filtres.</p>
          {narrowed && (
            <p className="mt-2">
              <button
                type="button"
                onClick={() => setFilter({ ...DEFAULT_JOURNAL_FILTER, days: filter.days })}
                className="rounded border border-[var(--ink-4)] px-2 py-0.5 text-[12.5px] hover:text-[var(--fg-1)]"
              >
                retirer les filtres
              </button>
            </p>
          )}
        </div>
      ) : (
        days.map((day) => (
          <section key={day.day}>
            {/* Not sticky, deliberately: the control bar above already pins
                itself to top-0 on a phone, and a second sticky at the same
                offset simply slides underneath it and disappears. Each line
                carries its own compact date, so the shelf is a rhythm rather
                than a thing that must stay on screen. */}
            <h2 className="border-y border-[var(--ink-4)]/40 bg-[var(--ink-3)]/40 px-3 py-1 text-[11px] uppercase tracking-[0.12em] text-[var(--fg-3)]">
              {day.label}
            </h2>
            <ul>
              {day.rows.map((row) => (
                <JournalLine key={row.id} row={row} locale={locale} />
              ))}
            </ul>
          </section>
        ))
      )}

      {/* Said out loud rather than left to be discovered. The mail store is
          keyed by address and the contact list is built from key holders,
          prospects and registered correspondents, so a letter to an authority
          nobody added to the registry has a row here and no line. A journal
          that hid that would be worse than no journal. */}
      {unattached > 0 && (
        <p className="border-t border-[var(--ink-4)]/60 px-3 py-2 text-[12.5px] text-[var(--fg-3)]">
          ⚠ {unattached} message{unattached > 1 ? 's' : ''} de la boîte n’
          {unattached > 1 ? 'ont' : 'a'} aucun contact et n’apparai
          {unattached > 1 ? 'ssent' : 't'} pas ci-dessus. Enregistre l’adresse dans Contacts
          (segment Correspondants) pour que son fil remonte.
        </p>
      )}
    </div>
  );
}
