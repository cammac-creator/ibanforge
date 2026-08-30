import type { ReactNode } from 'react';
import { formatDay } from '@/lib/crm/format';
import { nextActionLabel } from '@/lib/crm/situation';
import type { Contact, Situation } from '@/lib/crm/types';

/**
 * The band answers, in one glance, the three questions asked on opening a
 * contact: who holds the ball, for how long, and what to do next. The whole
 * surface is tinted by the ball state so the answer to the first one lands
 * before any text is read.
 *
 * No state and no event handler here, so this stays a Server Component: it
 * ships no JavaScript to the browser.
 */
/**
 * These labels name who owes the next move, never what to do about it. The
 * 'them' label in particular is not NEXT_ACTION_LABEL.wait: both used to read
 * "en attente de sa réponse", so the commonest state of all, just after a first
 * mail goes out, spent two of the band's three slots saying one thing. Stated
 * here rather than in situation.ts because that map is shared with callers that
 * want the action phrasing.
 */
const BALL = {
  us: { label: '⚠ À TOI DE JOUER', fg: '#fca5a5', bg: '#7f1d1d33', border: '#7f1d1d' },
  them: { label: 'LA BALLE EST CHEZ LUI', fg: '#93c5fd', bg: '#1e3a5f33', border: '#1e3a5f' },
  none: { label: 'Jamais contacté', fg: '#a1a1aa', bg: '#27272a', border: '#3f3f46' },
} as const;

/**
 * The fourth presentation, and the only one that is not a ball state.
 *
 * Their message IS the last one, so `ballInCourt` says 'us' and says it
 * correctly — but the operator has answered the question the band asks by
 * declaring that message needs no answer. Left alone, the band would shout
 * « ⚠ À TOI DE JOUER » in red and « Il attend ta réponse » in the same panel
 * as a pressed « Rien à répondre » button and the sentence saying the thread
 * has left the queue. That is the defect situation.ts already names in its own
 * words — one screen, two vocabularies — and the coloured band is the half
 * that wins.
 *
 * Sky, the colour the list badge wears, so the two surfaces say one thing in
 * one tone.
 */
const NO_REPLY = { label: 'RIEN À RÉPONDRE', fg: '#7dd3fc', bg: '#0c4a6e33', border: '#0c4a6e' } as const;

export function SituationBand({
  situation: s,
  kind,
  noReply = false,
  action,
}: {
  situation: Situation;
  kind?: Contact['kind'];
  /**
   * Computed by the caller through noReplyHolds, never here: this component
   * ships no JavaScript and holds no rule, and the list's badge reads the very
   * same function so the drawer and the row cannot disagree.
   */
  noReply?: boolean;
  /**
   * The one gesture that answers the line beside it, handed in by the caller.
   *
   * A slot rather than an import, so this file keeps holding no rule and no
   * state; the band still ships no JavaScript of its own and what arrives here
   * brings its own.
   *
   * ## Why the gesture belongs on this line and nowhere else
   *
   * It lived at the bottom of ContactDetail, which scrolls, below the
   * qualification blocks, the notes and the activity chart. It was live in
   * production for a day and the operator reported he still could not classify
   * a thank-you: a control nobody scrolls to is a control that does not exist.
   * The band is where the question is ASKED — « ⚠ À TOI DE JOUER », pinned,
   * read before anything else — so it is where the answer has to be offered.
   *
   * Placed on the action line rather than under it, because the pinned header's
   * height is already measured against the composer (see crm-app.tsx): a slot
   * on an existing row costs no pixels until it has something to unfold.
   */
  action?: ReactNode;
}) {
  const b = noReply ? NO_REPLY : BALL[s.ballInCourt];
  // "Jamais contacté" is the prospecting word for the same fact, and this band
  // sits directly above a sheet that calls it a first written request. Nothing
  // else about the band changes: the ball, the silence and the counts are facts
  // about the thread, not about who is on the other end of it.
  const ballLabel = !noReply && kind === 'institution' && s.ballInCourt === 'none' ? 'Pas encore écrit' : b.label;
  // A message sent today is not a silence, and "silence depuis 0 j" reads as a
  // bug. The thread below already carries the date of the last message.
  const silence = s.silenceDays !== null && s.silenceDays > 0 ? s.silenceDays : null;
  const firstContact = formatDay(s.firstContactAt);
  return (
    <div
      className="rounded-lg border px-3 py-2"
      style={{ backgroundColor: b.bg, borderColor: b.border }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-bold uppercase tracking-wide" style={{ color: b.fg }}>
            {ballLabel}
          </span>
          {silence !== null && (
            <span className="text-[13px] text-[var(--fg-2)]">
              silence depuis <strong>{silence} j</strong>
            </span>
          )}
        </div>
        {/* --fg-3, not --fg-4: measured on composited pixels, --fg-4 at 10px
            clears AA on the two dark tints (4.69:1, 4.68:1) but drops to
            3.92:1 on the lighter 'none' band, so the same line passed or
            failed depending on the ball state. --fg-3 clears all three. */}
        <span className="text-[12px] text-[var(--fg-3)]">
          {firstContact ? `1er contact ${firstContact} · ` : ''}
          {s.messageCount} message{s.messageCount > 1 ? 's' : ''}
        </span>
      </div>
      {/* The action line goes calm with the band. Amber is the colour of
          something owed today, and nothing is owed here.

          items-start, not items-center: the slot on the right unfolds a panel
          under itself when the operator accepts a standing rule, and a centred
          row would drag the sentence down the moment that happens. */}
      <div className="mt-1.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        {noReply ? (
          <p className="text-[12px] text-sky-300">→ Rien à faire : leur dernier message n’attend pas de réponse.</p>
        ) : (
          <p className="text-[12px] text-amber-300">→ {nextActionLabel(s.nextAction, kind)}</p>
        )}
        {action}
      </div>
    </div>
  );
}
