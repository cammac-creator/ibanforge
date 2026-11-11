import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { getActivation, getActivationFor } from './activation.js';

/**
 * Lot 3I (11.11.2026) : le verdict d'UNE adresse (`getActivationFor`, lu par la
 * fiche du bureau) est celui de `/v1/admin/activation`, jamais recalculé. Les
 * deux lectures appellent la même fonction de verdict ; cet essai les tient
 * égales, champ par champ, sur des données inventées qui couvrent chaque statut.
 *
 * Adresses sur alpha.example.net : @example.com est une adresse interne
 * (INTERNAL_EMAIL_RE), que l'activation écarte.
 */
const PFX = 'ifk_actfor';
const PAYING = 'paying@alpha.example.net';
const DORMANT = 'dormant@alpha.example.net';
const AT_LIMIT = 'atlimit@alpha.example.net';
const ACTIVE = 'active@alpha.example.net';
const NEW = 'new@alpha.example.net';
const SILENT = 'silent@alpha.example.net';
const INTERNAL = 'actfor-probe@example.com';
const ALL = [PAYING, DORMANT, AT_LIMIT, ACTIVE, NEW, SILENT];

function iso(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
const now = Date.now();
const daysAgo = (n: number) => iso(new Date(now - n * 86_400_000));
const month = new Date().toISOString().slice(0, 7);

beforeAll(() => {
  const db = getStatsDB();
  const insKey = db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit, credits_total, credits_remaining, source, tier)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, CASE WHEN ? IS NOT NULL THEN 'paid' ELSE 'email' END)`,
  );
  const key = (
    id: string,
    email: string,
    created: string,
    limit: number | null,
    credits: number | null,
    left: number | null,
    source: string | null,
  ) =>
    insKey.run(
      `${PFX}_${id}`,
      `${PFX}_${id}`,
      email,
      created,
      limit,
      credits,
      left,
      source,
      credits,
    );
  key('p_free', PAYING, daysAgo(30), 200, null, null, 'mcp');
  key('p_pack', PAYING, daysAgo(5), null, 5000, 3400, null);
  key('d_pack', DORMANT, daysAgo(40), null, 1000, 900, null);
  key('l_free', AT_LIMIT, daysAgo(20), 200, null, null, null);
  key('a_free', ACTIVE, daysAgo(20), 200, null, null, 'docs');
  key('n_free', NEW, daysAgo(1), 200, null, null, null);
  key('s_free', SILENT, daysAgo(30), 200, null, null, null);
  key('i_free', INTERNAL, daysAgo(10), 200, null, null, null);

  db.prepare('INSERT OR REPLACE INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)').run(
    `${PFX}_l_free`,
    month,
    200,
  );
  const insLog = db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix)
     VALUES ('POST', '/v1/iban/validate', ?, 12, ?, ?)`,
  );
  insLog.run(200, daysAgo(2), `${PFX}_p_pack`);
  insLog.run(200, daysAgo(25), `${PFX}_p_free`);
  insLog.run(200, daysAgo(30), `${PFX}_d_pack`);
  insLog.run(429, daysAgo(4), `${PFX}_l_free`);
  insLog.run(200, daysAgo(3), `${PFX}_a_free`);
});

afterAll(() => {
  const db = getStatsDB();
  db.prepare(`DELETE FROM request_log WHERE key_prefix LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM api_usage WHERE key_hash LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM api_keys WHERE key_prefix LIKE '${PFX}%'`).run();
});

describe('getActivationFor: the same verdict as getActivation, for one address', () => {
  it('covers every status on the invented data', () => {
    const statuses = ALL.map((e) => getActivationFor(e)?.status);
    expect(statuses).toEqual(['paying', 'dormant', 'at-limit', 'active', 'new', 'silent']);
  });

  it.each(ALL)('%s: equal, field by field, to its row of /v1/admin/activation', (email) => {
    const whole = getActivation(90).clients.find((c) => c.email === email);
    expect(whole).toBeDefined();
    expect(getActivationFor(email)).toEqual(whole);
  });

  it('reads the address whatever its case or its surrounding spaces', () => {
    expect(getActivationFor(`  ${PAYING.toUpperCase()} `)).toEqual(getActivationFor(PAYING));
  });

  it('null for an internal address, an unknown one and an empty one', () => {
    expect(getActivationFor(INTERNAL)).toBeNull();
    expect(getActivation(90).clients.some((c) => c.email === INTERNAL)).toBe(false);
    expect(getActivationFor('nobody@alpha.example.net')).toBeNull();
    expect(getActivationFor('   ')).toBeNull();
  });
});
