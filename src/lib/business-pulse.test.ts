import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getStatsDB } from './db.js';
import { BUSINESS_COHORTS, getBusinessAccounts, getBusinessPulse } from './business-pulse.js';

const NOW = new Date('2026-11-06T12:00:00Z');
let id = 0;
function key(email: string, at = '2026-11-02 12:00:00', prefix?: string) {
  const hash = `fiction-${++id}`;
  const p = prefix ?? `ifk_fiction${id}`;
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, created_at)
    VALUES (?, ?, ?, ?)`,
    )
    .run(hash, p, email, at);
  return { hash, prefix: p };
}
function call(
  prefix: string | null,
  at: string,
  status = 200,
  path = '/v1/iban/validate',
  method = 'POST',
) {
  getStatsDB()
    .prepare(
      `INSERT INTO request_log (key_prefix, created_at, status, path, method)
    VALUES (?, ?, ?, ?, ?)`,
    )
    .run(prefix, at, status, path, method);
}
function buy(
  k: ReturnType<typeof key>,
  at: string,
  outcome = 'credited',
  issued = 0,
  amount: number | null = 500,
) {
  getStatsDB()
    .prepare(
      `INSERT INTO key_purchases
    (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix, created_at, amount_minor, issued_by_us)
    VALUES (?, 'card', 'pack', ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(`fiction-ref-${++id}`, outcome, k.hash, k.hash, k.prefix, at, amount, issued);
}
beforeEach(() => {
  getStatsDB().exec('DELETE FROM request_log; DELETE FROM key_purchases; DELETE FROM api_keys;');
  vi.stubEnv('CRM_INTERNAL_EMAILS', 'operator@alpha.example.net');
});
afterEach(() => vi.unstubAllEnvs());

describe('pilotage — unités, périodes et absence de données personnelles', () => {
  it('rend un calendrier complet, y compris les jours sans activité et la semaine partielle', () => {
    const pulse = getBusinessPulse(NOW);
    expect(pulse.days).toHaveLength(90);
    expect(pulse.days[0].date).toBe('2026-08-09');
    expect(pulse.days.at(-1)).toEqual({
      date: '2026-11-06',
      active_accounts: 0,
      new_accounts: 0,
      new_buyers: 0,
    });
    expect(pulse.weeks).toHaveLength(8);
    expect(pulse.weeks.at(-1)).toEqual({
      start: '2026-11-02',
      end: '2026-11-08',
      partial: true,
      new_accounts: 0,
      new_buyers: 0,
    });
    expect(pulse.weeks.filter((w) => w.partial)).toHaveLength(1);
  });
  it('réunit les clés d’un compte et compte les jours distincts, pas les appels', () => {
    const old = key(' Member@alpha.example.net ', '2026-08-01 00:00:00');
    const fresh = key('member@alpha.example.net');
    call(old.prefix, '2026-11-05 12:00:00');
    call(fresh.prefix, '2026-11-05 13:00:00');
    call(fresh.prefix, '2026-11-06 11:00:00');
    expect(getBusinessPulse(NOW).totals).toEqual({
      known_accounts: 1,
      buyer_accounts: 0,
      active_7d: 1,
      active_30d: 1,
      returning_7d: 1,
    });
    expect(getBusinessPulse(NOW).weeks.at(-1)?.new_accounts).toBe(0);
    expect(
      getBusinessPulse(NOW)
        .days.slice(-2)
        .map((d) => d.active_accounts),
    ).toEqual([1, 1]);
  });
  it('garde les internes, anonymes, refus, découvertes et dates futures hors activité', () => {
    const valid = key('member@alpha.example.net');
    for (const email of ['operator@alpha.example.net', 'anonymous', 'person@example.com']) {
      call(key(email).prefix, '2026-11-06 10:00:00');
    }
    for (const status of [400, 401, 402, 429, 500])
      call(valid.prefix, '2026-11-06 10:00:00', status);
    call(valid.prefix, '2026-11-06 10:00:00', 200, '/health', 'GET');
    call(valid.prefix, '2026-11-06 10:00:00', 200, '/v1/bic/{code}', 'GET');
    call(valid.prefix, '2026-11-06 10:00:00', 200, '/v1/bic/%7Bcode%7D', 'GET');
    for (const path of ['/v1/iban/format', '/mcp:tools-call']) {
      call(valid.prefix, '2026-11-06 10:00:00', 200, path);
    }
    call(valid.prefix, '2026-11-06T12:00:00.001Z');
    call(null, '2026-11-06 10:00:00');
    key('future@alpha.example.net', '2026-12-01 00:00:00');
    expect(getBusinessPulse(NOW).totals).toMatchObject({ known_accounts: 1, active_7d: 0 });
    call(valid.prefix, NOW.toISOString());
    expect(getBusinessPulse(NOW).totals.active_7d).toBe(1);
  });
  it('ne transforme pas un préfixe ambigu en compte externe après exclusion de l’interne', () => {
    getStatsDB().exec('DROP INDEX IF EXISTS idx_api_keys_prefix_unique');
    const external = key('member@alpha.example.net', undefined, 'ifk_collision');
    key('operator@alpha.example.net', undefined, 'ifk_collision');
    call(external.prefix, '2026-11-06 11:00:00');
    expect(getBusinessPulse(NOW).totals.active_7d).toBe(0);
  });
  it('normalise les heures et conserve les bornes des sept et trente jours UTC', () => {
    const a = key('one@alpha.example.net', '2026-01-01 00:00:00');
    const b = key('two@alpha.example.net', '2026-01-01 00:00:00');
    call(a.prefix, '2026-10-31T00:15:00+02:00');
    call(b.prefix, '2026-10-30T23:15:00-02:00');
    expect(getBusinessPulse(NOW).totals).toMatchObject({
      active_7d: 1,
      active_30d: 2,
      returning_7d: 0,
    });
    expect(getBusinessPulse(NOW).days.find((d) => d.date === '2026-10-31')?.active_accounts).toBe(
      1,
    );
  });
  it('place un nouveau compte et son premier achat dans leurs semaines respectives', () => {
    const a = key('one@alpha.example.net', '2026-10-25 23:59:59');
    buy(a, '2026-11-02 00:00:00');
    buy(a, '2026-11-03 00:00:00');
    const pulse = getBusinessPulse(NOW);
    expect(pulse.weeks.at(-3)?.new_accounts).toBe(1);
    expect(pulse.weeks.at(-1)).toMatchObject({ new_accounts: 0, new_buyers: 1 });
    expect(pulse.totals.buyer_accounts).toBe(1);
  });
  it('ne recrée pas un acheteur lors d’une autre clé, d’un abonnement ou d’un remboursement', () => {
    const a = key('one@alpha.example.net', '2026-09-01 00:00:00');
    buy(a, '2026-09-10 00:00:00', 'refunded');
    const b = key('One@alpha.example.net');
    buy(b, '2026-11-03 00:00:00', 'attached');
    expect(getBusinessPulse(NOW).totals.buyer_accounts).toBe(1);
    expect(getBusinessPulse(NOW).weeks.at(-1)?.new_buyers).toBe(0);
  });
  it('écarte les dons, paiements échoués ou en attente, montants nuls et futurs', () => {
    for (const [i, outcome] of ['pending', 'failed', 'credited', 'credited'].entries()) {
      buy(
        key(`member${i}@alpha.example.net`),
        '2026-11-03 00:00:00',
        outcome,
        i === 2 ? 1 : 0,
        i === 3 ? 0 : 500,
      );
    }
    buy(key('future@alpha.example.net'), '2026-12-03 00:00:00');
    expect(getBusinessPulse(NOW).totals.buyer_accounts).toBe(0);
  });
  it('ne renvoie ni adresse, ni préfixe, ni référence, et ne modifie aucune table source', () => {
    const k = key('private@alpha.example.net');
    buy(k, '2026-11-03 00:00:00');
    call(k.prefix, '2026-11-06 11:00:00');
    const before = getStatsDB().prepare('SELECT total_changes() AS n').get();
    const body = JSON.stringify(getBusinessPulse(NOW));
    expect(getStatsDB().prepare('SELECT total_changes() AS n').get()).toEqual(before);
    for (const secret of ['@', 'ifk_', 'fiction-', 'key_prefix', 'lineage_hash', 'payer_email'])
      expect(body).not.toContain(secret);
  });
  it('ne laisse pas un futur type de vente élargir le périmètre API', () => {
    buy(key('member@alpha.example.net'), '2026-11-03 00:00:00');
    getStatsDB().prepare("UPDATE key_purchases SET kind = 'file_audit'").run();
    expect(getBusinessPulse(NOW).totals.buyer_accounts).toBe(0);
  });
});

describe('comptes correspondant aux indicateurs privés', () => {
  it('rend exactement la population de chacun des quatre compteurs', () => {
    const old = key('old@alpha.example.net', '2026-09-01 12:00:00');
    const fresh = key('new@alpha.example.net', '2026-11-04 12:00:00');
    const twin = key(' NEW@alpha.example.net ', '2026-11-05 12:00:00');
    const silent = key('silent@alpha.example.net', '2026-11-05 12:00:00');
    call(old.prefix, '2026-11-01 12:00:00');
    call(fresh.prefix, '2026-11-06 10:00:00');
    call(twin.prefix, '2026-11-06 11:00:00');
    call(silent.prefix, '2026-11-06 11:00:00', 402);
    buy(old, '2026-11-03 12:00:00');
    const pulse = getBusinessPulse(NOW);
    const expected = {
      active_today: pulse.days.at(-1)!.active_accounts,
      active_week: pulse.totals.active_7d,
      new_accounts: pulse.weeks.at(-1)!.new_accounts,
      new_buyers: pulse.weeks.at(-1)!.new_buyers,
    };
    for (const cohort of BUSINESS_COHORTS) {
      const result = getBusinessAccounts(cohort, 1, NOW);
      expect(result.total).toBe(expected[cohort]);
      expect(result.rows).toHaveLength(expected[cohort]);
      expect(new Set(result.rows.map((row) => row.email)).size).toBe(result.total);
      expect(result.generated_at).toBe(pulse.generated_at);
    }
    expect(getBusinessAccounts('active_today', 1, NOW).rows).toEqual([
      {
        email: 'new@alpha.example.net',
        created_at: '2026-11-04T12:00:00.000Z',
        first_purchase_at: null,
        active_days: 1,
        last_active_day: '2026-11-06',
      },
    ]);
    expect(getBusinessAccounts('active_week', 1, NOW).rows.map((row) => row.email)).toEqual([
      'new@alpha.example.net',
      'old@alpha.example.net',
    ]);
  });
  it('ne transforme ni un refus, ni une visite de documentation en utilisateur actif', () => {
    const candidate = key('candidate@alpha.example.net');
    for (const status of [400, 401, 402, 429, 500])
      call(candidate.prefix, '2026-11-06 10:00:00', status);
    for (const path of ['/health', '/v1/iban/format', '/mcp:tools-call'])
      call(candidate.prefix, '2026-11-06 10:00:00', 200, path);
    call(candidate.prefix, '2026-11-06T12:00:00.001Z');
    expect(getBusinessAccounts('active_today', 1, NOW).rows).toEqual([]);
    expect(getBusinessAccounts('active_week', 1, NOW).total).toBe(0);
    call(candidate.prefix, NOW.toISOString());
    expect(getBusinessAccounts('active_today', 1, NOW).total).toBe(1);
  });
  it('garde les comptes internes, anonymes et futurs hors des listes', () => {
    for (const email of ['operator@alpha.example.net', 'anonymous', 'person@example.com']) {
      const k = key(email);
      call(k.prefix, '2026-11-06 10:00:00');
      buy(k, '2026-11-06 10:00:00');
    }
    key('future@alpha.example.net', '2026-12-01 00:00:00');
    for (const cohort of BUSINESS_COHORTS)
      expect(getBusinessAccounts(cohort, 1, NOW).total).toBe(0);
  });
  it('distingue une clé offerte d’un premier achat et ne recrée pas un ancien acheteur', () => {
    const offered = key('offered@alpha.example.net');
    getStatsDB()
      .prepare('UPDATE api_keys SET credits_total=100, credits_remaining=100 WHERE key_hash=?')
      .run(offered.hash);
    buy(offered, '2026-11-04 12:00:00', 'credited', 1);
    const old = key('buyer@alpha.example.net', '2026-09-01 00:00:00');
    buy(old, '2026-10-01 00:00:00', 'refunded');
    buy(old, '2026-11-04 12:00:00');
    expect(getBusinessAccounts('new_buyers', 1, NOW).total).toBe(0);
    expect(getBusinessAccounts('new_accounts', 1, NOW).rows[0].first_purchase_at).toBeNull();
  });
  it('garde les mêmes frontières UTC que le calendrier et la semaine de création', () => {
    const a = key('before@alpha.example.net', '2026-11-02T00:30:00+02:00');
    const b = key('after@alpha.example.net', '2026-11-01T23:30:00-02:00');
    call(a.prefix, '2026-10-31T00:15:00+02:00');
    call(b.prefix, '2026-10-30T23:15:00-02:00');
    expect(getBusinessAccounts('active_week', 1, NOW).rows.map((row) => row.email)).toEqual([
      'after@alpha.example.net',
    ]);
    expect(getBusinessAccounts('new_accounts', 1, NOW).rows.map((row) => row.email)).toEqual([
      'after@alpha.example.net',
    ]);
    expect(getBusinessAccounts('active_today', 1, NOW).window).toEqual({
      start: '2026-11-06',
      end: '2026-11-06',
    });
    expect(getBusinessAccounts('active_week', 1, NOW).window).toEqual({
      start: '2026-10-31',
      end: '2026-11-06',
    });
    expect(getBusinessAccounts('new_accounts', 1, NOW).window).toEqual({
      start: '2026-11-02',
      end: '2026-11-06',
    });
  });
  it('pagine sans doublon, garde le total et borne une page devenue trop grande', () => {
    for (let i = 0; i < 55; i++)
      key(`member-${String(i).padStart(2, '0')}@alpha.example.net`, '2026-11-04 12:00:00');
    const first = getBusinessAccounts('new_accounts', 1, NOW),
      second = getBusinessAccounts('new_accounts', 2, NOW);
    expect(first).toMatchObject({ total: 55, page: 1, page_size: 50, pages: 2 });
    expect(first.rows).toHaveLength(50);
    expect(second.rows).toHaveLength(5);
    expect(new Set([...first.rows, ...second.rows].map((row) => row.email)).size).toBe(55);
    expect(first.rows[0].email).toBe('member-00@alpha.example.net');
    expect(second.rows[0].email).toBe('member-50@alpha.example.net');
    expect(getBusinessAccounts('new_accounts', 999, NOW)).toEqual(second);
    expect(getBusinessAccounts('new_accounts', 0, NOW)).toEqual(first);
  });
  it('un relevé vide garde une page lisible et aucun compte inventé', () => {
    expect(getBusinessAccounts('new_buyers', 8, NOW)).toMatchObject({
      total: 0,
      page: 1,
      pages: 1,
      rows: [],
    });
  });
  it('ne met ni clés ni identités dans le contrat agrégé', () => {
    const k = key('member@alpha.example.net');
    call(k.prefix, NOW.toISOString());
    const aggregate = JSON.stringify(getBusinessPulse(NOW));
    expect(aggregate).not.toContain('member@');
    expect(aggregate).not.toContain(k.prefix);
    const detail = JSON.stringify(getBusinessAccounts('active_today', 1, NOW));
    expect(detail).toContain('member@alpha.example.net');
    expect(detail).not.toContain(k.hash);
    expect(detail).not.toContain(k.prefix);
  });
});
