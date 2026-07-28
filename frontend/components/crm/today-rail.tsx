'use client';

import { useMemo } from 'react';
import { ballWithUs, followupDue } from '@/lib/crm/buckets';
import { HARD_CAP, SOFT_CAP } from '@/lib/crm/sent-today';
import { FOLLOWUP_DAYS } from '@/lib/crm/situation';
import type { Contact, Situation } from '@/lib/crm/types';

/** Rows listed before the overflow line takes over. */
const SHOWN = 5;

/** A contact paired with the situation the page computed for it. */
interface Ranked {
  c: Contact;
  s: Situation | undefined;
}

interface RailRow {
  id: string;
  name: string;
  days: number | null;
}

/**
 * Longest silence first: the thread that has waited longest is the one closest
 * to being lost, and only the first five are shown, so the order decides which
 * five those are. Ties fall back on the id, which is what makes the same five
 * appear on the server and in the browser and stops them shuffling when the
 * API hands its rows back in another order.
 */
function byOldestSilence(a: Ranked, b: Ranked): number {
  const d = (b.s?.silenceDays ?? 0) - (a.s?.silenceDays ?? 0);
  if (d !== 0) return d;
  return a.c.id < b.c.id ? -1 : a.c.id > b.c.id ? 1 : 0;
}

function toRow({ c, s }: Ranked): RailRow {
  return {
    id: c.id,
    // Same fallback chain as the contact list, so no row is named here and
    // blank there, or the reverse.
    name: c.company || c.email || 'Sans nom',
    days: s?.silenceDays ?? null,
  };
}

function Section({
  label,
  tone,
  count,
  rows,
  alertAfter,
  selectedId,
  onSelect,
}: {
  label: string;
  /** Accent for the badge. Hex, because it is used at two alpha levels. */
  tone: string;
  /** Size of the whole bucket, not of `rows`: the overflow line reads both. */
  count: number;
  rows: RailRow[];
  /** Days past which the counter turns red, or null to never turn it red. */
  alertAfter: number | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (count === 0) return null;
  return (
    <div className="mb-3 min-w-0">
      <p className="mb-1 flex min-w-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--fg-3)]">
        <span className="truncate">{label}</span>
        <span
          className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums"
          style={{ backgroundColor: `${tone}26`, color: tone }}
        >
          {count}
        </span>
      </p>
      {rows.map((r) => (
        <button
          key={r.id}
          type="button"
          onClick={() => onSelect(r.id)}
          // aria-pressed, not aria-current: same selection toggle as the list,
          // and the two columns are two views of one selection.
          aria-pressed={r.id === selectedId}
          title={r.name}
          className={`mb-0.5 flex w-full min-w-0 cursor-pointer items-center justify-between gap-1.5 rounded px-1.5 py-1 text-left text-[11px] transition-colors ${
            r.id === selectedId
              ? 'bg-[var(--ink-4)] text-[var(--fg-1)]'
              : 'bg-[var(--ink-3)]/40 text-[var(--fg-2)] hover:bg-[var(--ink-4)]/60'
          }`}
        >
          {/* truncate, not wrap: overflow:hidden drops this flex item's
              automatic minimum size to zero, so a long company name clips
              inside a 170px column instead of widening the whole grid. */}
          <span className="truncate">{r.name}</span>
          {r.days !== null && (
            <span
              className="shrink-0 tabular-nums"
              style={{
                color:
                  alertAfter !== null && r.days > alertAfter ? '#ef4444' : 'var(--fg-4)',
              }}
            >
              {r.days} j
            </span>
          )}
        </button>
      ))}
      {count > rows.length && (
        <p className="pl-1.5 text-[10px] text-[var(--fg-3)]">+ {count - rows.length} autres</p>
      )}
    </div>
  );
}

/**
 * The day's work, as a column that stays on screen while the operator moves
 * between contacts. It is the whole point of the layout the owner picked: what
 * is left to do today is not a screen you visit, it is always there.
 *
 * Situations arrive as a prop and are never derived here, exactly as in the
 * contact list. situationOf reads the current instant and parses a stored date
 * that carries no timezone, so a UTC server and a browser elsewhere would
 * disagree on the silence in days, and this subtree is server-rendered before
 * it is hydrated, so that disagreement is a hydration mismatch as well as a
 * wrong number. It would also flip followupDue, and with it the membership of
 * the second section and both badges. FOLLOWUP_DAYS is imported for the red
 * threshold only; nothing here calls situationOf.
 *
 * `sentToday` is a number for the same reason: the page counts it once against
 * the same instant, and no Date or Intl is built in this file.
 */
export function TodayRail({
  contacts,
  situations,
  snoozed,
  sentToday,
  selectedId,
  onSelect,
}: {
  contacts: Contact[];
  /** Keyed by Contact.id, one entry per contact, built by the page. */
  situations: Record<string, Situation>;
  /** Keyed the same way and on the same clock. A contact asleep until a date
   *  leaves the day's queue: that is the whole point of 'pas maintenant'. */
  snoozed: Record<string, boolean>;
  /** Real outbound mails dated today, drafts excluded. */
  sentToday: number;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { ours, due } = useMemo(() => {
    // filter hands back a fresh array each time, so sorting it in place leaves
    // the caller's contacts untouched.
    const rows: Array<Ranked & { asleep: boolean }> = contacts.map((c) => ({
      c,
      s: situations[c.id] as Situation | undefined,
      asleep: snoozed[c.id] === true,
    }));
    return {
      ours: rows.filter(({ c, s }) => ballWithUs(c, s)).sort(byOldestSilence),
      due: rows.filter(({ c, s, asleep }) => followupDue(c, s, asleep)).sort(byOldestSilence),
    };
  }, [contacts, situations, snoozed]);

  // The threshold is named in the text, not only in the colour: amber alone
  // tells a colour-blind reader nothing, and neither does it tell anyone why 8
  // is different from 7. Lot 3 turns the same two thresholds into the
  // daily_high and daily_cap guardrails.
  const capNote =
    sentToday >= HARD_CAP ? ' · plafond atteint' : sentToday >= SOFT_CAP ? ' · rythme élevé' : '';
  const capColor =
    sentToday >= HARD_CAP ? '#ef4444' : sentToday >= SOFT_CAP ? '#f59e0b' : 'var(--fg-3)';

  return (
    // min-w-0 so a long company name cannot set a min-content floor on this
    // grid item and widen the whole page. See the note in contact-list.tsx.
    //
    // sticky from lg up, and only from lg up. The contact column grows with the
    // number of contacts, so the page itself scrolls, and measured at 1280x800
    // scrolled to the foot of a full list there was not one rail row left on
    // screen: the column stayed put while the operator navigated, but the day's
    // work did not stay in front of him, which is the whole request. Pinned, the
    // counter and all ten rows are still there at the bottom of the page. It
    // needs self-start, or the grid stretches the box to the row height and
    // sticky has nothing left to slide inside. Below lg the three columns stack
    // and a pinned rail would sit on top of the thread instead of beside it.
    <aside
      aria-label="Travail du jour"
      className="min-w-0 rounded-xl border border-[var(--ink-4)]/60 bg-[var(--ink-2)]/60 p-2.5 lg:sticky lg:top-4 lg:self-start"
    >
      <p className="text-[10px] font-bold uppercase tracking-wide text-amber-400">Aujourd’hui</p>
      <p className="mb-2.5 text-[10px]" style={{ color: capColor }}>
        {sentToday} envoyé{sentToday > 1 ? 's' : ''} / plafond {HARD_CAP}
        {capNote}
      </p>

      {/* Labels copied from the chip and the stat card word for word: the
          operator is meant to read the same number in three places and see
          that it is the same number. */}
      <Section
        label="Tu as la balle"
        tone="#3b82f6"
        count={ours.length}
        rows={ours.slice(0, SHOWN).map(toRow)}
        // Here the day count discriminates: it says how long someone has been
        // left hanging, and past the followup threshold that is a problem.
        alertAfter={FOLLOWUP_DAYS}
        selectedId={selectedId}
        onSelect={onSelect}
      />
      <Section
        label="Relances dues"
        tone="#f59e0b"
        count={due.length}
        rows={due.slice(0, SHOWN).map(toRow)}
        // Every row in this bucket is over the threshold by definition, so
        // colouring them all red would re-encode the section's own title and
        // leave the operator a wall of red with nothing to pick out.
        alertAfter={null}
        selectedId={selectedId}
        onSelect={onSelect}
      />

      {ours.length === 0 && due.length === 0 && (
        <p className="py-4 text-center text-[10px] text-[var(--fg-3)]">
          Rien en attente. Journée propre.
        </p>
      )}
    </aside>
  );
}
