import { describe, it, expect, afterAll, beforeEach, vi } from 'vitest';

/**
 * Hermetic stats database, same hoisting idiom as demand-gaps.test.ts: db.js
 * reads its path at module load, so the env must be set before any import.
 */
const HERMETIC_DB = vi.hoisted(() => {
  const path = `${process.env.TMPDIR ?? '/tmp'}/ibf-textbook-gaps-${process.pid}-${Date.now()}.sqlite`;
  process.env.STATS_DB_PATH = path;
  return path;
});

import { getDemandGaps, resetDemandGaps } from './demand-gaps.js';
import { enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';
import { getStatsDB } from './db.js';
import { rmSync } from 'node:fs';

afterAll(() => {
  for (const suffix of ['', '-shm', '-wal']) {
    try {
      rmSync(HERMETIC_DB + suffix);
    } catch {
      /* already gone */
    }
  }
});

beforeEach(() => {
  resetDemandGaps();
  getStatsDB().exec('DROP TABLE IF EXISTS lookup_gaps');
  resetDemandGaps();
});

function rows(): Array<{ country: string; code: string; hits: number }> {
  return getStatsDB()
    .prepare('SELECT country, code, hits FROM lookup_gaps ORDER BY country, code')
    .all() as Array<{ country: string; code: string; hits: number }>;
}

describe('the demand ledger and the textbook IBANs', () => {
  it('does not count the textbook CH IBAN, but still counts a real unverifiable code', () => {
    // The one in every documentation: bank code 00762, allocated by nobody.
    const textbook = validateIBAN('CH93 0076 2011 6238 5295 7');
    enrichResult(textbook);
    expect(textbook.valid).toBe(true);
    expect(textbook.bank_code_check?.status).not.toBe('verified');
    // Checksum-valid, bank code 00791, equally absent from SIX: this one is
    // somebody's real question and must be counted.
    const real = validateIBAN('CH2400791000001234567');
    enrichResult(real);
    expect(real.bank_code_check?.status).not.toBe('verified');

    expect(rows()).toEqual([{ country: 'CH', code: '00791', hits: 1 }]);
  });

  it('purges the rows the textbook IBANs left behind, at table ensure time', () => {
    getStatsDB().exec(`
      CREATE TABLE lookup_gaps (
        kind TEXT NOT NULL, country TEXT, code TEXT NOT NULL, outcome TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1,
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (kind, country, code, outcome)
      );
      INSERT INTO lookup_gaps (kind, country, code, outcome, hits) VALUES
        ('bank_code', 'CH', '00762', 'not_in_register:not_allocated', 13),
        ('bank_code', 'LT', '10000', 'not_in_register:absent_from_reference_data', 1),
        ('bank_code', 'TR', '00061', 'not_in_register:absent_from_reference_data', 2),
        ('bank_code', 'TR', '00205', 'not_in_register:absent_from_reference_data', 6),
        ('bic', 'CN', 'CIBKCNBI200', 'not_found', 1);
    `);
    // Any read ensures the table, and ensuring purges.
    getDemandGaps(30);
    expect(rows()).toEqual([
      { country: 'CN', code: 'CIBKCNBI200', hits: 1 },
      { country: 'TR', code: '00205', hits: 6 },
    ]);
  });
});
