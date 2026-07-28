import { isAutomated } from './automated';
import type { Message, NextAction, Situation } from './types';

/** Days of silence after which an unanswered outbound becomes a followup. */
export const FOLLOWUP_DAYS = 10;

const DAY_MS = 86_400_000;

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A message we could place in time, paired with the instant it was placed at. */
interface DatedMessage {
  message: Message;
  at: Date;
}

/**
 * Derive the state of a conversation from its messages alone. Pure: no network,
 * no clock beyond the `today` argument, so it is deterministic under test.
 *
 * Drafts are excluded from every computation: an unsent draft changes neither
 * who holds the ball nor how long the silence has run. Undatable messages are
 * excluded too, so every field here describes the datable correspondence only.
 *
 * Automated inbound is excluded on the same footing, and for the same reason:
 * a support desk acknowledging a ticket has not answered us. Measured on the
 * real mailbox, letting robots through put two companies in `hasEverReplied`
 * that had never written, and left four of the five ball-in-court threads
 * waiting on a reply nobody was owed. See automated.ts, which also explains
 * why the test is on the text rather than on the sender. The messages stay in
 * `Contact.messages` and still render in the thread; they simply do not decide
 * anything here.
 */
export function situationOf(messages: Message[], today: Date = new Date()): Situation {
  // Each step hands back a fresh array, so sorting the last one in place leaves
  // the caller's messages untouched.
  const real = messages
    .filter((m) => m.direction === 'in' || m.direction === 'out')
    .filter((m) => !isAutomated(m))
    // A message with no usable date cannot be placed in the thread, so it cannot
    // decide who holds the ball, when the silence started, or when contact began.
    // Dropping it degrades to "we know less", where keeping it would invert the answer.
    .map((m) => ({ message: m, at: parseDate(m.msg_date) }))
    .filter((m): m is DatedMessage => m.at !== null)
    // Ordered on the instant, never on the raw string. String order is only
    // chronological while every row shares one date format, which the API does not
    // enforce, and localeCompare would additionally depend on the runtime locale.
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (real.length === 0) {
    return {
      ballInCourt: 'none',
      silenceDays: null,
      followupDue: false,
      firstContactAt: null,
      hasEverReplied: false,
      messageCount: 0,
      nextAction: 'first_mail',
    };
  }

  const last = real[real.length - 1];
  const ballInCourt: Situation['ballInCourt'] = last.message.direction === 'in' ? 'us' : 'them';
  const hasEverReplied = real.some((m) => m.message.direction === 'in');
  const firstContactAt = real.find((m) => m.message.direction === 'out')?.message.msg_date ?? null;

  // Clamped at zero: a message dated in the future is not a negative silence, and
  // the banner prints this number as it stands.
  const silenceDays = Math.max(0, Math.floor((today.getTime() - last.at.getTime()) / DAY_MS));

  const followupDue = ballInCourt === 'them' && silenceDays > FOLLOWUP_DAYS;

  // Order matters — see the plan. Without it, followup and firm_offer overlap.
  let nextAction: NextAction;
  if (ballInCourt === 'us') nextAction = 'reply';
  else if (followupDue) nextAction = 'followup';
  else if (hasEverReplied) nextAction = 'firm_offer';
  else nextAction = 'wait';

  return {
    ballInCourt,
    silenceDays,
    followupDue,
    firstContactAt,
    hasEverReplied,
    messageCount: real.length,
    nextAction,
  };
}

/** Human label for the banner and the list, in French. */
export const NEXT_ACTION_LABEL: Record<NextAction, string> = {
  first_mail: 'Premier mail à écrire',
  reply: 'Il attend ta réponse',
  followup: 'Relance due',
  firm_offer: 'Envoyer une offre ferme datée',
  wait: 'Rien à faire, en attente de sa réponse',
};
