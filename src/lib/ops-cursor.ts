import { createCipheriv, createDecipheriv, createHash } from 'node:crypto';

/**
 * Opaque cursors for the public operations feed.
 *
 * `/v1/ops/recent` used to serve the `operations` table's auto-increment id
 * as the row key and as the `?after=` cursor. That id is the count of every
 * operation since the table was created: read twice, it is the API's real
 * throughput — the one figure this public repository is not allowed to carry,
 * served to anyone (adversarial review of 07/09/2026, F1).
 *
 * The first fix (07/09) XOR-masked the id with a constant. A XOR keeps every
 * difference: cursor(a) − cursor(b) = a − b, so two reads of the feed still
 * gave the throughput, and the test that closed F1 only checked "not a decimal
 * number" (audit of 16/09/2026). This version encrypts the id with AES-128 in
 * a single block keyed from a server secret: consecutive ids give unrelated
 * strings, the server maps a cursor back to an id in one operation, and a
 * forged or random cursor decrypts to a block that fails the zero-prefix check
 * and counts as "no cursor", which is what `?after=` already meant when absent.
 *
 * The key is derived from OPS_CURSOR_SECRET, or the stats token when that is
 * unset, so cursors survive a restart; with neither, a fixed development key
 * keeps the route working and the tests deterministic.
 */
const ID_BITS = 48n;
const ID_LIMIT = 1n << ID_BITS;
const BLOCK = 16;
const ID_OFFSET = BLOCK - 6; // the id sits in the last six bytes, the first ten stay zero
const CURSOR_LENGTH = 22; // 16 bytes in base64url, unpadded

function deriveKey(): Buffer {
  const secret = process.env.OPS_CURSOR_SECRET || process.env.STATS_TOKEN || 'ops-cursor-dev';
  return createHash('sha256').update(`ops-cursor:${secret}`).digest().subarray(0, BLOCK);
}

let cached: Buffer | null = null;
function currentKey(): Buffer {
  if (cached === null) cached = deriveKey();
  return cached;
}

/** Tests only: recompute the key after the environment changed. */
export function resetOpsCursorMask(): void {
  cached = null;
}

/** The cursor for an operation id. Ids are positive and far below 2^48. */
export function encodeOpsCursor(id: number): string {
  if (!Number.isInteger(id) || id < 0 || BigInt(id) >= ID_LIMIT) {
    throw new RangeError(`operation id out of cursor range: ${id}`);
  }
  const block = Buffer.alloc(BLOCK);
  block.writeUIntBE(id, ID_OFFSET, 6);
  const cipher = createCipheriv('aes-128-ecb', currentKey(), null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]).toString('base64url');
}

/**
 * The operation id a cursor names, or null when the string is not one of
 * ours: empty, not 22 base64url characters, or decrypting to a block whose
 * ten leading bytes are not zero. `null` is what the route treats as "no
 * cursor", the same as a missing `?after=`.
 */
export function decodeOpsCursor(cursor: string | undefined | null): number | null {
  if (!cursor || cursor.length !== CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(cursor)) return null;
  const bytes = Buffer.from(cursor, 'base64url');
  if (bytes.length !== BLOCK) return null;
  const decipher = createDecipheriv('aes-128-ecb', currentKey(), null);
  decipher.setAutoPadding(false);
  const block = Buffer.concat([decipher.update(bytes), decipher.final()]);
  if (!block.subarray(0, ID_OFFSET).equals(Buffer.alloc(ID_OFFSET))) return null;
  return block.readUIntBE(ID_OFFSET, 6);
}
