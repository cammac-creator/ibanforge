import { describe, expect, it } from 'vitest';
import { isSenderRuleConfirmed, isUpdateConfirmed } from './update-confirmation';

describe('confirmation d’une modification de message ou de prospect', () => {
  it.each([
    ['réponse absente', undefined], ['réponse nulle', null], ['corps vide', {}],
    ['texte', 'ok'], ['tableau', [{ updated: 1 }]], ['zéro', { updated: 0 }],
    ['nombre négatif', { updated: -1 }], ['fraction', { updated: 0.5 }],
    ['nombre sous forme de texte', { updated: '1' }], ['booléen', { updated: true }],
    ['nombre non défini', { updated: NaN }], ['infini', { updated: Infinity }],
    ['entier imprécis', { updated: Number.MAX_SAFE_INTEGER + 1 }],
    ['champ hérité', Object.create({ updated: 1 })],
  ])('ne confirme pas : %s', (_label, body) => {
    expect(isUpdateConfirmed(body)).toBe(false);
  });
  it.each([1, 2])('accepte %i ligne(s) confirmée(s)', updated => {
    expect(isUpdateConfirmed({ updated })).toBe(true);
  });
});

describe('confirmation d’une règle par expéditeur', () => {
  const address = 'no-reply@exemple.example.net';
  it.each([
    ['réponse absente', null], ['corps vide', {}], ['tableau', [{ address, value: true }]],
    ['autre adresse', { address: 'no-reply@autre.example.net', value: true }],
    ['valeur inverse', { address, value: false }], ['valeur textuelle', { address, value: 'true' }],
    ['valeur manquante', { address }], ['champs hérités', Object.create({ address, value: true })],
  ])('refuse : %s', (_label, body) => {
    expect(isSenderRuleConfirmed(body, address, true)).toBe(false);
  });
  it('accepte l’adresse normalisée selon le contrat du backend', () => {
    expect(isSenderRuleConfirmed({ address, value: true }, '  No-Reply@Exemple.Example.Net  ', true)).toBe(true);
  });
  it('accepte un retrait confirmé sans exiger un compteur de suppressions', () => {
    expect(isSenderRuleConfirmed({ address, value: false }, address, false)).toBe(true);
  });
  it('ne prend pas une ancienne confirmation d’ajout pour un retrait', () => {
    expect(isSenderRuleConfirmed({ address, value: true }, address, false)).toBe(false);
  });
});
