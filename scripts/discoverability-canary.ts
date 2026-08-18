/**
 * Weekly discoverability canary (18/08/2026).
 *
 * Trust registries (Aegis & co) probe the published resources with a bare GET
 * and no payment. For months our POST routes answered 405 and bad identifiers
 * 400 — read as "does not speak x402", earning a "treat with caution" verdict
 * that silently steered verify-before-pay buyers away. The fix (universal 402)
 * is exactly the kind of behaviour that can regress without any test failing,
 * because x402 runs in free mode locally. So the canary asks the DEPLOYED API,
 * the way a crawler does, once a week.
 *
 * Rules:
 *  - The probe list comes from /.well-known/x402 — NEVER a hardcoded list, or
 *    a route added later is silently unwatched.
 *  - Every bare GET (and an empty unauthenticated POST on POST routes) must
 *    answer a decodable v2 402 envelope: PAYMENT-REQUIRED header, version 2,
 *    amount, CAIP-2 network, https resource.
 *  - The CDP Bazaar catalog must still list at least EXPECTED_BAZAAR_MIN
 *    distinct api.ibanforge.com resources (nothing indexes retroactively — a
 *    dropped listing stays dropped until the next settlement).
 *  - The authenticated CDP diagnostic (POST /platform/v2/x402/validate — it
 *    returns the rejection REASON in plain words) needs facilitator
 *    credentials the report runner deliberately does not hold; the canary
 *    says so instead of pretending to check.
 */

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const BAZAAR_URL = 'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources';
const EXPECTED_BAZAAR_MIN = 5;
const PROBE_TIMEOUT_MS = 15_000;
const BAZAAR_PAGE_LIMIT = 500;
const BAZAAR_MAX_PAGES = 60; // safety stop: 60 × 500 = 30k rows, twice today's catalog

export interface ManifestEndpoint {
  resource: string;
  method: string;
}

/** Extract the probe list from the served /.well-known/x402 document. */
export function endpointsFromManifest(manifest: unknown): ManifestEndpoint[] {
  const doc = manifest as { endpoints?: Array<{ resource?: unknown; url?: unknown; method?: unknown }> };
  if (!Array.isArray(doc?.endpoints)) return [];
  return doc.endpoints
    .map((e) => ({
      resource: typeof e.resource === 'string' ? e.resource : typeof e.url === 'string' ? e.url : '',
      method: typeof e.method === 'string' ? e.method.toUpperCase() : 'GET',
    }))
    .filter((e) => e.resource.startsWith('https://'));
}

/**
 * Judge one probe answer the way a registry crawler does. Returns the list of
 * faults — empty means the challenge is valid.
 */
export function validate402Envelope(status: number, headerB64: string | null): string[] {
  if (status !== 402) return [`statut ${status} (attendu 402)`];
  if (!headerB64) return ['en-tête PAYMENT-REQUIRED absent'];
  let env: {
    x402Version?: unknown;
    accepts?: Array<{ amount?: unknown; network?: unknown; payTo?: unknown }>;
    resource?: { url?: unknown };
  };
  try {
    env = JSON.parse(Buffer.from(headerB64, 'base64').toString('utf8'));
  } catch {
    return ['en-tête PAYMENT-REQUIRED indécodable'];
  }
  const faults: string[] = [];
  if (env.x402Version !== 2) faults.push(`x402Version=${String(env.x402Version)} (attendu 2)`);
  const acc = Array.isArray(env.accepts) ? env.accepts[0] : undefined;
  if (!acc) {
    faults.push('accepts vide');
  } else {
    if (typeof acc.amount !== 'string' || acc.amount === '') faults.push('accepts[0].amount manquant (enveloppe v1 ?)');
    if (typeof acc.network !== 'string' || !acc.network.includes(':')) faults.push('network non CAIP-2');
    if (typeof acc.payTo !== 'string' || !acc.payTo.startsWith('0x')) faults.push('payTo manquant');
  }
  const resUrl = env.resource?.url;
  if (typeof resUrl !== 'string' || !resUrl.startsWith('https://')) {
    faults.push(`resource.url non https (${String(resUrl)})`);
  }
  return faults;
}

async function probe(
  fetchImpl: typeof fetch,
  url: string,
  method: string,
): Promise<{ status: number; header: string | null }> {
  const res = await fetchImpl(url, { method, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  // Read (and discard) the body so undici does not keep the socket busy.
  await res.text().catch(() => '');
  return { status: res.status, header: res.headers.get('payment-required') };
}

/** Count distinct api.ibanforge.com resources in the CDP Bazaar catalog. */
export async function countBazaarResources(fetchImpl: typeof fetch = fetch): Promise<Set<string>> {
  const found = new Set<string>();
  for (let page = 0; page < BAZAAR_MAX_PAGES; page++) {
    const res = await fetchImpl(`${BAZAAR_URL}?limit=${BAZAAR_PAGE_LIMIT}&offset=${page * BAZAAR_PAGE_LIMIT}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) throw new Error(`Bazaar catalog HTTP ${res.status}`);
    // Parse, don't regex: a "total" or "resource" key inside an ITEM's own
    // schema would fool a text scan (it did — first version stopped after
    // page one on an item's "total": 3 and reported 0/5).
    const data = (await res.json()) as {
      items?: Array<{ resource?: unknown }>;
      pagination?: { total?: unknown };
    };
    for (const item of data.items ?? []) {
      if (typeof item.resource === 'string' && item.resource.startsWith('https://api.ibanforge.com')) {
        found.add(item.resource);
      }
    }
    const total = Number(data.pagination?.total ?? 0);
    if ((page + 1) * BAZAAR_PAGE_LIMIT >= total) break;
  }
  return found;
}

/** Run every check and render the weekly report section. */
export async function runDiscoverabilityCanary(fetchImpl: typeof fetch = fetch): Promise<string> {
  const lines: string[] = ['🕯️ CANARI DÉCOUVRABILITÉ'];

  const manifestRes = await fetchImpl(`${API_BASE}/.well-known/x402`, {
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  if (!manifestRes.ok) return `${lines[0]}\n🚨 manifeste /.well-known/x402 → HTTP ${manifestRes.status}`;
  const endpoints = endpointsFromManifest(await manifestRes.json());
  if (endpoints.length === 0) return `${lines[0]}\n🚨 manifeste sans endpoints — le canari n'a rien à sonder`;

  let bad = 0;
  for (const ep of endpoints) {
    const path = ep.resource.replace(API_BASE, '');
    // The bare-GET probe, the exact shape registries use.
    const get = await probe(fetchImpl, ep.resource, 'GET');
    const getFaults = validate402Envelope(get.status, get.header);
    if (getFaults.length > 0) {
      bad++;
      lines.push(`🚨 GET ${path} → ${getFaults.join(' · ')}`);
    } else {
      lines.push(`✓ GET ${path} → 402 v2`);
    }
    // POST routes must also answer 402 to an empty unauthenticated POST.
    if (ep.method === 'POST') {
      const post = await probe(fetchImpl, ep.resource, 'POST');
      const postFaults = validate402Envelope(post.status, post.header);
      if (postFaults.length > 0) {
        bad++;
        lines.push(`🚨 POST vide ${path} → ${postFaults.join(' · ')}`);
      }
    }
  }

  try {
    const inCatalog = await countBazaarResources(fetchImpl);
    if (inCatalog.size >= EXPECTED_BAZAAR_MIN) {
      lines.push(`✓ Bazaar CDP : ${inCatalog.size} ressources au catalogue`);
    } else {
      bad++;
      lines.push(
        `🚨 Bazaar CDP : ${inCatalog.size}/${EXPECTED_BAZAAR_MIN} ressources — refaire un micro-règlement (rien n'indexe rétroactivement) : [${[...inCatalog].join(', ')}]`,
      );
    }
  } catch (err) {
    lines.push(`⚠️ Bazaar CDP injoignable (${(err as Error).message}) — à revérifier à la main`);
  }

  lines.push(
    process.env.CDP_API_KEY_ID
      ? '· validate CDP : créds présentes mais non branché dans le canari (diagnostic manuel : POST /platform/v2/x402/validate)'
      : '· validate CDP : sauté (créds facilitateur absentes du runner, voulu) — diagnostic manuel au besoin',
  );
  if (bad === 0) lines.push('Tout vert : les sondes des registres voient un service x402 valide.');
  return lines.join('\n');
}
