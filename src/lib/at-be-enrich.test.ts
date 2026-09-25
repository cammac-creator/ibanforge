import { afterAll, describe, it, expect, vi } from 'vitest';

/**
 * L'Autriche et la Belgique de bout en bout, sur des registres INVENTÉS.
 *
 * Les deux registres quittent le dépôt public (décision du 24/09/2026 : ni
 * l'OeNB ni la BNB n'ont répondu sur la redistribution), ce fichier ne lit donc
 * plus les lignes livrées. Il installe des registres inventés de la même forme
 * (src/test-support/restricted-fixtures.ts) avant que quoi que ce soit n'ouvre
 * une base, et chaque vérification qui se sautait quand les lignes manquaient
 * tourne désormais, sur toute machine, contre des données que personne ne
 * détient.
 *
 * Chaque IBAN est construit par le mod-97 du jeu d'essai (et, pour la
 * Belgique, avec la clé nationale) et vérifié valide avant toute lecture.
 */
const { fixture, FX } = await vi.hoisted(async () => {
  const m = await import('../test-support/restricted-fixtures.js');
  return { fixture: m.installRestrictedFixture(), FX: m.FIXTURE };
});
afterAll(() => fixture.restore());

const { validateIBAN } = await import('./iban.js');
const { enrichResult } = await import('./enrich.js');
const { nationalRegisterAvailable, lookupNationalCode } = await import('./national-registers.js');

function check(iban: string) {
  const r = validateIBAN(iban);
  expect(r.valid, `${iban} must be a valid IBAN for this test to mean anything`).toBe(true);
  enrichResult(r);
  return r;
}

describe('the registers really are the invented ones', () => {
  it('holds the invented rows and none of the real ones', () => {
    // Si le jeu d'essai cessait de remplacer les vraies lignes, chaque
    // vérification ci-dessous décrirait à nouveau, en silence, les données de
    // production. Celle-ci échoue la première.
    expect(nationalRegisterAvailable('AT')).toBe(true);
    expect(nationalRegisterAvailable('BE')).toBe(true);
    expect(lookupNationalCode('AT', FX.AT.bank.code)?.name).toBe(FX.AT.bank.name);
    // 12000 et 001 sont attribués dans les vrais registres, à personne ici.
    expect(lookupNationalCode('AT', '12000')).toBeNull();
    expect(lookupNationalCode('BE', '001')).toBeNull();
  });
});

describe('Austria answers from the OeNB register', () => {
  it('verifies a bank the register lists', () => {
    const r = check(FX.AT.iban(FX.AT.bank.code));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bank_code_check?.register).toMatch(/Nationalbank/i);
  });

  it('verifies the code the register publishes unpadded', () => {
    // Stocké complété ('00980'), porté complété dans l'IBAN. Sans complément,
    // la banque centrale autrichienne ('100' dans le fichier de l'OeNB) serait
    // refusée.
    const r = check(FX.AT.iban(FX.AT.padded.code));
    expect(r.bank_code_check?.status).toBe('verified');
  });

  it('denies a code the register does not carry, and says stop', () => {
    const r = check(FX.AT.iban(FX.AT.unallocatedCode));
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });
});

describe('Belgium answers from the NBB Protocol register', () => {
  it('verifies a bank the register lists', () => {
    const r = check(FX.BE.iban(FX.BE.bank.code));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bank_code_check?.authoritative).toBe(true);
  });

  it('denies a slot the register does not allocate', () => {
    // La BNB écrit 'VRIJ' dans la colonne BIC d'un numéro libre et le seeder
    // écarte ces lignes : un numéro libre est donc absent ici. Il doit se lire
    // comme un refus, pas comme une banque.
    const r = check(FX.BE.iban(FX.BE.unallocatedCode));
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.authoritative).toBe(true);
    expect(r.bic).toBeNull();
  });

  it('never resolves a BIC for a code its own verdict denies', () => {
    // 23 de nos 781 clés belges annonçaient autrefois une banque sur un numéro
    // que le registre dit libre. 500 est une telle clé de la carte composite :
    // face à un registre qui ne l'attribue pas, la carte ne doit pas répondre
    // non plus.
    for (const iban of [FX.BE.iban(FX.BE.unallocatedCode), FX.BE.iban('500')]) {
      const r = check(iban);
      expect(r.bank_code_check?.status, iban).toBe('not_in_register');
      expect(r.bic, `${iban} resolved a BIC despite not_in_register`).toBeNull();
    }
  });

  it('denies the slot the whole web uses as its example IBAN', () => {
    // BE68539007547034 est l'exemple d'innombrables tutoriels. Le vrai registre
    // écrit 'Onbeschikbaar' (indisponible) pour 539 et le seeder écarte cette
    // ligne : la réponse servie doit être un refus sans établissement. Avant
    // cet écart, elle nommait une banque appelée « Onbeschikbaar ». Le test de
    // cet écart par le seeder lui-même n'existe pas encore (il faudrait un
    // classeur de test pour parseBelgium) : ici, seule la réponse est tenue.
    const r = check('BE68539007547034');
    expect(r.bank_code_check?.status).toBe('not_in_register');
    expect(r.bank_code_check?.institution).toBeUndefined();
  });

  it('serves the Belgian institution name, and only nulls for its address', () => {
    // The NBB file publishes names in four languages and no address at all.
    // Nulls are the honest shape of what Belgium publishes.
    const inst = check(FX.BE.iban(FX.BE.bank.code)).bank_code_check?.institution;
    expect(inst?.name).toBe(FX.BE.bank.name);
    expect(inst?.street).toBeNull();
    expect(inst?.post_code).toBeNull();
    expect(inst?.town).toBeNull();
    expect(inst?.country).toBe('BE');
  });
});

describe('Austria publishes the full seat address, and it is served', () => {
  it('serves street with house number, postal code, town and LEI', () => {
    // Chaque champ que publie l'OeNB, aucun inventé par nous.
    const inst = check(FX.AT.iban(FX.AT.bank.code)).bank_code_check?.institution;
    expect(inst?.name).toBe(FX.AT.bank.name);
    expect(inst?.street).toBe(FX.AT.bank.street);
    expect(inst?.post_code).toBe(FX.AT.bank.post_code);
    expect(inst?.town).toBe(FX.AT.bank.town);
    expect(inst?.country).toBe('AT');
    expect(inst?.lei).toBe(FX.AT.bank.lei);
  });

  it('keeps the register LEI and the directory LEI as separate claims', () => {
    // L'Autriche est le seul pays où les deux sont remplis : l'OeNB nomme le
    // titulaire du code bancaire, GLEIF l'entité derrière le BIC résolu. Ici ils
    // diffèrent exprès : perdre l'un, ou recopier l'un sur l'autre, ne peut pas
    // passer. Qui veut l'autorité sur le code demandé a besoin que la valeur du
    // registre soit toujours là. (Déplacé d'enrich.test.ts le 25/09/2026.)
    const r = check(FX.AT.iban(FX.AT.bank.code));
    expect(r.bank_code_check?.institution?.lei).toBe(FX.AT.bank.lei);
    expect(r.bic?.lei).toBe(FX.directory.at.lei);
  });
});

describe('the four registers keep their separate meanings', () => {
  it('does not claim authority for a country we hold no register for', () => {
    const r = check('FR1499999000010123456789A42');
    expect(r.bank_code_check?.authoritative).toBe(false);
  });
});

/**
 * The register BIC, served and labelled.
 *
 * Both tables have carried a BIC per bank code since they were seeded, and
 * until 29/08/2026 it was read only for the bank-code verdict while the served
 * BIC still came from the composite map: retired pairings served as truth, and
 * an EMI resolving to nothing while its BIC sat in our own database.
 */
describe('the register BIC wins the served pairing', () => {
  it('serves the register BIC under the register label', () => {
    const r = check(FX.BE.iban(FX.BE.bank.code));
    expect(r.bic?.code).toBe(FX.BE.bank.bic);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
    expect(r.bic?.source).toMatch(/Banque nationale de Belgique/);
  });

  it('gives an EMI the BIC the register publishes for it', () => {
    // No curated key, and a numeric bank code means the directory prefix
    // fallback is structurally empty: before the register BIC was served, a
    // Belgian EMI resolved to nothing.
    const r = check(FX.BE.iban(FX.BE.emi.code));
    expect(r.bic?.code).toBe(FX.BE.emi.bic);
    expect(r.bic?.basis).toBe('national_register');
  });

  // La priorité du BIC du registre sur une carte composite qui dit autre chose
  // est tenue dans at-be-register-bic.test.ts : ici, la carte ne porte aucun
  // des codes inventés, elle ne répond jamais.
  it('serves the register BIC for an Austrian code', () => {
    const r = check(FX.AT.iban(FX.AT.bank.code));
    expect(r.bic?.code).toBe(FX.AT.bank.bic);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });

  it('keeps the verdict without inventing a BIC for a row that has none', () => {
    // Allocated (the register names its holder) but published without a BIC,
    // and the composite map has no key for it either. Existence and BIC
    // availability stay separate answers, which is the whole point of the
    // bank_code_check block.
    const r = check(FX.BE.iban(FX.BE.noBic.code));
    expect(r.bank_code_check?.status).toBe('verified');
    expect(r.bic).toBeNull();
  });
});

/**
 * The Austrian branch code is part of the answer, not noise to be trimmed.
 *
 * The OeNB publishes every BIC at 11 characters and most carry a branch code
 * other than XXX. The seeder used to cut them to the 8-character stem, and in
 * the Austrian cooperative networks that stem names the central institution the
 * local bank clears through: a different legal entity, with a different LEI.
 *
 * La paire inventée ci-dessous a cette forme : XMPLATW2MUS est le membre local,
 * XMPLATW2 seul l'institut central.
 */
describe('Austria serves the branch code the OeNB publishes', () => {
  it('serves the local bank BIC, not the central institution stem', () => {
    const r = check(FX.AT.iban(FX.AT.member.code));
    expect(r.bic?.code).toBe(FX.AT.member.bic);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
    // The name beside it is the local bank's, which is exactly what made the
    // truncated answer self-contradicting.
    expect(r.bic?.bank_name).toMatch(/Musterdorf/);
  });

  it('keeps the eleventh character out of the institution stem', () => {
    // Stated separately from the equality above so a future change that
    // reintroduces truncation fails on the reason rather than on a literal.
    const code = check(FX.AT.iban(FX.AT.member.code)).bic?.code;
    expect(code).toHaveLength(11);
    expect(code?.slice(8)).not.toBe('XXX');
    expect(code?.slice(0, 8)).toBe(FX.AT.central.bic!.slice(0, 8));
  });

  it('serves a head office at eleven characters too, ending XXX', () => {
    // The register writes XXX for a head office. Storing what the register
    // publishes means the suffix is served rather than rebuilt.
    const r = check(FX.AT.iban(FX.AT.central.code));
    expect(r.bic?.code).toBe(FX.AT.central.bic);
    expect(r.bic?.basis).toBe('national_register');
    expect(r.bic?.authoritative).toBe(true);
  });

  it('leaves Belgium on the eight characters the NBB publishes', () => {
    // "Store what the source publishes", not "store eleven": Belgium must not
    // grow an invented XXX suffix.
    const r = check(FX.BE.iban(FX.BE.bank.code));
    expect(r.bic?.code).toBe(FX.BE.bank.bic);
    expect(r.bic?.code).toHaveLength(8);
  });
});
