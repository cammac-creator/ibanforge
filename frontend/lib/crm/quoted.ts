/**
 * Split a mail body into the new text and the quoted history.
 *
 * Display concern only: the stored body is never modified. Real threads carry
 * the whole history inline ('>' prefixes, Outlook 'From:' blocks, localized
 * attribution lines), which makes long threads unreadable when rendered raw.
 */

/** Attribution and separator scanning run per line on bodies that arrive from
 *  outside, so a single very long line must not become a denial of service.
 *  Real attribution lines and delimiters are short; anything past this length
 *  is not one, and skipping it only means showing more text rather than less. */
const MAX_MARKER_LINE = 400;

/** Attribution lines: "On <date>, X wrote:", "Le <date>, X a écrit :", German, Finnish.
 *  A real attribution always carries a date or an address, so require a digit or an "@":
 *  without that guard, ordinary prose ending in "wrote:" is mistaken for a quote header. */
const ATTRIBUTION =
  /^(?=.*[\d@])\s*(On\b.*\bwrote\s*:|Le\b.*\ba écrit\s*:|Am\b.*\bschrieb\b.*:|.*\bkirjoitti\s*:|Op\b.*\bschreef\b.*:|Il\b.*\bha scritto\s*:|El\b.*\bescribió\s*:|Em\b.*\bescreveu\s*:)\s*$/i;

/** A separator run that introduces a forwarded header block, including labeled
 *  delimiters ("-----Original Message-----", "---------- Forwarded message ---------").
 *  Fixed-length head and tail tests on a trimmed line, rather than one pattern with
 *  a lazy middle: when several parts can all consume "-", a long dash run that never
 *  closes backtracks superlinearly. No quantifier here is unbounded, so this check
 *  cannot be the freeze. What keeps a decorative rule inside a body from being read
 *  as a quote marker is not this predicate but the HEADER regex, which the caller
 *  applies to the next three lines. */
function isSeparator(line: string): boolean {
  const trimmed = line.trim();
  return /^[-_]{5}/.test(trimmed) && /[-_]{5}$/.test(trimmed);
}

/** Header lines of a quoted block, in the locales this mailbox actually receives
 *  (English, French, German, Dutch, Italian, Spanish, Portuguese). The French forms
 *  matter twice: a French correspondent writes them, and so does the translator that
 *  turns "Von: / Gesendet:" into "De : / Envoyé :" before the bubble is drawn. */
const HEADER =
  /^\s*(From|De|Von|Van|Da|Sent|Envoyé|Gesendet|Verzonden|Inviato|Enviado|Enviada|To|À|An|Aan|A|Para|Cc|Subject|Objet|Betreff|Onderwerp|Oggetto|Asunto|Assunto|Date|Datum|Data|Fecha)\s*:/i;

/** The line a header block opens on: the sender. */
const HEADER_OPEN = /^\s*(From|De|Von|Van|Da)\s*:/i;

/** An Outlook-style header block with no separator above it: a sender line followed,
 *  within the next four lines, by at least two more header lines. Outlook, Apple Mail
 *  and the translator all emit the block bare, and one "De :" alone in French prose
 *  must not fold a mail, hence the two further lines. */
function isHeaderBlock(lines: string[], i: number): boolean {
  if (!HEADER_OPEN.test(lines[i])) return false;
  const following = lines.slice(i + 1, i + 5).filter((l) => l.length <= MAX_MARKER_LINE);
  return following.filter((l) => HEADER.test(l)).length >= 2;
}

/** Index of the first line that opens the quoted history, or -1. */
function quoteCut(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // The '>' test is O(1) and always runs; the regex checks are length-guarded.
    if (line.trimStart().startsWith('>')) return i;
    const scannable = line.length <= MAX_MARKER_LINE;
    if (scannable && ATTRIBUTION.test(line)) return i;
    // A separator only cuts when a header line follows within the next 3 lines,
    // otherwise it is just decoration in the message itself.
    if (scannable && isSeparator(line) && lines.slice(i + 1, i + 4).some((l) => HEADER.test(l))) {
      return i;
    }
    if (scannable && isHeaderBlock(lines, i)) return i;
  }
  return -1;
}

/**
 * The new text of a reply, empty when the reply is nothing but quoted history.
 *
 * The same scan as splitQuoted, without its display fallback. That fallback
 * exists so a thread bubble is never empty, and to get there it returns the
 * quoted history under the name `fresh`. A caller about to hand the result to
 * a generator needs the opposite answer: the quoted history is very often our
 * own previous mail, and passing it on would be the repetition the brief
 * spends its instructions forbidding.
 */
export function freshOnly(body: string | null): string {
  if (!body || !body.trim()) return '';
  const lines = body.split('\n');
  const cut = quoteCut(lines);
  if (cut === -1) return body.trim();
  return lines.slice(0, cut).join('\n').trim();
}

export function splitQuoted(body: string | null): { fresh: string; quoted: string } {
  if (!body || !body.trim()) return { fresh: '', quoted: '' };

  const lines = body.split('\n');
  const cut = quoteCut(lines);

  if (cut === -1) return { fresh: body.trim(), quoted: '' };

  const fresh = lines.slice(0, cut).join('\n').trim();
  const quoted = lines.slice(cut).join('\n').trim();

  // A purely quoted reply must still show something rather than an empty bubble.
  if (!fresh) return { fresh: quoted, quoted: '' };

  return { fresh, quoted };
}
