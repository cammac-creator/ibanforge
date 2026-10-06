import { describe, expect, it } from 'vitest';
import { DE_METHODS } from './methods.js';
import { DE_OFFICIAL_VECTORS } from './vectors.js';
import { DE_VERIFIED_METHODS } from './verified.js';

/**
 * Les méthodes allemandes contre les numéros de test publiés par la
 * Bundesbank (« Prüfzifferberechnungsmethoden », Stand: Juni 2018).
 *
 * Ce fichier tient la règle de verified.ts : une méthode servie a au moins un
 * numéro officiel, et elle les passe TOUS. Les numéros sont ceux du document,
 * jamais des numéros calculés par ce code ou par une autre bibliothèque.
 */

/** Un code banque neutre pour les méthodes qui ne le lisent pas. */
const ANY_BLZ = '10000000';

const pad = (n: string) => n.padStart(10, '0');

describe('every official Bundesbank test number gives the expected verdict', () => {
  for (const [method, sets] of Object.entries(DE_OFFICIAL_VECTORS)) {
    describe(`method ${method}`, () => {
      it('is implemented', () => {
        expect(DE_METHODS[method], method).toBeTypeOf('function');
      });
      for (const set of sets) {
        const blz = set.blz ?? ANY_BLZ;
        for (const n of set.pass ?? []) {
          it(`${n} passes (${set.kind}, page ${set.page})`, () => {
            expect(DE_METHODS[method](pad(n), blz)).toBe('pass');
          });
        }
        for (const n of set.fail ?? []) {
          it(`${n} fails (${set.kind}, page ${set.page})`, () => {
            expect(DE_METHODS[method](pad(n), blz)).toBe('fail');
          });
        }
        for (const n of set.noCheck ?? []) {
          it(`${n} has no check digit (${set.kind}, page ${set.page})`, () => {
            expect(DE_METHODS[method](pad(n), blz)).toBe('no_check');
          });
        }
      }
    });
  }
});

describe('the verified list', () => {
  it('names only implemented methods that carry official numbers', () => {
    for (const method of DE_VERIFIED_METHODS) {
      expect(DE_METHODS[method], method).toBeTypeOf('function');
      const sets = DE_OFFICIAL_VECTORS[method] ?? [];
      const count = sets.reduce(
        (n, s) => n + (s.pass?.length ?? 0) + (s.fail?.length ?? 0) + (s.noCheck?.length ?? 0),
        0,
      );
      // « Zéro cas » ne vaut pas « tous les cas ».
      expect(count, `${method} has no official number`).toBeGreaterThan(0);
    }
  });

  it('does not list method 09, which is the absence of a method', () => {
    expect(DE_VERIFIED_METHODS.has('09')).toBe(false);
  });

  it('every official number is ten digits or fewer, digits only', () => {
    for (const [method, sets] of Object.entries(DE_OFFICIAL_VECTORS)) {
      for (const s of sets) {
        for (const n of [...(s.pass ?? []), ...(s.fail ?? []), ...(s.noCheck ?? [])]) {
          expect(n, method).toMatch(/^\d{1,10}$/);
        }
        if (s.blz) expect(s.blz, method).toMatch(/^\d{8}$/);
      }
    }
  });
});

describe('every method answers on every ten-digit number without throwing', () => {
  // Générateur à graine fixe : un échec se rejoue à l'identique.
  let seed = 20261006;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const samples = Array.from({ length: 400 }, (_, i) => {
    const len = 1 + (i % 10);
    let s = '';
    for (let k = 0; k < len; k++) s += String(Math.floor(rnd() * 10));
    return pad(s);
  });

  it.each(Object.keys(DE_METHODS).sort())('method %s', (method) => {
    for (const a of samples) {
      expect(['pass', 'fail', 'no_check'], `${method} ${a}`).toContain(
        DE_METHODS[method](a, ANY_BLZ),
      );
    }
  });
});
