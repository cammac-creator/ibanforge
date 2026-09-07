import { createHash } from 'node:crypto';

/**
 * Opaque cursors for the public operations feed.
 *
 * `/v1/ops/recent` used to serve the `operations` table's auto-increment id
 * as the row key and as the `?after=` cursor. That id is the count of every
 * operation since the table was created: read twice, it is the API's real
 * throughput — the one figure this public repository is not allowed to carry,
 * served to anyone (adversarial review of 07/09/2026, F1).
 *
 * The cursor keeps doing what the id did for a poller — "give me what came
 * after this" — without being a number anyone can subtract. It is the id
 * XOR-masked with 48 bits derived from a server secret and written in base36,
 * so consecutive ids give unrelated strings, the server maps a cursor back to
 * an id in one operation, and a forged cursor merely decodes to some id and
 * gets a window of public rows, exactly as `?after=<any number>` did.
 *
 * The mask is derived from OPS_CURSOR_SECRET, or the stats token when that is
 * unset, so cursors survive a restart; with neither, a fixed development mask
 * keeps the route working and the tests deterministic.
 */
const MASK_BITS = 48n;
const MASK_LIMIT = 1n << MASK_BITS;

function mask(): bigint {
  const secret = process.env.OPS_CURSOR_SECRET || process.env.STATS_TOKEN || 'ops-cursor-dev';
  const digest = createHash('sha256').update(`ops-cursor:${secret}`).digest();
  return digest.readUIntBE(0, 6) === 0 ? 1n : BigInt(digest.readUIntBE(0, 6));
}

let cached: bigint | null = null;
function currentMask(): bigint {
  if (cached === null) cached = mask();
  return cached;
}

/** Tests only: recompute the mask after the environment changed. */
export function resetOpsCursorMask(): void {
  cached = null;
}

/** The cursor for an operation id. Ids are positive and far below 2^48. */
export function encodeOpsCursor(id: number): string {
  if (!Number.isInteger(id) || id < 0 || BigInt(id) >= MASK_LIMIT) {
    throw new RangeError(`operation id out of cursor range: ${id}`);
  }
  return (BigInt(id) ^ currentMask()).toString(36);
}

/**
 * The operation id a cursor names, or null when the string is not one of
 * ours: empty, not base36, or decoding outside the id range. `null` is what
 * the route treats as "no cursor", the same as a missing `?after=`.
 */
export function decodeOpsCursor(cursor: string | undefined | null): number | null {
  if (!cursor || !/^[0-9a-z]{1,10}$/.test(cursor)) return null;
  let value = 0n;
  for (const ch of cursor) value = value * 36n + BigInt(parseInt(ch, 36));
  if (value >= MASK_LIMIT) return null;
  const id = value ^ currentMask();
  if (id >= MASK_LIMIT) return null;
  return Number(id);
}
