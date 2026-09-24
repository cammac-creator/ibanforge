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
    });
    expect(r.compliance.vop).toEqual({ participant: true, status: 'active', screened: true });
    expect(r.compliance.risk_score).toBe(0);
    expect(r.sepa?.vop_participant).toBe(true);
    expect((r.sepa as { basis?: string }).basis).toBe('epc_register');
  });

  it('serves the bank s own schemes, the same on validate and on compliance', () => {
    // DATA-02 (01/09/2026) sur des lignes inventées : le registre répond au
    // niveau de la banque quand il la liste, et les deux endpoints disent la
    // même chose.
    const iban = FX.AT.iban(FX.AT.member.code);
    const validated = validate(mods(), iban);
    expect((validated.sepa as { basis?: string }).basis).toBe('epc_register');
    expect(validated.sepa?.schemes).toEqual(['SCT', 'SCT_INST']);
    const reach = mods().response.buildComplianceResponse(iban).compliance.reachability;
    expect(reach).toEqual({ sepa_instant: true, sct: true, sdd: false, screened: true });
  });

  it('carries a pending VoP registration as pending, and not as a participant', () => {
    expect(mods().compliance.checkVop(FX.BE.bank.bic!)).toEqual({
      participant: false,
      status: 'pending',
      screened: true,
    });
    expect(validate(mods(), FX.BE.iban(FX.BE.bank.code)).sepa?.vop_participant).toBe(false);
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
  });

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

describe('no sanctions list loaded at all', () => {
  const mods = useDatabase({}, (fixture) => {
    const Database = require('better-sqlite3') as typeof DatabaseType;
    const db = new Database(fixture.compliancePath);
    db.prepare('DELETE FROM sanctioned_entities').run();
    db.close();
  });

  it('answers the BIC screen as not screened, never as clean', () => {
    expect(mods().compliance.screenBicSanctions('COBADEFF')).toEqual({
      screened: false,
      listed: null,
      matched_lists: [],
    });
  });

  it('answers compliance_data_unavailable rather than a reassuring score', () => {
    // La règle déjà en place pour une base illisible : un IBAN valide que nous
    // n'avons pas pu contrôler est « elevated, et on le dit », pas 0 / low.
    const r = mods().response.buildComplianceResponse(DE_ORDINARY);
    expect(r.compliance.flags).toEqual(['compliance_data_unavailable']);
    expect(r.compliance.risk_level).toBe('elevated');
    expect(r.compliance.sanctions.bank_screened).toBe(false);
  });

  it('still screens the country when no bank is resolved', () => {
    // Pas de BIC, pas d'axe banque : les axes pays et GAFI répondent seuls et
    // rien ne prétend avoir contrôlé une banque. Un IBAN russe garde son verdict
    // de pays sanctionné, quoi que portent les listes d'entités.
    const r = mods().compliance.buildComplianceResult(true, 'RU', null, 'bank', 'high', false);
    expect(r.sanctions.country_sanctioned).toBe(true);
    expect(r.sanctions.bank_screened).toBe(false);
  });
});
