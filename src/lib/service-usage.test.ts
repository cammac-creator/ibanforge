import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { rmSync } from 'node:fs';

// La base est imposée avant les imports, même si le terminal avait un chemin configuré.
const TEST_DB = vi.hoisted(() => {
  const file = `${process.env.TMPDIR ?? '/tmp'}/ibf-service-usage-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = file;
  return file;
});

import { getStatsDB } from './db.js';
import { getServiceUsage } from './service-usage.js';
import { getActivation } from './activation.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const START = '2026-08-13T00:00:00.000Z';
let keyNumber = 0;

function key(prefix: string, email = 'member@alpha.example.net', active = 1) {
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, active, created_at)
       VALUES (?, ?, ?, ?, '2026-09-10 00:00:00')`,
    )
    .run(`fiction-${++keyNumber}`, prefix, email, active);
}

function request(
  prefix: string | null,
  at = '2026-09-11 10:00:00',
  status = 200,
  method = 'POST',
  path = '/v1/iban/validate',
) {
  getStatsDB()
    .prepare(
      'INSERT INTO request_log (key_prefix, created_at, status, method, path) VALUES (?, ?, ?, ?, ?)',
    )
    .run(prefix, at, status, method, path);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubEnv('CRM_INTERNAL_EMAILS', 'operator@alpha.example.net');
  getStatsDB().exec('DELETE FROM request_log; DELETE FROM api_keys;');
});

afterAll(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  getStatsDB().close();
  for (const suffix of ['', '-wal', '-shm']) rmSync(TEST_DB + suffix, { force: true });
});

describe('service_usage — réponses métier observées', () => {
  it('rend les trois compteurs nuls et le périmètre exact sans compte attribuable', () => {
    expect(getServiceUsage(30, NOW)).toEqual({
      version: 1,
      period_days: 30,
      window_start: START,
      observed_until: NOW.toISOString(),
      unit: 'account',
      observation_basis: 'retained_request_log',
      active_accounts: 0,
      returning_accounts: 0,
      first_observed_accounts: 0,
    });
  });

  it('compte une réponse métier 2xx sans la confondre avec le premier appel', () => {
    key('ifk_member');
    request('ifk_member', '2026-07-01 10:00:00', 400);
    request('ifk_member', '2026-07-02 10:00:00', 200, 'GET', '/health');
    request('ifk_member');
    expect(getServiceUsage(30, NOW)).toMatchObject({
      active_accounts: 1,
      returning_accounts: 0,
      first_observed_accounts: 1,
    });
  });

  it.each([400, 401, 402, 404, 429, 500, 503])('ne compte pas le statut %i', (status) => {
    key('ifk_member');
    request('ifk_member', undefined, status);
    expect(getServiceUsage(30, NOW).active_accounts).toBe(0);
  });

  it.each([
    ['GET', '/v1/iban/validate'],
    ['POST', '/v1/bic/:code'],
    ['GET', '/health'],
    ['GET', '/v1/demo'],
    ['GET', '/openapi.json'],
    ['POST', '/mcp:tools-call'],
    ['GET', '/v1/bic/{code}'],
    ['GET', '/v1/bic/%7Bcode%7D'],
  ])('exclut la découverte et les appels hors filtre : %s %s', (method, path) => {
    key('ifk_member');
    request('ifk_member', undefined, 200, method, path);
    expect(getServiceUsage(30, NOW).active_accounts).toBe(0);
  });

  it.each([
    ['POST', '/v1/iban/validate'],
    ['POST', '/v1/iban/batch'],
    ['POST', '/v1/iban/compliance'],
    ['GET', '/v1/bic/:code'],
    ['GET', '/v1/ch/clearing/:iid'],
  ])('reprend les routes métier existantes : %s %s', (method, path) => {
    key('ifk_member');
    request('ifk_member', undefined, 201, method, path);
    expect(getServiceUsage(30, NOW).active_accounts).toBe(1);
  });

  it('réunit les clés actives et inactives sans doubler une même date', () => {
    key('ifk_old', 'member@alpha.example.net', 0);
    key('ifk_new', 'Member@alpha.example.net');
    request('ifk_old', '2026-09-10 09:00:00');
    request('ifk_new', '2026-09-10 10:00:00');
    request('ifk_new', '2026-09-10 11:00:00');
    expect(getServiceUsage(30, NOW)).toMatchObject({
      active_accounts: 1,
      returning_accounts: 0,
    });
    request('ifk_new');
    expect(getServiceUsage(30, NOW)).toMatchObject({
      active_accounts: 1,
      returning_accounts: 1,
      first_observed_accounts: 1,
    });
  });

  it('prend la première observation de toutes les clés conservées, même hors fenêtre', () => {
    key('ifk_old', undefined, 0);
    key('ifk_new');
    request('ifk_old', '2026-06-01 09:00:00');
    request('ifk_new');
    expect(getServiceUsage(30, NOW)).toMatchObject({
      active_accounts: 1,
      returning_accounts: 0,
      first_observed_accounts: 0,
    });
  });

  it('compte la première observation conservée après disparition d’une trace plus ancienne', () => {
    key('ifk_member');
    request('ifk_member', '2025-01-01 09:00:00');
    request('ifk_member');
    expect(getServiceUsage(30, NOW).first_observed_accounts).toBe(0);
    getStatsDB().prepare('DELETE FROM request_log WHERE created_at = ?').run('2025-01-01 09:00:00');
    expect(getServiceUsage(30, NOW)).toMatchObject({
      observation_basis: 'retained_request_log',
      first_observed_accounts: 1,
    });
  });

  it('exclut les comptes internes et les adresses génériques partagées', () => {
    const emails = [
      'operator@alpha.example.net',
      'person@example.com',
      'batch@cohorte.invalid',
      'credits-buyer',
      'stripe-buyer',
      'oem-subscriber',
      '',
    ];
    for (const [i, email] of emails.entries()) {
      const prefix = `ifk_excluded${i}`;
      key(prefix, email);
      request(prefix);
    }
    expect(getServiceUsage(30, NOW)).toMatchObject({
      active_accounts: 0,
      returning_accounts: 0,
      first_observed_accounts: 0,
    });
  });

  it('écarte les préfixes absents, inconnus ou partagés entre plusieurs comptes', () => {
    key('ifk_shared', 'one@alpha.example.net');
    key('ifk_shared', 'two@alpha.example.net');
    key('ifk_mixed', 'member@alpha.example.net');
    key('ifk_mixed', 'operator@alpha.example.net');
    request('ifk_shared');
    request('ifk_mixed');
    request(null);
    request('ifk_unknown');
    key('ifk_known_without_call');
    expect(getServiceUsage(30, NOW).active_accounts).toBe(0);
  });

  it('un préfixe répété pour le même compte ne multiplie pas le résultat', () => {
    key('ifk_same');
    key('ifk_same');
    request('ifk_same');
    expect(getServiceUsage(30, NOW).active_accounts).toBe(1);
  });

  it('applique les bornes UTC aux deux formats et exclut dates invalides ou futures', () => {
    key('ifk_before', 'before@alpha.example.net');
    request('ifk_before', '2026-08-12 23:59:59');
    key('ifk_start', 'start@alpha.example.net');
    request('ifk_start', START);
    key('ifk_until', 'until@alpha.example.net');
    request('ifk_until', NOW.toISOString());
    key('ifk_future', 'future@alpha.example.net');
    request('ifk_future', '2026-09-11T12:00:00.001Z');
    key('ifk_invalid', 'invalid@alpha.example.net');
    request('ifk_invalid', 'not-a-date');
    expect(getServiceUsage(30, NOW)).toMatchObject({
      active_accounts: 2,
      returning_accounts: 0,
      first_observed_accounts: 2,
    });
  });

  it('normalise les décalages horaires avant les minima et les dates distinctes', () => {
    key('ifk_member');
    request('ifk_member', '2026-08-13T00:30:00+02:00');
    request('ifk_member', '2026-09-10T23:30:00-02:00');
    request('ifk_member', '2026-09-11 10:00:00');
    expect(getServiceUsage(30, NOW)).toMatchObject({
      active_accounts: 1,
      returning_accounts: 0,
      first_observed_accounts: 0,
    });
  });

  it('deux dates UTC comptent deux jours, sans promettre un délai de vingt-quatre heures', () => {
    key('ifk_member');
    request('ifk_member', '2026-09-10T23:59:59Z');
    request('ifk_member', '2026-09-11T00:00:01Z');
    expect(getServiceUsage(30, NOW).returning_accounts).toBe(1);
  });

  it('borne les périodes au contrat 30/90 et annonce la vraie fenêtre', () => {
    key('ifk_member');
    request('ifk_member', '2026-07-01 10:00:00');
    expect(getServiceUsage(90, NOW)).toMatchObject({
      period_days: 90,
      window_start: '2026-06-14T00:00:00.000Z',
      active_accounts: 1,
    });
    expect(getServiceUsage(45, NOW)).toMatchObject({ period_days: 30, active_accounts: 0 });
  });

  it('ajoute le bloc sans réinterpréter premier appel, statut ou ancien entonnoir', () => {
    key('ifk_member');
    request('ifk_member', '2026-09-10 01:00:00', 200, 'GET', '/health');
    request('ifk_member', '2026-09-10 02:00:00', 400);
    const response = getActivation(30);
    expect(response.clients[0].first_call_at).toBe('2026-09-10 01:00:00');
    expect(response.clients[0].status).toBe('active');
    expect(response.funnel.first_call).toBe(1);
    expect(response.funnel.purchased).toBe(0);
    expect(response.cohorts).toHaveLength(8);
    expect(response.service_usage.active_accounts).toBe(0);
    expect(Object.keys(response.service_usage).sort()).toEqual(
      [
        'version',
        'period_days',
        'window_start',
        'observed_until',
        'unit',
        'observation_basis',
        'active_accounts',
        'returning_accounts',
        'first_observed_accounts',
      ].sort(),
    );
  });
});
