import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * La migration du lot M, sur les quatre bases qui existent vraiment : neuve,
 * ancienne (le schéma d'avril, avant toute migration), rejouée deux fois, et
 * celle où un préfixe d'origine est ambigu.
 *
 * Le seul test qui attrape un bloc de migration MAL PLACÉ (BRIEF §1.9,
 * piège 1) : un index ou un backfill qui nomme une colonne créée plus bas fait
 * échouer TOUTE l'initialisation, et l'API ne démarre plus.
 *
 * Le module db.ts lit STATS_DB_PATH une fois à l'import : chaque cas repart
 * d'un registre de modules vierge et d'un chemin neuf. Fixtures inventées, ce
 * dépôt est public.
 */
const HERMETIC = process.env.STATS_DB_PATH;
const temp: string[] = [];

function freshPath(): string {
  const p = join(tmpdir(), `ibf-lineage-${process.pid}-${randomUUID()}.sqlite`);
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

/** Le schéma d'avril : six colonnes sur api_keys, rien d'autre. */
function aprilSchema(path: string, extra = ''): void {
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
    ${extra}
  `);
  raw.close();
}

describe('migration des faits de lignée', () => {
  it('sur une base NEUVE, la colonne, la table et les index sont là', async () => {
    const mod = await openAt(freshPath());
    const db = mod.getStatsDB();
    expect(columns(db, 'api_keys')).toContain('lineage_hash');
    expect(indexes(db, 'api_keys')).toContain('idx_api_keys_lineage');
    for (const c of [
      'lineage_hash',
      'birth_at',
      'birth_tier',
      'birth_source',
      'entry_landing',
      'entry_referrer_domain',
      'delivery_page',
      'first_success_at',
      'first_success_route',
      'first_success_context',
      'first_unmarked_success_at',
      'week2_success_at',
      'last_success_at',
      'last_success_day',
      'success_days',
      'first_claim_at',
      'claim_method',
      'first_settlement_at',
      'settlement_count',
      'paid_key_hash',
      'paid_key_delivered_at',
      'paid_first_success_at',
      'backfilled',
      'updated_at',
      // Chantier « mesure agents » : les deux familles de client.
      'first_success_client',
      'last_success_client',
    ]) {
      expect(columns(db, 'lineage_facts'), c).toContain(c);
    }
    // Les deux agrégats journaliers des portes d'agent, avec leurs clés.
    for (const c of [
      'day',
      'source',
      'opened',
      'rate_limited',
      'approved_anonymous',
      'approved_email',
      'denied',
      'expired',
      'delivered',
    ]) {
      expect(columns(db, 'device_grant_daily'), c).toContain(c);
    }
    for (const c of ['day', 'sessions', 'tool_calls', 'key_requests']) {
      expect(columns(db, 'mcp_remote_daily'), c).toContain(c);
    }
    mod.closeAll();
  });

  it('sur une base ANCIENNE, les deux colonnes de client sont ajoutées UNE fois', async () => {
    // Le cas que la garde `PRAGMA table_info` existe pour couvrir : la table
    // existe déjà sans ces colonnes, l'ALTER doit passer une fois et une seule.
    // Un ALTER répété fait échouer TOUTE l'ouverture, et l'API ne démarre plus
    // (le piège du 19/08).
    const path = freshPath();
    aprilSchema(
      path,
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-cli', 'ifk_cli00001', 'h@alpha.example.net', '2026-07-01 10:00:00');`,
    );
    const first = await openAt(path);
    first.getStatsDB();
    first.closeAll();
    // Deuxième ouverture sur la MÊME base : la colonne est déjà là.
    const again = await openAt(path);
    const db = again.getStatsDB();
    expect(columns(db, 'lineage_facts').filter((c) => c === 'first_success_client')).toHaveLength(
      1,
    );
    expect(columns(db, 'lineage_facts').filter((c) => c === 'last_success_client')).toHaveLength(1);
    // Et les deux agrégats ne se dupliquent pas non plus.
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM device_grant_daily').get() as { n: number }).n,
    ).toBe(0);
    expect(
      (db.prepare('SELECT COUNT(*) AS n FROM mcp_remote_daily').get() as { n: number }).n,
    ).toBe(0);
    again.closeAll();
  });

  it('sur une base ANCIENNE, chaque clé devient sa propre lignée et sa naissance est reconstituée', async () => {
    const path = freshPath();
    aprilSchema(
      path,
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-old-1', 'ifk_old00001', 'a@alpha.example.net', '2026-07-01 10:00:00');
       INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-old-2', 'ifk_old00002', 'b@alpha.example.net', '2026-07-02 11:00:00');`,
    );
    const mod = await openAt(path);
    const db = mod.getStatsDB();
    const rows = db
      .prepare('SELECT key_hash, lineage_hash FROM api_keys ORDER BY id')
      .all() as Array<{ key_hash: string; lineage_hash: string }>;
    expect(rows).toEqual([
      { key_hash: 'h-old-1', lineage_hash: 'h-old-1' },
      { key_hash: 'h-old-2', lineage_hash: 'h-old-2' },
    ]);
    const facts = db
      .prepare(
        'SELECT lineage_hash, birth_at, birth_tier, backfilled FROM lineage_facts ORDER BY birth_at',
      )
      .all() as Array<{
      lineage_hash: string;
      birth_at: string;
      birth_tier: string;
      backfilled: number;
    }>;
    expect(facts).toEqual([
      {
        lineage_hash: 'h-old-1',
        birth_at: '2026-07-01 10:00:00',
        birth_tier: 'email',
        backfilled: 1,
      },
      {
        lineage_hash: 'h-old-2',
        birth_at: '2026-07-02 11:00:00',
        birth_tier: 'email',
        backfilled: 1,
      },
    ]);
    mod.closeAll();
  });

  it('une clé tournée rejoint la lignée de son origine quand le préfixe est unique', async () => {
    const path = freshPath();
    aprilSchema(
      path,
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-orig', 'ifk_orig0001', 'c@alpha.example.net', '2026-07-01 10:00:00');
       INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-rot', 'ifk_rot00001', 'c@alpha.example.net', '2026-07-05 10:00:00');`,
    );
    // origin_prefix n'existe pas encore dans le schéma d'avril : on ouvre une
    // fois pour le poser, puis on écrit la lignée comme rotateApiKey l'écrit.
    const first = await openAt(path);
    first
      .getStatsDB()
      .prepare(
        "UPDATE api_keys SET origin_prefix = 'ifk_orig0001', lineage_hash = NULL WHERE key_hash = 'h-rot'",
      )
      .run();
    first.getStatsDB().prepare('DELETE FROM lineage_facts').run();
    first.closeAll();

    const mod = await openAt(path);
    const db = mod.getStatsDB();
    const rot = db.prepare("SELECT lineage_hash FROM api_keys WHERE key_hash = 'h-rot'").get() as {
      lineage_hash: string;
    };
    expect(rot.lineage_hash).toBe('h-orig');
    // Une seule lignée pour les deux clés, et sa naissance est la PLUS ANCIENNE.
    const facts = db.prepare('SELECT lineage_hash, birth_at FROM lineage_facts').all() as Array<{
      lineage_hash: string;
      birth_at: string;
    }>;
    expect(facts).toEqual([{ lineage_hash: 'h-orig', birth_at: '2026-07-01 10:00:00' }]);
    mod.closeAll();
  });

  it("un préfixe d'origine AMBIGU est écarté, avec un avertissement compté", async () => {
    const path = freshPath();
    aprilSchema(
      path,
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-dupe-a', 'ifk_dupe0001', 'd@alpha.example.net', '2026-07-01 10:00:00');
       INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-dupe-b', 'ifk_dupe0001', 'e@alpha.example.net', '2026-07-01 10:00:01');
       INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-child', 'ifk_child001', 'd@alpha.example.net', '2026-07-06 10:00:00');`,
    );
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = await openAt(path);
    first
      .getStatsDB()
      .prepare(
        "UPDATE api_keys SET origin_prefix = 'ifk_dupe0001', lineage_hash = NULL WHERE key_hash = 'h-child'",
      )
      .run();
    first.closeAll();

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await openAt(path);
    const db = mod.getStatsDB();
    const child = db
      .prepare("SELECT lineage_hash FROM api_keys WHERE key_hash = 'h-child'")
      .get() as { lineage_hash: string };
    // Écartée : elle devient sa propre lignée, elle ne CHOISIT pas un parent.
    expect(child.lineage_hash).toBe('h-child');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ambiguë écartée'));
    warn.mockRestore();
    err.mockRestore();
    mod.closeAll();
  });

  it('rejouée deux fois, la migration ne duplique rien', async () => {
    const path = freshPath();
    aprilSchema(
      path,
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-twice', 'ifk_twice001', 'f@alpha.example.net', '2026-07-01 10:00:00');`,
    );
    const first = await openAt(path);
    first.getStatsDB();
    first.closeAll();
    expect(() => first.getStatsDB()).not.toThrow();
    const db = first.getStatsDB();
    expect((db.prepare('SELECT COUNT(*) AS n FROM lineage_facts').get() as { n: number }).n).toBe(
      1,
    );
    expect(columns(db, 'api_keys').filter((c) => c === 'lineage_hash')).toHaveLength(1);
    first.closeAll();
  });

  it("les « premiers » sont reconstitués depuis les traces, et étiquetés 'traces'", async () => {
    const path = freshPath();
    aprilSchema(
      path,
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
         VALUES ('h-traces', 'ifk_trace001', 'g@alpha.example.net', '2026-07-01 10:00:00');`,
    );
    // Les traces d'abord : le rattrapage des premiers ne s'exécute qu'au
    // passage où la naissance est insérée.
    const boot = await openAt(path);
    boot.getStatsDB().exec('DELETE FROM lineage_facts');
    const db0 = boot.getStatsDB();
    db0.prepare('UPDATE api_keys SET lineage_hash = NULL').run();
    const insert = db0.prepare(
      'INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix) VALUES (?, ?, ?, 5, ?, ?)',
    );
    // Deux succès métier, un 4xx et un appel non métier : seuls les deux
    // premiers comptent, et ils tombent sur deux jours UTC distincts.
    insert.run('POST', '/v1/iban/validate', 200, '2026-07-02 08:00:00', 'ifk_trace001');
    insert.run('GET', '/v1/bic/:code', 200, '2026-07-03 09:00:00', 'ifk_trace001');
    insert.run('POST', '/v1/iban/validate', 400, '2026-07-04 09:00:00', 'ifk_trace001');
    insert.run('GET', '/health', 200, '2026-07-01 09:00:00', 'ifk_trace001');
    // Un chemin non normalisé n'entre PAS : le rattrapage compare la route
    // canonique à l'identique, il ne reconnaît pas un préfixe textuel.
    insert.run('GET', '/v1/bic/DEUTDEFF', 200, '2026-07-01 07:00:00', 'ifk_trace001');
    boot.closeAll();

    const mod = await openAt(path);
    const db = mod.getStatsDB();
    const f = db
      .prepare(
        `SELECT first_success_at, first_success_route, first_success_context,
                first_unmarked_success_at, last_success_at, success_days
           FROM lineage_facts WHERE lineage_hash = 'h-traces'`,
      )
      .get() as {
      first_success_at: string;
      first_success_route: string;
      first_success_context: string;
      first_unmarked_success_at: string | null;
      last_success_at: string;
      success_days: number;
    };
    expect(f.first_success_at).toBe('2026-07-02 08:00:00');
    // Au MÊME format que le fil de l'eau, verbe compris.
    expect(f.first_success_route).toBe('POST /v1/iban/validate');
    expect(f.first_success_context).toBe('traces');
    // 🚨 JAMAIS posé par un rattrapage : une trace muette ne prouve pas
    // « hors panneau », et le contrat interdit d'en déduire « production ».
    expect(f.first_unmarked_success_at).toBeNull();
    expect(f.last_success_at).toBe('2026-07-03 09:00:00');
    expect(f.success_days).toBe(2);
    mod.closeAll();
  });
});
