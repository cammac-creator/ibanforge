#!/usr/bin/env node
/**
 * Right-to-erasure tooling — deletes everything attributable to one customer
 * email, across every table that holds it. Backs the promises made in
 * Privacy Policy §4/§5 ("deleted on request") and DPA §8.
 *
 * Written in plain CommonJS so it runs INSIDE the Railway container, where
 * there is no tsx and no python3:
 *
 *   railway ssh
 *   node /app/scripts/forget-customer.cjs someone@example.com            # dry run
 *   node /app/scripts/forget-customer.cjs someone@example.com --execute  # delete
 *
 * Locally it runs against data/stats.sqlite (or STATS_DB_PATH).
 *
 * What it does NOT touch, on purpose:
 * - Stripe records (statutory bookkeeping — invoices live at Stripe);
 * - aggregated tables (daily_stats/hourly_stats hold no personal data);
 * - request_log/operations rows of OTHER customers.
 */

const path = require('node:path');
const Database = require('better-sqlite3');

const email = (process.argv[2] || '').trim().toLowerCase();
const execute = process.argv.includes('--execute');

if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/forget-customer.cjs <email> [--execute]');
  process.exit(1);
}

const dbPath =
  process.env.STATS_DB_PATH ||
  (require('node:fs').existsSync('/app/data/stats.sqlite')
    ? '/app/data/stats.sqlite'
    : path.join(__dirname, '..', 'data', 'stats.sqlite'));

const db = new Database(dbPath);
console.log(`Database: ${dbPath}`);
console.log(`Customer: ${email}`);
console.log(execute ? 'MODE: EXECUTE (rows will be deleted)\n' : 'MODE: dry run (pass --execute to delete)\n');

const keys = db
  .prepare('SELECT key_prefix, key_hash FROM api_keys WHERE email = ?')
  .all(email);
const prefixes = keys.map((k) => k.key_prefix);
const hashes = keys.map((k) => k.key_hash);

const inList = (n) => Array(n).fill('?').join(',');
const hasTable = (name) =>
  !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);

/** [label, sql, params] — count with SELECT, delete with DELETE, same WHERE. */
const targets = [];
targets.push(['api_keys', 'FROM api_keys WHERE email = ?', [email]]);
if (prefixes.length) {
  targets.push(['request_log', `FROM request_log WHERE key_prefix IN (${inList(prefixes.length)})`, prefixes]);
  targets.push(['operations', `FROM operations WHERE key_prefix IN (${inList(prefixes.length)})`, prefixes]);
}
if (hashes.length) {
  targets.push(['api_usage', `FROM api_usage WHERE key_hash IN (${inList(hashes.length)})`, hashes]);
  if (hasTable('quota_notices')) {
    targets.push(['quota_notices', `FROM quota_notices WHERE key_hash IN (${inList(hashes.length)})`, hashes]);
  }
}
if (hasTable('email_messages')) {
  targets.push(['email_messages', 'FROM email_messages WHERE customer_email = ? OR counterparty = ?', [email, email]]);
}
if (hasTable('email_summaries')) {
  targets.push(['email_summaries', 'FROM email_summaries WHERE email = ?', [email]]);
}
if (hasTable('prospects')) {
  targets.push(['prospects', 'FROM prospects WHERE contact_email = ?', [email]]);
}
if (hasTable('feedback')) {
  targets.push(['feedback', 'FROM feedback WHERE contact = ?', [email]]);
}

let total = 0;
for (const [label, where, params] of targets) {
  const n = db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...params).n;
  total += n;
  console.log(`${label.padEnd(16)} ${n} row(s)`);
}
if (keys.length) {
  console.log(`\nKeys involved: ${prefixes.map((p) => `${p}…`).join(', ')}`);
}

if (!execute) {
  console.log(`\nDry run — ${total} row(s) would be deleted. Re-run with --execute.`);
  process.exit(0);
}

const run = db.transaction(() => {
  for (const [label, where, params] of targets) {
    const res = db.prepare(`DELETE ${where}`).run(...params);
    console.log(`deleted ${String(res.changes).padStart(5)}  ${label}`);
  }
});
run();
console.log(`\nDone. ${total} row(s) deleted for ${email}.`);
console.log('Reminder: Stripe keeps its own billing records (statutory bookkeeping).');
