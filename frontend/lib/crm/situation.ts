import type { Message, NextAction, Situation } from './types';

/** Days of silence after which an unanswered outbound becomes a followup. */
export const FOLLOWUP_DAYS = 10;

const DAY_MS = 86_400_000;

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Derive the state of a conversation from its messages alone. Pure: no network,
 * no clock beyond the `today` argument, so it is deterministic under test.
 *
 * Drafts are excluded from every computation: an unsent draft changes neither
 * who holds the ball nor how long the silence has run.
 */
export function situationOf(messages: Message[], today: Date = new Date()): Situation {
  // filter() already hands back a fresh array, so sorting it in place leaves the
  // caller's messages untouched.
  const real = messages
    .filter((m) => m.direction === 'in' || m.direction === 'out')
    .sort((a, b) => (a.msg_date ?? '').localeCompare(b.msg_date ?? ''));

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
  const ballInCourt: Situation['ballInCourt'] = last.direction === 'in' ? 'us' : 'them';
  const hasEverReplied = real.some((m) => m.direction === 'in');
  const firstContactAt = real.find((m) => m.direction === 'out')?.msg_date ?? null;

  const lastDate = parseDate(last.msg_date);
  const silenceDays = lastDate ? Math.floor((today.getTime() - lastDate.getTime()) / DAY_MS) : null;

  // The null check is what lets TypeScript compare below; at runtime a null
  // silence would already fall through as false.
  const followupDue =
    ballInCourt === 'them' && silenceDays !== null && silenceDays > FOLLOWUP_DAYS;

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
