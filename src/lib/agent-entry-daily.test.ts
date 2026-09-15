import { beforeEach, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import {
  bumpDeviceGrantApproval,
  bumpDeviceGrantDaily,
  bumpDeviceGrantExpiries,
  bumpMcpRemoteDaily,
  readDeviceGrantDaily,
  readMcpRemoteDaily,
} from './agent-entry-daily.js';

/**
 * Les deux compteurs journaliers des portes d'agent : ce qu'ils additionnent,
 * ce qu'ils bornent, et ce qu'ils refusent d'écrire.
 *
 * Fixtures inventées, ce dépôt est public.
 */
const TODAY = (): string =>
  (getStatsDB().prepare("SELECT date('now') AS d").get() as { d: string }).d;

beforeEach(() => {
  getStatsDB().exec('DELETE FROM device_grant_daily; DELETE FROM mcp_remote_daily;');
});

describe('device_grant_daily', () => {
  it('additionne dans la colonne demandée, sur la porte demandée', () => {
    bumpDeviceGrantDaily('opened', 'mcp-device');
    bumpDeviceGrantDaily('opened', 'mcp-device');
    bumpDeviceGrantDaily('opened', 'web-device');
    bumpDeviceGrantDaily('rate_limited', 'mcp-device');
    bumpDeviceGrantDaily('denied', 'web-device');
    bumpDeviceGrantDaily('delivered', 'mcp-device', 1);
    const rows = readDeviceGrantDaily(TODAY(), TODAY());
    expect(rows).toHaveLength(2);
    const mcp = rows.find((r) => r.source === 'mcp-device')!;
    const web = rows.find((r) => r.source === 'web-device')!;
    expect(mcp.opened).toBe(2);
    expect(mcp.rate_limited).toBe(1);
    expect(mcp.delivered).toBe(1);
    expect(mcp.denied).toBe(0);
    expect(web.opened).toBe(1);
    expect(web.denied).toBe(1);
  });

  it('borne la porte à trois valeurs : une source libre tombe dans other', () => {
    // 🚨 Le test qui garde la table petite. Sans la réduction, chaque `source`
    // inventée par un appelant créerait sa propre ligne, tous les jours, dans
    // une table qui n'a AUCUNE politique de rétention.
    bumpDeviceGrantDaily('opened', 'ma-porte-1');
    bumpDeviceGrantDaily('opened', 'ma-porte-2');
    bumpDeviceGrantDaily('opened', null);
    const rows = readDeviceGrantDaily(TODAY(), TODAY());
    expect(rows).toHaveLength(1);
    expect(rows[0].source).toBe('other');
    expect(rows[0].opened).toBe(3);
  });

  it("le palier choisit la branche d'approbation", () => {
    bumpDeviceGrantApproval('email', 'web-device');
    bumpDeviceGrantApproval('anonymous', 'web-device');
    // Un palier inattendu compte comme anonyme plutôt que de se perdre.
    bumpDeviceGrantApproval(null, 'web-device');
    const [row] = readDeviceGrantDaily(TODAY(), TODAY());
    expect(row.approved_email).toBe(1);
    expect(row.approved_anonymous).toBe(2);
  });

  it("n'écrit rien pour un incrément nul ou négatif", () => {
    bumpDeviceGrantDaily('opened', 'web-device', 0);
    bumpDeviceGrantDaily('opened', 'web-device', -5);
    bumpDeviceGrantDaily('opened', 'web-device', Number.NaN);
    expect(readDeviceGrantDaily(TODAY(), TODAY())).toHaveLength(0);
  });

  it('les expirations sont agrégées par porte, depuis device_codes', () => {
    const db = getStatsDB();
    const insert = db.prepare(
      `INSERT INTO device_codes (device_code_hash, user_code, grant_type, status, source, expires_at)
       VALUES (?, ?, 'device', 'pending', ?, datetime('now', '-2 hours'))`,
    );
    insert.run('h-exp-1', 'AAAABBBB', 'web-device');
    insert.run('h-exp-2', 'AAAABBBC', 'web-device');
    insert.run('h-exp-3', 'AAAABBBD', 'mcp-device');
    insert.run('h-exp-4', 'AAAABBBE', 'sa-porte-libre');
    // Une ligne encore valide : elle ne doit PAS être comptée.
    db.prepare(
      `INSERT INTO device_codes (device_code_hash, user_code, grant_type, status, source, expires_at)
       VALUES ('h-vivant', 'AAAABBBF', 'device', 'pending', 'web-device', datetime('now', '+10 minutes'))`,
    ).run();
    bumpDeviceGrantExpiries(
      `grant_type = 'device' AND status IN ('pending','approved')
         AND expires_at < datetime('now', '-1 hour')`,
    );
    const rows = readDeviceGrantDaily(TODAY(), TODAY());
    expect(rows.find((r) => r.source === 'web-device')!.expired).toBe(2);
    expect(rows.find((r) => r.source === 'mcp-device')!.expired).toBe(1);
    expect(rows.find((r) => r.source === 'other')!.expired).toBe(1);
    db.prepare("DELETE FROM device_codes WHERE device_code_hash LIKE 'h-exp-%'").run();
    db.prepare("DELETE FROM device_codes WHERE device_code_hash = 'h-vivant'").run();
  });

  it('ne rend que les jours de la plage demandée, bornes incluses', () => {
    const db = getStatsDB();
    db.prepare(
      "INSERT INTO device_grant_daily (day, source, opened) VALUES ('2026-09-01', 'web-device', 3)",
    ).run();
    db.prepare(
      "INSERT INTO device_grant_daily (day, source, opened) VALUES ('2026-09-05', 'web-device', 4)",
    ).run();
    db.prepare(
      "INSERT INTO device_grant_daily (day, source, opened) VALUES ('2026-09-09', 'web-device', 5)",
    ).run();
    const rows = readDeviceGrantDaily('2026-09-01', '2026-09-05');
    expect(rows.map((r) => r.day)).toEqual(['2026-09-01', '2026-09-05']);
  });
});

describe('mcp_remote_daily', () => {
  it('additionne les trois compteurs en une seule ligne par jour', () => {
    bumpMcpRemoteDaily({ sessions: 1 });
    bumpMcpRemoteDaily({ toolCalls: 3, keyRequests: 1 });
    bumpMcpRemoteDaily({ toolCalls: 2 });
    const rows = readMcpRemoteDaily(TODAY(), TODAY());
    expect(rows).toHaveLength(1);
    expect(rows[0].sessions).toBe(1);
    expect(rows[0].tool_calls).toBe(5);
    expect(rows[0].key_requests).toBe(1);
  });

  it("n'écrit rien quand les trois deltas sont vides", () => {
    bumpMcpRemoteDaily({});
    bumpMcpRemoteDaily({ sessions: 0, toolCalls: 0, keyRequests: 0 });
    bumpMcpRemoteDaily({ toolCalls: -3 });
    expect(readMcpRemoteDaily(TODAY(), TODAY())).toHaveLength(0);
  });
});
