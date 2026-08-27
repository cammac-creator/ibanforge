/**
 * Suggestion logic for attaching an orphan mail to a known person.
 *
 * The attach control used to be a bare email input: it required knowing the
 * customer's canonical (key) address by heart, which is exactly the thing the
 * operator does not know — the whole reason the mail is an orphan is that the
 * sender used ANOTHER address. This module ranks the CRM's people index
 * against what we do know: the query being typed, and the sender address
 * itself, whose local part often carries a name fragment.
 *
 * Pure functions, so the ranking is testable without a DOM.
 */

export interface PersonRow {
  email: string;
  label: string;
  kind: 'client' | 'prospect';
}

/**
 * Mailbox providers whose domain says nothing about who the person is.
 * A token like "gmail" must never match a label, while a company domain
 * ("alpha-example") is often the best signal available.
 */
const GENERIC_MAIL_DOMAINS = new Set([
  'gmail',
  'googlemail',
  'outlook',
  'hotmail',
  'live',
  'msn',
  'yahoo',
  'ymail',
  'icloud',
  'me',
  'mac',
  'aol',
  'proton',
  'protonmail',
  'gmx',
  'web',
  'mail',
  'email',
  'bluewin',
  'sunrise',
  'hispeed',
  'orange',
  'wanadoo',
  'free',
  'freenet',
  't-online',
]);

/**
 * Name-ish fragments of an address: letter runs of length >= 3 from the local
 * part, plus the domain's name-bearing label when it is not a generic mailbox
 * provider. "a904312zed@gmail.com" yields ["zed"]; "j.dupont@alpha.example.net"
 * yields ["dupont", "alpha"].
 */
export function senderTokens(sender: string): string[] {
  const [localRaw, domainRaw] = sender.trim().toLowerCase().split('@');
  const tokens = new Set<string>();
  for (const t of (localRaw ?? '').split(/[^a-zà-öø-ÿ]+/i)) {
    if (t.length >= 3) tokens.add(t);
  }
  // "alpha.example.net" → "alpha": the leftmost domain label a company chooses
  // is the name-bearing one. Generic labels (mail providers, "mail.", "web.")
  // are skipped, the TLD is never a candidate, and one label is enough.
  const labels = (domainRaw ?? '').split('.').slice(0, -1);
  const named = labels.find((l) => l.length >= 3 && !GENERIC_MAIL_DOMAINS.has(l));
  if (named) tokens.add(named);
  return [...tokens];
}

function matches(row: PersonRow, needle: string): boolean {
  return row.email.includes(needle) || row.label.toLowerCase().includes(needle);
}

/**
 * The rows worth showing for one orphan, best first.
 *
 * With a query, it is a plain substring filter over email and label, local
 * parts that START with the query first — the operator is typing a name and
 * expects prefix matches on top. With no query yet, the sender's own name
 * fragments are tried instead, so the right person is often on screen before
 * anything is typed. An empty answer is honest: better no suggestion than the
 * whole directory.
 */
export function suggestFor(sender: string, query: string, rows: PersonRow[], max = 6): PersonRow[] {
  const q = query.trim().toLowerCase();
  if (q.length >= 2) {
    return rows
      .filter((r) => matches(r, q))
      .sort((a, b) => {
        const aStarts = a.email.split('@')[0]!.startsWith(q) || a.label.toLowerCase().startsWith(q);
        const bStarts = b.email.split('@')[0]!.startsWith(q) || b.label.toLowerCase().startsWith(q);
        if (aStarts !== bStarts) return aStarts ? -1 : 1;
        return a.email.localeCompare(b.email);
      })
      .slice(0, max);
  }
  const tokens = senderTokens(sender);
  if (tokens.length === 0) return [];
  return rows
    .map((r) => ({ r, score: tokens.filter((t) => matches(r, t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.r.email.localeCompare(b.r.email))
    .slice(0, max)
    .map((x) => x.r);
}
