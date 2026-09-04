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
 * Local parts that name a desk, not a person: "support@" says nothing about
 * WHO wrote, so it must never count as a name fragment. On 2026-09-03 the
 * "support" of an MCP directory's notification address matched the "support@"
 * of a prospect, the pre-selected proposal was accepted, and the alias then
 * pulled five months of build notices into that prospect's thread.
 */
const ROLE_LOCAL_PARTS = new Set(
  `support info hello contact sales admin team office mail email billing help service services
   jobs careers accounts accounting finance invoice invoices order orders legal privacy security
   abuse postmaster webmaster hostmaster partner partners partnership partnerships community press
   marketing newsletter news notification notifications noreply reply bounce bounces mailer daemon
   alert alerts update updates dev api ops web www root system robot bot welcome onboarding
   feedback compliance kyc`.split(/\s+/),
);

/**
 * Domain labels that describe a kind of business, not one business: "agents",
 * "labs", "cloud" each match a dozen files. A label has to be a NAME to be
 * evidence, on both the token side and the label side of bestMatch.
 */
const GENERIC_DOMAIN_LABELS = new Set(
  `agent agents app apps cloud online digital tech lab labs group team global world net dev corp
   inc ltd gmbh sarl company solutions service services systems software studio studios media
   network networks partners consulting holding international europe swiss suisse schweiz finance
   financial pay payment payments bank banking crypto data api info contact support hello`.split(
    /\s+/,
  ),
);

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
    if (t.length >= 3 && !ROLE_LOCAL_PARTS.has(t)) tokens.add(t);
  }
  // "alpha.example.net" → "alpha": the leftmost domain label a company chooses
  // is the name-bearing one. Generic labels (mail providers, "mail.", "web.")
  // are skipped, the TLD is never a candidate, and one label is enough.
  const labels = (domainRaw ?? '').split('.').slice(0, -1);
  const named = labels.find(
    (l) => l.length >= 3 && !GENERIC_MAIL_DOMAINS.has(l) && !GENERIC_DOMAIN_LABELS.has(l),
  );
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

/**
 * Why a row is proposed, in the operator's words. Ordered from the reason that
 * settles it to the one that only hints.
 */
export type MatchReason = 'same_domain' | 'domain_in_label' | 'name_in_address';

export interface BestMatch {
  row: PersonRow;
  reason: MatchReason;
}

export const MATCH_REASON_FR: Record<MatchReason, string> = {
  same_domain: 'même domaine de messagerie',
  domain_in_label: 'le domaine de l’expéditeur est dans le nom du dossier',
  name_in_address: 'un nom de l’adresse se retrouve dans le dossier',
};

function domainOf(email: string): string {
  return email.trim().toLowerCase().split('@')[1] ?? '';
}

function isGenericDomain(domain: string): boolean {
  const label = domain.split('.')[0] ?? '';
  return GENERIC_MAIL_DOMAINS.has(label);
}

/**
 * The one row worth pre-selecting for a sender, with the reason, or null.
 *
 * The strongest signal is a shared company domain: two addresses at
 * alpha.example.net are the same firm nine times out of ten, and never when the
 * domain is a mailbox provider. Next, the sender's domain name appearing in a
 * file's label ("acme" in "ACME Sàrl"). Last, a name fragment of the local part
 * found in a label or an address, which is the weakest and only ever a hint.
 *
 * Ties inside a tier go to clients before prospects, then to the shorter
 * address, so the answer is stable between renders. Null beats a guess: the
 * control still offers the typed search when nothing here holds.
 */
export function bestMatch(sender: string, rows: PersonRow[]): BestMatch | null {
  const s = sender.trim().toLowerCase();
  const domain = domainOf(s);
  const byTier = (candidates: PersonRow[]): PersonRow | undefined =>
    [...candidates].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'client' ? -1 : 1;
      return a.email.length - b.email.length || a.email.localeCompare(b.email);
    })[0];
  const others = rows.filter((r) => r.email !== s);
  if (domain && !isGenericDomain(domain)) {
    const same = byTier(others.filter((r) => domainOf(r.email) === domain));
    if (same) return { row: same, reason: 'same_domain' };
    const label = domain.split('.')[0] ?? '';
    if (label.length >= 4 && !GENERIC_DOMAIN_LABELS.has(label)) {
      const inLabel = byTier(others.filter((r) => r.label.toLowerCase().includes(label)));
      if (inLabel) return { row: inLabel, reason: 'domain_in_label' };
    }
  }
  const names = senderTokens(s).filter((t) => t.length >= 4 && t !== domain.split('.')[0]);
  if (names.length) {
    const named = byTier(others.filter((r) => names.some((t) => matches(r, t))));
    if (named) return { row: named, reason: 'name_in_address' };
  }
  return null;
}

/**
 * Mail no person wrote: DMARC aggregate reports, no-reply senders, delivery
 * notices. Named so the queue can say "avis automatique" and offer the
 * dismissal first, instead of asking the operator to read a report to find out.
 */
export function isAutomatedNotice(sender: string, subject: string | null): boolean {
  const s = sender.toLowerCase();
  const local = s.split('@')[0] ?? '';
  const subj = (subject ?? '').toLowerCase();
  if (
    /^(no-?reply|noreply|do-?not-?reply|donotreply|mailer-daemon|postmaster|dmarc|bounce|notifications?)/.test(
      local,
    )
  )
    return true;
  if (/dmarc|report domain:|aggregate report|delivery status notification|undeliverable/.test(subj))
    return true;
  // A directory's build and release notices come from its ordinary support
  // desk, so the sender says nothing; the subject does.
  if (
    /^(build (succeeded|failed) for |release \S+ (of \S+ )?(has been |was )?published|your mcp server .* (was not |has been )approved)/.test(
      subj,
    )
  )
    return true;
  return false;
}
