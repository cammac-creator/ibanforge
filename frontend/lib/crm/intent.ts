import type { Situation } from './types';

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
 */
export function intentOf(situation: Situation | undefined): Intent {
  return situation?.ballInCourt === 'us' ? 'reply' : 'outbound';
}
