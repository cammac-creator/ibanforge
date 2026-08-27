import type { Contact, Situation } from './types';

/** Which of the two writing paths applies. Never asked, always derived. */
export type Intent = 'reply' | 'outbound';

/**
 * Reply when the ball is in our court, which is `situationOf`'s way of saying the
 * other side wrote last and is waiting.
 *
 * Derived from the situation rather than from `Contact.messages` on purpose. That
 * array keeps help-desk automation: build-contacts.ts drops drafts and the rows
 * it cannot date, and nothing else. situationOf already drops automated messages,
 * requires a readable date, and orders on the instant instead of the raw string.
 * Reading the array here
 * would have counted a robot's acknowledgement as a human reply, disarming the
 * prospecting guardrails on a thread nobody answered, and would have contradicted
 * the situation band shown three centimetres above the composer.
 *
 * An absent situation answers `outbound`, which keeps every guardrail armed.
 *
 * ## The one exception, and why it is an exception
 *
 * An institutional correspondent is always on the `reply` path, thread or no
 * thread. `outbound` does not mean "we are writing first", it means "this is
 * cold prospecting", and it carries the whole apparatus that goes with it: the
 * angles, the pre-written pitch, the daily send cap as a BLOCKING rule, the
 * cold-mail length window, and a warning that the mail owes its reader a way to
 * stop being contacted. Applied to a written request for a data permission,
 * every one of those is wrong, and two of them are actively harmful: an opt-out
 * line at the foot of a letter to a supervisor, and a regulatory answer refused
 * because eight commercial mails happened to go out the same morning.
 *
 * So the kind decides here, once, and both the sheet that is rendered and the
 * rule set that is armed read the same answer. A first letter to an institution
 * is still a first letter; it is just not a cold pitch.
 */
export function intentOf(situation: Situation | undefined, kind?: Contact['kind']): Intent {
  if (kind === 'institution') return 'reply';
  return situation?.ballInCourt === 'us' ? 'reply' : 'outbound';
}
