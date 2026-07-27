import type { Message } from './types';

/**
 * How many trailing messages of a thread are shown. Four, as the composer has
 * always sent: enough for the model to hear the conversation, few enough that
 * the brief stays a brief.
 */
const TAIL_LENGTH = 4;

/**
 * How much of the last mail we sent goes into the brief, in characters.
 *
 * The rest of the tail stays on `snippet`, which the API caps at 280. Four
 * bodies at their full stored length, up to 8000 characters each, would be
 * 32000 characters of prompt to say what 280 already say for messages the
 * model only has to recognise rather than avoid repeating.
 *
 * 1500 covers an ordinary mail whole: the ones this CRM sends run 900 to 1200
 * characters. It is a ceiling for the unusual case, not the working value.
 */
export const PREVIOUS_MAIL_CHARS = 1500;

/** The label a marked line carries, which must never claim more than it shows. */
function previousMail(m: Message): { label: string; text: string } {
  const body = (m.body ?? '').trim();
  if (!body) {
    // `body` is optional on Message and the API does not fill it on every row.
    // Falling back to the snippet keeps the anti-repetition instruction, which
    // is the point of the line, while dropping the claim of completeness,
    // which would be a lie the model would act on: told it has the whole mail,
    // it would treat the 280 characters it can see as the whole mail and
    // rewrite the rest.
    return {
      label: 'MY PREVIOUS MAIL, opening only, the rest is not stored. Do not repeat any of it:',
      text: (m.snippet ?? '').trim(),
    };
  }
  if (body.length > PREVIOUS_MAIL_CHARS) {
    return {
      label: `MY PREVIOUS MAIL, its first ${PREVIOUS_MAIL_CHARS} characters. Do not repeat any of it:`,
      text: `${body.slice(0, PREVIOUS_MAIL_CHARS)} [cut here]`,
    };
  }
  return {
    label: 'MY PREVIOUS MAIL, in full. Do not repeat any of it, not one sentence:',
    text: body,
  };
}

/**
 * The tail of a thread, in the shape both the generator and the angles
 * endpoint read it.
 *
 * One function and not two literals: the angles are proposed from this text
 * and the draft is then written from it, so the two must be looking at the
 * same thread or the angle describes a conversation the generation cannot see.
 * The instruction below therefore reaches the angles endpoint as well, which
 * is deliberate: an angle proposed while the previous mail was half hidden is
 * an angle that mail may already have taken.
 *
 * The rule this file exists for: the last mail WE sent is quoted from `body`,
 * capped, and named. Every other line stays on `snippet`.
 *
 * The reason is a bug the owner reported as "a follow-up sends back the mail
 * already sent". A generator asked not to repeat the previous mail was shown
 * only its first 280 characters, since `snippet` is what the tail carried and
 * `body`, up to 8000 characters, sat unread in the same object. On a mail of
 * 900 to 1200 characters two thirds of it were invisible, so two thirds of it
 * were free to come back.
 *
 * The marked line is the last OUTBOUND message of the tail, chosen on
 * `direction === 'out'` and never on "not inbound": the type admits 'draft',
 * and a draft announced as the mail we sent would be an instruction built on
 * something that never left. A message with no text at all is skipped for the
 * same reason, so the label never introduces an empty quote.
 *
 * Scoped to the tail rather than to the whole thread: a tail of four with no
 * outbound message in it is a thread where they have written four times since
 * we last did, which is a reply to write and not a follow-up.
 *
 * Empty when there is no correspondence, which the callers each phrase in
 * their own way rather than sending a bare empty string.
 */
export function threadTail(messages: Message[]): string {
  const tail = messages.slice(-TAIL_LENGTH);

  let marked = -1;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const m = tail[i];
    if (m.direction !== 'out') continue;
    if (!(m.body ?? '').trim() && !(m.snippet ?? '').trim()) continue;
    marked = i;
    break;
  }

  return tail
    .map((m, i) => {
      const head = `[${m.direction === 'in' ? 'them' : 'me'} ${m.msg_date ?? ''}]`;
      if (i !== marked) return `${head} ${m.snippet ?? ''}`;
      const { label, text } = previousMail(m);
      return `${head} ${label}\n${text}`;
    })
    .join('\n');
}
