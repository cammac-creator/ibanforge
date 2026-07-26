import { HARD_CAP, SOFT_CAP } from './sent-today';
import type { GuardrailIssue, GuardrailReport } from './types';

export interface CheckInput {
  body: string;
  /**
   * The subject line, when the caller has one. Optional so that a body-only
   * call keeps behaving exactly as it did before the field existed.
   *
   * Only `em_dash` and `spam_word` widen to it. Both are about what the
   * recipient reads, and the subject is the line most certain to be read and
   * the field spam filters weigh hardest. The other rules stay on the body: a
   * subject is not prose, so counting its words would distort a window tuned
   * for a mail, a link in a header is not a link in the text, and an opt-out
   * belongs in the closing rather than the subject.
   */
  subject?: string;
  sentToday: number;
  /** A cold first touch: stricter length window, opt-out required. */
  isFirstTouch: boolean;
}

const FOLLOWUP_WORDS = { min: 40, max: 90 };
const FIRST_TOUCH_WORDS = { min: 90, max: 140 };

/** Short list, deliberately: a long list produces noise and gets ignored. */
const SPAM_WORDS = [
  'gratuit',
  'garanti',
  'sans engagement',
  'cliquez',
  'offre exceptionnelle',
  'free trial',
  'guaranteed',
  'act now',
  'limited time',
  'click here',
];

const OPTOUT_HINTS = [
  'désinscri',
  'desinscri',
  'ne plus recevoir',
  'opt out',
  'opt-out',
  'unsubscribe',
  'stop',
];

const LINK_SCHEMES = ['https://', 'http://'];

/**
 * A single character class and no quantifier at all, so there is nothing for a
 * backtracking engine to explore. Every scan below is one left-to-right pass
 * over the body: the draft is operator text of unbounded length, and a pattern
 * that degrades on a crafted line would freeze the composer while it typed.
 */
const WHITESPACE = /\s/;

/**
 * Words and links in one pass. A word is a maximal run of non-whitespace, the
 * same thing `trim().split(/\s+/)` counts. A link is such a run containing a
 * scheme with at least one character behind it, which is what `https?:\/\/\S+`
 * matches: the greedy tail eats the rest of the run, so a run is worth one link
 * at most, however many schemes it holds.
 *
 * The scheme test runs against the run alone rather than searching forward
 * through the whole body from each run, which would be quadratic on a draft
 * with many words and no link at all.
 *
 * Case matters here, as it did in the pattern this replaces: a hand-typed
 * `HTTPS://` is not counted. Composers emit lowercase schemes.
 */
function scanBody(body: string): { words: number; links: number } {
  let words = 0;
  let links = 0;
  let start = -1;

  for (let i = 0; i <= body.length; i += 1) {
    const boundary = i === body.length || WHITESPACE.test(body[i]);
    if (!boundary) {
      if (start === -1) start = i;
      continue;
    }
    if (start === -1) continue;
    words += 1;
    if (hasLink(body.slice(start, i))) links += 1;
    start = -1;
  }

  return { words, links };
}

function hasLink(run: string): boolean {
  return LINK_SCHEMES.some((scheme) => {
    const at = run.indexOf(scheme);
    return at !== -1 && at + scheme.length < run.length;
  });
}

/**
 * Pre-send checks. Blocking issues disable the send button; the UI still offers
 * an explicit two-click override, because these protect the domain reputation
 * without taking the decision away from the operator.
 *
 * Pure by design: `sentToday` arrives as a number and is never recomputed here,
 * so the whole page judges one snapshot and the rules stay testable on the nose.
 */
export function checkDraft({ body, subject, sentToday, isFirstTouch }: CheckInput): GuardrailReport {
  const issues: GuardrailIssue[] = [];
  const lowerBody = body.toLowerCase();

  /**
   * Everything the recipient reads, for the two rules that span both fields.
   *
   * Joined with a newline rather than a space on purpose: every multi-word spam
   * phrase is separated by single spaces, so a space would let a subject ending
   * in "sans" and a body opening on "engagement" forge a match that neither
   * field contains. A newline cannot be mistaken for the inside of a phrase.
   */
  const written = subject ? `${subject}\n${body}` : body;
  const lowerWritten = subject ? written.toLowerCase() : lowerBody;

  // The owner's own rule, and the reason it blocks rather than warns: an em
  // dash in prose reads as a machine wrote the sentence, and the whole point of
  // this CRM is a founder writing to one person at a time. A generated subject
  // line announces it just as loudly as a generated paragraph.
  if (written.includes('—')) {
    issues.push({
      code: 'em_dash',
      level: 'blocking',
      message:
        'Tiret cadratin détecté. C’est un marqueur IA : remplace-le par une virgule, un point ou des parenthèses.',
    });
  }

  if (sentToday >= HARD_CAP) {
    issues.push({
      code: 'daily_cap',
      level: 'blocking',
      message: `Plafond du jour atteint (${sentToday}/${HARD_CAP}). Au-delà, tu joues la réputation du domaine.`,
    });
  } else if (sentToday >= SOFT_CAP) {
    issues.push({
      code: 'daily_high',
      level: 'warning',
      message: `${sentToday} mails déjà partis aujourd’hui. La cadence visée est de 5 à 8.`,
    });
  }

  const { words, links } = scanBody(body);

  // An empty body raises nothing on purpose: a blank draft is the composer's
  // business, and answering "0 mots, la cible est 40-90" to someone who has not
  // started writing would be noise on every new draft.
  // Named `target` rather than `window`: this package ships to a browser, and a
  // local binding that shadows the DOM global inside a function is a trap for
  // whoever edits it next.
  const target = isFirstTouch ? FIRST_TOUCH_WORDS : FOLLOWUP_WORDS;
  if (words > 0 && (words < target.min || words > target.max)) {
    issues.push({
      code: 'length',
      level: 'warning',
      // Task 11 checks as the operator types, so this message is on screen from
      // the first word onwards. "1 mots" every time a draft is started reads as
      // a broken tool, which is not what a panel asking to be trusted can do.
      message: `${words} mot${words > 1 ? 's' : ''}. La cible ${isFirstTouch ? 'pour un premier mail' : 'pour une relance'} est ${target.min}-${target.max}.`,
    });
  }

  if (links > 1) {
    issues.push({
      code: 'too_many_links',
      level: 'warning',
      message: `${links} liens. Un seul suffit, au-delà le filtre anti-spam se méfie.`,
    });
  }

  // Body only: an opt-out in the header is not an opt-out.
  if (isFirstTouch && !OPTOUT_HINTS.some((h) => lowerBody.includes(h))) {
    issues.push({
      code: 'no_optout',
      level: 'warning',
      message: 'Pas de sortie proposée. Un premier mail à froid doit offrir de ne plus être contacté.',
    });
  }

  // One flag per draft, not one per match: a panel that turns red seven times
  // for one bad sentence is a panel the operator stops reading. Subject
  // included, since that is the field the filters weigh hardest.
  const hit = SPAM_WORDS.find((w) => lowerWritten.includes(w));
  if (hit) {
    issues.push({ code: 'spam_word', level: 'warning', message: `Mot à risque : « ${hit} ».` });
  }

  return { issues, blocking: issues.some((i) => i.level === 'blocking') };
}
