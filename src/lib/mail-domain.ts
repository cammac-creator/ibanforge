import { promises as dns } from 'node:dns';

/**
 * Does this domain accept mail at all?
 *
 * Every message handed to the relay for a domain that cannot exist costs the
 * sending mailbox a refusal at the provider, and enough refusals get the
 * mailbox itself blocked for "spam": on 02/09/2026 Infomaniak started answering
 * 550 5.2.0 to every send from our address, transactional key mails included,
 * after days of automated sends to addresses with no mail server behind them.
 * The check here is the one the provider will make anyway, done before the
 * mailbox pays for it: an MX record, or failing that an A/AAAA record.
 *
 * Fail-open on purpose. A resolver hiccup must never refuse a real signup or
 * swallow a real key mail; only a definite "no such domain" says no.
 */
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { ok: boolean; until: number }>();

const RESERVED_SUFFIXES = [
  '.invalid',
  '.internal',
  '.test',
  '.local',
  '.localhost',
  '.example',
  '.onion',
];
const DOCUMENTATION_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);

export function domainOf(email: string): string {
  return email.trim().toLowerCase().split('@').pop() ?? '';
}

export async function domainAcceptsMail(domain: string): Promise<boolean> {
  const d = domain.trim().toLowerCase();
  if (!d.includes('.')) return false;
  if (RESERVED_SUFFIXES.some((s) => d.endsWith(s)) || DOCUMENTATION_DOMAINS.has(d)) return false;
  const hit = cache.get(d);
  if (hit && hit.until > Date.now()) return hit.ok;
  let ok = true;
  try {
    const mx = await withTimeout(dns.resolveMx(d), 2500);
    if (mx.length === 0) ok = await hasAddress(d);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // ENOTFOUND / ENODATA on MX: no MX record, the domain may still take mail on its A record.
    if (code === 'ENOTFOUND' || code === 'ENODATA') {
      ok = await hasAddress(d);
    } else {
      ok = true; // timeout or resolver failure: not the domain's fault
    }
  }
  cache.set(d, { ok, until: Date.now() + TTL_MS });
  return ok;
}

async function hasAddress(d: string): Promise<boolean> {
  try {
    const a = await withTimeout(dns.resolve4(d), 2500);
    if (a.length > 0) return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOTFOUND' && code !== 'ENODATA') return true;
  }
  try {
    const aaaa = await withTimeout(dns.resolve6(d), 2500);
    return aaaa.length > 0;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code !== 'ENOTFOUND' && code !== 'ENODATA';
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(Object.assign(new Error('dns timeout'), { code: 'ETIMEOUT' })),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Test seam: forget what was learned. */
export function resetMailDomainCache(): void {
  cache.clear();
}
