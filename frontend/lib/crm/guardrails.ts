import type { Intent } from './intent';
import { type PreviousMail, REPEAT_RATIO, repeatRatio, sameSubject } from './repeat';
import { HARD_CAP, SOFT_CAP } from './sent-today';
import type { GuardrailIssue, GuardrailReport } from './types';

export interface CheckInput {
  body: string;
  /**
   * Which writing path this is. Derived by intent.ts, never asked.
   *
   * Required rather than optional with a default: a caller that forgets it
   * would silently get the prospecting rule set on a reply, which is the exact
   * defect this field exists to remove. A compile error is the cheaper failure.
   */
  intent: Intent;
  /**
   * The subject line, when the caller has one. Optional so that a body-only
   * call keeps behaving exactly as it did before the field existed.
   *
   * Only `em_dash`, `spam_word` and `foreign_link` widen to it. All three are
   * about what the recipient reads, and the subject is the line most certain
   * to be read and the field spam filters weigh hardest; a domain a stranger
   * slipped into a generated subject is as much a lure as one in the body. The
   * other rules stay on the body: a subject is not prose, so counting its
   * words would distort a window tuned for a mail, a link in a header does not
   * cost what a link in the text costs, and an opt-out belongs in the closing
   * rather than the subject.
   */
  subject?: string;
  sentToday: number;
  /** A cold first touch: stricter length window, opt-out required. */
  isFirstTouch: boolean;
  /**
   * The last mail actually sent to this contact, when there is one.
   *
   * Optional, and absent means the two rules that read it say nothing at all,
   * so a caller that never heard of them keeps the report it had. It is handed
   * in rather than derived here for the same reason `sentToday` is: this
   * function stays a function of its arguments, and the selector that finds it
   * is tested on its own in repeat.ts.
   */
  previous?: PreviousMail;
}

/**
 * Short names for the blocking rules, for the two controls that carry the
 * override. The list under the composer says the whole sentence; the button
 * being clicked says what it is being clicked against, because on a short
 * window that list can be scrolled out of view while the button is not.
 *
 * Beside the rules rather than beside the markup that renders it: what belongs
 * in this map is decided by which rules block, which is decided here.
 *
 * Partial on purpose. A warning never reaches the override button, so a warning
 * needs no entry, and adding one for every rule would suggest the button can be
 * offered for any of them. A **blocking** rule with no entry is another matter:
 * it puts a raw code such as `daily_cap` in front of the operator. That case is
 * pinned by a test rather than left to be noticed, precisely because the rule
 * that would break it is one word away, in this file, from the rules that do
 * not block.
 */
export const BLOCK_LABEL: Partial<Record<GuardrailIssue['code'], string>> = {
  em_dash: 'tiret cadratin',
  empty_body: 'message vide',
  daily_cap: 'plafond du jour',
};

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
];

/**
 * The one-word opt-out, matched as a WORD. As a substring, "stop" was
 * satisfied by "stopped", "stops" and "non-stop" — the rule that protects the
 * sending domain on a cold first mail was the easiest one to pass by accident.
 */
const OPTOUT_WORD = /\bstop\b/;

const LINK_SCHEMES = ['https://', 'http://'];

/** Words that offer a call, a meeting or a demo, in the languages this desk writes. */
const CALL_WORDS =
  /\b(quick call|short call|a call|phone call|call me|jump on a call|hop on a call|meeting|demo|screen ?share|calendly|zoom|google meet|teams call|un appel|par téléphone|par telephone|au téléphone|au telephone|une réunion|une visio|ein anruf|telefonat|ein meeting|videocall|15 ?min)\b/i;

/**
 * Exported so the composer can say which field carries it without writing the
 * character a second time. A second literal elsewhere would drift the day this
 * rule widens: the block would still fire and the field pointer would name
 * nothing, which is the exact failure that pointer exists to prevent.
 */
export const EM_DASH = '—';

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
 * The one domain a draft may point to without a second look, with every
 * subdomain of it (`api.ibanforge.com`, `www.ibanforge.com`).
 */
const OWN_DOMAIN = 'ibanforge.com';

/**
 * File suffixes that read like a top-level domain in a sentence (`Node.js`,
 * `package.json`, `config.yaml`) and are none. Every entry was checked against
 * the public suffix list on 10.11.2026: none of them is a real TLD, so skipping
 * them lets no domain through.
 *
 * The suffixes that ARE real TLDs are left out on purpose, however much they
 * look like files: `.md`, `.py`, `.sh`, `.rs`, `.pl`, `.so`, `.zip`, `.mov`,
 * `.java`, `.ai`, `.app`, `.dev`, `.io`. `.rs` and `.pl` carry the sites of
 * the very banks this desk writes about, and `.zip` and `.mov` are known for
 * domains registered to be mistaken for files. A file name ending in `.md`
 * or `.zip` therefore warns: that is the price of the rule not letting a
 * `.zip` domain through.
 */
export const NOT_A_TLD: ReadonlySet<string> = new Set([
  'js',
  'mjs',
  'cjs',
  'jsx',
  'ts',
  'tsx',
  'json',
  'jsonc',
  'yml',
  'yaml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'env',
  'lock',
  'log',
  'txt',
  'csv',
  'tsv',
  'mdx',
  'html',
  'htm',
  'css',
  'scss',
  'xml',
  'svg',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'sql',
  'sqlite',
  'db',
  'wasm',
  'vue',
  'php',
  'rb',
  'go',
  'kt',
  'cs',
  'cpp',
  'swift',
  'gz',
  'tgz',
  'tar',
  'exe',
  'dll',
  'pem',
  'crt',
  'key',
  'csr',
  'patch',
  'diff',
  'ipynb',
  'bak',
  'tmp',
]);

/**
 * Dots IDNA reads as a dot (ideographic, fullwidth, halfwidth):
 * `alpha.example。net` resolves as `alpha.example.net`, so the scan reads it
 * that way too.
 */
const IDN_DOTS = new Set(['。', '．', '｡']);

/** One character, no quantifier: nothing for a backtracking engine to explore. */
const HOST_CHAR = /[\p{L}\p{N}]/u;
const LETTERS_ONLY = /^\p{L}+$/u;

/** The characters a sentence puts right after a link, and never part of it. */
const TRAILING_PUNCTUATION = new Set([
  '.',
  ',',
  ';',
  ':',
  '!',
  '?',
  ')',
  ']',
  '}',
  '>',
  '"',
  "'",
  '»',
  '’',
  '”',
]);

function isOwnHost(host: string): boolean {
  let end = host.length;
  while (end > 0 && host[end - 1] === '.') end -= 1;
  const h = host.slice(0, end).toLowerCase();
  return h === OWN_DOMAIN || h.endsWith(`.${OWN_DOMAIN}`);
}

/**
 * A run of host characters, written without a scheme, read as a domain or not.
 * A domain here is two labels at least, the last one letters only (or an IDN
 * `xn--` label), and not a file suffix. Version numbers (`1.10.0`, `v2.3`),
 * single letters (`e.g.`, `S.A.`) and file names (`package.json`) are not.
 */
function bareHost(token: string): string | null {
  let start = 0;
  let end = token.length;
  while (start < end && (token[start] === '.' || token[start] === '-')) start += 1;
  while (end > start && (token[end - 1] === '.' || token[end - 1] === '-')) end -= 1;
  const host = token.slice(start, end).toLowerCase();
  const labels = host.split('.');
  if (labels.length < 2 || labels.some((l) => l === '')) return null;
  const tld = labels[labels.length - 1];
  const tldLike = tld.startsWith('xn--') || (tld.length >= 2 && LETTERS_ONLY.test(tld));
  if (!tldLike) return null;
  if (labels[0] !== 'www' && NOT_A_TLD.has(tld)) return null;
  return host;
}

/**
 * Every domain written without a scheme in `text`, one pass. A token right
 * before an `@` is the local part of an address, not a site, so it is skipped;
 * the domain after the `@` is read like any other, since a mailbox a stranger
 * chose is the same lure as a link (`ibanforge.com@alpha.example.net` names
 * `alpha.example.net`).
 */
function bareHosts(text: string, out: string[]): void {
  let token = '';
  const flush = (next: string) => {
    if (token && next !== '@') {
      const host = bareHost(token);
      if (host) out.push(host);
    }
    token = '';
  };
  for (const ch of text) {
    if (ch === '.' || IDN_DOTS.has(ch)) token += '.';
    else if (ch === '-' || HOST_CHAR.test(ch)) token += ch;
    else flush(ch);
  }
  flush('');
}

/**
 * The host a `http(s)://` link really opens, read by the browser's own parser:
 * `https://ibanforge.com@alpha.example.net` opens `alpha.example.net`, and
 * `https://ibanforge.com.alpha.example.net` is not ours either. Text the parser
 * refuses is read as bare text instead, so a malformed link still names the
 * domains it carries.
 */
function linkHosts(link: string, scheme: string, out: string[]): void {
  let end = link.length;
  while (end > scheme.length && TRAILING_PUNCTUATION.has(link[end - 1])) end -= 1;
  if (end === scheme.length) return; // a scheme with nothing behind it
  const trimmed = link.slice(0, end);
  let host = '';
  try {
    host = new URL(trimmed).hostname;
  } catch {
    host = '';
  }
  if (host) out.push(host.toLowerCase());
  else bareHosts(trimmed.slice(scheme.length), out);
}

/**
 * Every host a text points to that is not ibanforge.com or one of its
 * subdomains, deduplicated, in reading order.
 *
 * Each whitespace-delimited run is split at every `http://` or `https://` it
 * holds, whatever their case: the part before the first scheme is read as bare
 * text, each part from a scheme to the next as a link. A link nested in the
 * query of one of ours (`https://ibanforge.com/r?u=https://alpha.example.net`) is
 * therefore read on its own. Linear in the length of the text, like every
 * other scan in this file: the composer runs it on each keystroke.
 */
export function foreignHosts(text: string): string[] {
  const hosts: string[] = [];
  let start = -1;
  for (let i = 0; i <= text.length; i += 1) {
    const boundary = i === text.length || WHITESPACE.test(text[i]);
    if (!boundary) {
      if (start === -1) start = i;
      continue;
    }
    if (start === -1) continue;
    readRun(text.slice(start, i), hosts);
    start = -1;
  }
  const seen = new Set<string>();
  return hosts.filter((h) => {
    if (isOwnHost(h) || seen.has(h)) return false;
    seen.add(h);
    return true;
  });
}

/**
 * The scheme starting at `at`, whatever its case, or undefined. Compared on a
 * slice of the scheme's own length rather than on a lowercased copy of the
 * whole text: lowercasing can change a string's length (`İ`), and an index
 * read on the copy would then point beside the link in the original.
 */
function schemeAt(run: string, at: number): string | undefined {
  return LINK_SCHEMES.find((s) => run.slice(at, at + s.length).toLowerCase() === s);
}

function readRun(run: string, out: string[]): void {
  const starts: Array<{ at: number; scheme: string }> = [];
  for (let at = 0; at < run.length; at += 1) {
    if (run[at] !== 'h' && run[at] !== 'H') continue;
    const scheme = schemeAt(run, at);
    if (!scheme) continue;
    starts.push({ at, scheme });
    at += scheme.length - 1;
  }
  bareHosts(starts.length ? run.slice(0, starts[0].at) : run, out);
  starts.forEach(({ at, scheme }, k) => {
    const next = k + 1 < starts.length ? starts[k + 1].at : run.length;
    linkHosts(run.slice(at, next), scheme, out);
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
export function checkDraft({
  body,
  subject,
  sentToday,
  isFirstTouch,
  previous,
  intent,
}: CheckInput): GuardrailReport {
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
  if (written.includes(EM_DASH)) {
    issues.push({
      code: 'em_dash',
      level: 'blocking',
      message:
        'Tiret cadratin détecté. C’est un marqueur IA : remplace-le par une virgule, un point ou des parenthèses.',
    });
  }

  /**
   * Both intentions. Sending an empty mail is never what was meant, and it is
   * the one mistake a fast reply path makes easy: the sheet opens focused, and
   * a stray Enter would otherwise send nothing at all.
   */
  if (!body.trim()) {
    issues.push({
      code: 'empty_body',
      level: 'blocking',
      message: 'Le message est vide.',
    });
  }

  /**
   * Both intentions, and the reply above all (audit of 10/11/2026, WEB-14). A
   * reply draft is written by a model that has read the sender's mail, and a
   * sender who writes instructions to that model can have it copy a link of
   * his choosing into our answer, under our name. The only address a mail of
   * ours needs is ibanforge.com, so any other host is shown before sending.
   *
   * A warning, never a block: citing a bank's register or a library is
   * sometimes the right answer, and the operator is the one who knows whether
   * this link is his. One issue per draft, naming the first host and counting
   * the rest, since the panel keys its rows by code.
   */
  const foreign = foreignHosts(written);
  if (foreign.length > 0) {
    const first = foreign[0].length > 60 ? `${foreign[0].slice(0, 59)}…` : foreign[0];
    const more =
      foreign.length > 1
        ? ` et ${foreign.length - 1} autre${foreign.length > 2 ? 's' : ''}`
        : '';
    issues.push({
      code: 'foreign_link',
      level: 'warning',
      message: `Lien ou domaine hors d’ibanforge.com : « ${first} »${more}. Vérifie qu’il vient de toi, pas du message reçu ni du modèle, avant d’envoyer.`,
    });
  }

  /**
   * Everything below is prospecting hygiene: cadence against a domain's
   * reputation, a length window tuned for a cold mail, an opt-out a stranger is
   * owed, and repetition against the last mail we sent unprompted.
   *
   * None of it applies to a reply. Answering a question in two sentences is not
   * a mail that is too short, and someone who just wrote to us does not need to
   * be offered a way to stop being contacted.
   */
  if (intent === 'outbound') {
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

    // An empty body raises `empty_body` above and must not also be lectured on
    // length here: "0 mots, la cible est 40-90" on a draft not yet started is
    // noise on every open of the sheet, and a word count only means something
    // once there are words.
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
    if (
      isFirstTouch &&
      !OPTOUT_HINTS.some((h) => lowerBody.includes(h)) &&
      !OPTOUT_WORD.test(lowerBody)
    ) {
      issues.push({
        code: 'no_optout',
        level: 'warning',
        message:
          'Pas de sortie proposée. Un premier mail à froid doit offrir de ne plus être contacté.',
      });
    }

    // One flag per draft, not one per match: a panel that turns red seven times
    // for one bad sentence is a panel the operator stops reading. Subject
    // included, since that is the field the filters weigh hardest.
    const hit = SPAM_WORDS.find((w) => lowerWritten.includes(w));
    if (hit) {
      issues.push({ code: 'spam_word', level: 'warning', message: `Mot à risque : « ${hit} ».` });
    }

    // The owner's standing rule: a mail never proposes a call. The brief says
    // so to the writer; this is the check that says so to the sender, because
    // an instruction in a prompt is not a guarantee. A warning, not a block:
    // the fault is not writing the word, it is letting it leave unseen.
    const call = lowerWritten.match(CALL_WORDS);
    if (call) {
      issues.push({
        code: 'phone_call',
        level: 'warning',
        message: `Propose un appel ou une réunion (« ${call[0]} ») : la règle est une réponse écrite, jamais un appel.`,
      });
    }

    /**
     * The question nothing here used to ask: does this say what the last mail
     * already said. Both of these warn and neither ever blocks. See repeat.ts for
     * why the measure is what it is; the choice of level is the point here.
     *
     * An em dash and the daily cap are promises about the domain's reputation,
     * which is why they take the send away until the operator overrides them.
     * Resending a close text is not that. It is an editorial call, sometimes the
     * right one, and the operator is the only one holding what the recipient
     * said on the phone yesterday. So this is loud and never in the way.
     */
    if (previous) {
      const ratio = repeatRatio(body, previous.text);
      if (ratio !== null && ratio >= REPEAT_RATIO) {
        // Rounded to the nearest ten: the figure is a reading of a set overlap,
        // not a measurement, and printing 62 % invites an argument about the 2.
        const rounded = Math.round(ratio * 10) * 10;
        issues.push({
          code: 'repeat_previous',
          level: 'warning',
          message: `Environ ${rounded} % de ce texte se retrouve déjà dans ton dernier mail envoyé. Coupe ce qui a déjà été dit et garde une seule idée neuve.`,
        });
      }
      // Cheaper than the body comparison and more visible to the recipient: the
      // subject is the line they read before deciding to open anything.
      if (subject && sameSubject(subject, previous.subject)) {
        issues.push({
          code: 'same_subject',
          level: 'warning',
          message:
            'Objet identique à ton dernier mail envoyé. Donne-lui un objet qui annonce ce que celui-ci apporte de neuf.',
        });
      }
    }
  }

  return { issues, blocking: issues.some((i) => i.level === 'blocking') };
}
