import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type DatabaseType from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  FATF_AS_OF,
  FATF_BLACK_LIST,
  FATF_GREY_LIST,
  FATF_MEMBERS,
  FATF_SUSPENDED,
} from './compliance-static.js';

/**
 * La base de conformité porte bien les listes du GAFI qu'elle annonce (03.11.2026).
 *
 * L'API lit le statut GAFI d'un pays dans `data/compliance.sqlite` (table
 * `fatf_countries`) et sa date dans `metadata.fatf_as_of` ; les listes, elles,
 * sont tenues à la main dans `compliance-static.ts`, et `refresh-compliance.yml`
 * reconstruit la base depuis elles. La sonde `compliance:fatf-age` ne lit que la
 * constante : rien ne vérifiait que la base servie suit le code.
 *
 * Deux règles, lues sur la base que l'API ouvrirait (COMPLIANCE_DB_PATH, sinon
 * `data/`), en lecture seule :
 *  - une base n'est jamais datée d'une plénière plus récente que le code ;
 *  - une base datée de la plénière du code porte exactement ses listes.
 * Entre la fusion d'une nouvelle plénière et le passage du rafraîchissement, la
 * base est datée de la précédente : la seconde règle attend ce passage, la
 * première tient toujours.
 */
const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PATH = process.env.COMPLIANCE_DB_PATH ?? join(ROOT, 'data/compliance.sqlite');

function open(): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(PATH, { readonly: true, fileMustExist: true });
}

/** Ce que `scripts/refresh-compliance.ts` écrit, dans le même ordre d'insertion. */
function expectedStatuses(): Map<string, string> {
  const expected = new Map<string, string>();
  for (const cc of FATF_BLACK_LIST) expected.set(cc, 'black_list');
  for (const cc of FATF_GREY_LIST) expected.set(cc, 'grey_list');
  for (const cc of FATF_MEMBERS) expected.set(cc, 'member');
  for (const cc of FATF_SUSPENDED) expected.set(cc, 'suspended');
  return expected;
}

describe('les listes du GAFI de la base de conformité', () => {
  const db = open();
  const stamp = (
    db.prepare(`SELECT value FROM metadata WHERE key = 'fatf_as_of'`).get() as
      { value: string } | undefined
  )?.value;

  it('sont datées, et jamais d’une plénière plus récente que le code', () => {
    expect(stamp).toMatch(/^\d{4}-\d{2}$/);
    expect((stamp ?? '') <= FATF_AS_OF, `base ${stamp}, code ${FATF_AS_OF}`).toBe(true);
  });

  it.runIf(stamp === FATF_AS_OF)(
    'sont exactement celles du code quand les dates concordent',
    () => {
      const rows = db.prepare(`SELECT country_code, status FROM fatf_countries`).all() as Array<{
        country_code: string;
        status: string;
      }>;
      const served = new Map(rows.map((r) => [r.country_code, r.status]));
      const expected = expectedStatuses();
      expect([...served.entries()].sort()).toEqual([...expected.entries()].sort());
    },
  );
});
