import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

const STATS_DB_PATH = process.env.STATS_DB_PATH ?? resolve(__dirname, '../data/stats.sqlite');
const KEY_PREFIX = 'ifk_';
const DEFAULT_LIMIT = 200;

const db = new Database(STATS_DB_PATH);

const keyCols = (
  db.prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
).map((r) => r.name);
if (!keyCols.includes('monthly_limit')) {
  db.exec('ALTER TABLE api_keys ADD COLUMN monthly_limit INTEGER');
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function list() {
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
    return;
  }

  console.log(`\n  API Keys (${month})\n`);
  console.log(
    '  Prefix        Email                          Limit     Used      Status    Created',
  );
  console.log('  ' + '-'.repeat(90));

  for (const r of rows) {
    const limit = r.monthly_limit ?? DEFAULT_LIMIT;
    const status = r.active ? 'active' : 'inactive';
    const pct = limit > 0 ? Math.round((r.used / limit) * 100) : 0;
    console.log(
      `  ${r.key_prefix.padEnd(12)}  ${r.email.padEnd(30)} ${String(limit).padStart(6)}  ${String(r.used).padStart(6)} (${pct}%)  ${status.padEnd(8)}  ${r.created_at.slice(0, 10)}`,
    );
  }
  console.log();
}

function setQuota(email: string, limit: number) {
  const result = db
    .prepare('UPDATE api_keys SET monthly_limit = ? WHERE email = ? AND active = 1')
    .run(limit, email);
  if (result.changes === 0) {
    console.error(`No active key found for ${email}`);
    process.exit(1);
  }
  console.log(`Quota for ${email} set to ${limit} requests/month`);
}

function generate(email: string, monthlyLimit?: number) {
  const rawKey = KEY_PREFIX + randomBytes(32).toString('hex');
  const keyHash = hashKey(rawKey);
  const keyPrefix = rawKey.slice(0, 12);

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit) VALUES (?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, email, monthlyLimit ?? null);

  const limit = monthlyLimit ?? DEFAULT_LIMIT;
  console.log(`\n  Key generated for ${email}`);
  console.log(`  API Key:       ${rawKey}`);
  console.log(`  Prefix:        ${keyPrefix}`);
  console.log(`  Monthly limit: ${limit}`);
  console.log(`\n  Save this key — it will not be shown again.\n`);
}

function deactivate(email: string) {
  const result = db
    .prepare('UPDATE api_keys SET active = 0 WHERE email = ? AND active = 1')
    .run(email);
  if (result.changes === 0) {
    console.error(`No active key found for ${email}`);
    process.exit(1);
  }
  console.log(`Key for ${email} deactivated`);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'list':
    list();
    break;

  case 'set-quota': {
    const [email, limitStr] = args;
    if (!email || !limitStr) {
      console.error('Usage: admin-keys set-quota <email> <limit>');
      process.exit(1);
    }
    setQuota(email, parseInt(limitStr, 10));
    break;
  }

  case 'generate': {
    const [email, limitStr] = args;
    if (!email) {
      console.error('Usage: admin-keys generate <email> [limit]');
      process.exit(1);
    }
    generate(email, limitStr ? parseInt(limitStr, 10) : undefined);
    break;
  }

  case 'deactivate': {
    const [email] = args;
    if (!email) {
      console.error('Usage: admin-keys deactivate <email>');
      process.exit(1);
    }
    deactivate(email);
    break;
  }

  default:
    console.log(`
  IBANforge API Key Admin

  Usage: npm run admin -- <command> [args]

  Commands:
    list                         List all API keys with usage
    generate <email> [limit]     Generate a new key (default: 200/month)
    set-quota <email> <limit>    Set monthly quota for a key
    deactivate <email>           Deactivate a key
`);
}

db.close();
