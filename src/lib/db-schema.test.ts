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
