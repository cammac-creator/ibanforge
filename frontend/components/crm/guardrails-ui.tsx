'use client';

import { useMemo, useState } from 'react';
import { checkDraft, EM_DASH } from '@/lib/crm/guardrails';
import type { GuardrailIssue, GuardrailReport, Situation } from '@/lib/crm/types';

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
 * Short names for the blocking rules, for the two controls that carry the
 * override. The list says the whole sentence; the button being clicked says
 * what it is being clicked against, because on a short window that list can be
 * scrolled out of view while the button is not.
 *
 * Partial on purpose: a blocking rule added later shows its raw code here,
 * which is ugly and therefore noticed, rather than hiding behind a generic
 * "le blocage" that would read as if nothing had changed.
 */
const BLOCK_LABEL: Partial<Record<GuardrailIssue['code'], string>> = {
  em_dash: 'tiret cadratin',
  daily_cap: 'plafond du jour',
};

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
  /** Label of the override control, or null when there is nothing to offer. */
  offer: string | null;
  /** What the send button reads once the override is granted. */
  forcedLabel: string;
  /** Pass over the blocks currently on screen. */
  grant: () => void;
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
 * override is tied to it because `daily_cap` fires on the counter alone, so
 * past ten sends every freshly opened composer starts blocked over an empty
 * draft, and an escape hatch offered there would re-arm a button that is off
 * for another reason. A control that visibly does nothing when clicked is how
 * the operator learns to distrust the whole panel.
 *
 * `sentToday` is never recounted here and no Date is built: msg_date carries
 * no timezone, and this tree is server-rendered before it is hydrated.
 */
export function useGuardrails({
  subject,
  body,
  sentToday,
  situation,
  sendable,
}: {
  subject: string;
  body: string;
  /** Counted by the page, against the one instant the situations use. */
  sentToday: number;
  /** Undefined only if the page failed to derive one; every rule then falls to its warmer form. */
  situation?: Situation;
  sendable: boolean;
}): Guarded {
  const [overrideFor, setOverrideFor] = useState<string | null>(null);

  // What a cold first touch is, decided once for both surfaces. Undefined
  // falls to false, which only loosens two warnings and never a block.
  const isFirstTouch = situation?.nextAction === 'first_mail';
  const report = useMemo(
    () => checkDraft({ body, subject, sentToday, isFirstTouch }),
    [body, subject, sentToday, isFirstTouch],
  );

  const blockers = report.issues.filter((i) => i.level === 'blocking');
  /** Sorted, so the same two blocks yield the same grant in any order. */
  const blockKey = blockers
    .map((i) => i.code)
    .sort()
    .join('+');
  const blockNames = blockers.map((i) => BLOCK_LABEL[i.code] ?? i.code).join(', ');
  const forced = report.blocking && sendable && overrideFor === blockKey;

  return {
    report,
    blocked: report.blocking && !forced,
    forced,
    offer: report.blocking && sendable && !forced ? `Forcer l’envoi malgré : ${blockNames}` : null,
    forcedLabel: `⚠️ Envoyer malgré : ${blockNames}`,
    grant: () => setOverrideFor(blockKey),
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
}: {
  /** Unique per surface: the send button points at it with aria-describedby. */
  id: string;
  report: GuardrailReport;
  subject: string;
  body: string;
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
    </ul>
  );
}

/**
 * Deliberate, not easy: this only re-arms the send, and the operator still has
 * to press it. Two clicks, and the domain stays theirs to gamble. It belongs
 * next to the button it re-arms, never at the foot of the list, because the
 * escape hatch has to travel with the button.
 */
export function OverrideButton({
  offer,
  onClick,
  dense = false,
}: {
  offer: string;
  onClick: () => void;
  /** Matches the shorter buttons of the draft card row. */
  dense?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border border-red-500/40 text-xs text-red-300 hover:bg-red-500/10 ${
        dense ? 'px-3 py-1' : 'px-3 py-1.5'
      }`}
    >
      {offer}
    </button>
  );
}
