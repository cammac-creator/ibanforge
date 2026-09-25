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

/**
 * La forme normalisée d'une adresse, recopiée de src/lib/email-norm.ts : ce
 * script CommonJS ne peut pas importer de TypeScript. C'est l'identité du compte
 * client (sessions et codes de connexion). scripts/forget-customer.account.test.ts
 * vérifie que les deux copies s'accordent (étiquette, points de Gmail,
 * googlemail, casse).
 */
function normalizeEmail(raw) {
  const e = String(raw).trim().toLowerCase();
  if (!e.includes('@')) return null;
  const at = e.lastIndexOf('@');
  let local = e.slice(0, at);
  const domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${local.split('.').join('')}@gmail.com`;
  }
  return `${local}@${domain}`;
}
const emailNorm = normalizeEmail(email);

const dbPath =
  process.env.STATS_DB_PATH ||
  (require('node:fs').existsSync('/app/data/stats.sqlite')
    ? '/app/data/stats.sqlite'
    : path.join(__dirname, '..', 'data', 'stats.sqlite'));

const db = new Database(dbPath);
console.log(`Database: ${dbPath}`);
console.log(`Customer: ${email}`);
console.log(`Account identity: ${emailNorm}`);
console.log(
  execute ? 'MODE: EXECUTE (rows will be deleted)\n' : 'MODE: dry run (pass --execute to delete)\n',
);

const keys = db.prepare('SELECT key_prefix, key_hash FROM api_keys WHERE email = ?').all(email);
const prefixes = keys.map((k) => k.key_prefix);
const hashes = keys.map((k) => k.key_hash);

const inList = (n) => Array(n).fill('?').join(',');
const hasTable = (name) =>
  !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name);

/** [label, sql, params] — count with SELECT, delete with DELETE, same WHERE. */
const targets = [];
targets.push(['api_keys', 'FROM api_keys WHERE email = ?', [email]]);
if (prefixes.length) {
  targets.push([
    'request_log',
    `FROM request_log WHERE key_prefix IN (${inList(prefixes.length)})`,
    prefixes,
  ]);
  targets.push([
    'operations',
    `FROM operations WHERE key_prefix IN (${inList(prefixes.length)})`,
    prefixes,
  ]);
}
if (hashes.length) {
  targets.push([
    'api_usage',
    `FROM api_usage WHERE key_hash IN (${inList(hashes.length)})`,
    hashes,
  ]);
  if (hasTable('quota_notices')) {
    targets.push([
      'quota_notices',
      `FROM quota_notices WHERE key_hash IN (${inList(hashes.length)})`,
      hashes,
    ]);
  }
}
if (hasTable('email_messages')) {
  targets.push([
    'email_messages',
    'FROM email_messages WHERE customer_email = ? OR counterparty = ?',
    [email, email],
  ]);
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
// Audit du 16/09/2026 : huit tables portaient une adresse sans oubli ni purge par
// ancienneté. La liste n'est plus tenue à la main : scripts/forget-customer.coverage.test.ts
// échoue dès qu'une table à colonne d'adresse n'est ni ici, ni purgée par le temps.
if (hasTable('activation_nudges')) {
  targets.push(['activation_nudges', 'FROM activation_nudges WHERE lower(email) = ?', [email]]);
}
if (hasTable('contact_notes')) {
  targets.push(['contact_notes', 'FROM contact_notes WHERE lower(email) = ?', [email]]);
}
if (hasTable('thread_reads')) {
  targets.push(['thread_reads', 'FROM thread_reads WHERE lower(email) = ?', [email]]);
}
if (hasTable('thread_summaries')) {
  targets.push(['thread_summaries', 'FROM thread_summaries WHERE lower(email) = ?', [email]]);
}
if (hasTable('key_claims')) {
  targets.push(['key_claims', 'FROM key_claims WHERE lower(email_norm) = ?', [email]]);
}
if (hasTable('cohort_relabels')) {
  targets.push([
    'cohort_relabels',
    'FROM cohort_relabels WHERE lower(old_email) = ? OR lower(address) = ?',
    [email, email],
  ]);
}
// Compte client par e-mail (lot C1, 25.09.2026) : les sessions de lecture et le
// code de connexion en cours, par l'adresse NORMALISÉE, qui est l'identité du
// compte. Une demande d'oubli coupe ainsi les sessions tout de suite, au lieu de
// les laisser lire jusqu'à leur expiration.
if (hasTable('account_sessions')) {
  targets.push(['account_sessions', 'FROM account_sessions WHERE email_norm = ?', [emailNorm]]);
}
if (hasTable('account_login_codes')) {
  targets.push([
    'account_login_codes',
    'FROM account_login_codes WHERE email_norm = ?',
    [emailNorm],
  ]);
}
if (hasTable('orphan_mail')) {
  // sender is either the bare address or "Name <address>".
  targets.push([
    'orphan_mail',
    "FROM orphan_mail WHERE lower(sender) = ? OR lower(sender) LIKE '%<' || ? || '>%'",
    [email, email],
  ]);
}

// Le registre des achats (lot B1, 25.09.2026) : l'adresse saisie par un payeur
// est EFFACÉE de sa ligne, la ligne reste. C'est une pièce de l'argent (un
// paiement, son montant, la clé créditée), que la comptabilité garde comme
// Stripe garde la sienne ; l'adresse n'y servait que de contact de service.
const anonymise = [];
if (hasTable('key_purchases')) {
  anonymise.push([
    'key_purchases',
    'FROM key_purchases WHERE lower(payer_email) = ?',
    'UPDATE key_purchases SET payer_email = NULL WHERE lower(payer_email) = ?',
    [email],
  ]);
  // L'adresse du portefeuille qui a payé en USDC (relecture de sécurité de la
  // PR 259, D10) est une donnée personnelle pseudonyme : effacée elle aussi, sur
  // les achats des clés de ce client. Le nonce et le hash de transaction restent
  // la référence du paiement, comme son montant.
  const purchaseCols = db
    .prepare('PRAGMA table_info(key_purchases)')
    .all()
    .map((c) => c.name);
  if (hashes.length && purchaseCols.includes('payer_address')) {
    anonymise.push([
      'key_purchases',
      `FROM key_purchases WHERE key_hash IN (${inList(hashes.length)}) AND payer_address IS NOT NULL`,
      `UPDATE key_purchases SET payer_address = NULL WHERE key_hash IN (${inList(hashes.length)})`,
      hashes,
    ]);
  }
}

let total = 0;
for (const [label, where, params] of targets) {
  const n = db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...params).n;
  total += n;
  console.log(`${label.padEnd(16)} ${n} row(s)`);
}
for (const [label, where, , params] of anonymise) {
  const n = db.prepare(`SELECT COUNT(*) AS n ${where}`).get(...params).n;
  console.log(`${label.padEnd(16)} ${n} row(s) keep their line, the payer address is erased`);
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
  for (const [label, , update, params] of anonymise) {
    const res = db.prepare(update).run(...params);
    console.log(`erased  ${String(res.changes).padStart(5)}  ${label} (payer address)`);
  }
});
run();
console.log(`\nDone. ${total} row(s) deleted for ${email}.`);
console.log('Reminder: Stripe keeps its own billing records (statutory bookkeeping).');
