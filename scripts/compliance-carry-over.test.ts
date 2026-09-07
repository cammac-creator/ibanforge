import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARRY_OVER_MAX_AGE_DAYS, carryOverList } from './compliance-carry-over.js';

const SCHEMA = `
  CREATE TABLE sanctioned_entities (
    bic8 TEXT NOT NULL, entity_name TEXT, source_list TEXT NOT NULL,
    country_code TEXT, directory_match INTEGER NOT NULL DEFAULT 1,
    UNIQUE(bic8, source_list)
  );
  CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

const NOW = new Date('2026-09-06T03:22:00Z');

describe('carryOverList', () => {
  let dir: string;
  let previousPath: string;
  let target: Database.Database;

  function writePrevious(lastRefresh: string | null, rows: Array<[string, string]>) {
    const db = new Database(previousPath);
    db.exec(SCHEMA);
    if (lastRefresh) db.prepare(`INSERT INTO metadata VALUES ('last_refresh', ?)`).run(lastRefresh);
    const ins = db.prepare(
      `INSERT INTO sanctioned_entities (bic8, entity_name, source_list, country_code, directory_match) VALUES (?, ?, ?, '', 1)`,
    );
    for (const [bic8, list] of rows) ins.run(bic8, `${list}-listed entity`, list);
    db.close();
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ibf-carry-'));
    previousPath = join(dir, 'previous.sqlite');
    target = new Database(':memory:');
    target.exec(SCHEMA);
  });

  afterEach(() => {
    target.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies the failed list from a previous database that is young enough, and records it', () => {
    writePrevious('2026-08-30T03:22:07.646Z', [
      ['AAAAEUAA', 'EU'],
      ['BBBBEUBB', 'EU'],
      ['CCCCUSCC', 'OFAC'],
    ]);
    const r = carryOverList(target, previousPath, 'EU', NOW);
    expect(r).toEqual({ rows: 2, previousRefresh: '2026-08-30T03:22:07.646Z', reason: 'carried' });
    const lists = target
      .prepare('SELECT source_list, COUNT(*) AS n FROM sanctioned_entities GROUP BY source_list')
      .all();
    expect(lists).toEqual([{ source_list: 'EU', n: 2 }]);
    const meta = target.prepare(`SELECT value FROM metadata WHERE key = 'carried_over'`).get() as {
      value: string;
    };
    expect(meta.value).toBe('EU@2026-08-30T03:22:07.646Z');
  });

  it('appends to the carried_over marker when a second list is carried in the same run', () => {
    writePrevious('2026-08-30T03:22:07.646Z', [
      ['AAAAEUAA', 'EU'],
      ['DDDDUNDD', 'UN'],
    ]);
    carryOverList(target, previousPath, 'EU', NOW);
    carryOverList(target, previousPath, 'UN', NOW);
    const meta = target.prepare(`SELECT value FROM metadata WHERE key = 'carried_over'`).get() as {
      value: string;
    };
    expect(meta.value).toBe('EU@2026-08-30T03:22:07.646Z,UN@2026-08-30T03:22:07.646Z');
  });

  it('refuses a previous database older than the bound, so a stale list cannot ride forever', () => {
    const tooOld = new Date(
      NOW.getTime() - (CARRY_OVER_MAX_AGE_DAYS + 1) * 86_400_000,
    ).toISOString();
    writePrevious(tooOld, [['AAAAEUAA', 'EU']]);
    const r = carryOverList(target, previousPath, 'EU', NOW);
    expect(r.reason).toBe('previous_too_old');
    expect(r.rows).toBe(0);
    expect(target.prepare('SELECT COUNT(*) AS n FROM sanctioned_entities').get()).toEqual({ n: 0 });
    expect(
      target.prepare(`SELECT value FROM metadata WHERE key = 'carried_over'`).get(),
    ).toBeUndefined();
  });

  it('refuses a previous database whose refresh date is missing', () => {
    writePrevious(null, [['AAAAEUAA', 'EU']]);
    expect(carryOverList(target, previousPath, 'EU', NOW).reason).toBe('previous_too_old');
  });

  it('reports no_rows for a list the previous database never held, such as SECO', () => {
    writePrevious('2026-08-30T03:22:07.646Z', [['CCCCUSCC', 'OFAC']]);
    expect(carryOverList(target, previousPath, 'SECO', NOW)).toEqual({
      rows: 0,
      previousRefresh: '2026-08-30T03:22:07.646Z',
      reason: 'no_rows',
    });
  });

  it('reports no_previous_db on a first run, without throwing', () => {
    expect(carryOverList(target, join(dir, 'absent.sqlite'), 'EU', NOW)).toEqual({
      rows: 0,
      previousRefresh: null,
      reason: 'no_previous_db',
    });
  });

  it('does not duplicate a row the fresh run already inserted', () => {
    writePrevious('2026-08-30T03:22:07.646Z', [['AAAAEUAA', 'EU']]);
    target
      .prepare(
        `INSERT INTO sanctioned_entities (bic8, entity_name, source_list, country_code, directory_match) VALUES ('AAAAEUAA', 'fresh', 'EU', '', 1)`,
      )
      .run();
    const r = carryOverList(target, previousPath, 'EU', NOW);
    expect(r.reason).toBe('carried');
    expect(target.prepare('SELECT COUNT(*) AS n FROM sanctioned_entities').get()).toEqual({ n: 1 });
    expect(
      (
        target.prepare(`SELECT entity_name FROM sanctioned_entities`).get() as {
          entity_name: string;
        }
      ).entity_name,
    ).toBe('fresh');
  });
});
