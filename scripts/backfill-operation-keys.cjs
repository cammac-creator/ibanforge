#!/usr/bin/env node
/**
 * Attribute historical `operations` rows to the API key that asked for them.
 *
 * `operations.key_prefix` is filled at write time from 2026-07-30 onward. Rows
 * written before that are attributed here, by pairing each one with the request
 * that produced it: same second, same endpoint. The two inserts happen inside
 * one HTTP request, so the pairing is sound where it is unique — and it is only
 * applied where it is unique. Measured on production before writing this:
 * 3,384 rows, 3,285 with exactly one candidate, 17 ambiguous, 82 with none.
 * The 17 and the 82 are left NULL rather than guessed.
 *
 * Only fills NULLs, so running it twice changes nothing the second time.
 *
 * Usage, from /app on Railway:
 *   node scripts/backfill-operation-keys.cjs --dry-run
 *   node scripts/backfill-operation-keys.cjs --commit
 *
 * Take a copy of stats.sqlite before --commit. This is the only script in the
 * repository that writes to accumulated production history.
 */
const Database = require('better-sqlite3');
const path = require('node:path');

const DB_PATH = process.env.STATS_DB_PATH || path.join(process.cwd(), 'data', 'stats.sqlite');
const COMMIT = process.argv.includes('--commit');

/** Which endpoint writes which operation_type. A type absent here is skipped. */
const PATH_BY_TYPE = {
  iban_validate: '/v1/iban/validate',
  iban_batch: '/v1/iban/batch',
  bic_lookup: '/v1/bic/:code',
  iban_compliance: '/v1/iban/compliance',
  ch_clearing_lookup: '/v1/ch/clearing/:iid',
  iban_format: '/v1/iban/format',
};

const db = new Database(DB_PATH, { readonly: !COMMIT });

const cols = db.prepare('PRAGMA table_info(operations)').all().map((r) => r.name);
if (!cols.includes('key_prefix')) {
  console.error('operations.key_prefix is missing — deploy the migration first, then re-run.');
  process.exit(1);
}

// One distinct non-null key among the requests logged in the same second on the
// same path. COUNT(DISTINCT) ignores NULLs, so `anon` counts them separately:
// an operation that coincides with both a keyed and an anonymous request is
// ambiguous and must stay NULL.
const candidates = db.prepare(`
  SELECT COUNT(DISTINCT key_prefix) keyed,
         SUM(key_prefix IS NULL) anon,
         MIN(key_prefix) k
  FROM request_log WHERE path = ? AND created_at = ?
`);

const update = COMMIT ? db.prepare('UPDATE operations SET key_prefix = ? WHERE id = ?') : null;

const stats = { attributed: 0, anonymous: 0, ambiguous: 0, noCandidate: 0, byType: {} };

const run = () => {
  for (const [type, p] of Object.entries(PATH_BY_TYPE)) {
    const rows = db
      .prepare('SELECT id, created_at FROM operations WHERE operation_type = ? AND key_prefix IS NULL')
      .all(type);
    let hit = 0;
    for (const row of rows) {
      const c = candidates.get(p, row.created_at);
      if (c.keyed === 0 && c.anon === 0) stats.noCandidate++;
      else if (c.keyed === 1 && c.anon === 0) {
        stats.attributed++;
        hit++;
        if (update) update.run(c.k, row.id);
      } else if (c.keyed === 0) stats.anonymous++;
      else stats.ambiguous++;
    }
    stats.byType[type] = { pending: rows.length, attributed: hit };
  }
};

if (COMMIT) db.transaction(run)();
else run();

console.log(COMMIT ? '--- COMMITTED ---' : '--- DRY RUN (nothing written) ---');
console.table(stats.byType);
console.log(
  `attributed ${stats.attributed}  |  anonymous ${stats.anonymous}  |  ambiguous ${stats.ambiguous}  |  no candidate ${stats.noCandidate}`,
);
const remaining = db.prepare('SELECT COUNT(*) n FROM operations WHERE key_prefix IS NULL').get().n;
const total = db.prepare('SELECT COUNT(*) n FROM operations').get().n;
console.log(`operations still unattributed: ${remaining} / ${total}`);
db.close();
