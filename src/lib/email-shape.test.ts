import { describe, expect, it } from 'vitest';
import { isPlainEmail } from './email-shape.js';

describe('isPlainEmail', () => {
  it.each([
    'acme@example.com',
    'first.last+tag@mail.alpha.example.net',
    "o'brien@alpha.example.net",
    'ACME@EXAMPLE.COM',
    'a_b-c@xn--bcher-kva.example',
    'owner-1727200000000@alpha-corp.example.net',
  ])('accepte une adresse simple : %s', (address) => {
    expect(isPlainEmail(address)).toBe(true);
  });

  it.each([
    // Deux adresses, quelle que soit la façon de les coller.
    'acme+x,autre@example.com',
    'acme@example.com,autre@example.com',
    'acme@example.com, autre@example.com',
    'acme@example.com;autre@example.com',
    'acme@example.com autre@example.com',
    'acme@example.com\nautre@example.com',
    'acme@example.com\r\nBcc: autre@example.com',
    // Un nom affiché ou des guillemets : l'en-tête les lirait autrement.
    'Acme <acme@example.com>',
    '"acme,autre"@example.com',
    '<acme@example.com>',
    // Les formes déjà refusées avant, qui doivent le rester.
    'pasuneadresse',
    'acme@',
    '@example.com',
    'acme@example',
    'acme@example.c',
    'acme@@example.com',
    'a@b@example.com',
    ' acme@example.com',
    'acme@example.com ',
    // Points et tirets hors des places permises.
    '.acme@example.com',
    'acme.@example.com',
    'ac..me@example.com',
    'acme@-example.com',
    'acme@example-.com',
    'acme@example..com',
    // Longueurs : 64 caractères de partie locale, 254 en tout.
    `${'a'.repeat(65)}@example.com`,
    `acme@${'a'.repeat(250)}.com`,
  ])('refuse : %j', (address) => {
    expect(isPlainEmail(address)).toBe(false);
  });

  it('accepte les longueurs maximales exactes', () => {
    expect(isPlainEmail(`${'a'.repeat(64)}@example.com`)).toBe(true);
    const label = 'a'.repeat(63);
    const address = `acme@${label}.${label}.${label}.${'b'.repeat(53)}.com`;
    expect(address.length).toBe(254);
    expect(isPlainEmail(address)).toBe(true);
  });
});
