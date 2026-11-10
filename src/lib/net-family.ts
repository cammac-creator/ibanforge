/**
 * Families of source addresses, to classify the MCP transport's past traffic
 * without keeping a single address.
 *
 * `request_log.ip_hash` stores a salted, truncated hash of each client address
 * (`hashIp`, src/lib/stats.ts), never the address. To tell which sources came
 * from a published range, the hash of every address of that range is computed
 * here and compared with the stored ones: the reading is retroactive, needs no
 * new column, and adds nothing to the request path.
 *
 * Nothing in this module imports the hash itself: the caller passes it in, so
 * this file stays free of the stats module and of its secret.
 */

/**
 * The outbound IPv4 ranges Anthropic publishes for its requests to external
 * servers, MCP tool calls included ("Outbound IP addresses",
 * https://platform.claude.com/docs/en/api/ip-addresses, read on 10 November
 * 2026). The connectors documentation names only the first one; the API page
 * names both. No outbound IPv6 range is published there.
 */
export const ANTHROPIC_OUTBOUND_V4: readonly string[] = ['160.79.104.0/21', '153.61.208.0/20'];

/** Where the ranges above were read, and when: echoed in the measurement. */
export const ANTHROPIC_OUTBOUND_SOURCE = 'https://platform.claude.com/docs/en/api/ip-addresses';
export const ANTHROPIC_OUTBOUND_READ_ON = '2026-11-10';

/**
 * The shortest prefix accepted: a /16 is 65 536 addresses, hence twice as many
 * hashes. Anything wider is a typo or a range too large to hash on a request.
 */
export const MIN_V4_PREFIX = 16;

const OCTET = /^(?:0|[1-9]\d{0,2})$/;

function parseV4(text: string): number | null {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!OCTET.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function formatV4(value: number): string {
  return [
    Math.floor(value / 16777216) % 256,
    Math.floor(value / 65536) % 256,
    Math.floor(value / 256) % 256,
    value % 256,
  ].join('.');
}

/**
 * Every address of an IPv4 block, network and broadcast included (a source
 * address is any address of the block). Refuses a prefix shorter than /16, a
 * malformed block, and a block written with host bits set: a published range
 * that does not read as a network is a typo, and a silent correction would
 * measure another range.
 */
export function expandV4(cidr: string): string[] {
  const match = /^([^/]+)\/(\d{1,2})$/.exec(cidr.trim());
  if (!match) throw new Error(`Not an IPv4 block: ${cidr}`);
  const base = parseV4(match[1]!);
  const prefix = Number(match[2]);
  if (base === null || prefix > 32) throw new Error(`Not an IPv4 block: ${cidr}`);
  if (prefix < MIN_V4_PREFIX) {
    throw new Error(`Block too wide: ${cidr} (the shortest prefix accepted is /${MIN_V4_PREFIX})`);
  }
  const size = 2 ** (32 - prefix);
  if (base % size !== 0) throw new Error(`Host bits set in ${cidr}: not a network address`);
  const out: string[] = new Array<string>(size);
  for (let i = 0; i < size; i++) out[i] = formatV4(base + i);
  return out;
}

/**
 * The two ways the log may have written one IPv4 address. `extractClientIp`
 * hands the address over exactly as the proxy gave it, without normalising, so
 * an IPv4 can arrive plain or as an IPv4-mapped IPv6 (`::ffff:a.b.c.d`), and
 * each spelling hashes differently.
 */
export function v4Spellings(address: string): [string, string] {
  return [address, `::ffff:${address}`];
}

type HashFn = (ip: string) => string | null;

const memo = new WeakMap<HashFn, Map<string, ReadonlySet<string>>>();

/**
 * The hashes of every address of the blocks, under both spellings, memoised
 * per hash function and per list of blocks (the two published ranges cost a
 * few thousand SHA-256 once per process, never per request).
 */
export function familyHashes(cidrs: readonly string[], hash: HashFn): ReadonlySet<string> {
  const key = cidrs.join(',');
  let byCidrs = memo.get(hash);
  if (!byCidrs) {
    byCidrs = new Map();
    memo.set(hash, byCidrs);
  }
  const known = byCidrs.get(key);
  if (known) return known;
  const hashes = new Set<string>();
  for (const cidr of cidrs) {
    for (const address of expandV4(cidr)) {
      for (const spelling of v4Spellings(address)) {
        const h = hash(spelling);
        if (h) hashes.add(h);
      }
    }
  }
  byCidrs.set(key, hashes);
  return hashes;
}
