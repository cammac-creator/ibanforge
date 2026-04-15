import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const API_URL = process.env.IBANFORGE_API_URL ?? 'https://api.ibanforge.com';
const ADMIN_SECRET = process.env.ADMIN_SECRET;

// ---------------------------------------------------------------------------
// Remote mode: all operations go through the admin API (production-safe)
// ---------------------------------------------------------------------------

async function remoteList() {
  const res = await fetch(`${API_URL}/v1/admin/keys`, {
    headers: { 'X-Admin-Secret': ADMIN_SECRET! },
  });
  if (!res.ok) {
    console.error(`Error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const data = (await res.json()) as {
    month: string;
    keys: Array<{
      key_prefix: string;
      email: string;
      monthly_limit: number | null;
      active: number;
      created_at: string;
      used: number;
    }>;
  };

  if (data.keys.length === 0) {
    console.log('No API keys found.');
    return;
  }

  console.log(`\n  API Keys — PRODUCTION (${data.month})\n`);
  console.log(
    '  Prefix        Email                          Limit     Used      Status    Created',
  );
  console.log('  ' + '-'.repeat(90));

  for (const r of data.keys) {
    const limit = r.monthly_limit ?? 200;
    const status = r.active ? 'active' : 'inactive';
    const pct = limit > 0 ? Math.round((r.used / limit) * 100) : 0;
    console.log(
      `  ${r.key_prefix.padEnd(12)}  ${r.email.padEnd(30)} ${String(limit).padStart(6)}  ${String(r.used).padStart(6)} (${pct}%)  ${status.padEnd(8)}  ${r.created_at.slice(0, 10)}`,
    );
  }
  console.log();
}

async function remoteGenerate(email: string, monthlyLimit?: number) {
  const res = await fetch(`${API_URL}/v1/admin/keys`, {
    method: 'POST',
    headers: { 'X-Admin-Secret': ADMIN_SECRET!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, monthly_limit: monthlyLimit }),
  });
  if (!res.ok) {
    console.error(`Error: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const data = (await res.json()) as { api_key: string; key_prefix: string; monthly_limit: number };

  console.log(`\n  Key generated on PRODUCTION for ${email}`);
  console.log(`  API Key:       ${data.api_key}`);
  console.log(`  Prefix:        ${data.key_prefix}`);
  console.log(`  Monthly limit: ${data.monthly_limit}`);

  // Verify the key works against the live API
  console.log(`\n  Verifying key against ${API_URL}...`);
  const check = await fetch(`${API_URL}/v1/keys/usage`, {
    headers: { Authorization: `Bearer ${data.api_key}` },
  });
  if (check.ok) {
    console.log('  ✓ Key verified — works in production.\n');
  } else {
    console.error(`  ✗ VERIFICATION FAILED (HTTP ${check.status}) — key may not work!\n`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Local mode: direct SQLite access (dev/testing only)
// ---------------------------------------------------------------------------

function localMode() {
  console.log('\n  ⚠  LOCAL MODE — writing to local SQLite, NOT production.\n');

  const Database = require('better-sqlite3');
  const STATS_DB_PATH = process.env.STATS_DB_PATH ?? resolve(__dirname, '../data/stats.sqlite');
  const db = new Database(STATS_DB_PATH);

  const keyCols = (
    db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
  ).map((r: { name: string }) => r.name);
  if (!keyCols.includes('monthly_limit')) {
    db.exec('ALTER TABLE api_keys ADD COLUMN monthly_limit INTEGER');
  }

  return db;
}

function localList() {
  const db = localMode();
  const month = new Date().toISOString().slice(0, 7);
  const rows = db
    .prepare(
      `SELECT k.key_prefix, k.email, k.monthly_limit, k.active, k.created_at,
              COALESCE(u.count, 0) as used
       FROM api_keys k
       LEFT JOIN api_usage u ON u.key_hash = k.key_hash AND u.month = ?
       ORDER BY k.created_at DESC`,
    )
    .all(month) as Array<{
    key_prefix: string;
    email: string;
    monthly_limit: number | null;
    active: number;
    created_at: string;
    used: number;
  }>;

  if (rows.length === 0) {
    console.log('No API keys found.');
    db.close();
    return;
  }

  console.log(`\n  API Keys — LOCAL (${month})\n`);
  console.log(
    '  Prefix        Email                          Limit     Used      Status    Created',
  );
  console.log('  ' + '-'.repeat(90));

  for (const r of rows) {
    const limit = r.monthly_limit ?? 200;
    const status = r.active ? 'active' : 'inactive';
    const pct = limit > 0 ? Math.round((r.used / limit) * 100) : 0;
    console.log(
      `  ${r.key_prefix.padEnd(12)}  ${r.email.padEnd(30)} ${String(limit).padStart(6)}  ${String(r.used).padStart(6)} (${pct}%)  ${status.padEnd(8)}  ${r.created_at.slice(0, 10)}`,
    );
  }
  console.log();
  db.close();
}

function localGenerate(email: string, monthlyLimit?: number) {
  const db = localMode();
  const rawKey = 'ifk_' + randomBytes(32).toString('hex');
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit) VALUES (?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, email, monthlyLimit ?? null);

  console.log(`  Key generated LOCALLY for ${email}`);
  console.log(`  API Key:       ${rawKey}`);
  console.log(`  Prefix:        ${keyPrefix}`);
  console.log(`  Monthly limit: ${monthlyLimit ?? 200}`);
  console.log(`\n  ⚠  This key only works locally. Use without --local for production.\n`);
  db.close();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const isLocal = process.argv.includes('--local');
const filteredArgs = process.argv.slice(2).filter((a) => a !== '--local');
const [command, ...args] = filteredArgs;

if (!isLocal && !ADMIN_SECRET) {
  console.error(`
  Error: ADMIN_SECRET not set.

  For production:  export ADMIN_SECRET=your-secret
  For local dev:   npm run admin -- --local <command>
`);
  process.exit(1);
}

switch (command) {
  case 'list':
    if (isLocal) localList();
    else remoteList();
    break;

  case 'generate': {
    const [email, limitStr] = args;
    if (!email) {
      console.error('Usage: admin-keys generate <email> [limit]');
      process.exit(1);
    }
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    if (isLocal) localGenerate(email, limit);
    else remoteGenerate(email, limit);
    break;
  }

  default:
    console.log(`
  IBANforge API Key Admin

  Usage: npm run admin -- <command> [args] [--local]

  Commands:
    list                         List all API keys with usage
    generate <email> [limit]     Generate a new key (default: 200/month)

  Modes:
    (default)                    Production via admin API (requires ADMIN_SECRET)
    --local                      Local SQLite only (dev/testing)

  Examples:
    ADMIN_SECRET=xxx npm run admin -- list
    ADMIN_SECRET=xxx npm run admin -- generate client@example.com 5000
    npm run admin -- --local list
`);
}
