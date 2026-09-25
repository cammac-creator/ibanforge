import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Le seul test qui attrape un bloc de migration MAL PLACÉ (BRIEF §1.9,
 * piège 1) : sur une base neuve comme sur une base ancienne, openStatsDB()
 * doit passer sans jeter. Un backfill qui nomme une colonne créée plus bas
 * fait échouer toute l'initialisation, et l'API ne démarre plus.
 *
 * Le module db.ts lit STATS_DB_PATH une fois à l'import : chaque cas repart
 * d'un registre de modules vierge et d'un chemin neuf.
 */
const HERMETIC = process.env.STATS_DB_PATH;
const temp: string[] = [];

function freshPath(): string {
  const p = join(tmpdir(), `ibf-schema-${process.pid}-${randomUUID()}.sqlite`);
  temp.push(p);
  return p;
}

async function openAt(path: string) {
  vi.resetModules();
  process.env.STATS_DB_PATH = path;
  return import('./db.js');
}

afterEach(() => {
  process.env.STATS_DB_PATH = HERMETIC;
  for (const p of temp.splice(0)) {
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(p + suffix);
      } catch {
        /* déjà parti */
      }
    }
  }
});

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
    (c) => c.name,
  );
}

function indexes(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map(
    (i) => i.name,
  );
}

/**
 * Les deux tables du compte client (lot C1, 24.09.2026), posées en DERNIER dans
 * `openStatsDB`. Les colonnes sont nommées une à une : une colonne qui manque
 * ferait jeter la première connexion, pas l'ouverture de la base.
 */
function expectAccountTables(db: Database.Database): void {
  expect(columns(db, 'account_login_codes').sort()).toEqual(
    ['attempts', 'code_hash', 'created_at', 'email_norm', 'expires_at'].sort(),
  );
  expect(columns(db, 'account_sessions').sort()).toEqual(
    [
      'created_at',
      'email_display',
      'email_norm',
      'expires_at',
      'last_seen_at',
      'revoked_at',
      'token_hash',
    ].sort(),
  );
  expect(indexes(db, 'account_sessions')).toContain('idx_account_sessions_email');
}

describe('ouverture du schéma', () => {
  it('sur une base NEUVE, openStatsDB() ne jette pas et pose le palier de clé', async () => {
    const mod = await openAt(freshPath());
    const db = mod.getStatsDB();
    const cols = columns(db, 'api_keys');
    for (const c of [
      'tier',
      'claimed_at',
      'claim_method',
      'email_norm',
      'origin_prefix',
      'shield_episode',
    ]) {
      expect(cols, c).toContain(c);
    }
    const tables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
        name: string;
      }>
    ).map((t) => t.name);
    expect(tables).toContain('key_claims');
    expect(tables).toContain('key_settlements');
    expect(tables).toContain('subscription_payments');
    expect(indexes(db, 'subscription_payments')).toContain('idx_subscription_payments_sub');
    expect(columns(db, 'pending_verifications')).toContain('key_prefix');
    expect(indexes(db, 'api_keys')).toContain('idx_api_keys_prefix_unique');
    expect(indexes(db, 'key_creations')).toContain('idx_key_creations_created');
    expectAccountTables(db);
    mod.closeAll();
  });

  it('jouée deux fois de suite, la migration est idempotente', async () => {
    const path = freshPath();
    const mod = await openAt(path);
    mod.getStatsDB();
    mod.closeAll();
    expect(() => mod.getStatsDB()).not.toThrow();
    expect(columns(mod.getStatsDB(), 'api_keys').filter((c) => c === 'tier')).toHaveLength(1);
    mod.closeAll();
  });

  it('sur une base ANCIENNE (schéma d’avril, avant toute migration), tout se pose sans jeter', async () => {
    const path = freshPath();
    // La forme la plus vieille de api_keys : six colonnes, rien d'autre.
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1
      );
      INSERT INTO api_keys (key_hash, key_prefix, email) VALUES ('h1', 'ifk_00000001', 'You.Old+tag@GMAIL.com');
      INSERT INTO api_keys (key_hash, key_prefix, email) VALUES ('h2', 'ifk_00000002', 'credits-buyer');
    `);
    raw.close();
    const mod = await openAt(path);
    const db = mod.getStatsDB();
    const rows = db
      .prepare('SELECT key_prefix, tier, email_norm, claimed_at FROM api_keys ORDER BY id')
      .all() as Array<{
      key_prefix: string;
      tier: string;
      email_norm: string | null;
      claimed_at: string | null;
    }>;
    // Défaut 'email' pour une clé née avec une adresse ; la sentinelle reste
    // sans forme normalisée ; et AUCUN claimed_at inventé rétroactivement.
    expect(rows[0]).toEqual({
      key_prefix: 'ifk_00000001',
      tier: 'email',
      email_norm: 'youold@gmail.com',
      claimed_at: null,
    });
    expect(rows[1].email_norm).toBeNull();
    expect(indexes(db, 'api_keys')).toContain('idx_api_keys_prefix_unique');
    // Le registre des renouvellements se pose aussi sur une base ancienne.
    expect(columns(db, 'subscription_payments')).toContain('invoice_id');
    // Et les deux tables du compte client (lot C1).
    expectAccountTables(db);
    mod.closeAll();
  });

  it('le registre des achats (lot B1) se pose sur une base neuve, une base ancienne, et se rejoue', async () => {
    // Base neuve : les deux tables, la colonne et les index.
    const fresh = await openAt(freshPath());
    const fdb = fresh.getStatsDB();
    expect(columns(fdb, 'api_keys')).toContain('credits_notice_base');
    expect(columns(fdb, 'key_purchases')).toEqual(
      expect.arrayContaining([
        'payment_ref',
        'lineage_hash',
        'outcome',
        'payer_email',
        'prev_tier',
      ]),
    );
    expect(columns(fdb, 'key_topup_refs').sort()).toEqual(
      ['created_at', 'lineage_hash', 'ref'].sort(),
    );
    expect(indexes(fdb, 'key_purchases')).toEqual(
      expect.arrayContaining(['idx_key_purchases_lineage', 'idx_key_purchases_created']),
    );
    fresh.closeAll();

    // Base ancienne : un pack par carte, un pack USDC et une clé gratuite, au
    // schéma d'avant le registre. Le rattrapage les inscrit et écrit 0 sur les
    // deux packs, jamais sur la clé gratuite.
    const path = freshPath();
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1,
        monthly_limit INTEGER,
        credits_remaining INTEGER,
        credits_total INTEGER,
        stripe_session_id TEXT,
        amount_paid_minor INTEGER,
        amount_paid_currency TEXT,
        x402_payment_ref TEXT
      );
      INSERT INTO api_keys (key_hash, key_prefix, email, credits_remaining, credits_total, stripe_session_id, amount_paid_minor, amount_paid_currency)
        VALUES ('hc', 'ifk_0000000c', 'acme@example.com', 900, 1000, 'cs_test_old', 400, 'usd');
      INSERT INTO api_keys (key_hash, key_prefix, email, credits_remaining, credits_total, x402_payment_ref)
        VALUES ('hu', 'ifk_0000000u', 'credits-buyer', 0, 5000, 'abcdef0123456789abcdef0123456789');
      INSERT INTO api_keys (key_hash, key_prefix, email) VALUES ('hf', 'ifk_0000000f', 'free@alpha.example.net');
    `);
    raw.close();
    const mod = await openAt(path);
    const db = mod.getStatsDB();
    const limits = db
      .prepare('SELECT key_hash, tier, monthly_limit FROM api_keys ORDER BY key_hash')
      .all();
    expect(limits).toEqual([
      { key_hash: 'hc', tier: 'paid', monthly_limit: 0 },
      { key_hash: 'hf', tier: 'email', monthly_limit: null },
      { key_hash: 'hu', tier: 'paid', monthly_limit: 0 },
    ]);
    const purchases = db
      .prepare(
        'SELECT payment_ref, rail, outcome, credits, amount_minor, backfilled FROM key_purchases ORDER BY payment_ref',
      )
      .all();
    expect(purchases).toEqual([
      {
        payment_ref: 'stripe:cs_test_old',
        rail: 'card',
        outcome: 'minted',
        credits: 1000,
        amount_minor: 400,
        backfilled: 1,
      },
      {
        payment_ref: 'x402:abcdef0123456789abcdef0123456789',
        rail: 'usdc',
        outcome: 'minted',
        credits: 5000,
        amount_minor: null,
        backfilled: 1,
      },
    ]);
    // Rejouée : rien de plus.
    mod.closeAll();
    const again = mod.getStatsDB();
    expect(
      (again.prepare('SELECT COUNT(*) AS n FROM key_purchases').get() as { n: number }).n,
    ).toBe(2);
    mod.closeAll();
  });

  it('le rattrapage ne date jamais la fin d’un abonnement vivant (relecture de la PR 259, D5)', async () => {
    // Une clé Pro tournée avant le 10.09 : l'ancienne rotation recopiait
    // l'allocation, pas l'abonnement. Sa copie active ne porte donc pas
    // `stripe_subscription_id`, alors que l'abonnement est toujours facturé.
    // Un second abonnement, lui, a sa pierre tombale.
    const path = freshPath();
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1,
        monthly_limit INTEGER,
        stripe_session_id TEXT,
        stripe_subscription_id TEXT,
        amount_paid_minor INTEGER,
        amount_paid_currency TEXT,
        lineage_hash TEXT,
        origin_prefix TEXT
      );
      CREATE TABLE dead_subscriptions (
        subscription_id TEXT PRIMARY KEY,
        recorded_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO api_keys (key_hash, key_prefix, email, active, monthly_limit, stripe_session_id,
                            stripe_subscription_id, lineage_hash)
        VALUES ('ho', 'ifk_000000ho', 'acme@example.com', 0, 10000, 'cs_test_rotated_pro',
                'sub_test_rotated_pro', 'ho');
      INSERT INTO api_keys (key_hash, key_prefix, email, active, monthly_limit, lineage_hash, origin_prefix)
        VALUES ('hr', 'ifk_000000hr', 'acme@example.com', 1, 10000, 'ho', 'ifk_000000ho');
      INSERT INTO api_keys (key_hash, key_prefix, email, active, monthly_limit, stripe_session_id,
                            stripe_subscription_id, lineage_hash)
        VALUES ('hd', 'ifk_000000hd', 'acme@example.com', 0, 10000, 'cs_test_dead_pro',
                'sub_test_dead_pro', 'hd');
      INSERT INTO dead_subscriptions (subscription_id) VALUES ('sub_test_dead_pro');
    `);
    raw.close();
    const mod = await openAt(path);
    const rows = mod
      .getStatsDB()
      .prepare(
        `SELECT payment_ref, kind, ended_at FROM key_purchases
          WHERE kind = 'subscription' ORDER BY payment_ref`,
      )
      .all() as Array<{ payment_ref: string; kind: string; ended_at: string | null }>;
    expect(rows.map((r) => r.payment_ref)).toEqual([
      'stripe:cs_test_dead_pro',
      'stripe:cs_test_rotated_pro',
    ]);
    // La pierre tombale dit la fin ; son absence ne la dit pas.
    expect(rows[0].ended_at).not.toBeNull();
    expect(rows[1].ended_at).toBeNull();
    mod.closeAll();
  });

  it('avec deux key_prefix identiques, l’ouverture ne jette pas et l’index unique n’est PAS créé', async () => {
    const path = freshPath();
    const raw = new Database(path);
    raw.exec(`
      CREATE TABLE api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key_hash TEXT UNIQUE NOT NULL,
        key_prefix TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        active INTEGER DEFAULT 1
      );
      INSERT INTO api_keys (key_hash, key_prefix, email) VALUES ('h1', 'ifk_dupe0001', 'a@alpha.example.net');
      INSERT INTO api_keys (key_hash, key_prefix, email) VALUES ('h2', 'ifk_dupe0001', 'b@alpha.example.net');
    `);
    raw.close();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const mod = await openAt(path);
    expect(() => mod.getStatsDB()).not.toThrow();
    const idx = indexes(mod.getStatsDB(), 'api_keys');
    expect(idx).not.toContain('idx_api_keys_prefix_unique');
    expect(idx).toContain('idx_api_keys_prefix');
    expect(err).toHaveBeenCalledWith(expect.stringContaining('duplicate key_prefix'));
    err.mockRestore();
    mod.closeAll();
  });
});
