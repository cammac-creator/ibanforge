import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CH_LOCALITIES_ATTRIBUTION,
  CH_TOWN_EXONYMS,
  POSTCODE_LOCALITY_WARNINGS,
  checkPostcodeLocality,
  isChLocalitiesTable,
  loadChLocalities,
  nameVariants,
  resetChLocalities,
  townKey,
  type ChLocalitiesTable,
} from './ch-localities.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const committed = JSON.parse(
  readFileSync(resolve(ROOT, 'data/ch-localities.json'), 'utf8'),
) as ChLocalitiesTable;

const check = (pst_cd: string, twn_nm: string, ctry = 'CH') =>
  checkPostcodeLocality({ pst_cd, twn_nm, ctry });

describe('data/ch-localities.json, as committed', () => {
  it('is a table the API accepts, with its source, version and terms', () => {
    expect(isChLocalitiesTable(committed)).toBe(true);
    expect(committed.attribution).toBe('©swisstopo');
    expect(committed.collection).toBe('ch.swisstopo-vd.ortschaftenverzeichnis_plz');
    expect(committed.version).toBe('2026-10-01');
    expect(committed.terms).toContain('also used commercially');
    expect(committed.terms).toContain('A reference to the source is mandatory.');
    expect(committed.terms_url).toBe(
      'https://www.swisstopo.admin.ch/en/terms-of-use-free-geodata-and-geoservices',
    );
  });

  it('keeps six columns and nothing else: no coordinates, no address share, no municipality number', () => {
    expect(committed.columns).toEqual([
      'postcode',
      'additional_digit',
      'locality',
      'municipality',
      'canton',
      'language',
    ]);
    expect(committed.rows.every((r) => r.length === 6)).toBe(true);
    expect(committed.rows.some((r) => r.some((v) => /^\d+\.\d+$/.test(v)))).toBe(false);
  });

  it('matches the measurement of 29.10.2026: 5 716 rows, 3 190 postcodes, 13 in Liechtenstein', () => {
    expect(committed.rows).toHaveLength(5716);
    expect(new Set(committed.rows.map((r) => r[0])).size).toBe(3190);
    expect(new Set(committed.rows.filter((r) => r[4] === '').map((r) => r[0])).size).toBe(13);
  });
});

describe('checkPostcodeLocality: the test cases of the decision', () => {
  it('Moutier (2740) is in the canton of Jura since 01.01.2026, with a sliver in Roches (BE)', () => {
    const r = check('2740', 'Moutier')!;
    expect(r.status).toBe('match');
    expect(r.localities).toEqual([
      { name: 'Moutier', municipality: 'Moutier', canton: 'JU', country: 'CH' },
      { name: 'Moutier', municipality: 'Roches (BE)', canton: 'BE', country: 'CH' },
    ]);
    // La commune est admise à la place de la localité.
    expect(check('2740', 'Roches')!.status).toBe('match');
  });

  it('Büsingen (8238, a German municipality) is not listed, and the answer does not call it nonexistent', () => {
    const r = check('8238', 'Büsingen')!;
    expect(r.status).toBe('postcode_not_listed');
    expect(r.localities).toEqual([]);
    expect(r.detail).toContain('is not in the official directory of localities');
    expect(r.detail).toContain('Swiss postcode used outside that territory');
    expect(r.detail).not.toMatch(/does not exist|nonexistent|invalid/i);
  });

  it('Campione (6911) is not listed', () => {
    expect(check('6911', 'Campione')!.status).toBe('postcode_not_listed');
    expect(check('6911', "Campione d'Italia")!.status).toBe('postcode_not_listed');
  });

  it('a postcode absent from the file, with a town listed elsewhere, is not listed', () => {
    expect(committed.rows.some((r) => r[0] === '9999')).toBe(false);
    const r = check('9999', 'Zürich')!;
    expect(r.status).toBe('postcode_not_listed');
    expect(POSTCODE_LOCALITY_WARNINGS.has(r.status)).toBe(true);
    expect(check('80011', 'Zürich')!.status).toBe('postcode_not_listed');
  });

  it('Biel/Bienne, written either way', () => {
    for (const town of ['Biel', 'Bienne', 'Biel/Bienne', 'BIEL-BIENNE', 'biel bienne']) {
      expect(check('2502', town)!.status, town).toBe('match');
    }
  });

  it('Zürich and Zurich, in any case, with or without the umlaut', () => {
    for (const town of ['Zürich', 'Zurich', 'ZÜRICH', 'zurich', 'Zuerich', 'Zürich 1']) {
      expect(check('8001', town)!.status, town).toBe('match');
    }
  });

  it('a postcode and a town that do not go together: a warning naming the localities of the postcode', () => {
    const r = check('8001', 'Bern')!;
    expect(r.status).toBe('town_mismatch');
    expect(POSTCODE_LOCALITY_WARNINGS.has(r.status)).toBe(true);
    expect(r.localities).toEqual([
      { name: 'Zürich', municipality: 'Zürich', canton: 'ZH', country: 'CH' },
    ]);
    expect(r.detail).toContain('lists postcode 8001 for Zürich (municipality Zürich, ZH)');
    expect(r.detail).toContain('"Bern"');
  });

  it('Liechtenstein: Vaduz is in LI, so CH is the wrong country; 9498 Planken is listed', () => {
    const wrong = check('9490', 'Vaduz', 'CH')!;
    expect(wrong.status).toBe('other_country');
    expect(wrong.detail).toContain('in Liechtenstein');
    expect(wrong.localities[0]).toEqual({
      name: 'Vaduz',
      municipality: 'Vaduz',
      canton: null,
      country: 'LI',
    });
    expect(check('9490', 'Vaduz', 'LI')!.status).toBe('match');
    expect(check('9498', 'Planken', 'LI')!.status).toBe('match');
    expect(check('8001', 'Zürich', 'LI')!.status).toBe('other_country');
  });

  it('post-office box postcodes are not verifiable, and carry no warning: 1211 Genève, 3003 Bern, 2501 Biel, 8010 Zürich', () => {
    for (const [p, t] of [
      ['1211', 'Genève 27'],
      ['1211', 'Genève'],
      ['3003', 'Bern'],
      ['2501', 'Biel'],
      ['8010', 'Zürich'],
      ['9001', 'St. Gallen'],
    ] as const) {
      const r = check(p, t)!;
      expect(r.status, `${p} ${t}`).toBe('not_verifiable');
      expect(POSTCODE_LOCALITY_WARNINGS.has(r.status)).toBe(false);
    }
    const biel = check('2501', 'Biel')!;
    expect(biel.detail).toContain('under 2502, 2503, 2504, 2505');
    expect(biel.detail).toContain('neither confirmed nor contradicted');
  });
});

describe('checkPostcodeLocality: spelling tolerance', () => {
  it('St., Sankt and Saint', () => {
    expect(check('9000', 'St. Gallen')!.status).toBe('match');
    expect(check('9000', 'Sankt Gallen')!.status).toBe('match');
    expect(check('9000', 'St.Gallen')!.status).toBe('match');
    expect(check('2610', 'Saint-Imier')!.status).toBe('match');
    expect(check('2610', 'St-Imier')!.status).toBe('match');
    expect(check('1450', 'Sainte-Croix')!.status).toBe('match');
  });

  it('the names of the larger towns in another language (Wikidata labels)', () => {
    expect(check('1204', 'Genf')!.status).toBe('match');
    expect(check('1204', 'Geneva')!.status).toBe('match');
    expect(check('3011', 'Berne')!.status).toBe('match');
    expect(check('4051', 'Bâle')!.status).toBe('match');
    expect(check('6003', 'Lucerne')!.status).toBe('match');
    expect(check('1700', 'Freiburg')!.status).toBe('match');
    expect(check('2000', 'Neuenburg')!.status).toBe('match');
    expect(check('1950', 'Sitten')!.status).toBe('match');
    expect(check('9000', 'Saint-Gall')!.status).toBe('match');
    // Un exonyme ne sert qu'à ne pas signaler : il ne rend pas une autre ville juste.
    expect(check('8001', 'Genf')!.status).toBe('town_mismatch');
  });

  it('every exonym key names a municipality of the directory', () => {
    const municipalities = new Set(committed.rows.map((r) => r[3]));
    for (const official of Object.keys(CH_TOWN_EXONYMS)) {
      expect(municipalities.has(official), official).toBe(true);
    }
  });

  it('a district added to the town, a canton suffix, a sorting number, a country prefix on the postcode', () => {
    expect(check('8050', 'Zürich-Oerlikon')!.status).toBe('match');
    expect(check('4634', 'Wisen')!.status).toBe('match');
    expect(check('4634', 'Wisen SO')!.status).toBe('match');
    expect(check('1000', 'Lausanne')!.status).toBe('match');
    expect(check('1000', 'Lausanne 26')!.status).toBe('match');
    expect(check('CH-8001', 'Zürich')!.status).toBe('match');
    expect(check(' 8001 ', ' Zürich ')!.status).toBe('match');
  });

  it('townKey and nameVariants', () => {
    expect(townKey('St. Gallen')).toBe(townKey('Sankt Gallen'));
    expect(townKey('Saint-Imier')).toBe(townKey('St-Imier'));
    expect(townKey('Zürich')).toBe(townKey('ZUERICH'));
    expect(nameVariants('Biel/Bienne')).toEqual(
      expect.arrayContaining([townKey('Biel/Bienne'), 'biel', 'bienne']),
    );
    expect(nameVariants('Roches (BE)')).toEqual(expect.arrayContaining(['roches']));
    expect(nameVariants('Laax GR 2')).toEqual(expect.arrayContaining(['laax']));
  });

  /**
   * Aucune adresse juste refusée : chaque ligne du répertoire, écrite avec sa
   * localité ou avec sa commune, et sous les variantes d'écriture courantes,
   * doit répondre `match`. Un échec ici est un avertissement qui partirait sur
   * une adresse vraie.
   */
  it('every row of the directory, by locality or by municipality, in the usual spellings, is a match', () => {
    const spellings = (s: string): string[] => {
      const plain = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const out = [s, s.toUpperCase(), s.toLowerCase(), plain, plain.toUpperCase()];
      if (/\bSt\.\s/.test(s)) out.push(s.replace(/\bSt\.\s/, 'Sankt '));
      if (/\bSt-/.test(s)) out.push(s.replace(/\bSt-/, 'Saint-'));
      if (s.includes('/')) out.push(...s.split('/'));
      return out;
    };
    const misses: string[] = [];
    for (const [postcode, , locality, municipality, canton] of committed.rows) {
      const ctry = canton === '' ? 'LI' : 'CH';
      for (const town of [locality, municipality]) {
        for (const written of spellings(town)) {
          const r = check(postcode, written, ctry);
          if (r?.status !== 'match') misses.push(`${postcode} ${written} → ${r?.status}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  /**
   * L'autre sens : la tolérance ne doit pas tout accepter. Un nom inventé est
   * signalé sur chaque NPA, et la localité d'un NPA d'une autre région (premier
   * chiffre différent) presque jamais admise. Mesuré le 29.10.2026 : 1 sur
   * 11 432 (« Augst » pour « Aeugst am Albis », par « ae » et le préfixe).
   */
  it('the tolerance is not a blank cheque: an invented town is flagged everywhere, a far town almost never accepted', () => {
    const byPostcode = new Map<string, (typeof committed.rows)[number][]>();
    for (const r of committed.rows) {
      const list = byPostcode.get(r[0]);
      if (list) list.push(r);
      else byPostcode.set(r[0], [r]);
    }
    const postcodes = [...byPostcode.keys()];
    const ctryOf = (p: string) => (byPostcode.get(p)![0]![4] === '' ? 'LI' : 'CH');
    for (const p of postcodes) {
      expect(check(p, 'Atlantis', ctryOf(p))!.status, p).toBe('town_mismatch');
    }
    let tried = 0;
    let accepted = 0;
    postcodes.forEach((p, i) => {
      const far = postcodes[(i + 1597) % postcodes.length]!;
      if (far[0] === p[0]) return;
      for (const r of byPostcode.get(far)!) {
        for (const town of [r[2], r[3]]) {
          tried += 1;
          if (check(p, town, ctryOf(p))!.status === 'match') accepted += 1;
        }
      }
    });
    expect(tried).toBeGreaterThan(10_000);
    expect(accepted / tried).toBeLessThan(0.001);
  });
});

describe('checkPostcodeLocality: scope, source and date', () => {
  afterEach(() => {
    delete process.env.CH_LOCALITIES_PATH;
    resetChLocalities();
  });

  it('applies to CH and LI only, and only with a postcode and a town', () => {
    expect(check('8001', 'Zürich', 'DE')).toBeNull();
    expect(check('8001', 'Zürich', 'AT')).toBeNull();
    expect(check('', 'Zürich')).toBeNull();
    expect(check('8001', '')).toBeNull();
    expect(checkPostcodeLocality({ pst_cd: '8001', twn_nm: 'Zürich' })).toBeNull();
    expect(check('8001', 'Zürich', ' ch ')!.status).toBe('match');
  });

  it('every answer carries the source with the credit ©swisstopo and the version date', () => {
    for (const r of [check('8001', 'Zürich'), check('8001', 'Bern'), check('8238', 'Büsingen')]) {
      expect(r!.source).toContain('Federal Office of Topography swisstopo');
      expect(r!.source).toContain(CH_LOCALITIES_ATTRIBUTION);
      expect(r!.source).toContain('version of 01.10.2026');
      expect(r!.as_of).toBe('2026-10-01');
    }
  });

  it('without the file: directory_unavailable, no warning, never an exception', () => {
    process.env.CH_LOCALITIES_PATH = '/nonexistent/ch-localities.json';
    resetChLocalities();
    expect(loadChLocalities()).toBeNull();
    const r = check('8001', 'Bern')!;
    expect(r.status).toBe('directory_unavailable');
    expect(POSTCODE_LOCALITY_WARNINGS.has(r.status)).toBe(false);
    expect(r.as_of).toBeNull();
    expect(r.source).toContain('©swisstopo');
  });

  it('a truncated table is refused', () => {
    expect(isChLocalitiesTable({ ...committed, rows: committed.rows.slice(0, 100) })).toBe(false);
    expect(isChLocalitiesTable({ ...committed, attribution: 'swisstopo' })).toBe(false);
  });
});
