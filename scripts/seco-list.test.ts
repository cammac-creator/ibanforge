import { describe, expect, it } from 'vitest';
import { decodeXmlText, parseSecoWholeList, swiftCodesIn } from './seco-list.js';

/**
 * Le lecteur de la liste SECO complète, sur des cibles inventées qui
 * reproduisent chacun des pièges relevés le 07.10.2026 dans la vraie liste
 * (voir l'en-tête de seco-list.ts). Les codes sont inventés, les tournures sont
 * celles de la liste.
 */

const listed = (date = '2022-02-28') =>
  `<modification modification-type="listed" enactment-date="${date}" publication-date="${date}" effective-date="${date}"/>`;

function entity(ssid: string, name: string, infos: string[], mods: string): string {
  return (
    `<target ssid="${ssid}"><sanctions-set-id>1</sanctions-set-id><entity>` +
    `<identity ssid="${ssid}1" main="true"><name ssid="${ssid}2" name-type="primary-name" quality="good" lang="eng">` +
    `<name-part order="1" name-part-type="whole-name"><value>${name}</value></name-part></name></identity>` +
    infos
      .map((t, i) => `<other-information ssid="${ssid}${i + 3}">${t}</other-information>`)
      .join('') +
    `</entity>${mods}</target>`
  );
}

function wholeList(targets: string[], type = 'whole-list'): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<swiss-sanctions-list list-type="${type}" date="2026-09-28">` +
    `<sanctions-program ssid="1" version-date="2026-05-21"><program-key lang="eng">Test</program-key></sanctions-program>` +
    targets.join('') +
    `<place ssid="9"><location>Nowhere</location></place></swiss-sanctions-list>`
  );
}

const FIXTURE = wholeList([
  // « SWIFT/BIC code: … and <un numéro> » : manqué par l'ancienne extraction.
  entity('1', 'Alpha Bank Co Ltd', ['SWIFT/BIC code: ALFASDKH and 5040942458'], listed()),
  // Plusieurs codes dans un champ, dont une succursale : deux établissements.
  entity(
    '2',
    'Beta Commercial Trust Bankers Ltd.',
    [
      'SWIFT codes: BETAIRTHKSH (Kish Island branch), GAMAAEA1 (Dubai branch), BETAIRTH (Tehran branch)',
      'Tel: 0000000000 (Kish Island branch)',
    ],
    listed(),
  ),
  // Radiée : la modification la plus récente est la radiation.
  entity(
    '3',
    'Epsilon Bank of Syria',
    ['SWIFT/BIC: EPSISYDA, all offices worldwide [NPWMD].'],
    `<modification modification-type="de-listed" enactment-date="2025-06-20" effective-date="2025-06-20"/>${listed('2016-01-19')}`,
  ),
  // Le mot « Swift » dans un NOM d'entreprise n'est jamais un code.
  entity('4', 'Swift Investments (PVT) Ltd', ['Type of entity: company'], listed()),
  // Un code qui n'existe plus que dans l'histoire (bloc <removed>) ne compte pas.
  entity(
    '5',
    'Delta Credit Bank',
    ['SWIFT: DELTKPPY.'],
    `<modification modification-type="amended" effective-date="2025-04-15"><added><target ssid="5"><entity><other-information ssid="58">SWIFT: DELTKPPY.</other-information></entity></target></added>` +
      `<removed><target ssid="5"><entity><other-information ssid="57">SWIFT: OLDXKPPY</other-information></entity></target></removed></modification>${listed('2016-12-01')}`,
  ),
  // Le document écrit une modification du 03.06 AVANT une radiation du 20.06 : la date l'emporte.
  entity(
    '6',
    'Eta State Bank',
    ['SWIFT/BIC: ETAXSYDA'],
    `<modification modification-type="amended" effective-date="2025-06-03"/><modification modification-type="de-listed" effective-date="2025-06-20"/>${listed('2014-12-17')}`,
  ),
  // Le code au milieu d'un champ de coordonnées : seul le code est lu.
  entity(
    '7',
    'Zeta Agricultural Bank',
    ['Email Address agbank@example.org; SWIFT/BIC ZETALYLT (Libya); Tel No. (218) 21 000 0000'],
    listed(),
  ),
  // Une personne n'est jamais une banque, même si un champ cite un code.
  `<target ssid="8"><sanctions-set-id>1</sanctions-set-id><individual><identity ssid="81" main="true"><name><name-part order="1"><value>Person Theta</value></name-part></name></identity>` +
    `<other-information ssid="82">SWIFT: THETKPPY</other-information></individual>${listed()}</target>`,
  // Entités XML dans le nom.
  entity('9', 'Iota &amp; Kappa Bank', ['Swift: IOTAIRTH'], listed()),
]);

describe('parseSecoWholeList', () => {
  const list = parseSecoWholeList(FIXTURE);

  it('lit la date et compte les cibles, radiées à part', () => {
    expect(list.listDate).toBe('2026-09-28');
    expect(list.targets).toBe(9);
    // Radiées : Epsilon (3) et Eta (6).
    expect(list.listedTargets).toBe(7);
  });

  it('ne garde que les banques en vigueur désignées par un code SWIFT', () => {
    expect(list.banks.map((b) => b.bic8)).toEqual([
      'ALFASDKH',
      'BETAIRTH',
      'GAMAAEA1',
      'DELTKPPY',
      'ZETALYLT',
      'IOTAIRTH',
    ]);
  });

  it("n'accuse ni une banque radiée, ni un nom d'entreprise, ni l'histoire, ni une personne", () => {
    const bics = list.banks.map((b) => b.bic8);
    expect(bics).not.toContain('EPSISYDA'); // radiée
    expect(bics).not.toContain('ETAXSYDA'); // radiée, modifications dans le désordre
    expect(bics).not.toContain('INVESTME'); // « Swift Investments »
    expect(bics).not.toContain('OLDXKPPY'); // seulement dans <removed>
    expect(bics).not.toContain('THETKPPY'); // une personne
  });

  it('nomme chaque banque comme la liste, entités décodées', () => {
    expect(list.banks.find((b) => b.bic8 === 'IOTAIRTH')).toEqual({
      bic8: 'IOTAIRTH',
      name: 'Iota & Kappa Bank',
      ssid: '9',
    });
    expect(list.banks.find((b) => b.bic8 === 'GAMAAEA1')?.name).toBe(
      'Beta Commercial Trust Bankers Ltd.',
    );
  });

  it('refuse un document qui n’est pas la liste complète', () => {
    expect(() => parseSecoWholeList('<html><body>Erreur 500</body></html>')).toThrow(
      /not a SECO sanctions list/,
    );
    expect(() => parseSecoWholeList(wholeList([], 'delta-list'))).toThrow(
      /expected the whole list/,
    );
  });

  it('refuse un fichier coupé au milieu d’une cible', () => {
    const cut = FIXTURE.slice(0, FIXTURE.indexOf('Zeta Agricultural Bank'));
    expect(() => parseSecoWholeList(cut)).toThrow(/truncated/);
  });
});

describe('swiftCodesIn', () => {
  it('lit les tournures de la liste', () => {
    expect(swiftCodesIn('SWIFT: DELTKPPY')).toEqual(['DELTKPPY']);
    expect(swiftCodesIn('SWIFT/BIC: DELTKPPY.')).toEqual(['DELTKPPY']);
    expect(swiftCodesIn('Swift: IOTAIRTH')).toEqual(['IOTAIRTH']);
    expect(swiftCodesIn('SWIFT/BIC code: ALFASDKH and 5040942458')).toEqual(['ALFASDKH']);
    expect(swiftCodesIn('SWIFT/BIC: EPSISYDA, all offices worldwide [NPWMD].')).toEqual([
      'EPSISYDA',
    ]);
  });

  it('ne recolle pas un code coupé et ne lit pas un mot', () => {
    expect(swiftCodesIn('SWIFT: REF AIRTH')).toEqual([]);
    expect(swiftCodesIn('Swift Investments (PVT) Ltd')).toEqual([]);
    expect(swiftCodesIn('SWIFT/BIC: see BRANCHES below')).toEqual([]);
    expect(swiftCodesIn('Website: https://example.org')).toEqual([]);
  });
});

describe('decodeXmlText', () => {
  it('décode les entités nommées et numériques', () => {
    expect(decodeXmlText('A &amp; B &lt;C&gt; &#233;&#xE9; &quot;x&apos;')).toBe(
      `A & B <C> éé "x'`,
    );
    expect(decodeXmlText('&unknown;')).toBe('&unknown;');
  });
});
