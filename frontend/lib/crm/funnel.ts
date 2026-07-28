import { humanOnly } from './automated';
import { resolveCountry } from './country';
import type { Contact, ProspectSourcing } from './types';

/**
 * What each campaign, segment, confidence tier and country actually produced.
 *
 * Every figure below was computable from data the CRM already held on
 * 27/07/2026, and the CRM computed none of them. Deciding what to source next
 * without them means deciding blind, which is how four segments came to be
 * worked at the same intensity while one of them had returned nothing in
 * twelve sends and another had returned a paying customer.
 *
 * ## What counts as what
 *
 * `mailed` is at least one outbound. `followed` is two outbound in a row with
 * nothing from them in between, which is a real follow-up; counting "received
 * two mails" instead would score every conversation as a follow-up and inflate
 * the figure four-fold on this data. `replied` is at least one inbound from a
 * person, robots excluded (see automated.ts), which is the difference between
 * six replies and eight. `converted` is holding an API key that is paid or
 * actually used.
 */
export interface FunnelRow {
  key: string;
  label: string;
  stock: number;
  mailed: number;
  followed: number;
  replied: number;
  converted: number;
}

interface Counted {
  mailed: boolean;
  followed: boolean;
  replied: boolean;
  converted: boolean;
}

/** Read one contact's thread once; every breakdown reuses the answer. */
function countOne(c: Contact): Counted {
  // Ordered by build-contacts already; robots dropped so a ticket
  // acknowledgement neither counts as a reply nor breaks a follow-up pair.
  const ms = humanOnly(c.messages);
  let mailed = false;
  let followed = false;
  let replied = false;
  for (let i = 0; i < ms.length; i++) {
    if (ms[i].direction === 'out') {
      mailed = true;
      if (i > 0 && ms[i - 1].direction === 'out') followed = true;
    } else if (ms[i].direction === 'in') {
      replied = true;
    }
  }
  const converted = c.kind === 'client' && (c.apiKey.paid || c.apiKey.usedAllTime > 0);
  return { mailed, followed, replied, converted };
}

/**
 * Group contacts and count the funnel in each group.
 *
 * `keyOf` returns null for a contact the cut does not apply to, and those
 * contacts are left out of that breakdown entirely rather than swept into a
 * bucket. A client who never came from the prospect list has no segment, and
 * inventing one for it would put made-up rows in a table meant to inform a
 * sourcing decision.
 */
export function funnelBy(
  contacts: Contact[],
  keyOf: (c: Contact) => { key: string; label: string } | null,
): FunnelRow[] {
  const rows = new Map<string, FunnelRow>();
  for (const c of contacts) {
    const k = keyOf(c);
    if (!k) continue;
    let row = rows.get(k.key);
    if (!row) {
      row = { key: k.key, label: k.label, stock: 0, mailed: 0, followed: 0, replied: 0, converted: 0 };
      rows.set(k.key, row);
    }
    const n = countOne(c);
    row.stock += 1;
    if (n.mailed) row.mailed += 1;
    if (n.followed) row.followed += 1;
    if (n.replied) row.replied += 1;
    if (n.converted) row.converted += 1;
  }
  // Most replies first, then the biggest stock. Sorting on the outcome rather
  // than alphabetically puts what worked at the top, which is the question
  // being asked. The key breaks ties so the order is stable across renders.
  return [...rows.values()].sort(
    (a, b) => b.replied - a.replied || b.stock - a.stock || (a.key < b.key ? -1 : 1),
  );
}

/**
 * The sourcing block. Required on a prospect, present on a client only when
 * that address came from the prospect list, so the union answers
 * `ProspectSourcing | undefined` without needing to narrow.
 */
function sourcingOf(c: Contact): ProspectSourcing | undefined {
  return c.sourcing;
}

export const BY_SEGMENT = (c: Contact) => {
  const s = sourcingOf(c)?.segment;
  return s ? { key: s, label: s } : null;
};

export const BY_CAMPAIGN = (c: Contact) => {
  const s = sourcingOf(c)?.source;
  return s ? { key: s, label: s } : null;
};

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'Confiance haute',
  medium: 'Confiance moyenne',
  low: 'Confiance faible',
};

export const BY_CONFIDENCE = (c: Contact) => {
  const s = sourcingOf(c)?.confidence;
  if (!s) return null;
  return { key: s, label: CONFIDENCE_LABEL[s] ?? s };
};

/**
 * Geography, over EVERY contact, unlike the three cuts above.
 *
 * Those three read the sourcing block and skip a contact that has none, since
 * a customer who never came from the prospect list genuinely has no segment
 * and inventing one would put a made-up row in a table meant to drive
 * sourcing. Country is different: it lives on ContactBase and build-contacts
 * fills it for a client from enrichEmail, so the data is there. Gating this
 * cut on the sourcing block the way the others do left the customers out:
 * measured on the real list, the geography table summed to 78 rows where 99
 * contacts were active, quietly omitting the whole customer base from the one
 * screen meant to say where the business actually is.
 *
 * Rows whose stored text names no country land in one visible bucket rather
 * than vanishing: a breakdown that silently drops a tenth of its rows claims a
 * completeness it does not have. See country.ts.
 */
export const BY_COUNTRY = (c: Contact) => {
  const r = resolveCountry(c.country);
  return { key: r.code ?? '??', label: r.label };
};
