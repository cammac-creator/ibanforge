import { describe, expect, it } from 'vitest';
import { BACKUP_FORMAT, READABLE_FORMATS, exportPaidState, restorePaidState } from './backup.js';
import { claimKey, generateApiKey } from './api-keys.js';
import { recordKeySettlement } from './key-settlements.js';
import { getStatsDB } from './db.js';

/**
 * Les colonnes voyagent seules, les TABLES non (spec 01 §4.13, cas 23 et
 * 23bis). Une restauration qui perdrait key_claims et key_settlements le
 * ferait en silence, le jour où l'on est déjà en train de réparer une panne.
 * Fixtures inventées : ce dépôt est public.
 */
const RUN = Date.now();

describe('sauvegarde du palier de clé', () => {
  it('23. un aller-retour conserve le palier, la preuve, la forme normalisée et les deux journaux', () => {
    const db = getStatsDB();
    const a = generateApiKey(null, undefined, undefined, false, { ipHash: `bk-${RUN}` })!;
    const c = generateApiKey(null, undefined, undefined, false, { ipHash: `bk-${RUN}` })!;
    claimKey(c.key_hash, 'email_code', { email: `bk-${RUN}@alpha.example.net` });
    recordKeySettlement({
      keyHash: a.key_hash,
      keyPrefix: a.key_prefix,
      paymentRef: `bk-ref-${RUN}`,
      route: 'POST /v1/iban/validate',
      quotedAmountUsd: 0.005,
    });
    const dump = exportPaidState('2026-09-15T12:00:00Z');
    expect(dump.format).toBe(BACKUP_FORMAT);
    expect(dump.key_claims!.some((r) => r.key_hash === c.key_hash)).toBe(true);
    expect(dump.key_settlements!.some((r) => r.key_hash === a.key_hash)).toBe(true);

    // Le volume est perdu, pour ces lignes-là.
    for (const h of [a.key_hash, c.key_hash]) {
      db.prepare('DELETE FROM api_keys WHERE key_hash = ?').run(h);
      db.prepare('DELETE FROM key_claims WHERE key_hash = ?').run(h);
      db.prepare('DELETE FROM key_settlements WHERE key_hash = ?').run(h);
    }
    const report = restorePaidState(dump);
    expect(report.keys_inserted).toBeGreaterThanOrEqual(2);
    expect(report.claims_inserted).toBeGreaterThanOrEqual(1);
    expect(report.settlements_inserted).toBeGreaterThanOrEqual(1);

    const back = db
      .prepare('SELECT tier, claimed_at, claim_method, email_norm FROM api_keys WHERE key_hash = ?')
      .get(c.key_hash) as {
      tier: string;
      claimed_at: string;
      claim_method: string;
      email_norm: string;
    };
    expect(back.tier).toBe('claimed');
    expect(back.claimed_at).not.toBeNull();
    expect(back.claim_method).toBe('email_code');
    expect(back.email_norm).toBe(`bk-${RUN}@alpha.example.net`);
    expect(
      (
        db
          .prepare('SELECT COUNT(*) AS n FROM key_settlements WHERE key_hash = ?')
          .get(a.key_hash) as { n: number }
      ).n,
    ).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE key_hash = ? AND event = 'claim'")
          .get(c.key_hash) as { n: number }
      ).n,
    ).toBe(1);
  });

  it('23bis. un dump au format 1, écrit à la main, se restaure sans jeter', () => {
    expect(READABLE_FORMATS).toContain(1);
    const hash = `bk1-hash-${RUN}`;
    const old = {
      format: 1,
      taken_at: '2026-08-21T22:00:00Z',
      counts: { api_keys: 1, api_usage: 1 },
      api_keys: [
        {
          key_hash: hash,
          key_prefix: `ifk_bk1${String(RUN).slice(-5)}`,
          email: 'acme@example.com',
          monthly_limit: 200,
        },
      ],
      api_usage: [{ key_hash: hash, month: '2026-08', count: 3 }],
    };
    const report = restorePaidState(old);
    expect(report.keys_inserted).toBe(1);
    expect(report.usage_inserted).toBe(1);
    expect(report.claims_inserted).toBe(0);
    expect(report.settlements_inserted).toBe(0);
    // Une ligne ancienne prend le DEFAULT 'email', qui est vrai pour elle.
    const row = getStatsDB().prepare('SELECT tier FROM api_keys WHERE key_hash = ?').get(hash) as {
      tier: string;
    };
    expect(row.tier).toBe('email');
  });

  it("23ter. un aller-retour conserve le journal d'annulation du radar, et un dump au format 2 se restaure sans lui", () => {
    expect(READABLE_FORMATS).toContain(2);
    const db = getStatsDB();
    const hash = `bk3-hash-${RUN}`;
    const prefix = `ifk_bk3${String(RUN).slice(-5)}`;
    // Une ligne écrite comme le lot 6 l'écrit : bornes au format SQLite, ancien
    // solde consigné. Sans elle dans le dump, une clé coupée ne se rend plus.
    db.prepare(
      `INSERT INTO key_revocations
         (key_prefix, key_hash, reason, episode_id, anchor, anchor_share, anchor_keys,
          burst_from, burst_to, burst_keys, window_minutes, distinct_sources,
          prev_active, prev_monthly_limit, prev_units_used, prev_no_recredit)
       VALUES (?, ?, 'anon_burst', 'ep-test', 'ua:test-agent/1.0', 0.5, 8,
               '2026-09-15 10:00:00', '2026-09-15 10:00:30', 16, 0.5, 5, 1, 25, 3, 1)`,
    ).run(prefix, hash);

    const dump = exportPaidState('2026-09-15T12:00:00Z');
    // Le numéro courant et non un 3 figé : chaque lot qui ajoute une table
    // l'incrémente, et ce test-ci porte sur le journal d'annulation, pas sur la
    // valeur du compteur (que le test 23 vérifie déjà contre BACKUP_FORMAT).
    expect(dump.format).toBe(BACKUP_FORMAT);
    expect(READABLE_FORMATS).toContain(3);
    const mine = dump.key_revocations!.filter((r) => r.key_hash === hash);
    expect(mine).toHaveLength(1);
    expect(dump.counts.key_revocations).toBeGreaterThanOrEqual(1);

    // Le journal est perdu, pour cette ligne-là ; le dump la rend, une seule fois.
    db.prepare('DELETE FROM key_revocations WHERE key_hash = ?').run(hash);
    const only = {
      ...dump,
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
      lineage_facts: [],
    };
    const report = restorePaidState({ ...only, key_revocations: mine });
    expect(report.revocations_inserted).toBe(1);
    const again = restorePaidState({ ...only, key_revocations: mine });
    expect(again.revocations_inserted).toBe(0);
    expect(again.revocations_skipped).toBe(1);
    const back = db
      .prepare('SELECT prev_monthly_limit, prev_units_used FROM key_revocations WHERE key_hash = ?')
      .all(hash) as Array<{ prev_monthly_limit: number; prev_units_used: number }>;
    expect(back).toEqual([{ prev_monthly_limit: 25, prev_units_used: 3 }]);

    // Un dump au format 2 (avant le lot 6) n'a pas ce journal : rien à remettre,
    // et ce n'est pas une erreur.
    const f2 = restorePaidState({
      format: 2,
      taken_at: '2026-09-15T00:00:00Z',
      counts: { api_keys: 0, api_usage: 0, key_claims: 0, key_settlements: 0 },
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
    });
    expect(f2.revocations_inserted).toBe(0);
    expect(f2.revocations_skipped).toBe(0);
  });

  it('23quater. un aller-retour conserve les faits de mesure, et un dump au format 3 se restaure sans eux', () => {
    expect(READABLE_FORMATS).toContain(3);
    expect(READABLE_FORMATS).toContain(4);
    const db = getStatsDB();
    const lineage = `bk4-lineage-${RUN}`;
    // Une lignée comme le lot M l'écrit : bornes au format SQLite, « premiers »
    // posés une seule fois. Sans elle dans le dump, un volume restauré rendrait
    // des clés vivantes avec un entonnoir vide — et le rattrapage depuis
    // request_log ne rendrait que ce que la purge des douze mois a laissé.
    db.prepare(
      `INSERT INTO lineage_facts
         (lineage_hash, birth_at, birth_tier, backfilled, first_success_at, first_success_route,
          first_success_context, first_unmarked_success_at, last_success_at, last_success_day,
          success_days, updated_at)
       VALUES (?, '2026-09-15 08:00:00', 'anonymous', 0, '2026-09-15 08:30:00',
               'POST /v1/iban/validate', 'unknown', '2026-09-15 08:30:00',
               '2026-09-15 09:00:00', '2026-09-15', 1, '2026-09-15 09:00:00')`,
    ).run(lineage);

    const dump = exportPaidState('2026-09-15T12:00:00Z');
    expect(dump.format).toBe(BACKUP_FORMAT);
    const mine = dump.lineage_facts!.filter((r) => r.lineage_hash === lineage);
    expect(mine).toHaveLength(1);
    expect(dump.counts.lineage_facts).toBeGreaterThanOrEqual(1);

    // Les faits sont perdus, pour cette lignée-là ; le dump les rend, une fois.
    db.prepare('DELETE FROM lineage_facts WHERE lineage_hash = ?').run(lineage);
    const only = {
      ...dump,
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
      key_revocations: [],
    };
    const report = restorePaidState({ ...only, lineage_facts: mine });
    expect(report.lineages_inserted).toBe(1);
    const again = restorePaidState({ ...only, lineage_facts: mine });
    expect(again.lineages_inserted).toBe(0);
    expect(again.lineages_skipped).toBe(1);
    const back = db
      .prepare(
        'SELECT first_success_at, first_success_context, success_days, backfilled FROM lineage_facts WHERE lineage_hash = ?',
      )
      .all(lineage);
    expect(back).toEqual([
      {
        first_success_at: '2026-09-15 08:30:00',
        first_success_context: 'unknown',
        success_days: 1,
        backfilled: 0,
      },
    ]);

    // Un dump au format 3 (avant le lot M) n'a pas cette table : rien à
    // remettre, et ce n'est pas une erreur.
    const f3 = restorePaidState({
      format: 3,
      taken_at: '2026-09-15T00:00:00Z',
      counts: { api_keys: 0, api_usage: 0, key_claims: 0, key_settlements: 0, key_revocations: 0 },
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
      key_revocations: [],
    });
    expect(f3.lineages_inserted).toBe(0);
    expect(f3.lineages_skipped).toBe(0);
  });

  it('23quinquies. un aller-retour conserve le journal des bascules du disjoncteur, et un dump au format 4 se restaure sans lui', () => {
    expect(READABLE_FORMATS).toContain(4);
    const db = getStatsDB();
    const episode = `ep-bk-${RUN}`;
    db.prepare(
      `INSERT INTO breaker_transitions
         (episode_id, direction, reason, "trigger", creations_in_window, distinct_sources, threshold, window_minutes, undegraded)
       VALUES (?, 'armed', 'threshold', 'creations', 12, 6, 10, 60, 0)`,
    ).run(episode);
    const dump = exportPaidState('2026-09-15T12:00:00Z');
    expect(dump.format).toBe(BACKUP_FORMAT);
    const mine = dump.breaker_transitions!.filter((r) => r.episode_id === episode);
    expect(mine).toHaveLength(1);
    expect(dump.counts.breaker_transitions).toBeGreaterThanOrEqual(1);

    db.prepare('DELETE FROM breaker_transitions WHERE episode_id = ?').run(episode);
    const only = {
      ...dump,
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
      key_revocations: [],
      lineage_facts: [],
    };
    const report = restorePaidState({ ...only, breaker_transitions: mine });
    expect(report.transitions_inserted).toBe(1);
    const again = restorePaidState({ ...only, breaker_transitions: mine });
    expect(again.transitions_inserted).toBe(0);
    expect(again.transitions_skipped).toBe(1);
    const back = db
      .prepare(
        'SELECT direction, reason, creations_in_window FROM breaker_transitions WHERE episode_id = ?',
      )
      .all(episode);
    expect(back).toEqual([{ direction: 'armed', reason: 'threshold', creations_in_window: 12 }]);

    const f4 = restorePaidState({
      format: 4,
      taken_at: '2026-09-15T00:00:00Z',
      counts: { api_keys: 0, api_usage: 0 },
      api_keys: [],
      api_usage: [],
    });
    expect(f4.transitions_inserted).toBe(0);
    expect(f4.transitions_skipped).toBe(0);
    db.prepare('DELETE FROM breaker_transitions WHERE episode_id = ?').run(episode);
  });

  it('23sexies. un aller-retour conserve les naissances de clés, et un dump au format 5 se restaure sans elles', () => {
    expect(READABLE_FORMATS).toContain(5);
    const db = getStatsDB();
    const prefix = `ifk_bk6${String(RUN).slice(-5)}`;
    db.prepare(
      "INSERT INTO key_creations (ip_hash, user_agent, key_prefix) VALUES ('bk6-net', 'bk6-ua/1.0', ?)",
    ).run(prefix);
    const dump = exportPaidState('2026-09-15T12:00:00Z');
    expect(dump.format).toBe(BACKUP_FORMAT);
    const mine = dump.key_creations!.filter((r) => r.key_prefix === prefix);
    expect(mine).toHaveLength(1);
    expect(dump.counts.key_creations).toBeGreaterThanOrEqual(1);
    db.prepare('DELETE FROM key_creations WHERE key_prefix = ?').run(prefix);
    const only = {
      ...dump,
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
      key_revocations: [],
      lineage_facts: [],
      breaker_transitions: [],
    };
    const report = restorePaidState({ ...only, key_creations: mine });
    expect(report.creations_inserted).toBe(1);
    const again = restorePaidState({ ...only, key_creations: mine });
    expect(again.creations_inserted).toBe(0);
    expect(again.creations_skipped).toBe(1);
    const back = db
      .prepare('SELECT ip_hash, user_agent FROM key_creations WHERE key_prefix = ?')
      .all(prefix);
    expect(back).toEqual([{ ip_hash: 'bk6-net', user_agent: 'bk6-ua/1.0' }]);
    const f5 = restorePaidState({
      format: 5,
      taken_at: '2026-09-15T00:00:00Z',
      counts: { api_keys: 0, api_usage: 0 },
      api_keys: [],
      api_usage: [],
    });
    expect(f5.creations_inserted).toBe(0);
    db.prepare('DELETE FROM key_creations WHERE key_prefix = ?').run(prefix);
  });

  it('23septies. un aller-retour conserve les deux compteurs de portes, et un dump au format 6 se restaure sans eux', () => {
    // 🚨 Le discriminant qui les fait entrer dans la sauvegarde alors que
    // `trial_daily` en est délibérément absente : `trial_daily` se reconstruit
    // depuis `trial_ledger`, ces deux tables non. `device_codes` est purgée à
    // 24 h, et le nom d'un outil MCP n'est journalisé nulle part. Une
    // restauration sans elles rendrait des lignées vivantes avec un rail à zéro.
    expect(READABLE_FORMATS).toContain(6);
    expect(READABLE_FORMATS).toContain(7);
    // Le format 7 a introduit ces deux tables ; le format 8 (registre des
    // achats, lot B1) les porte toujours. Voir backup.purchases.test.ts.
    expect(BACKUP_FORMAT).toBe(8);
    const db = getStatsDB();
    const day = `2026-09-${String((RUN % 28) + 1).padStart(2, '0')}`;
    db.prepare(
      'INSERT INTO device_grant_daily (day, source, opened, approved_anonymous, delivered) VALUES (?, ?, 4, 3, 2)',
    ).run(day, 'mcp-device');
    db.prepare(
      'INSERT INTO mcp_remote_daily (day, sessions, tool_calls, key_requests) VALUES (?, 5, 40, 3)',
    ).run(day);
    const dump = exportPaidState('2026-09-15T12:00:00Z');
    const grants = dump.device_grant_daily!.filter((r) => r.day === day);
    const mcps = dump.mcp_remote_daily!.filter((r) => r.day === day);
    expect(grants).toHaveLength(1);
    expect(mcps).toHaveLength(1);
    expect(dump.counts.device_grant_daily).toBeGreaterThanOrEqual(1);
    expect(dump.counts.mcp_remote_daily).toBeGreaterThanOrEqual(1);
    db.prepare('DELETE FROM device_grant_daily WHERE day = ?').run(day);
    db.prepare('DELETE FROM mcp_remote_daily WHERE day = ?').run(day);
    const only = {
      ...dump,
      api_keys: [],
      api_usage: [],
      key_claims: [],
      key_settlements: [],
      key_revocations: [],
      lineage_facts: [],
      breaker_transitions: [],
      key_creations: [],
    };
    const report = restorePaidState({
      ...only,
      device_grant_daily: grants,
      mcp_remote_daily: mcps,
    });
    expect(report.grant_days_inserted).toBe(1);
    expect(report.mcp_days_inserted).toBe(1);
    // Rejouée : rien de plus, et surtout rien d'écrasé. Un compteur cumulatif
    // remis à une valeur ancienne serait pire qu'une journée manquante.
    const again = restorePaidState({
      ...only,
      device_grant_daily: grants,
      mcp_remote_daily: mcps,
    });
    expect(again.grant_days_inserted).toBe(0);
    expect(again.grant_days_skipped).toBe(1);
    expect(again.mcp_days_inserted).toBe(0);
    expect(again.mcp_days_skipped).toBe(1);
    const back = db
      .prepare(
        'SELECT source, opened, approved_anonymous, delivered FROM device_grant_daily WHERE day = ?',
      )
      .all(day);
    expect(back).toEqual([
      { source: 'mcp-device', opened: 4, approved_anonymous: 3, delivered: 2 },
    ]);
    const backMcp = db
      .prepare('SELECT sessions, tool_calls, key_requests FROM mcp_remote_daily WHERE day = ?')
      .all(day);
    expect(backMcp).toEqual([{ sessions: 5, tool_calls: 40, key_requests: 3 }]);
    // Un dump au format 6 n'a pas ces tables : rien à remettre, et ce n'est pas
    // une erreur.
    const f6 = restorePaidState({
      format: 6,
      taken_at: '2026-09-15T00:00:00Z',
      counts: { api_keys: 0, api_usage: 0 },
      api_keys: [],
      api_usage: [],
    });
    expect(f6.grant_days_inserted).toBe(0);
    expect(f6.mcp_days_inserted).toBe(0);
    db.prepare('DELETE FROM device_grant_daily WHERE day = ?').run(day);
    db.prepare('DELETE FROM mcp_remote_daily WHERE day = ?').run(day);
  });

  it("device_codes n'entre JAMAIS dans la sauvegarde : elle porte une clé en clair", () => {
    // 🚨 L'assertion la plus importante du fichier pour ce chantier.
    // `device_codes.raw_key_once` est une clé API EN CLAIR, et l'export est
    // précisément le fichier fait pour être copié hors du serveur (SEC-03).
    const dump = exportPaidState('2026-09-15T12:00:00Z') as unknown as Record<string, unknown>;
    expect(Object.keys(dump)).not.toContain('device_codes');
    expect(Object.keys(dump.counts as object)).not.toContain('device_codes');
    expect(JSON.stringify(dump)).not.toContain('raw_key_once');
  });
});
