/**
 * `GET /v1/bic/:code` : une fiche complète ou « introuvable », jamais une chaîne
 * vide, le nom du pays et l'âge de la donnée (25/09/2026).
 *
 * La suite apporte sa base : une copie de la base publique à laquelle deux
 * lignes INVENTÉES sont ajoutées, l'une sans nom, l'autre sans ville. Les BIC
 * XMPL… ne sont attribués à personne. Aucune ligne réelle d'une source sous
 * conditions n'est lue ni écrite ici ; les autres assertions portent sur des
 * étiquettes (source, millésime, trace), jamais sur un nom de banque.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';

const { dbDir, previousPath, blankedAbi } = await vi.hoisted(async () => {
  const { copyFileSync, mkdtempSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const { createRequire } = await import('node:module');
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'ibanforge-bic-truth-'));
  const path = join(dir, 'bic.sqlite');
  copyFileSync(resolve(here, '../../data/bic.sqlite'), path);
  const Database = createRequire(import.meta.url)(
    'better-sqlite3',
  ) as typeof import('better-sqlite3');
  const db = new Database(path);
  const insert = db.prepare(
    `INSERT INTO bic_entries (bic8, bic11, institution, country_code, country_name, city, source)
     VALUES (?, ?, ?, 'IT', 'Italy', ?, 'gleif')`,
  );
  // Une ligne qui ne nomme personne, et une ligne dont la ville est vide.
  insert.run('XMPLITN1', 'XMPLITN1XXX', '', 'Roma');
  insert.run('XMPLITC1', 'XMPLITC1XXX', 'BANCA DI ESEMPIO SPA', '');
  // Le chemin de la validation : une clé italienne de la carte composite, sans
  // ville dans la carte, dont la ligne de description est PUBLIQUE (copie
  // figée du répertoire SWIFT). Dans cette copie seulement, sa ville est vidée,
  // comme la liste STEP2 laisse les siennes.
  const map = JSON.parse(readFileSync(resolve(here, '../db/bic_data.json'), 'utf8')) as Record<
    string,
    { bic: string; city?: string }
  >;
  const byBic11 = db.prepare(
    "SELECT bic11 FROM bic_entries WHERE bic11 = ? AND source = 'swiftcodes' AND city != ''",
  );
  let abi: string | null = null;
  for (const [key, entry] of Object.entries(map)) {
    if (!/^IT:\d{5}$/.test(key) || entry.city || entry.bic.length !== 11) continue;
    if (!byBic11.get(entry.bic)) continue;
    db.prepare("UPDATE bic_entries SET city = '' WHERE bic11 = ?").run(entry.bic);
    abi = key.slice(3);
    break;
  }
  db.close();
  const previous = process.env.BIC_DB_PATH;
  process.env.BIC_DB_PATH = path;
  return { dbDir: dir, previousPath: previous, blankedAbi: abi };
});

const { bicLookup } = await import('./bic-lookup.js');
const { closeAll } = await import('../lib/db.js');
const { lookup } = await import('../lib/bic-lookup.js');
const { frozenSources, sourceVintage } = await import('../lib/source-vintage.js');
const { getBicDB } = await import('../lib/db.js');
const { validateIBAN } = await import('../lib/iban.js');
const { enrichResult } = await import('../lib/enrich.js');
const { ibanFor } = await import('../test-support/restricted-fixtures.js');

afterAll(async () => {
  closeAll();
  if (previousPath === undefined) delete process.env.BIC_DB_PATH;
  else process.env.BIC_DB_PATH = previousPath;
  const { rmSync } = await import('node:fs');
  rmSync(dbDir, { recursive: true, force: true });
});

function app() {
  const a = new Hono<HonoEnv>();
  a.route('/', bicLookup);
  return a;
}

type Record_ = Record<string, unknown> & {
  found: boolean;
  institution: string | null;
  city: string | null;
  country: { code: string; name: string };
  source: string | null;
  source_name?: string | null;
  source_as_of?: string;
  listed_in_current_source?: boolean | null;
  note?: string;
};

async function get(code: string): Promise<Record_> {
  const res = await app().request(`/v1/bic/${code}`);
  expect(res.status).toBe(200);
  return (await res.json()) as Record_;
}

describe('GET /v1/bic/:code: complete or not found', () => {
  it('never answers found:true without a name', async () => {
    const r = await get('XMPLITN1');
    expect(r.found).toBe(false);
    expect(r.institution).toBeNull();
    expect(r.city).toBeNull();
    expect(r.source).toBeNull();
    expect(r.source_name).toBeNull();
    // Même chemin, même note qu'un BIC introuvable.
    expect(r.note).toBeTruthy();
  });

  it('answers null, not an empty string, for a city the source left blank', async () => {
    const r = await get('XMPLITC1');
    expect(r.found).toBe(true);
    expect(r.city).toBeNull();
  });

  it('names the country on a not-found BIC', async () => {
    const r = await get('ZZZZITMM');
    expect(r.found).toBe(false);
    expect(r.country).toEqual({ code: 'IT', name: 'Italy' });
    // Présent sur toute réponse de format valide, trouvée ou non.
    expect(r).toHaveProperty('listed_in_current_source');
  });

  it('dates a row from a frozen source and names the source', async () => {
    const frozen = frozenSources()[0]!;
    // Choisi par requête : un BIC dont la seule ligne vient de la source figée.
    const pick = getBicDB()
      .prepare(
        `SELECT bic8 FROM bic_entries WHERE source = ? AND bic11 = bic8 || 'XXX'
         AND institution IS NOT NULL AND institution != '' LIMIT 1`,
      )
      .get(frozen.source) as { bic8: string };
    expect(lookup(`${pick.bic8}XXX`)?.source).toBe(frozen.source);
    const r = await get(pick.bic8);
    expect(r.found).toBe(true);
    expect(r.source).toBe(frozen.source);
    expect(r.source_as_of).toBe(sourceVintage(frozen.source)!.as_of);
    expect(r.source_name).toBeTruthy();
    expect(r.source_name).not.toBe(frozen.source);
  });

  it('does not date a row whose source has no vintage', async () => {
    const r = await get('XMPLITC1');
    expect(r.source).toBe('gleif');
    expect(r).not.toHaveProperty('source_as_of');
    expect(typeof r.source_name).toBe('string');
  });

  it('country.code is always BIC positions 5-6', async () => {
    for (const code of ['XMPLITN1', 'XMPLITC1', 'ZZZZITMM', 'COBADEFF', 'ZZZZDEFFXXX']) {
      const r = await get(code);
      expect(r.country.code).toBe(code.slice(4, 6));
      expect(r.country.name.length).toBeGreaterThan(2);
    }
  });
});

describe('the validation bic block never serves an empty string', () => {
  it('a curated-map answer whose directory row leaves the town blank is inferred and serves city null', () => {
    expect(blankedAbi, 'no Italian curated key with a public description row').not.toBeNull();
    const r = validateIBAN(ibanFor('IT', `X${blankedAbi}11101000000123456`));
    enrichResult(r);
    expect(r.valid).toBe(true);
    expect(r.bic?.basis).toBe('curated_map');
    expect(r.bic?.city).toBeNull();
    expect(r.bank_code_holder).toBe('inferred');
    expect(r.checks?.bic).toBe('inferred');
    // La ligne vient de la copie figée : datée.
    expect(r.bic?.source_as_of).toBe(frozenSources()[0]!.as_of);
  });
});
