import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  judgeSourceSize,
  MAX_RECORD_DROP,
  readPreviousSanctions,
  SOURCE_RECORD_FLOORS,
  SOURCE_RECORDS_KEY,
  type PreviousSanctions,
} from './sanctions-source-floor.js';

const NONE: PreviousSanctions = { records: {}, rows: {}, meta: {} };

describe('judgeSourceSize', () => {
  it('accepte une liste de taille normale au premier passage', () => {
    expect(judgeSourceSize('SECO', 7_108, 11, NONE)).toBeNull();
    expect(judgeSourceSize('OFAC', 19_489, 285, NONE)).toBeNull();
    expect(judgeSourceSize('EU', 43_892, 2, NONE)).toBeNull();
  });

  it('refuse une liste vide ou sous le plancher absolu', () => {
    expect(judgeSourceSize('SECO', 0, 0, NONE)).toMatch(/under the absolute floor/);
    expect(judgeSourceSize('OFAC', SOURCE_RECORD_FLOORS.OFAC.min - 1, 200, NONE)).toMatch(
      /under the absolute floor/,
    );
    expect(judgeSourceSize('EU', Number.NaN, 2, NONE)).toMatch(/under the absolute floor/);
  });

  it('refuse une liste bien plus petite que la semaine précédente', () => {
    const previous: PreviousSanctions = { records: { SECO: 7_108 }, rows: { SECO: 11 }, meta: {} };
    const limit = 7_108 * (1 - MAX_RECORD_DROP);
    expect(judgeSourceSize('SECO', Math.floor(limit) - 1, 11, previous)).toMatch(/down \d+%/);
    // Une baisse sous le seuil (une vague de radiations) passe.
    expect(judgeSourceSize('SECO', Math.ceil(limit) + 1, 10, previous)).toBeNull();
  });

  it('refuse une liste qui ne donne plus aucun BIC quand la base en portait', () => {
    const previous: PreviousSanctions = { records: { EU: 43_892 }, rows: { EU: 2 }, meta: {} };
    expect(judgeSourceSize('EU', 43_900, 0, previous)).toMatch(/no bank BIC read/);
    // Sans ligne précédente pour elle, zéro BIC n'est pas un indice de panne.
    expect(judgeSourceSize('EU', 43_900, 0, NONE)).toBeNull();
  });
});

describe('readPreviousSanctions', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ibf-floor-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function writeDb(path: string, records: string | null): void {
    const db = new Database(path);
    db.exec(`
      CREATE TABLE sanctioned_entities (bic8 TEXT NOT NULL, entity_name TEXT, source_list TEXT NOT NULL,
        country_code TEXT, directory_match INTEGER NOT NULL DEFAULT 1, UNIQUE(bic8, source_list));
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO sanctioned_entities VALUES ('ALFASDKH', 'x', 'SECO', '', 0), ('BETAIRTH', 'x', 'SECO', '', 1),
        ('GAMAAEA1', 'x', 'OFAC', '', 1);
      INSERT INTO metadata VALUES ('last_refresh', '2026-10-04T09:35:04.559Z'), ('seco_list_date', '2026-09-28');
    `);
    if (records !== null) {
      db.prepare('INSERT INTO metadata VALUES (?, ?)').run(SOURCE_RECORDS_KEY, records);
    }
    db.close();
  }

  it('lit les lignes par liste, la taille inscrite et la date de la liste SECO', () => {
    const path = join(dir, 'previous.sqlite');
    writeDb(path, JSON.stringify({ EU: 43_892, OFAC: 19_489, SECO: 7_108 }));
    const previous = readPreviousSanctions(path);
    expect(previous.rows).toEqual({ OFAC: 1, SECO: 2 });
    expect(previous.records).toEqual({ EU: 43_892, OFAC: 19_489, SECO: 7_108 });
    expect(previous.meta.seco_list_date).toBe('2026-09-28');
  });

  it('ignore une mesure illisible, sans perdre les lignes', () => {
    const path = join(dir, 'previous.sqlite');
    writeDb(path, '{pas du json');
    const previous = readPreviousSanctions(path);
    expect(previous.records).toEqual({});
    expect(previous.rows).toEqual({ OFAC: 1, SECO: 2 });
  });

  it('rend une mesure vide sans base, sans lever', () => {
    expect(readPreviousSanctions(join(dir, 'absente.sqlite'))).toEqual(NONE);
  });
});
