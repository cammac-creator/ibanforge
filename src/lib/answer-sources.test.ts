import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

/**
 * A hermetic statistics database, as in src/routes/stats.test.ts: these tests
 * count rows of one table on today's date, and the developer database holds
 * real rows. The path is read by db.js at load, hence vi.hoisted.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-answer-sources-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { rmSync } from 'node:fs';
import { Hono } from 'hono';
import {
  ANSWER_SOURCE_FAMILIES,
  answerSourceFamily,
  getAnswerSources,
  isOwnToolCall,
  recordAnswerSources,
} from './answer-sources.js';
import { getStatsDB } from './db.js';
import { recordSafelyFailures } from './record-safely.js';
import { frozenSources } from './source-vintage.js';
import { sourceName } from './bic-lookup.js';
import { ibanValidate } from '../routes/iban-validate.js';
import { ibanBatch } from '../routes/iban-batch.js';
import { stats } from '../routes/stats.js';
import type { HonoEnv, IBANValidationResult } from '../types.js';

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal']) rmSync(`${HERMETIC_DB}${suffix}`, { force: true });
});

beforeEach(() => {
  getStatsDB().prepare('DELETE FROM answer_sources_daily').run();
});

type Cell = { country: string; family: string; count: number };
function cells(): Cell[] {
  return getStatsDB()
    .prepare('SELECT country, family, count FROM answer_sources_daily ORDER BY country, family')
    .all() as Cell[];
}
function total(): number {
  return cells().reduce((acc, c) => acc + c.count, 0);
}

/** A served answer, reduced to the fields the family is read from. */
function served(partial: Partial<IBANValidationResult>): IBANValidationResult {
  return {
    iban: 'XX00TEST',
    valid: true,
    country: { code: 'XX', name: 'Testland' },
    ...partial,
  } as IBANValidationResult;
}

const bic = (fields: Record<string, unknown>) =>
  ({ code: 'TESTXXYY', bank_name: 'Société Alpha', city: null, ...fields }) as never;

describe('the table', () => {
  it('has exactly four columns: day, country, family, count — never a key, an address, a time or an IBAN', () => {
    const cols = (
      getStatsDB().prepare('PRAGMA table_info(answer_sources_daily)').all() as Array<{
        name: string;
        pk: number;
      }>
    ).map((c) => [c.name, c.pk]);
    expect(cols).toEqual([
      ['day', 1],
      ['country', 2],
      ['family', 3],
      ['count', 0],
    ]);
  });

  it('is not part of the paid state that backups and pre-migration copies carry', async () => {
    const { PAID_STATE_TABLES } = await import('./paid-state.js');
    expect(PAID_STATE_TABLES as readonly string[]).not.toContain('answer_sources_daily');
  });
});

describe('answerSourceFamily — read from the served answer alone', () => {
  it('a national register read in full that names the holder', () => {
    expect(
      answerSourceFamily(
        served({
          bank_code_holder: 'confirmed',
          bank_code_check: { authoritative: true } as never,
          // The BIC may come from elsewhere (a Swiss IID without a BIC in
          // BankMaster): the register named the bank, so the register is the source.
          bic: bic({ basis: 'curated_map', source_as_of: '2018-01' }),
        }),
      ),
    ).toBe('national_register');
  });

  it('a partial register or list that names the holder', () => {
    expect(
      answerSourceFamily(
        served({
          bank_code_holder: 'confirmed',
          bank_code_check: { authoritative: false } as never,
        }),
      ),
    ).toBe('partial_list');
  });

  it('a BIC printed by a register beside the code, without an authoritative verdict', () => {
    expect(
      answerSourceFamily(
        served({
          bank_code_holder: 'inferred',
          bank_code_check: { authoritative: false } as never,
          bic: bic({ basis: 'national_register' }),
        }),
      ),
    ).toBe('partial_list');
  });

  it('the frozen 2018 copy of the SWIFT directory, by the curated map or by prefix', () => {
    for (const basis of ['curated_map', 'directory_prefix']) {
      expect(
        answerSourceFamily(
          served({ bank_code_holder: 'inferred', bic: bic({ basis, source_as_of: '2018-01' }) }),
        ),
        basis,
      ).toBe('swift_2018');
    }
  });

  it('only swiftcodes lies about its date today: a new frozen source must be filed here', () => {
    // `swift_2018` is recognised by the vintage source-vintage.ts gives the
    // frozen copy. A second frozen source would carry another `source_as_of`
    // and land in `other_current`: this test makes that a decision, not an accident.
    expect(frozenSources()).toEqual([{ source: 'swiftcodes', as_of: '2018-01' }]);
  });

  it('GLEIF, read by the prefix fallback', () => {
    expect(
      answerSourceFamily(
        served({
          bank_code_holder: 'inferred',
          bic: bic({ basis: 'directory_prefix', source: sourceName('gleif') }),
        }),
      ),
    ).toBe('gleif');
  });

  it('any other bank found: the curated map over a current row, a prefix on another directory', () => {
    expect(
      answerSourceFamily(
        served({
          bank_code_holder: 'inferred',
          bic: bic({ basis: 'curated_map', source: 'IBANforge curated bank-code map' }),
        }),
      ),
    ).toBe('other_current');
    expect(
      answerSourceFamily(
        served({
          bank_code_holder: 'inferred',
          bic: bic({ basis: 'directory_prefix', source: sourceName('bundesbank') }),
        }),
      ),
    ).toBe('other_current');
  });

  it('no bank: no BIC and no register naming a holder, or a code nobody holds', () => {
    expect(answerSourceFamily(served({ bank_code_holder: 'unknown', bic: null }))).toBe('none');
    expect(answerSourceFamily(served({ bank_code_holder: 'not_allocated', bic: null }))).toBe(
      'none',
    );
    expect(answerSourceFamily(served({}))).toBe('none');
  });

  it('an invalid IBAN names no bank and is not counted', () => {
    expect(answerSourceFamily(served({ valid: false, country: undefined }))).toBeNull();
    expect(answerSourceFamily(served({ valid: false }))).toBeNull();
  });

  it('every family it can answer is one of the declared six', () => {
    expect(ANSWER_SOURCE_FAMILIES).toEqual([
      'national_register',
      'partial_list',
      'gleif',
      'swift_2018',
      'other_current',
      'none',
    ]);
  });
});

describe('recordAnswerSources', () => {
  it('increments the cell of the day by upsert', () => {
    const de = served({ country: { code: 'DE', name: 'Germany' }, bank_code_holder: 'unknown' });
    expect(recordAnswerSources([de])).toBe(true);
    expect(recordAnswerSources([de, de])).toBe(true);
    expect(cells()).toEqual([{ country: 'DE', family: 'none', count: 3 }]);
    const { day } = getStatsDB().prepare('SELECT day FROM answer_sources_daily').get() as {
      day: string;
    };
    // The UTC date alone, never a time.
    expect(day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('skips the invalid ones and writes nothing for an empty list', () => {
    expect(recordAnswerSources([served({ valid: false })])).toBe(true);
    expect(recordAnswerSources([])).toBe(true);
    expect(cells()).toEqual([]);
  });

  it('answers false instead of throwing when the table cannot be written', () => {
    const db = getStatsDB();
    db.exec('ALTER TABLE answer_sources_daily RENAME TO answer_sources_daily_away');
    try {
      expect(recordAnswerSources([served({})])).toBe(false);
    } finally {
      db.exec('ALTER TABLE answer_sources_daily_away RENAME TO answer_sources_daily');
    }
  });
});

describe('isOwnToolCall — the keyless calls of our own tools', () => {
  it('follows NOT_INTERNAL_TOOL_SQL: a key speaks louder than the agent', () => {
    expect(isOwnToolCall(false, 'ibanforge-outil/probe 1.0')).toBe(true);
    expect(isOwnToolCall(false, 'IBANforge-outil/probe')).toBe(true);
    expect(isOwnToolCall(true, 'ibanforge-outil/probe')).toBe(false);
    expect(isOwnToolCall(false, 'Mozilla/5.0 ibanforge-outil/x')).toBe(false);
    expect(isOwnToolCall(false, null)).toBe(false);
  });
});

describe('the REST routes count each valid IBAN served', () => {
  const app = new Hono<HonoEnv>();
  app.route('/', ibanValidate);
  app.route('/', ibanBatch);
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('POST /v1/iban/validate: one valid IBAN, one count, in the family its answer names', async () => {
    const res = await post('/v1/iban/validate', { iban: 'DE89370400440532013000' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as IBANValidationResult;
    expect(cells()).toEqual([{ country: 'DE', family: answerSourceFamily(body)!, count: 1 }]);
    // The Bundesbank register names the holder of BLZ 37040044.
    expect(answerSourceFamily(body)).toBe('national_register');
  });

  it('POST /v1/iban/validate: an invalid IBAN is not counted', async () => {
    const res = await post('/v1/iban/validate', { iban: 'DE89370400440532013001' });
    expect(res.status).toBe(200);
    expect(cells()).toEqual([]);
  });

  it('POST /v1/iban/batch: a batch of N valid IBANs counts N, the invalid ones none', async () => {
    const ibans = [
      'DE89370400440532013000',
      'DE89370400440532013000',
      'CH9300762011623852957',
      'GB82WEST12345698765432',
      'FR1420041010050500013M02606',
      'DE89370400440532013001',
    ];
    const res = await post('/v1/iban/batch', { ibans });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: IBANValidationResult[]; valid_count: number };
    expect(body.valid_count).toBe(5);
    expect(total()).toBe(5);
    // Each cell holds exactly what the served answers say.
    const expected = new Map<string, number>();
    for (const r of body.results) {
      const family = answerSourceFamily(r);
      if (!family) continue;
      const key = `${r.country!.code}|${family}`;
      expected.set(key, (expected.get(key) ?? 0) + 1);
    }
    expect(Object.fromEntries(cells().map((c) => [`${c.country}|${c.family}`, c.count]))).toEqual(
      Object.fromEntries(expected),
    );
  });

  it('a keyless call signed by one of our tools is not counted', async () => {
    const res = await post(
      '/v1/iban/validate',
      { iban: 'DE89370400440532013000' },
      { 'User-Agent': 'ibanforge-outil/probe' },
    );
    expect(res.status).toBe(200);
    const batch = await post(
      '/v1/iban/batch',
      { ibans: ['DE89370400440532013000'] },
      { 'User-Agent': 'ibanforge-outil/probe' },
    );
    expect(batch.status).toBe(200);
    expect(cells()).toEqual([]);
  });

  it('a failed write never breaks the answer, and is counted for the ops alert', async () => {
    const db = getStatsDB();
    const before = recordSafelyFailures('answer_sources');
    db.exec('ALTER TABLE answer_sources_daily RENAME TO answer_sources_daily_away');
    try {
      const res = await post('/v1/iban/validate', { iban: 'DE89370400440532013000' });
      expect(res.status).toBe(200);
      expect(((await res.json()) as IBANValidationResult).valid).toBe(true);
      const batch = await post('/v1/iban/batch', { ibans: ['DE89370400440532013000'] });
      expect(batch.status).toBe(200);
      expect(recordSafelyFailures('answer_sources')).toBe(before + 2);
    } finally {
      db.exec('ALTER TABLE answer_sources_daily_away RENAME TO answer_sources_daily');
    }
    // And the next success closes the streak.
    await post('/v1/iban/validate', { iban: 'DE89370400440532013000' });
    expect(recordSafelyFailures('answer_sources')).toBe(0);
  });
});

describe('getAnswerSources — the share of each family, by country', () => {
  function seed(day: string, country: string, family: string, count: number) {
    getStatsDB()
      .prepare('INSERT INTO answer_sources_daily (day, country, family, count) VALUES (?, ?, ?, ?)')
      .run(day, country, family, count);
  }
  const daysAgo = (n: number) =>
    (getStatsDB().prepare(`SELECT date('now', ?) AS d`).get(`-${n} days`) as { d: string }).d;

  it('adds the days of the window, gives each family its count and share, largest country first', () => {
    seed(daysAgo(0), 'IT', 'swift_2018', 3);
    seed(daysAgo(1), 'IT', 'swift_2018', 4);
    seed(daysAgo(1), 'IT', 'national_register', 3);
    seed(daysAgo(2), 'DE', 'national_register', 5);
    // Outside a 30-day window, today included.
    seed(daysAgo(30), 'DE', 'none', 100);

    const report = getAnswerSources(30);
    expect(report.period_days).toBe(30);
    expect(report.since).toBe(daysAgo(29));
    expect(report.families).toEqual(ANSWER_SOURCE_FAMILIES);
    expect(report.total).toBe(15);
    expect(report.by_country.map((c) => c.country)).toEqual(['IT', 'DE']);

    const italy = report.by_country[0];
    expect(italy.total).toBe(10);
    expect(italy.families.swift_2018).toEqual({ count: 7, share: 0.7 });
    expect(italy.families.national_register).toEqual({ count: 3, share: 0.3 });
    expect(italy.families.none).toEqual({ count: 0, share: 0 });
    expect(Object.keys(italy.families)).toEqual([...ANSWER_SOURCE_FAMILIES]);

    const de = report.by_country[1];
    expect(de.families.national_register).toEqual({ count: 5, share: 1 });
    expect(de.families.none.count).toBe(0);
  });

  it('is served under answer_sources on GET /stats, behind the stats token', async () => {
    const previous = process.env.STATS_TOKEN;
    process.env.STATS_TOKEN = 'test-answer-sources-token';
    try {
      seed(daysAgo(0), 'NL', 'other_current', 2);
      const app = new Hono();
      app.route('/', stats);
      const denied = await app.request('/stats');
      expect(denied.status).toBe(403);
      const res = await app.request('/stats', {
        headers: { Authorization: 'Bearer test-answer-sources-token' },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        answer_sources: ReturnType<typeof getAnswerSources>;
        total_operations: number;
      };
      // The other keys of the overview are untouched.
      expect(typeof body.total_operations).toBe('number');
      expect(body.answer_sources.period_days).toBe(30);
      expect(body.answer_sources.by_country).toEqual([
        {
          country: 'NL',
          total: 2,
          families: Object.fromEntries(
            ANSWER_SOURCE_FAMILIES.map((f) => [
              f,
              f === 'other_current' ? { count: 2, share: 1 } : { count: 0, share: 0 },
            ]),
          ),
        },
      ]);
    } finally {
      if (previous === undefined) delete process.env.STATS_TOKEN;
      else process.env.STATS_TOKEN = previous;
    }
  });
});
