import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeAll, getStatsDB } from './db.js';
import { clientProfileWindow, getClientProfiles } from './stats.js';

const NOW = new Date('2026-11-06T12:00:00.000Z');
const PREFIX = 'ifk_periode_fictive';
function sample(at: string, ancient = false) {
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO request_log (method,path,status,response_ms,created_at,hour,key_prefix,ip_hash,user_agent,client_kind)
    VALUES ('POST',?,?,?,?,23,?,?,?,?)`,
  ).run(
    ancient ? '/ancien' : '/v1/iban/validate',
    ancient ? 503 : 200,
    ancient ? 9000 : 12,
    at,
    PREFIX,
    ancient ? 'ip-ancienne' : 'ip-fictive',
    ancient ? 'ancien' : 'client-fictif',
    ancient ? 'bot' : 'api',
  );
  db.prepare(
    `INSERT INTO operations (operation_type,country_code,success,created_at,key_prefix,reject_reason)
    VALUES ('iban_validate',?,?,?,?,?)`,
  ).run(ancient ? 'IT' : 'CH', 1, at, PREFIX, ancient ? 'ancien' : 'fictif');
}
beforeEach(() => {
  getStatsDB().prepare('DELETE FROM request_log').run();
  getStatsDB().prepare('DELETE FROM operations').run();
});
afterAll(closeAll);

describe('Fenêtre des dossiers clients', () => {
  it.each([30, 90, 365])('applique exactement %i journées UTC à toutes les mesures', (days) => {
    const window = clientProfileWindow(days, NOW);
    const start = Date.parse(window.window_start);
    sample(new Date(start - 1).toISOString(), true);
    sample(window.window_start);
    sample('2026-11-06 11:00:00');
    sample('2026-11-06T13:00:00+01:00');
    sample('2026-11-06T12:00:00.001Z', true);
    sample('illisible', true);
    const p = getClientProfiles(days, NOW)[PREFIX];
    expect(p).toMatchObject({
      total: 3,
      ok: 3,
      server_error: 0,
      avg_ms: 12,
      p95_ms: 12,
      distinct_ips: 1,
      first_seen: window.window_start.replace('T', ' ').slice(0, 19),
      last_seen: '2026-11-06 12:00:00',
      last_success_at: '2026-11-06 12:00:00',
      last_refusal_at: null,
    });
    expect(p.endpoints).toEqual([{ path: '/v1/iban/validate', count: 3 }]);
    expect(p.countries).toEqual([{ code: 'CH', count: 3 }]);
    expect(p.user_agents).toEqual([{ ua: 'client-fictif', count: 3 }]);
    expect(p.client_kinds).toEqual([{ kind: 'api', count: 3 }]);
    expect(p.reject_reasons).toEqual([{ reason: 'fictif', count: 3 }]);
    expect(p.days).toEqual([
      { day: window.window_start.slice(0, 10), count: 1, bad: 0 },
      { day: '2026-11-06', count: 2, bad: 0 },
    ]);
    expect(p.hours.reduce((sum, n) => sum + n, 0)).toBe(3);
    expect([p.hours[0], p.hours[11], p.hours[12], p.hours[23]]).toEqual([1, 1, 1, 0]);
  });
  it('change réellement les totaux avec la période et ne crée pas un profil ancien vide', () => {
    sample('2026-09-01 10:00:00', true);
    expect(getClientProfiles(30, NOW)[PREFIX]).toBeUndefined();
    expect(getClientProfiles(90, NOW)[PREFIX].total).toBe(1);
  });
  it('compare les instants SQL et ISO après normalisation', () => {
    sample('2026-11-06T01:00:00+02:00');
    sample('2026-11-06 02:00:00');
    const p = getClientProfiles(30, NOW)[PREFIX];
    expect(p.first_seen).toBe('2026-11-05 23:00:00');
    expect(p.last_seen).toBe('2026-11-06 02:00:00');
    expect(p.days.map((r) => r.day)).toEqual(['2026-11-05', '2026-11-06']);
  });
  it('borne les entrées du calcul et inclut seulement le début du jour à minuit', () => {
    expect(clientProfileWindow(0, NOW).period_days).toBe(1);
    expect(clientProfileWindow(Infinity, NOW).period_days).toBe(90);
    expect(clientProfileWindow(400, NOW).period_days).toBe(365);
    sample('2026-11-06 00:00:00');
    sample('2026-11-06 00:00:01', true);
    expect(getClientProfiles(1, new Date('2026-11-06T00:00:00Z'))[PREFIX].total).toBe(1);
  });
  it('conserve tous les pays pour que leur décompte ne soit pas un top tronqué', () => {
    const insert = getStatsDB().prepare(
      "INSERT INTO operations (operation_type,country_code,success,created_at,key_prefix) VALUES ('iban_validate',?,1,?,?)",
    );
    for (let i = 0; i < 31; i++) insert.run(`pays-fictif-${i}`, NOW.toISOString(), PREFIX);
    expect(getClientProfiles(30, NOW)[PREFIX].countries).toHaveLength(31);
  });
});
