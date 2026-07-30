'use client';

import { useMemo, useState } from 'react';
import { BLOCK_LABEL, checkDraft, EM_DASH } from '@/lib/crm/guardrails';
import { intentOf } from '@/lib/crm/intent';
import { lastOutbound } from '@/lib/crm/repeat';
import type { GuardrailReport, Message, Situation } from '@/lib/crm/types';

/**
 * The pre-send checks as the operator meets them, shared by the two places a
 * mail can leave this CRM: the composer at the foot of the panel, and the
 * draft card in the thread.
 *
 * One module and not two copies, because the second surface is exactly how a
 * guardrail dies: a check that exists on one path and not the other is a
 * documented way around it, and two wordings of the same rule teach the
 * operator that the rule is decorative.
 */

/**
 * Which field carries the em dash.
 *
 * It is not always the operator's own typing: a reply is generated from a hint
 * built on the last message's subject, and the field is then filled from what
 * comes back, so a dash the recipient wrote can land in the subject and lock
 * the send on a body that is perfectly clean. Being told "somewhere in your
 * draft" while staring at a clean body is how an operator concludes the tool
 * is broken and forces every send out of habit. A draft saved from that
 * composer carries the same dash into the card, so the card needs the pointer
 * just as much.
 *
 * Silent when neither field holds it, which cannot happen while the rule and
 * this function read the same constant, and is the safe answer if they ever
 * stop agreeing.
 */
function emDashField(subject: string, body: string): string | null {
  const inSubject = subject.includes(EM_DASH);
  const inBody = body.includes(EM_DASH);
  if (inSubject && inBody) return 'Il est dans l’objet et dans le corps.';
  if (inSubject) return 'Il est dans l’objet.';
  if (inBody) return 'Il est dans le corps.';
  return null;
}

export interface Guarded {
  report: GuardrailReport;
  /** A block stands and nothing covers it: the send button must be off. */
  blocked: boolean;
  /** A block stands and the operator has passed over it: the send may proceed. */
  forced: boolean;
  /** Label of the override control, or null when there is nothing to pass over. */
  offer: string | null;
  /**
   * Said in the panel once the grant is given, or null. It is in the panel and
   * not in the send button's label because a label that grows is a button that
   * moves, and this one must not move: see OverrideButton.
   */
  forcedNote: string | null;
  /** Grant the override, or withdraw a grant already given. */
  toggle: () => void;
  /** Drop the grant. Call it whenever the text becomes a different draft. */
  clear: () => void;
}

/**
 * Runs the checks and holds the override.
 *
 * The override is the blocks it was granted against, not a boolean. A boolean
 * granted for an em dash would still be armed once the dash is gone and the
 * daily cap has taken its place, which is an override of something the
 * operator never looked at. Holding the key means the grant expires by itself
 * the moment the reasons change. Typing does not drop it, because re-arming
 * the button after every keystroke would train the operator to click without
 * reading; `clear()` is for the events that make the text another draft.
 *
 * `sendable` is the caller's own answer to "could this be sent at all, the
 * checks aside": an address, a subject, a body, nothing in flight. The
 * override is tied to it because two blocks fire with nothing typed:
 * `empty_body` on the text alone, under both intents, and `daily_cap` on the
 * counter alone, on the outbound path only. So a freshly opened composer
 * starts blocked over an empty draft, and an escape hatch offered there would
 * re-arm a button that is off for another reason. A control that visibly does
 * nothing when clicked is how the operator learns to distrust the whole panel.
 *
 * `sentToday` is never recounted here and no Date is built: msg_date carries
 * no timezone, and this tree is server-rendered before it is hydrated.
 */
export function useGuardrails({
  subject,
  body,
  sentToday,
  situation,
  messages,
  sendable,
}: {
  subject: string;
  body: string;
  /** Counted by the page, against the one instant the situations use. */
  sentToday: number;
  /**
   * Undefined only if the page failed to derive one. Absent, the checks take
   * the stricter road, not a warmer one: intent falls to 'outbound', which
   * arms the whole prospecting rule set; only isFirstTouch falls loose, and
   * it governs two warnings.
   */
  situation?: Situation;
  /**
   * The contact's correspondence, from which the last mail actually sent is
   * taken. Required, not optional: the two rules that read it exist because the
   * same defect reached the operator through both surfaces, and a prop that can
   * be forgotten is how the second surface loses a rule the first one has.
   */
  messages: Message[];
  sendable: boolean;
}): Guarded {
  const [overrideFor, setOverrideFor] = useState<string | null>(null);

  // What a cold first touch is, decided once for both surfaces. Undefined
  // falls to false, which only loosens two warnings and never a block.
  const isFirstTouch = situation?.nextAction === 'first_mail';
  // Which rule set applies, decided once for both surfaces. Derived rather than
  // passed in: an absent situation answers `outbound`, which keeps every
  // guardrail armed, so a surface that forgets to hand one down loses no check.
  const intent = intentOf(situation);
  // Held apart from the report below so that typing, which changes `body` on
  // every keystroke, does not walk the whole thread again each time.
  const previous = useMemo(() => lastOutbound(messages) ?? undefined, [messages]);
  const report = useMemo(
    () => checkDraft({ body, subject, sentToday, isFirstTouch, previous, intent }),
    [body, subject, sentToday, isFirstTouch, previous, intent],
  );

  const blockers = report.issues.filter((i) => i.level === 'blocking');
  /** Sorted, so the same two blocks yield the same grant in any order. */
  const blockKey = blockers
    .map((i) => i.code)
    .sort()
    .join('+');
  const blockNames = blockers.map((i) => BLOCK_LABEL[i.code] ?? i.code).join(', ');

  /**
   * Recurrence, which the key alone cannot catch.
   *
   * Holding the codes stops one block covering another, but says nothing about
   * the same block coming back: delete the em dash and the grant is merely
   * dormant, paste another and the send is armed again with no second click.
   * Same through `sendable`: grant at the cap, wipe the draft, write a
   * completely different mail, and it is live on the keystroke that makes it
   * sendable. Deleting and rewriting is exactly the event that makes the text
   * another draft, so the grant has to die on the edge, not on the value.
   *
   * The key itself is the third edge, and the ordinary path: at the cap with an
   * em dash the grant covers both, deleting the dash leaves the cap standing,
   * so nothing above fires and the grant lies dormant on a key it no longer
   * matches. Retype the dash and it matches again, armed, with no second click.
   * Past ten sends both blocks together are the end of day state and Cmd+Z is
   * the whole sequence.
   *
   * State adjusted during render rather than in an effect: the corrected value
   * has to be the one this render paints, or the button is red for a frame on
   * a grant nobody gave. React re-runs the component before committing.
   */
  const [seen, setSeen] = useState({ blocking: false, sendable: false, blockKey: '' });
  if (
    seen.blocking !== report.blocking ||
    seen.sendable !== sendable ||
    seen.blockKey !== blockKey
  ) {
    const unblocked = seen.blocking && !report.blocking;
    const revived = !seen.sendable && sendable;
    const drifted = seen.blockKey !== blockKey;
    setSeen({ blocking: report.blocking, sendable, blockKey });
    if (unblocked || revived || drifted) setOverrideFor(null);
  }

  const forced = report.blocking && sendable && overrideFor === blockKey;

  // No focus move on the grant, deliberately. Sending focus to a now live send
  // button reproduced in the keyboard exactly what the mounted toggle had just
  // closed for the mouse: Enter grants, focus lands on the armed button, a
  // second Enter sends, and a held Enter does both inside the repeat delay.
  // The toggle stays mounted, so the keyboard route through a block is already
  // open: the button beside it becomes focusable the moment it is armed.

  return {
    report,
    blocked: report.blocking && !forced,
    forced,
    offer: report.blocking && sendable ? `Forcer l’envoi malgré : ${blockNames}` : null,
    forcedNote: forced ? `Forçage accordé. Le mail partira malgré : ${blockNames}.` : null,
    toggle: () => setOverrideFor((prev) => (prev === blockKey ? null : blockKey)),
    clear: () => setOverrideFor(null),
  };
}

/**
 * The checks, under the text they judge and above the button they govern.
 *
 * Severity is written as a word and not only as a colour: amber against red
 * tells a colour-blind reader nothing, and it tells nobody why one line
 * disables the send and the other does not. No aria-live: this list changes on
 * every keystroke, and a screen reader reading a word count out loud as it is
 * typed would make the composer unusable.
 */
export function GuardrailChecks({
  id,
  report,
  subject,
  body,
  forcedNote,
}: {
  /** Unique per surface: the send button points at it with aria-describedby. */
  id: string;
  report: GuardrailReport;
  subject: string;
  body: string;
  /**
   * The armed state, in words. Neither the send button nor the toggle may say
   * it, because saying it would widen them, so the panel says it: red buttons
   * alone tell a colour-blind operator nothing about a send that is about to
   * ignore a rule.
   */
  forcedNote?: string | null;
}) {
  if (report.issues.length === 0) return null;
  const where = emDashField(subject, body);
  return (
    <ul id={id} className="mt-1.5 space-y-0.5">
      {report.issues.map((i) => (
        <li
          key={i.code}
          className={`text-[11px] leading-snug ${
            i.level === 'blocking' ? 'text-red-400' : 'text-amber-300'
          }`}
        >
          {i.level === 'blocking' ? '🔴 Blocage : ' : '🟠 Attention : '}
          {i.message}
          {i.code === 'em_dash' && where ? ` ${where}` : ''}
        </li>
      ))}
      {forcedNote && (
        <li className="text-[11px] font-medium leading-snug text-red-300">⚠️ {forcedNote}</li>
      )}
    </ul>
  );
}

/**
 * Deliberate, not easy: this only re-arms the send, and the operator still has
 * to press it. Two clicks, and the domain stays theirs to gamble. It belongs
 * next to the button it re-arms, never at the foot of the list, because the
 * escape hatch has to travel with the button.
 *
 * A toggle rather than a control that vanishes on use, and one whose label is
 * the same pressed and unpressed. Both properties are load-bearing, and both
 * were learnt at the bench rather than reasoned:
 *
 *  1. Unmounted on click, it collapsed the row it sits in. On the draft card,
 *     whose row is left aligned in DOM order, that pulled an unconfirmed
 *     Supprimer left, into the point the click had just landed on. discard()
 *     asks nothing and there is no undo.
 *  2. Mounted but with a send button that renamed itself "Envoyer malgré ..."
 *     on the grant, the send button grew from 89px to 216px and slid under
 *     that same cursor: measured, a double click then sent the mail.
 *
 * So nothing in this row may change width when the grant is given. The armed
 * state is carried by the fill, by aria-pressed, and by a line in the panel
 * above. Pressing again withdraws the grant, which a safety control should
 * allow.
 */
export function OverrideButton({
  offer,
  pressed,
  onClick,
  dense = false,
}: {
  offer: string;
  pressed: boolean;
  onClick: () => void;
  /** Matches the shorter buttons of the draft card row. */
  dense?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      // Fill and text colour only between the two states. No weight change:
      // bolder text is wider text, and a width change is the very movement
      // this toggle exists to avoid.
      className={`rounded-lg border border-red-500/40 text-xs hover:bg-red-500/20 ${
        dense ? 'px-3 py-1' : 'px-3 py-1.5'
      } ${pressed ? 'bg-red-500/20 text-red-100' : 'text-red-300'}`}
    >
      {offer}
    </button>
  );
}
