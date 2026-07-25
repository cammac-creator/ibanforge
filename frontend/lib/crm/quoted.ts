/**
 * Split a mail body into the new text and the quoted history.
 *
 * Display concern only: the stored body is never modified. Real threads carry
 * the whole history inline ('>' prefixes, Outlook 'From:' blocks, localized
 * attribution lines), which makes long threads unreadable when rendered raw.
 */

/** Attribution lines: "On <date>, X wrote:", "Le <date>, X a écrit :", German, Finnish. */
const ATTRIBUTION =
  /^\s*(On\b.*\bwrote\s*:|Le\b.*\ba écrit\s*:|Am\b.*\bschrieb\b.*:|.*\bkirjoitti\s*:)\s*$/i;

/** A separator run (underscores or dashes) that introduces a forwarded header block. */
const SEPARATOR = /^\s*[_-]{5,}\s*$/;

/** Header line that opens a quoted block, in the locales we actually receive. */
const HEADER = /^\s*(From|De|Sent|Envoyé|To|À|Subject|Objet)\s*:/i;

export function splitQuoted(body: string | null): { fresh: string; quoted: string } {
  if (!body || !body.trim()) return { fresh: '', quoted: '' };

  const lines = body.split('\n');
  let cut = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('>')) {
      cut = i;
      break;
    }
    if (ATTRIBUTION.test(line)) {
      cut = i;
      break;
    }
    // A separator only cuts when a header line follows within the next 3 lines,
    // otherwise it is just decoration in the message itself.
    if (SEPARATOR.test(line) && lines.slice(i + 1, i + 4).some((l) => HEADER.test(l))) {
      cut = i;
      break;
    }
  }

  if (cut === -1) return { fresh: body.trim(), quoted: '' };

  const fresh = lines.slice(0, cut).join('\n').trim();
  const quoted = lines.slice(cut).join('\n').trim();

  // A purely quoted reply must still show something rather than an empty bubble.
  if (!fresh) return { fresh: quoted, quoted: '' };

  return { fresh, quoted };
}
