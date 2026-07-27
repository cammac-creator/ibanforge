import type { Message } from './types';

/**
 * Does this draft say what the last mail already said?
 *
 * The fourth cause of the defect the owner reported as "a follow-up sends back
 * the mail already sent". The first three were about the draft being written:
 * a button that copied the first mail, a brief that showed the generator 280
 * characters of a mail it was told not to repeat, and a prompt that never asked
 * for a follow-up. This one is about the draft being sent. Nothing between the
 * text and the send button ever asked the one question that would have caught
 * all three from the outside.
 *
 * It is a warning and never a block. Resending a text close to the last one is
 * sometimes exactly right, and the operator is the one who knows: unlike the em
 * dash or the daily cap, nothing here is a promise to the domain's reputation.
 * The rule's job is to make the resemblance impossible to miss, not to decide.
 *
 * ## The measure, and why this one
 *
 * Word trigrams, compared as sets, scored by their overlap coefficient:
 * shared / the smaller of the two counts. Three properties earn it its place,
 * and all three were measured on invented fixtures rather than assumed.
 *
 * A trigram is what makes a repeated signature cheap. "Bien à vous," and a name
 * are a handful of trigrams inside a mail worth eighty, and the trigrams that
 * straddle the join between the new text and the shared closing differ, since
 * what precedes them differs. Measured: a genuine follow-up that repeats the
 * greeting, an entire sixteen-word closing formula AND the signature scores
 * 0.37, well under the threshold, while a rewrite that swaps one word in six
 * scores 0.76 and a rewrite that swaps one in four scores 0.55. Boilerplate
 * costs little because boilerplate is short; a paraphrase costs a lot because
 * every substituted word destroys three trigrams around it.
 *
 * The smaller count as the denominator, rather than the new text's, because the
 * previous mail can be the shorter of the two. The store does not fill `body`
 * on every row, so what we hold may be 280 characters of a mail that was 600.
 * Measured on that pair, a verbatim copy of the whole mail scores 0.47 against
 * the new text and 0.98 against the shorter side: the ratio taken over the new
 * text alone misses the owner's own defect whenever the body was not kept.
 * Jaccard misses it too, for the same reason, and Jaccard additionally punishes
 * a mail for being long.
 *
 * The cost of the overlap coefficient is that a short text buried in a long one
 * scores 1. That is not a flaw here: a paragraph of the mail already sent,
 * pasted into a longer draft, is the thing being looked for.
 *
 * ## What it does not catch, said plainly
 *
 * A heavy paraphrase. One word in three rewritten scores 0.02, indistinguishable
 * from a fresh mail. No set-of-n-grams measure reaches that case; catching it
 * would take an embedding, which means a network call on every keystroke.
 *
 * A repeat of a mail two steps back: only the last outbound is compared, which
 * is what the message on screen claims and no more.
 *
 * Anything short. See MIN_SHINGLES.
 *
 * ## No regex over the text
 *
 * The scan below is one left-to-right pass with a single character class and no
 * quantifier, exactly as `scanBody` in guardrails.ts. Both bodies are text from
 * outside, one of them retyped on every keystroke, and this repository has paid
 * twice for a quantifier that backtracked on a crafted line.
 */

/** Words per shingle. Three: see the header for the arithmetic behind it. */
export const SHINGLE = 3;

/**
 * How many shingles the shorter side must hold before the ratio means anything.
 *
 * Thirty, which is about thirty-two words. Under it the score is dominated by
 * the greeting, the closing formula and the signature, all of which two honest
 * mails share: measured, a twenty-five word follow-up that keeps the same
 * closing formula scores 0.71, and warning about it would be crying over
 * exactly the legitimate repetition this rule must tolerate. Thirty-two words
 * is also under the forty this CRM aims at for a follow-up, so a mail that
 * short already has the length rule speaking to it.
 *
 * The floor is on the shorter of the two texts, so a very short previous mail
 * abstains as well. What covers that case is the subject rule below: an
 * identical subject is the cheap half of the same question.
 */
export const MIN_SHINGLES = 30;

/** At or above this, the draft is worth a warning. Calibrated, see the header. */
export const REPEAT_RATIO = 0.5;

/** The last mail actually sent, in the two fields worth comparing. */
export interface PreviousMail {
  subject: string | null;
  text: string;
}

/**
 * A letter or a digit. One character class, no quantifier, tested one character
 * at a time: everything else is a separator, so `l'établissement` and
 * `l’établissement` yield the same two words whichever apostrophe was typed,
 * and a trailing comma never makes a word its own.
 */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Lowercased words, in order. */
function tokenize(text: string): string[] {
  const lower = text.toLowerCase();
  const out: string[] = [];
  let start = -1;
  for (let i = 0; i <= lower.length; i += 1) {
    const inWord = i < lower.length && WORD_CHAR.test(lower[i]);
    if (inWord) {
      if (start === -1) start = i;
      continue;
    }
    if (start === -1) continue;
    out.push(lower.slice(start, i));
    start = -1;
  }
  return out;
}

/** The distinct runs of SHINGLE consecutive words. Empty under that length. */
function shingles(text: string): Set<string> {
  const words = tokenize(text);
  const set = new Set<string>();
  for (let i = 0; i + SHINGLE <= words.length; i += 1) {
    set.add(words.slice(i, i + SHINGLE).join(' '));
  }
  return set;
}

/**
 * How much of the shorter text is also in the longer one, from 0 to 1.
 *
 * Symmetric on purpose: the question is whether these two mails say the same
 * thing, and which of them happens to be held in full is an accident of what
 * the store kept. 0 when either side is shorter than one shingle, which is the
 * honest answer to a comparison there is nothing to make.
 */
export function overlap(a: string, b: string): number {
  const left = shingles(a);
  const right = shingles(b);
  if (left.size === 0 || right.size === 0) return 0;
  return shared(left, right) / Math.min(left.size, right.size);
}

/** How many shingles the two texts have in common. */
function shared(left: Set<string>, right: Set<string>): number {
  let n = 0;
  for (const s of left) if (right.has(s)) n += 1;
  return n;
}

/**
 * The same measure, or null when the pair is too short to be judged.
 *
 * Null and zero are different answers and the caller must not conflate them:
 * one says these mails do not resemble each other, the other says do not ask.
 */
export function repeatRatio(next: string, previous: string): number | null {
  const left = shingles(next);
  const right = shingles(previous);
  const floor = Math.min(left.size, right.size);
  if (floor < MIN_SHINGLES) return null;
  return shared(left, right) / floor;
}

/**
 * The same subject line, give or take how it was typed.
 *
 * Compared as words, so spacing, case and trailing punctuation do not decide
 * it, and no quantified pattern touches the text. A reply prefix is left where
 * it is: "Re: X" answering "X" is ordinary mail rather than a duplicate, and
 * stripping it would make every threaded reply look like one.
 */
export function sameSubject(next: string, previous: string | null): boolean {
  if (!previous) return false;
  const a = tokenize(next);
  if (a.length === 0) return false;
  const b = tokenize(previous);
  if (a.length !== b.length) return false;
  return a.every((w, i) => w === b[i]);
}

/**
 * The last mail we actually sent, or null.
 *
 * Deliberately not the selector in thread-tail.ts, which looks for the same
 * thing inside the last four messages only. That bound is right there and wrong
 * here: a tail of four with no outbound in it means they have written four
 * times since we last did, which is a reply to compose rather than a follow-up
 * to write. Here the question is what was last said in our own words, however
 * far back that was, so the whole thread is searched.
 *
 * Drafts are skipped even when a draft is the newest row: nothing in a draft
 * has been said to anyone yet, and the card in the thread would otherwise be
 * compared against itself. A row with no text at all is skipped too, since it
 * would abstain anyway and hide an older mail that could be judged.
 *
 * `body` first, `snippet` only when there is no body: the snippet is the
 * opening 280 characters and comparing against it can only find fewer
 * repetitions, never more.
 */
export function lastOutbound(messages: Message[]): PreviousMail | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.direction !== 'out') continue;
    const text = (m.body ?? '').trim() || (m.snippet ?? '').trim();
    if (!text) continue;
    return { subject: m.subject, text };
  }
  return null;
}
