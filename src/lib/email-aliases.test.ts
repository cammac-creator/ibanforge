import { describe, it, expect, afterAll } from 'vitest';
import { addAlias, listAliases, loadAliasMap, toCanonical } from './email-aliases.js';
import { getStatsDB } from './db.js';

const RUN = Date.now();
const A = `alias-${RUN}@example.com`;
const B = `canon-${RUN}@example.com`;
const C = `second-${RUN}@example.com`;

afterAll(() => {
  getStatsDB()
    .prepare(`DELETE FROM email_aliases WHERE alias LIKE ? OR canonical LIKE ?`)
    .run(`%${RUN}@example.com`, `%${RUN}@example.com`);
});

describe('email-aliases — « cette adresse EST ce client »', () => {
  it('enregistre, liste et résout (insensible à la casse)', () => {
    expect(addAlias(A.toUpperCase(), ` ${B} `)).toEqual({ ok: true });
    expect(listAliases().some((r) => r.alias === A && r.canonical === B)).toBe(true);
    const map = loadAliasMap();
    expect(toCanonical(A.toUpperCase(), map)).toBe(B);
    expect(toCanonical(B, map)).toBe(B);
    expect(toCanonical('inconnu@example.net', map)).toBe('inconnu@example.net');
  });

  it('aplatit les chaînes : aliaser vers un alias vise son canonique', () => {
    expect(addAlias(C, A)).toEqual({ ok: true });
    expect(toCanonical(C, loadAliasMap())).toBe(B);
  });

  it('refuse le cycle, l’auto-alias et les adresses invalides', () => {
    expect(addAlias(B, B).ok).toBe(false);
    // A est déjà le canonique de personne, mais B est canonique de A :
    // aliaser B ailleurs casserait la résolution existante.
    expect(addAlias(B, 'x@example.org').ok).toBe(false);
    expect(addAlias('pas-un-email', B).ok).toBe(false);
  });
});
