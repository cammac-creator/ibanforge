import { beforeEach, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { getDailyCallers } from './daily-callers.js';
import { getActivation } from './activation.js';

const NOW = new Date('2026-06-16T12:00:00Z');
let serial = 0;
function key(
  prefix: string,
  email = 'member@alpha.example.net',
  tier = 'email',
  issued = 0,
  active = 1,
) {
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys
    (key_hash, key_prefix, email, tier, issued_by_us, active) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(`fiction-${++serial}`, prefix, email, tier, issued, active);
}
function call(prefix: string | null, at = '2026-06-16 10:00:00', status = 200) {
  getStatsDB()
    .prepare(
      'INSERT INTO request_log (key_prefix, created_at, status, method, path) VALUES (?, ?, ?, ?, ?)',
    )
    .run(prefix, at, status, 'GET', '/v1/demo');
}
beforeEach(() => {
  getStatsDB().exec(
    'DELETE FROM request_log; DELETE FROM api_keys; DROP INDEX IF EXISTS idx_api_keys_prefix_unique',
  );
});

describe('comptes ayant appelé par jour UTC', () => {
  it('réunit toutes les clés et tous les statuts, y compris une clé remplacée', () => {
    key('ifk_old', undefined, 'email', 0, 0);
    key('ifk_new', 'Member@alpha.example.net');
    call('ifk_old');
    call('ifk_new', undefined, 429);
    call('ifk_new', undefined, 402);
    expect(getDailyCallers(30, NOW).days.at(-1)).toEqual({ day: '2026-06-16', accounts: 1 });
  });
  it('exclut anonymes, internes, amorçage, pilotes et préfixes inconnus', () => {
    key('ifk_anon', 'anonymous', 'anonymous');
    key('ifk_anon_mail', 'anon@alpha.example.net', 'anonymous');
    key('ifk_internal', 'person@example.com');
    key('ifk_issued', 'issued@alpha.example.net', 'email', 1);
    key('ifk_pilot', 'launch-pilot@alpha.example.net');
    for (const p of [
      'ifk_anon',
      'ifk_anon_mail',
      'ifk_internal',
      'ifk_issued',
      'ifk_pilot',
      'ifk_unknown',
      null,
    ])
      call(p);
    expect(getDailyCallers(30, NOW).days.every((d) => d.accounts === 0)).toBe(true);
  });
  it('écarte un préfixe ambigu avant les exclusions internes', () => {
    key('ifk_shared', 'one@alpha.example.net');
    key('ifk_shared', 'two@alpha.example.net');
    key('ifk_mixed');
    key('ifk_mixed', 'person@example.com');
    call('ifk_shared');
    call('ifk_mixed');
    expect(getDailyCallers(30, NOW).days.at(-1)?.accounts).toBe(0);
  });
  it('garde un préfixe répété pour le même compte sans le compter deux fois', () => {
    key('ifk_same');
    key('ifk_same');
    call('ifk_same');
    expect(getDailyCallers(30, NOW).days.at(-1)?.accounts).toBe(1);
  });
  it('produit exactement trente dates, zéros compris, avec les deux formats de date', () => {
    key('ifk_one');
    key('ifk_two', 'two@alpha.example.net');
    call('ifk_one', '2026-05-18 00:00:00');
    call('ifk_two', '2026-05-18T00:00:00Z');
    call('ifk_one', '2026-05-17T23:59:59Z');
    call('ifk_one', '2026-06-16T12:00:00.001Z');
    call('ifk_one', 'invalid');
    const result = getDailyCallers(30, NOW);
    expect(result.window).toEqual({ from: '2026-05-18', to: '2026-06-16' });
    expect(result.days).toHaveLength(30);
    expect(result.days[0].accounts).toBe(2);
    expect(result.days.slice(1).every((d) => d.accounts === 0)).toBe(true);
    expect(result).toMatchObject({ unit: 'account', today_partial: true });
  });
  it('normalise les décalages horaires et conserve les fenêtres 30/90', () => {
    key('ifk_one');
    call('ifk_one', '2026-06-15T23:30:00-02:00');
    expect(getDailyCallers(90, NOW).days).toHaveLength(90);
    expect(getDailyCallers(90, NOW).days.at(-1)?.accounts).toBe(1);
    expect(getDailyCallers(7, NOW).period_days).toBe(30);
  });
  it('ajoute la lecture à activation sans changer la version des réponses métier', () => {
    const result = getActivation(30);
    expect(result.daily_callers.days).toHaveLength(30);
    expect(result.service_usage.version).toBe(1);
  });
});
