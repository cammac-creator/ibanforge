import { isAutomated } from './automated';
import { freshOnly } from './quoted';
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

/**
 * How much of the mail we have to answer goes into the brief, in characters.
 *
 * Higher than the outbound cap on purpose. The outbound quote exists so the
 * model can avoid repeating itself, a job the opening does most of; this one
 * exists so the model can answer, a job that needs the whole thing, because
 * the question is as likely to be in the last paragraph as the first. Stored
 * bodies stop at 8000 and the quoted history is removed before this applies,
 * so a real mail almost never reaches this ceiling.
 */
export const INCOMING_MAIL_CHARS = 4000;

/**
 * Said on every incoming label that shows less than the whole mail.
 *
 * Without it the truncation is indistinguishable from the sender trailing off,
 * and the model answers the wrong thing: shown 280 characters ending inside a
 * word, it wrote "I saw your message got cut off after ... curious what you
 * were about to say" to a correspondent whose mail was complete and whose
 * actual question sat in the part that had been cut. Extending the cap without
 * this sentence just moves that failure to a later character.
 */
const OUR_CUT = 'cut here by this tool and NOT by the sender, who did not stop mid-sentence';

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
 * The mail we owe an answer to, quoted from `body` rather than from `snippet`.
 *
 * `freshOnly` first, and not as a nicety: a reply carries the mail it answers
 * underneath it, so the raw body would hand our own previous mail back to the
 * model a second time, unlabelled, right after the line that tells it not to
 * repeat that mail.
 *
 * The strict variant and not `splitQuoted`, whose display fallback returns the
 * quoted history as `fresh` so that a thread bubble is never empty. That is
 * the right answer for the bubble and the wrong one here, and it fires on
 * exactly the reply this cares about, the one that opens on a quote marker.
 * Empty then falls back to the snippet, which says what it is showing.
 */
function incomingMail(m: Message): { label: string; text: string } {
  const fresh = freshOnly(m.body ?? '');
  if (!fresh) {
    return {
      label: `THEIR MAIL, the opening only, the rest is not stored, ${OUR_CUT}. Answer what it asks:`,
      text: (m.snippet ?? '').trim(),
    };
  }
  if (fresh.length > INCOMING_MAIL_CHARS) {
    return {
      label: `THEIR MAIL, its first ${INCOMING_MAIL_CHARS} characters, ${OUR_CUT}. Answer every question in it:`,
      // The marker carries the ownership of the cut too, rather than the bare
      // `[cut here]` the outbound line uses. By the time the model reaches it
      // the label is four thousand characters behind, and the boundary is
      // exactly where the wrong impression forms.
      text: `${fresh.slice(0, INCOMING_MAIL_CHARS)} [truncated by this tool, not by the sender]`,
    };
  }
  return {
    label: 'THEIR MAIL, in full. This is what you must answer: address every question it asks:',
    text: fresh,
  };
}

/** The last message of the tail this predicate accepts that has any text at all. */
function lastWithText(tail: Message[], accept: (m: Message) => boolean): number {
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const m = tail[i];
    if (!accept(m)) continue;
    if (!(m.body ?? '').trim() && !(m.snippet ?? '').trim()) continue;
    return i;
  }
  return -1;
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
 * The rule this file exists for: two lines of the tail are quoted from `body`,
 * capped, and named. Every other line stays on `snippet`.
 *
 * The first is the last mail WE sent, and the bug behind it was reported as "a
 * follow-up sends back the mail already sent". A generator asked not to repeat
 * the previous mail was shown only its first 280 characters, since `snippet`
 * is what the tail carried and `body`, up to 8000 characters, sat unread in
 * the same object. On a mail of 900 to 1200 characters two thirds of it were
 * invisible, so two thirds of it were free to come back.
 *
 * The second is the mail THEY sent that we have not answered, and its bug was
 * reported as "the generated reply does not answer the questions". The same
 * 280-character cap applied to it, so the message the draft exists to answer
 * was the one message the generator could not read, while the message it must
 * not repeat was the one it read in full. The priorities were exactly
 * inverted, and the cost is not a clumsy sentence: a correspondent who asks
 * two questions and gets a reply addressing neither reads it as not having
 * been read.
 *
 * That line is marked only when no outbound message follows it. Their mail is
 * the one to answer when we have not written since; once we have, it is
 * context for a follow-up, and telling the generator to answer a mail already
 * answered would produce a second reply to the same questions.
 *
 * Both marked lines are chosen on an explicit direction and never on its
 * negation: the type admits 'draft', and a draft announced as the mail we sent
 * would be an instruction built on something that never left. A message with
 * no text at all is skipped for the same reason, so a label never introduces
 * an empty quote.
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

  const markedOut = lastWithText(tail, (m) => m.direction === 'out');
  /*
   * Automated messages are skipped here and nowhere else in this file. They
   * stay in the tail as context, which costs nothing, but a support-desk
   * acknowledgement introduced as the mail to answer would have the generator
   * write a reply to a robot. `situation` already filters them for the same
   * reason and this file does not see its verdict, so the rule is applied
   * again rather than assumed: five of sixteen inbound messages were
   * automation when the mailbox was measured, so the case is ordinary.
   *
   * Skipping rather than stopping: a human mail still waiting for an answer
   * behind a later robot ack is still the mail to answer.
   */
  const lastIn = lastWithText(tail, (m) => m.direction === 'in' && !isAutomated(m));
  // Unanswered, which is the only state where the mail is one to answer.
  const markedIn = lastIn > markedOut ? lastIn : -1;

  return tail
    .map((m, i) => {
      const head = `[${m.direction === 'in' ? 'them' : 'me'} ${m.msg_date ?? ''}]`;
      if (i === markedOut) {
        const { label, text } = previousMail(m);
        return `${head} ${label}\n${text}`;
      }
      if (i === markedIn) {
        const { label, text } = incomingMail(m);
        return `${head} ${label}\n${text}`;
      }
      return `${head} ${m.snippet ?? ''}`;
    })
    .join('\n');
}
