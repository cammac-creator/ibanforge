import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import type DatabaseType from 'better-sqlite3';
import {
  FIXTURE as FX,
  installRestrictedFixture,
  RESTRICTED_DATASETS,
  type RestrictedFixture,
  type RestrictedFixtureOptions,
} from '../test-support/restricted-fixtures.js';

/**
 * Une table ou une liste qui n'est pas chargée veut dire « non consulté »,
 * jamais « non ».
 *
 * ## Pourquoi ce fichier existe
 *
 * Les données sous licence restrictive quittent le dépôt public (décision du
 * 24/09/2026) et arriveront en production par un fichier privé séparé.
 * « Cette table n'est pas là » est donc un état que l'API doit décrire
 * honnêtement : sur un déploiement où le fichier privé manque, sur la copie
 * d'un contributeur, et en CI. Mesuré le 24/09/2026 en vidant ces tables, elle
 * ne le faisait pas : `checkReachability` et `checkVop` répondaient
 * `screened: true` sur des registres EPC vides, chaque banque revenait « non
 * joignable en SEPA Instant », « absente du registre VoP », et le score de
 * risque payant d'une banque ordinaire passait de 0 à 10. `meta.sources`
 * nommait encore la liste de l'ONU et les registres EPC après le départ de leurs
 * lignes.
 *
 * ## Comment il le prouve
 *
 * Les mêmes requêtes, sur quatre bases construites à partir des bases livrées :
 *
 *  1. chaque jeu sous licence restrictive remplacé par des lignes inventées (le
 *     témoin : les chemins répondent quand la donnée est là) ;
 *  2. chaque jeu absent, tables gardées VIDES ;
 *  3. chaque jeu absent, tables SUPPRIMÉES là où c'est possible ;
 *  4. aucune liste de sanctions chargée.
 *
 * Chaque bloc installe sa base et recharge les modules, parce que les chemins
 * sont lus une seule fois, à l'import.
 */

const require = createRequire(import.meta.url);

/** Commerzbank, l'exemple allemand classique : donnée publique de bout en bout (BLZ de la Bundesbank, BIC). */
const DE_ORDINARY = 'DE89370400440532013000';

async function loadModules() {
  vi.resetModules();
  return {
    compliance: await import('./compliance.js'),
    complianceDb: await import('./compliance-db.js'),
    response: await import('./compliance-response.js'),
    iban: await import('./iban.js'),
    enrich: await import('./enrich.js'),
    pra: await import('./pra-banks.js'),
  };
}
type Modules = Awaited<ReturnType<typeof loadModules>>;

function useDatabase(
  options: RestrictedFixtureOptions,
  after?: (fixture: RestrictedFixture) => void,
): () => Modules {
  let fixture: RestrictedFixture;
  let modules: Modules;
  beforeAll(async () => {
    fixture = installRestrictedFixture(options);
    after?.(fixture);
    modules = await loadModules();
  }, 60_000);
  afterAll(() => fixture.restore());
  return () => modules;
}

function validate(m: Modules, iban: string) {
  const r = m.iban.validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  m.enrich.enrichResult(r);
  return r;
}

describe('control: the invented datasets answer when they are loaded', () => {
  const mods = useDatabase({});

  it('screens an invented bank against the invented EPC registers', () => {
    const r = mods().response.buildComplianceResponse(FX.AT.iban(FX.AT.bank.code));
    expect(r.bic?.code).toBe(FX.AT.bank.bic);
    expect(r.compliance.reachability).toEqual({
      sepa_instant: true,
      sct: true,
      sdd: true,
      screened: true,
      // Nom honnête ajouté le 25/09/2026.
      listed_in_epc_registers: true,
    });
    expect(r.compliance.vop).toEqual({
      participant: true,
      status: 'active',
      screened: true,
      register_status: 'active',
    });
    expect(r.compliance.risk_score).toBe(0);
    expect(r.sepa?.vop_participant).toBe(true);
    expect((r.sepa as { basis?: string }).basis).toBe('epc_register');
    // Le grain de la banque, sur les mêmes registres inventés.
    expect(r.sepa?.bank_reachability).toBe('listed');
    expect(r.sepa?.bank_schemes).toEqual(['SCT', 'SDD', 'SCT_INST']);
    expect(r.sepa?.vop_register_status).toBe('active');
    expect(r.checks?.sepa_reachability).toBe('pass');
  });

  it('serves the bank s own schemes, the same on validate and on compliance', () => {
    // DATA-02 (01/09/2026) sur des lignes inventées : le registre répond au
    // niveau de la banque quand il la liste, et les deux endpoints disent la
    // même chose.
    const iban = FX.AT.iban(FX.AT.member.code);
    const validated = validate(mods(), iban);
    expect((validated.sepa as { basis?: string }).basis).toBe('epc_register');
    expect(validated.sepa?.schemes).toEqual(['SCT', 'SCT_INST']);
    expect(validated.sepa?.bank_schemes).toEqual(['SCT', 'SCT_INST']);
    const reach = mods().response.buildComplianceResponse(iban).compliance.reachability;
    expect(reach).toEqual({
      sepa_instant: true,
      sct: true,
      sdd: false,
      screened: true,
      listed_in_epc_registers: true,
    });
  });

  it('answers not_listed for a bank the EPC registers do not list, and keeps the country schemes', () => {
    // Une banque publique de la carte composite, absente des registres EPC
    // inventés : le registre a été lu, elle n'y figure pas. Une absence du
    // registre n'est pas une exclusion du schéma : `schemes` garde le pays.
    const r = validate(mods(), 'NL19BICK0123456789');
    expect(r.bic?.code).toBeTruthy();
    expect(r.sepa?.bank_reachability).toBe('not_listed');
    expect(r.sepa?.bank_schemes).toBeNull();
    expect(r.sepa?.vop_register_status).toBe('not_listed');
    expect((r.sepa as { basis?: string }).basis).toBe('country_default');
    expect(r.checks?.sepa_reachability).toBe('unknown');
    const c = mods().response.buildComplianceResponse('NL19BICK0123456789');
    expect(c.compliance.reachability.listed_in_epc_registers).toBe(false);
    expect(c.compliance.vop.register_status).toBe('not_listed');
  });

  it('carries a pending VoP registration as pending, and not as a participant', () => {
    expect(mods().compliance.checkVop(FX.BE.bank.bic!)).toEqual({
      participant: false,
      status: 'pending',
      screened: true,
    });
    expect(validate(mods(), FX.BE.iban(FX.BE.bank.code)).sepa?.vop_participant).toBe(false);
    expect(validate(mods(), FX.BE.iban(FX.BE.bank.code)).sepa?.vop_register_status).toBe('pending');
  });

  it('still scores a bank the loaded registers do not list', () => {
    // Les registres ont été consultés et la banque n'y est pas : c'est un
    // constat, et il garde son poids. Seul un registre non consulté le perd.
    const r = mods().response.buildComplianceResponse(DE_ORDINARY);
    expect(r.compliance.reachability.screened).toBe(true);
    expect(r.compliance.flags).toEqual(expect.arrayContaining(['no_sepa_instant', 'no_vop']));
    expect(r.compliance.risk_score).toBe(10);
    expect(r.sepa?.vop_participant).toBe(false);
  });

  it('names the UN list, and matches on it, when it is loaded', () => {
    expect(mods().complianceDb.loadedSanctionsLists()).toContain('UN');
    const r = mods().response.buildBicComplianceResponse(FX.UN.onlyUn);
    expect('compliance' in r && r.compliance.sanctions.matched_lists).toEqual(['UN']);
    expect('meta' in r && r.meta.sources).toMatch(/(^|,)UN(,|$)/);
    expect(mods().compliance.screenBicSanctions(FX.UN.unAndOfac).matched_lists.sort()).toEqual([
      'OFAC',
      'UN',
    ]);
  });
});

describe.each(['empty', 'absent'] as const)('every restricted dataset missing, tables %s', (as) => {
  const mods = useDatabase({ missing: { datasets: RESTRICTED_DATASETS, as } });

  it('says the EPC registers were not consulted, rather than "not reachable"', () => {
    const m = mods();
    expect(m.compliance.checkReachability('COBADEFF')).toEqual({
      sepa_instant: false,
      sct: false,
      sdd: false,
      screened: false,
    });
    expect(m.compliance.checkVop('COBADEFF')).toEqual({
      participant: false,
      status: 'not_found',
      screened: false,
    });
  });

  it('leaves the score of an ordinary bank at 0, not 10', () => {
    const r = mods().response.buildComplianceResponse(DE_ORDINARY);
    expect(r.bic?.code.slice(0, 8)).toBe('COBADEFF');
    expect(r.compliance.sanctions.bank_screened).toBe(true);
    expect(r.compliance.risk_score).toBe(0);
    expect(r.compliance.risk_level).toBe('low');
    // Nommé pour ce que c'est : un registre que nous n'avons pas consulté, pour
    // une banque que nous avons bien résolue. Jamais un constat sur la banque,
    // jamais « pas de banque ».
    expect(r.compliance.flags).toEqual(
      expect.arrayContaining(['sepa_register_unavailable', 'vop_register_unavailable']),
    );
    expect(r.compliance.flags).not.toContain('no_sepa_instant');
    expect(r.compliance.flags).not.toContain('no_vop');
    expect(r.compliance.flags).not.toContain('no_bank_resolved');
    // Les champs ajoutés le 25/09/2026 disent la même chose : non consulté,
    // jamais « absent du registre ».
    expect(r.compliance.reachability.listed_in_epc_registers).toBeNull();
    expect(r.compliance.vop.register_status).toBeNull();
    expect(r.sepa?.bank_reachability).toBeNull();
    expect(r.sepa?.bank_schemes).toBeNull();
    expect(r.sepa?.vop_register_status).toBeNull();
    expect(r.checks?.sepa_reachability).toBe('unknown');
    // Les registres EPC manquent : l'index des traces courantes est incomplet,
    // et un BIC qu'il ne trouve pas répond « non consulté », jamais `false`.
    expect(r.bic?.listed_in_current_source).not.toBe(false);
  });

  it('keeps a Belarusian bank critical: outside the SEPA area the country answers', () => {
    // Aucune banque d'un pays hors SEPA ne figure au registre : « pas de SEPA
    // Instant, pas de VoP » y est un constat tiré du pays, registre ou non. Les
    // retirer faisait passer cette banque de critical à high.
    const r = mods().response.buildComplianceResponse('BY13NBRB3600900000002Z00AB00');
    expect(r.bic?.code.slice(0, 8)).toBe('NBRBBY2X');
    expect(r.compliance.reachability.screened).toBe(true);
    expect(r.compliance.vop.screened).toBe(true);
    expect(r.compliance.flags).toEqual(
      expect.arrayContaining(['sanctioned_country', 'no_sepa_instant', 'no_vop']),
    );
    expect(r.compliance.flags).not.toContain('sepa_register_unavailable');
    expect(r.compliance.risk_level).toBe('critical');
    // Même règle par BIC.
    const byBic = mods().response.buildBicComplianceResponse('NBRBBY2X');
    if ('error' in byBic) throw new Error('should validate');
    expect(byBic.compliance.flags).toEqual(expect.arrayContaining(['no_sepa_instant', 'no_vop']));
    expect(byBic.compliance.risk_level).toBe('critical');
  });

  it('answers an ordinary non-SEPA IBAN exactly as a full database does', () => {
    const r = mods().response.buildComplianceResponse('UA213223130000026007233566001');
    expect(r.bic?.code).toBeTruthy();
    expect(r.compliance.reachability).toEqual({
      sepa_instant: false,
      sct: false,
      sdd: false,
      screened: true,
      listed_in_epc_registers: false,
    });
    expect(r.compliance.vop).toEqual({
      participant: false,
      status: 'not_found',
      screened: true,
      register_status: 'not_listed',
    });
    expect(r.compliance.flags).toEqual(expect.arrayContaining(['no_sepa_instant', 'no_vop']));
    // Hors SEPA, aucun champ du grain de la banque.
    expect(r.sepa).not.toHaveProperty('bank_reachability');
    expect(r.checks?.sepa_reachability).toBe('not_applicable');
    // Et la validation dit la même chose que la conformité : `false`, pas null.
    expect(validate(mods(), 'UA213223130000026007233566001').sepa?.vop_participant).toBe(false);
  });

  // getSepaInfo() ne compte pas ces territoires comme membres, alors que le
  // registre porte leurs banques : le raccourci par le pays leur donnerait un
  // faux « non ». Banques inventées.
  it.each(['GG', 'GP', 'JE', 'MQ', 'RE'])(
    'leaves %s, a territory the registers cover, as "not consulted"',
    (cc) => {
      const r = mods().response.buildBicComplianceResponse(`XMPL${cc}2X`);
      if ('error' in r) throw new Error('should validate');
      expect(r.country.code).toBe(cc);
      expect(r.compliance.reachability.screened).toBe(false);
      expect(r.compliance.vop.screened).toBe(false);
      expect(r.compliance.flags).toEqual(
        expect.arrayContaining(['sepa_register_unavailable', 'vop_register_unavailable']),
      );
      expect(r.compliance.flags).not.toContain('no_sepa_instant');
    },
  );

  it('answers vop_participant null and the country schemes on validate', () => {
    const r = validate(mods(), DE_ORDINARY);
    expect(r.sepa?.vop_participant).toBeNull();
    expect((r.sepa as { basis?: string }).basis).toBe('country_default');
  });

  it('names neither the UN list nor the EPC registers in meta.sources', () => {
    const m = mods();
    const sources = m.response.buildComplianceResponse(DE_ORDINARY).meta.sources ?? '';
    expect(sources.split(',')).not.toContain('UN');
    expect(sources).not.toMatch(/EPC-/);
    // Ce qui a été consulté reste nommé : les listes publiques et le GAFI.
    expect(sources.split(',')).toEqual(expect.arrayContaining(['EU', 'OFAC', 'FATF']));
    expect(m.complianceDb.loadedSanctionsLists()).toEqual(['EU', 'OFAC']);
  });

  it('does not match a bank only the missing UN list names', () => {
    const r = mods().response.buildBicComplianceResponse(FX.UN.onlyUn);
    expect('compliance' in r && r.compliance.sanctions.matched_lists).toEqual([]);
    // La réponse ne dit pas « absente de la liste de l'ONU » : elle dit quelles
    // listes elle a lues, et celle de l'ONU n'en fait pas partie.
    expect('meta' in r && (r.meta.sources ?? '').split(',')).not.toContain('UN');
  });

  it('degrades Austria to "register unavailable", never to a denial', () => {
    // Un code que la carte composite ne porte pas non plus : rien ne peut y répondre.
    const r = validate(mods(), FX.AT.iban(FX.AT.unallocatedCode));
    expect(r.bank_code_check?.reason).toBe('national_register_unavailable');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.next_steps?.map((s) => s.code)).not.toContain('bank_code_not_allocated');
  });

  it('degrades Belgium the same way', () => {
    const r = validate(mods(), FX.BE.iban(FX.BE.unallocatedCode));
    expect(r.bank_code_check?.reason).toBe('national_register_unavailable');
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.next_steps?.map((s) => s.code)).not.toContain('bank_code_not_allocated');
  });

  it('lets the composite map answer an Austrian code it carries, labelled as the map', () => {
    // Documenté ici, pas modifié : src/db/bic_data.json porte encore des clés
    // autrichiennes (tirées par une compilation tierce du fichier de l'OeNB),
    // si bien qu'un vrai code autrichien revient `verified` sans le registre.
    // L'étiquette est honnête (la carte composite, `authoritative: false`),
    // mais ces clés sont elles-mêmes des données du registre qui s'en va, et
    // leur sort appartient à la modification qui retire le registre.
    const r = validate(mods(), FX.AT.iban('12000'));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.register).toMatch(/composite/i);
    expect(r.bank_code_check?.authoritative).toBe(false);
    expect(r.bic?.basis).not.toBe('national_register');
  });

  it('answers San Marino as before its list existed', () => {
    const r = validate(mods(), FX.SM.iban(FX.SM.bank.code));
    expect(r.bank_code_check?.reason).toBe('absent_from_reference_data');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });

  it('says nothing about PRA authorisation, and credits no month', () => {
    const m = mods();
    // /llms.txt lit ces valeurs au démarrage à froid ; une exception ici serait un 500.
    expect(m.pra.getPraBanksCount()).toBe(0);
    expect(m.pra.getPraListMonth()).toBeNull();
    expect(m.pra.praAttribution()).toBeNull();
    expect(validate(m, FX.PRA.gbIban).pra_authorisation).toBeUndefined();
  });
});

/**
 * Aucune liste de sanctions chargée : seule la recherche de la banque est
 * sautée. Les axes pays et GAFI ont leurs propres tables et répondent quand
 * même ; une banque résolue lève `sanctions_lists_unavailable` et ne descend
 * pas sous 50. Rejoué table vidée PUIS table supprimée : préparée sans
 * condition, la requête de la banque faisait lever même un IBAN sans banque
 * résolue sur une table supprimée.
 */
describe.each(['DELETE FROM sanctioned_entities', 'DROP TABLE sanctioned_entities'])(
  'no sanctions list loaded at all (%s)',
  (statement) => {
    const mods = useDatabase({}, (fixture) => {
      const Database = require('better-sqlite3') as typeof DatabaseType;
      const db = new Database(fixture.compliancePath);
      db.prepare(statement).run();
      db.close();
    });

    it('answers the BIC screen as not screened, never as clean', () => {
      expect(mods().compliance.screenBicSanctions('COBADEFF')).toEqual({
        screened: false,
        listed: null,
        matched_lists: [],
      });
    });

    it('answers institution_listed null, never false, and says the institution was not screened', () => {
      const r = mods().response.buildComplianceResponse(DE_ORDINARY);
      expect(r.compliance.sanctions.bank_sanctioned).toBe(false);
      expect(r.compliance.sanctions.institution_listed).toBeNull();
      expect(r.compliance.sanctions.payee_screened).toBe(false);
      expect(r.checks?.institution_sanctions).toBe('unknown');
    });

    it('holds an ordinary bank at elevated, saying why, never at low', () => {
      const r = mods().response.buildComplianceResponse(DE_ORDINARY);
      expect(r.compliance.sanctions.bank_screened).toBe(false);
      expect(r.compliance.flags).toContain('sanctions_lists_unavailable');
      // La banque est bien résolue : ni « pas de banque », ni le repli d'une
      // base illisible.
      expect(r.compliance.flags).not.toContain('no_bank_resolved');
      expect(r.compliance.flags).not.toContain('compliance_data_unavailable');
      expect(r.compliance.risk_score).toBe(50);
      expect(r.compliance.risk_level).toBe('elevated');
      expect(r.meta.sources ?? '').not.toMatch(/(^|,)(EU|OFAC|UN)(,|$)/);
    });

    it('keeps a North Korean bank critical, with the country and FATF axes it read', () => {
      // Le chemin BIC de /v1/iban/compliance. Tout faire tomber dans le repli
      // disait `country_sanctioned: false` et `non_member` et donnait 50.
      const r = mods().response.buildBicComplianceResponse('DCBKKPPY');
      if ('error' in r) throw new Error('should validate');
      expect(r.compliance.sanctions.country_sanctioned).toBe(true);
      expect(r.compliance.sanctions.fatf_status).toBe('black_list');
      expect(r.compliance.sanctions.bank_screened).toBe(false);
      expect(r.compliance.flags).toContain('sanctions_lists_unavailable');
      expect(r.compliance.risk_level).toBe('critical');
    });

    it('keeps a resolved Belarusian bank critical, not below what a full database says', () => {
      const r = mods().response.buildComplianceResponse('BY13NBRB3600900000002Z00AB00');
      expect(r.bic?.code.slice(0, 8)).toBe('NBRBBY2X');
      expect(r.compliance.sanctions.country_sanctioned).toBe(true);
      expect(r.compliance.flags).toEqual(
        expect.arrayContaining(['sanctioned_country', 'sanctions_lists_unavailable']),
      );
      expect(r.compliance.risk_score).toBeGreaterThanOrEqual(80);
      expect(r.compliance.risk_level).toBe('critical');
    });

    it('still screens the country when no bank is resolved', () => {
      // Pas de BIC, pas d'axe banque : les axes pays et GAFI répondent seuls et
      // rien ne prétend avoir contrôlé une banque. Un IBAN russe garde son
      // verdict de pays sanctionné, quoi que portent les listes d'entités.
      const r = mods().response.buildComplianceResponse('RU0204452560040702810412345678901');
      expect(r.bic ?? null).toBeNull();
      expect(r.compliance.sanctions.country_sanctioned).toBe(true);
      expect(r.compliance.sanctions.bank_screened).toBe(false);
      expect(r.compliance.flags).toContain('no_bank_resolved');
      expect(r.compliance.flags).not.toContain('sanctions_lists_unavailable');
      expect(r.compliance.risk_level).toBe('critical');
    });
  },
);

/**
 * La liste de l'ONU seule manque (sa surcouche privée n'est pas là) : une banque
 * est bien criblée contre les autres listes, mais aucune correspondance n'y vaut
 * plus « non ». `institution_listed` le dit (25/09/2026).
 */
describe('the UN list alone is missing', () => {
  const mods = useDatabase({ missing: { datasets: ['UN'], as: 'absent' } });

  it('answers institution_listed null for a bank no loaded list names', () => {
    const r = mods().response.buildComplianceResponse(DE_ORDINARY);
    expect(r.compliance.sanctions.bank_screened).toBe(true);
    expect(r.compliance.flags).toContain('sanctions_list_unavailable_un');
    expect(r.compliance.sanctions.bank_sanctioned).toBe(false);
    expect(r.compliance.sanctions.institution_listed).toBeNull();
    expect(r.checks?.institution_sanctions).toBe('unknown');
  });
});

/**
 * Une table VoP présente mais illisible (schéma inattendu, une ligne) : la
 * sonde passe, la requête lève. La validation, le lot et l'outil MCP
 * validate_iban tombaient en 500 ; la validation répond désormais « non
 * consulté », et la conformité garde son repli `compliance_data_unavailable`.
 */
describe('a VoP table present but unreadable', () => {
  const mods = useDatabase({}, (fixture) => {
    const Database = require('better-sqlite3') as typeof DatabaseType;
    const db = new Database(fixture.compliancePath);
    db.exec('DROP TABLE vop_participants; CREATE TABLE vop_participants (x TEXT);');
    db.prepare("INSERT INTO vop_participants (x) VALUES ('y')").run();
    db.close();
  });

  it('answers vop_participant null on validate, instead of a 500', () => {
    const r = validate(mods(), DE_ORDINARY);
    expect(r.bic?.code).toBeTruthy();
    expect(r.sepa?.vop_participant).toBeNull();
  });

  it('answers compliance_data_unavailable on the paid screen', () => {
    const r = mods().response.buildComplianceResponse(DE_ORDINARY);
    expect(r.compliance.flags[0]).toBe('compliance_data_unavailable');
    // Les noms honnêtes arrivent aussi sur ce repli (25/09/2026).
    expect(r.compliance.vop.register_status).toBeNull();
    expect(r.compliance.sanctions.payee_screened).toBe(false);
    expect(r.compliance.sanctions).toHaveProperty('institution_listed');
    expect(r.compliance.reachability).toHaveProperty('listed_in_epc_registers');
    // L'axe pays a pu ne pas être lu : pas de « pass » sur un défaut.
    expect(r.checks?.country_sanctions).toBe('unknown');
    // Le registre des schémas se lit (la banque n'y figure pas : constat) ; le
    // registre VoP ne se lit pas : ni `no_vop`, ni « non chargé ».
    expect(r.compliance.flags).toContain('no_sepa_instant');
    expect(r.compliance.flags).not.toContain('no_vop');
    expect(r.compliance.flags).not.toContain('vop_register_unavailable');
    expect(r.compliance.vop.screened).toBe(false);
    expect(r.compliance.risk_score).toBe(50);
    expect(r.compliance.risk_level).toBe('elevated');
  });

  it('keeps a Belarusian bank critical, with the country axis it could read', () => {
    // Le repli écrit en dur disait `country_sanctioned: false` et 50 : une table
    // VoP illisible effaçait le pays sanctionné. Les axes lisibles répondent.
    const r = mods().response.buildComplianceResponse('BY13NBRB3600900000002Z00AB00');
    expect(r.compliance.flags[0]).toBe('compliance_data_unavailable');
    expect(r.compliance.sanctions.country_sanctioned).toBe(true);
    expect(r.compliance.flags).toContain('sanctioned_country');
    expect(r.compliance.risk_level).toBe('critical');
    const byBic = mods().response.buildBicComplianceResponse('NBRBBY2X');
    if ('error' in byBic) throw new Error('should validate');
    expect(byBic.compliance.sanctions.country_sanctioned).toBe(true);
    expect(byBic.compliance.risk_level).toBe('critical');
  });
});

/**
 * Une table des schémas SEPA présente mais illisible : `meta.sources` omet les
 * schémas qu'il n'a pas pu lire, et le reste de `meta` est servi. La lecture
 * levait, et getComplianceMeta() mettait tout `meta` à null.
 */
describe('a SEPA scheme table present but unreadable', () => {
  const mods = useDatabase({}, (fixture) => {
    const Database = require('better-sqlite3') as typeof DatabaseType;
    const db = new Database(fixture.compliancePath);
    db.exec('DROP TABLE sepa_participants; CREATE TABLE sepa_participants (x TEXT);');
    db.prepare("INSERT INTO sepa_participants (x) VALUES ('y')").run();
    db.close();
  });

  it('keeps the rest of meta, and names no scheme it could not read', () => {
    const meta = mods().complianceDb.getComplianceMeta();
    expect(meta.sanctions_as_of).toBeTruthy();
    expect(meta.fatf_as_of).toBeTruthy();
    expect(meta.sources?.split(',')).toEqual(expect.arrayContaining(['EU', 'OFAC', 'FATF']));
    expect(meta.sources ?? '').not.toMatch(/EPC-/);
  });
});

/** La table GAFI vidée (hors scénario : elle est publique) : `meta` reste cohérent avec lui-même. */
describe('an empty FATF table', () => {
  const mods = useDatabase({}, (fixture) => {
    const Database = require('better-sqlite3') as typeof DatabaseType;
    const db = new Database(fixture.compliancePath);
    db.prepare('DELETE FROM fatf_countries').run();
    db.close();
  });

  it('neither names nor dates a FATF list it did not read', () => {
    const meta = mods().complianceDb.getComplianceMeta();
    expect(meta.sources?.split(',')).not.toContain('FATF');
    expect(meta.fatf_as_of).toBeNull();
  });
});

/**
 * Fermer la connexion oublie ce que les sondes, les requêtes préparées et
 * `meta.sources` savaient. Les autres blocs rechargent les modules à chaque
 * base et ne passent jamais par ce chemin ; celui-ci garde une seule instance
 * des modules, ferme, modifie le fichier et relit.
 */
describe('closing the compliance connection', () => {
  let fixture: RestrictedFixture;
  beforeAll(() => {
    fixture = installRestrictedFixture({});
  }, 60_000);
  afterAll(() => fixture.restore());

  it('forgets the probes, the prepared statements and the sources string', async () => {
    vi.resetModules();
    const compliance = await import('./compliance.js');
    const complianceDb = await import('./compliance-db.js');
    const db = await import('./db.js');
    const bic8 = FX.AT.bank.bic!.slice(0, 8);

    // Prépare les deux requêtes et fige les sondes et la chaîne.
    expect(compliance.checkVop(bic8).screened).toBe(true);
    expect(compliance.checkReachability(bic8).screened).toBe(true);
    expect(complianceDb.loadedComplianceSources()?.split(',')).toContain('UN');

    // Les lignes ONU retirées par une AUTRE connexion, sans fermer la nôtre :
    // la chaîne est mémorisée pour la connexion ouverte, elle ne change pas
    // (sans le mémo, chaque réponse relançait deux SELECT DISTINCT).
    const Database = require('better-sqlite3') as typeof DatabaseType;
    const other = new Database(fixture.compliancePath);
    other.prepare("DELETE FROM sanctioned_entities WHERE source_list = 'UN'").run();
    other.close();
    expect(complianceDb.loadedComplianceSources()?.split(',')).toContain('UN');

    db.closeAll();
    const w = new Database(fixture.compliancePath);
    w.prepare('DELETE FROM vop_participants').run();
    w.close();

    // Sans l'effacement des sondes, le registre VoP vidé resterait « chargé ».
    expect(compliance.checkVop(bic8)).toEqual({
      participant: false,
      status: 'not_found',
      screened: false,
    });
    // Sans la remise à zéro des requêtes, celle-ci partirait sur la connexion
    // fermée (« The database connection is not open »).
    expect(compliance.checkReachability(bic8).screened).toBe(true);
    // Sans l'effacement du mémo, `meta.sources` nommerait encore l'ONU.
    expect(complianceDb.loadedComplianceSources()?.split(',')).not.toContain('UN');
  });
});
