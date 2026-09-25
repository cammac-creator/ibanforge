import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IBANValidationResult } from '../types.js';

/**
 * L'Italie de bout en bout, sur une édition FIXE (25/09/2026).
 *
 * Les registres de la Banca d'Italia listent les banques, les établissements de
 * paiement et de monnaie électronique qu'elle inscrit ; ils ne publient pas
 * l'attribution de l'espace ABI. Trois réponses, et aucune n'est un refus :
 *
 * - un code en vigueur est `verified`, titulaire nommé par le registre
 *   (`confirmed`), `authoritative: false` ;
 * - un code que le registre a RADIÉ est `verified` avec `retired`, `retired_on`
 *   et, s'il existe, le successeur légal (`superseded_by`), titulaire `inferred`
 *   parce que personne ne le tient aujourd'hui, et il cesse de servir le nom
 *   périmé de la carte curée ;
 * - un code que le registre n'a jamais connu reçoit exactement la réponse
 *   d'avant le registre (Poste Italiane, le Trésor, les succursales
 *   d'établissements européens émettent des IBAN hors de lui).
 *
 * Les faits asservis ici sont ceux de l'édition du 23/09/2026, recopiés
 * ci-dessous : les poser sur la base livrée ferait échouer le rafraîchissement
 * hebdomadaire au premier changement de nom. Ce qui doit tenir quelle que soit
 * l'édition vit dans it-register-live.test.ts.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));

const SOURCE =
  "Banca d'Italia, Albi ed elenchi di vigilanza (open data, CC BY 4.0, https://creativecommons.org/licenses/by/4.0/)";
const AS_OF = '2026-09-23';

/** Codes en vigueur, tels que l'édition du 23/09/2026 les écrit (données publiques). */
const IN_FORCE: Array<{
  code: string;
  name: string;
  street: string;
  post_code: string;
  town: string;
  lei: string | null;
}> = [
  {
    code: '03069',
    name: 'INTESA SANPAOLO S.P.A.',
    street: 'PIAZZA SAN CARLO, 156',
    post_code: '10121',
    town: 'TORINO',
    lei: '2W8N8UU78PMDQKZENC08',
  },
  {
    code: '03268',
    name: 'BANCA SELLA - S.P.A.',
    street: 'PIAZZA GAUDENZIO SELLA, 1',
    post_code: '13900',
    town: 'BIELLA',
    lei: '549300I7OIUB41P86L19',
  },
  {
    code: '03479',
    name: 'BNP PARIBAS SA',
    street: 'PIAZZA LINA BO BARDI, 3',
    post_code: '20124',
    town: 'MILANO',
    lei: null,
  },
  {
    code: '05387',
    name: 'BPER BANCA S.P.A.',
    street: 'VIA S. CARLO, 8/20',
    post_code: '41121',
    town: 'MODENA',
    lei: 'N747OI7JINV7RUUH6190',
  },
  {
    code: '36081',
    name: 'POSTEPAY S.P.A.',
    street: 'VIALE EUROPA, 190',
    post_code: '00144',
    town: 'ROMA',
    lei: '81560006CC40E9A86833',
  },
];

/**
 * Codes radiés, tels que le chargeur les dérive de l'historique et des fusions
 * de la même édition. Le dernier est INVENTÉ, nom compris : un code que la carte
 * curée porte encore, déclaré radié par cette édition fixe, pour prouver que
 * l'élagage au chargement ne dépend pas du nettoyage de bic_data.json.
 */
const RETIRED: Array<{
  code: string;
  name: string;
  retired_on: string;
  successor_code: string | null;
  successor_name: string | null;
}> = [
  {
    code: '03111',
    name: "UNIONE DI BANCHE ITALIANE SOCIETA' PER AZIONI (IN FORMA ABBREVIATA UBI BANCA)",
    retired_on: '2021-04-11',
    successor_code: '03069',
    successor_name: 'INTESA SANPAOLO S.P.A.',
  },
  {
    // L'exemple italien du registre ISO 13616 : absorbée par UBI en 2017, puis
    // UBI par Intesa Sanpaolo en 2021 ; le successeur est suivi jusqu'à Intesa.
    code: '05428',
    name: 'BANCA POPOLARE DI BERGAMO S.P.A.',
    retired_on: '2017-02-19',
    successor_code: '03069',
    successor_name: 'INTESA SANPAOLO S.P.A.',
  },
  {
    code: '06175',
    name: 'BANCA CARIGE S.P.A. - CASSA DI RISPARMIO DI GENOVA E IMPERIA (IN FORMA ABBREVIATA CARIGE S.P.A.)',
    retired_on: '2022-11-27',
    successor_code: '05387',
    successor_name: 'BPER BANCA S.P.A.',
  },
  {
    // Liquidation, actifs cédés : une cession ne fait pas de successeur légal.
    code: '05728',
    name: 'BANCA POPOLARE DI VICENZA SPA IN LIQUIDAZIONE COATTA AMMINISTRATIVA',
    retired_on: '2017-07-19',
    successor_code: null,
    successor_name: null,
  },
  {
    // La même entité a changé de code : son successeur est son nouveau code.
    code: '03181',
    name: 'BNP PARIBAS SA',
    retired_on: '2022-09-30',
    successor_code: '03479',
    successor_name: 'BNP PARIBAS SA',
  },
  {
    code: '23019',
    name: 'Banca di Esempio S.p.A.',
    retired_on: '2020-01-31',
    successor_code: null,
    successor_name: null,
  },
];

const COMPOSITE =
  'IBANforge composite bank-code map (assembled from BIC directories, not a national bank-code register)';

let tmpDir: string;
let previousPath: string | undefined;
let check: (iban: string) => IBANValidationResult;
let enrich: typeof import('./enrich.js');
let lib: typeof import('./national-registers.js');
let closeAll: () => void;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ibanforge-it-fixed-'));
  const dbPath = join(tmpDir, 'bic.sqlite');
  copyFileSync(resolve(__dirname, '../../data/bic.sqlite'), dbPath);
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS national_bank_codes_retired (
    country TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, retired_on TEXT NOT NULL,
    successor_code TEXT, successor_name TEXT, source TEXT, as_of TEXT, PRIMARY KEY (country, code))`);
  db.exec(`DELETE FROM national_bank_codes WHERE country = 'IT'`);
  db.exec(`DELETE FROM national_bank_codes_retired WHERE country = 'IT'`);
  const insCode = db.prepare(
    `INSERT INTO national_bank_codes (country, code, name, bic, street, post_code, town, lei, source, as_of)
     VALUES ('IT', ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of IN_FORCE)
    insCode.run(r.code, r.name, r.street, r.post_code, r.town, r.lei, SOURCE, AS_OF);
  const insRetired = db.prepare(
    `INSERT INTO national_bank_codes_retired (country, code, name, retired_on, successor_code, successor_name, source, as_of)
     VALUES ('IT', ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const r of RETIRED) {
    insRetired.run(r.code, r.name, r.retired_on, r.successor_code, r.successor_name, SOURCE, AS_OF);
  }
  db.close();

  // Avant le premier import qui atteint db.js : le chemin y est lu une fois.
  previousPath = process.env.BIC_DB_PATH;
  process.env.BIC_DB_PATH = dbPath;

  const { validateIBAN } = await import('./iban.js');
  enrich = await import('./enrich.js');
  lib = await import('./national-registers.js');
  closeAll = (await import('./db.js')).closeAll;
  check = (iban: string): IBANValidationResult => {
    const r = validateIBAN(iban);
    expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
    enrich.enrichResult(r);
    return r;
  };
}, 60_000);

afterAll(() => {
  closeAll?.();
  if (previousPath === undefined) delete process.env.BIC_DB_PATH;
  else process.env.BIC_DB_PATH = previousPath;
  rmSync(tmpDir, { recursive: true, force: true });
});

/** Valeurs des positions impaires du CIN (A-Z et 0-9 lus comme 0-25 et 0-9). */
const CIN_ODD = [
  1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23,
];

/**
 * Un IBAN italien valide pour un code ABI, CIN compris (la lettre de contrôle
 * que l'API vérifie aussi), sur un guichet et un compte inventés. Les IBAN de
 * l'étude du 24/09/2026 sont construits ainsi.
 */
function itIban(abi: string, cab = '01600', account = '000000123456'): string {
  const body = `${abi}${cab}${account}`;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const v = /\d/.test(body[i]) ? Number(body[i]) : body.charCodeAt(i) - 65;
    sum += i % 2 === 0 ? CIN_ODD[v] : v;
  }
  const bban = `${String.fromCharCode(65 + (sum % 26))}${body}`;
  const digits = `${bban}IT00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  const checkDigits = 98n - (BigInt(digits) % 97n);
  return `IT${checkDigits.toString().padStart(2, '0')}${bban}`;
}

describe('the fixture is the register the answers come from', () => {
  it('loads the fixed copy, not the shipped rows', () => {
    // Si l'isolement des modules cessait de marcher, tout ce qui suit décrirait
    // la base livrée ; ce test échoue le premier et le dit.
    expect(lib.nationalRegisterAvailable('IT')).toBe(true);
    expect(lib.nationalRegisterEdition('IT')).toEqual({ source: SOURCE, as_of: AS_OF });
    expect([...lib.retiredNationalCodes('IT')].sort()).toEqual(RETIRED.map((r) => r.code).sort());
  });

  it('builds the credit CC BY 4.0 asks for: author, licence, edition and the modification', () => {
    expect(lib.nationalRegisterCredit('IT')).toBe(
      `Source: ${SOURCE}, edition ${AS_OF}; normalised and joined by IBANforge`,
    );
  });

  it('builds IBANs the way the study did', () => {
    expect(itIban('03111')).toBe('IT58V0311101600000000123456');
    expect(itIban('05428', '11101')).toBe('IT60X0542811101000000123456');
  });
});

describe('a code in force is named by the register, without settling a negative', () => {
  it.each(IN_FORCE.map((r) => [r.code, r] as const))('%s', (code, row) => {
    const r = check(itIban(code));
    const c = r.bank_code_check!;
    expect(c.value).toBe(code);
    expect(c.status).toBe('verified');
    expect(c.match).toBe('register');
    expect(c.authoritative).toBe(false);
    expect(c.register).toBe(enrich.registerCoverage('IT').register);
    expect(c.institution).toEqual({
      name: row.name,
      street: row.street,
      post_code: row.post_code,
      town: row.town,
      country: 'IT',
      ...(row.lei ? { lei: row.lei } : {}),
    });
    expect(c.as_of).toBe('2026-09');
    expect(c.retired).toBeUndefined();
    expect(c.retired_on).toBeUndefined();
    expect(r.bank_code_holder).toBe('confirmed');
    expect(r.checks?.bank_code).toBe('pass');
  });

  it('keeps the curated BIC beside the register verdict: the Banca d’Italia publishes none', () => {
    const r = check(itIban('03069'));
    expect(r.bic?.code).toBe('BCITITMM');
    expect(r.bic?.basis).toBe('curated_map');
    expect(r.bic?.authoritative).toBe(false);
  });

  it('answers the code as it stands today when it was re-registered after a radiation', () => {
    // 03268 : Banca Sella radiée le 31/12/2005 et réinscrite le lendemain sous
    // le même code. Un titulaire en vigueur l'emporte sur tout le passé.
    const r = check(itIban('03268'));
    expect(r.bank_code_check?.retired).toBeUndefined();
    expect(r.bank_code_check?.institution?.name).toBe('BANCA SELLA - S.P.A.');
  });
});

describe('a code the register has struck off is retired, never refused', () => {
  it('03111 no longer answers « Banca Carige », and names the legal successor', () => {
    // Jusqu'au 25/09/2026 : `verified`, BIC CRGEITGGXXX, « Banca Carige », Genova :
    // la mauvaise banque, elle-même absorbée par BPER en 2022.
    const r = check(itIban('03111'));
    const c = r.bank_code_check!;
    expect(c.status).toBe('verified');
    expect(c.reason).toBeUndefined();
    expect(c.authoritative).toBe(false);
    expect(c.retired).toBe(true);
    expect(c.retired_on).toBe('2021-04-11');
    expect(c.superseded_by).toBe('03069');
    expect(c.institution).toEqual({
      name: "UNIONE DI BANCHE ITALIANE SOCIETA' PER AZIONI (IN FORMA ABBREVIATA UBI BANCA)",
      street: null,
      post_code: null,
      town: null,
      country: 'IT',
    });
    expect(c.register).toBe(enrich.registerCoverage('IT').register);
    expect(c.as_of).toBe('2026-09');
    expect(r.bic ?? null).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/carige|CRGEITGG/i);
    // Personne ne tient ce code aujourd'hui : pas `confirmed`, jamais `not_allocated`.
    expect(r.bank_code_holder).toBe('inferred');
    expect(r.checks?.bank_code).toBe('inferred');
    expect(r.valid).toBe(true);
  });

  it('tells the caller what to do, and that the legal successor may not hold the account', () => {
    const r = check(itIban('03111'));
    const steps = r.next_steps ?? [];
    expect(steps.map((s) => s.code)).toEqual(['bank_code_retired']);
    expect(steps[0].do).toBe(
      'Update the beneficiary details before sending. The register struck this bank code off on 2021-04-11; its legal successor by merger or incorporation holds bank code 03069, which is not necessarily the bank that now holds the account.',
    );
    expect(steps[0].because).toContain("Banca d'Italia");
  });

  it('follows the legal successor through two mergers, on the ISO 13616 example IBAN', () => {
    const r = check('IT60X0542811101000000123456');
    expect(r.bank_code_check?.retired).toBe(true);
    expect(r.bank_code_check?.retired_on).toBe('2017-02-19');
    expect(r.bank_code_check?.superseded_by).toBe('03069');
    expect(r.bic ?? null).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/UBI BANCA SCPA|BLOPIT22/);
  });

  it('06175, Banca Carige itself, points at BPER', () => {
    const r = check(itIban('06175'));
    expect(r.bank_code_check?.superseded_by).toBe('05387');
    expect(r.bic ?? null).toBeNull();
  });

  it('names no successor where the register records none, and says so', () => {
    const r = check(itIban('05728'));
    expect(r.bank_code_check?.retired).toBe(true);
    expect(r.bank_code_check?.superseded_by).toBeUndefined();
    expect(r.next_steps?.[0]?.do).toBe(
      'Update the beneficiary details before sending. The register struck this bank code off on 2017-07-19 and names no legal successor.',
    );
  });

  it('points a code that only changed numbers at its new number', () => {
    const r = check(itIban('03181'));
    expect(r.bank_code_check?.superseded_by).toBe('03479');
    expect(r.bank_code_check?.institution?.name).toBe('BNP PARIBAS SA');
  });

  it('drops a curated key the register declares retired, even while bic_data.json still carries it', () => {
    // 23019 est dans la carte curée (ARABITRRXXX) ; cette édition FIXE le
    // déclare radié. L'élagage au chargement suffit à couper le BIC.
    const curated = JSON.parse(
      readFileSync(resolve(__dirname, '../db/bic_data.json'), 'utf8'),
    ) as Record<string, { bic: string }>;
    expect(curated['IT:23019']?.bic).toBe('ARABITRRXXX');
    const r = check(itIban('23019'));
    expect(r.bank_code_check?.retired).toBe(true);
    expect(r.bic ?? null).toBeNull();
  });

  it('never escalates into a refusal, and never asks to screen a bank that no longer exists', () => {
    for (const row of RETIRED) {
      const r = check(itIban(row.code));
      const c = r.bank_code_check!;
      expect(c.status, row.code).toBe('verified');
      expect(c.authoritative, row.code).toBe(false);
      expect(c.reason, row.code).toBeUndefined();
      expect(r.bank_code_holder, row.code).not.toBe('not_allocated');
      const codes = (r.next_steps ?? []).map((s) => s.code);
      expect(codes, row.code).not.toContain('bank_code_not_allocated');
      expect(codes, row.code).not.toContain('screen_compliance');
    }
  });
});

describe('a code the register never listed gets the answer it had before the register', () => {
  it.each([
    ['07601', 'BPPIITRRXXX'],
    ['01000', 'BITAITRRENT'],
    ['36092', 'QNTOITM2XXX'],
  ])('%s (outside the Banca d’Italia registers) keeps the composite map', (code, bic) => {
    const r = check(itIban(code));
    expect(r.bank_code_check).toEqual({
      value: code,
      status: 'verified',
      match: 'register',
      register: COMPOSITE,
      authoritative: false,
      as_of: r.bank_code_check!.as_of,
    });
    expect(r.bic?.code).toBe(bic);
    expect(r.bank_code_holder).toBe('inferred');
  });

  it('a code neither the register nor the map knows stays absent_from_reference_data, never not_allocated', () => {
    const r = check(itIban('09999'));
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.reason).toBe('absent_from_reference_data');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bank_code_holder).toBe('unknown');
  });
});

describe('Italy is a partial register, and the rest of Europe does not move', () => {
  it('is partial, named with its CC BY 4.0 credit', () => {
    const coverage = enrich.registerCoverage('IT');
    expect(coverage.basis).toBe('partial');
    expect(coverage.register).toContain("Banca d'Italia");
    expect(coverage.register).toContain('CC BY 4.0');
    expect(coverage.register).toContain('https://creativecommons.org/licenses/by/4.0/');
    expect(coverage.register).toContain('normalised and joined by IBANforge');
    expect(coverage.register).toContain('an absence is not a non-allocation');
  });

  it('keeps a German retired code confirmed, with its own wording', () => {
    const db = new Database(process.env.BIC_DB_PATH!, { readonly: true });
    const row = db
      .prepare('SELECT blz FROM de_blz WHERE retired = 1 AND successor_blz IS NOT NULL LIMIT 1')
      .get() as { blz: string } | undefined;
    db.close();
    expect(row, 'no retired German BLZ in the shipped database').toBeDefined();
    const bban = `${row!.blz}0532013000`;
    const digits = `${bban}DE00`.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
    const iban = `DE${(98n - (BigInt(digits) % 97n)).toString().padStart(2, '0')}${bban}`;
    const r = check(iban);
    expect(r.bank_code_check?.retired).toBe(true);
    expect(r.bank_code_check?.retired_on).toBeUndefined();
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_holder).toBe('confirmed');
    const step = r.next_steps?.find((s) => s.code === 'bank_code_retired');
    expect(step?.do).toMatch(
      /^Update the beneficiary details\. The register is retiring this bank code; \d{8} takes over\.$/,
    );
  });

  it('keeps San Marino, the other ABI register, exactly as it was', () => {
    // Même format ABI, registre partiel lui aussi : un code absent de la liste
    // de la BCSM reste `absent_from_reference_data`, et aucune ligne italienne
    // ne répond pour lui.
    expect(enrich.registerCoverage('SM').basis).toBe('partial');
    expect(lib.lookupRetiredNationalCode('SM', '03111')).toBeNull();
  });
});
