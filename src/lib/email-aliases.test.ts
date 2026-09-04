import { describe, it, expect, afterAll } from 'vitest';
import { addAlias, listAliases, loadAliasMap, removeAlias, toCanonical } from './email-aliases.js';
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

describe('removeAlias — le chemin du retour', () => {
  const ALIAS = `directory-${RUN}@example.net`;
  const CANON = `prospect-${RUN}@example.com`;
  const IN_ID = `in-${RUN}`;
  const OUT_ID = `out-${RUN}`;
  const OWN_ID = `own-${RUN}`;

  afterAll(() => {
    getStatsDB()
      .prepare(`DELETE FROM email_messages WHERE id IN (?, ?, ?)`)
      .run(IN_ID, OUT_ID, OWN_ID);
  });

  it('rend au fil de l’alias les entrants venus de lui, laisse le reste en place', () => {
    const db = getStatsDB();
    expect(addAlias(ALIAS, CANON)).toEqual({ ok: true });
    const ins = db.prepare(
      `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, counterparty)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    // The nightly re-ingest filed a build notice FROM the alias under the
    // canonical thread…
    ins.run(IN_ID, CANON, 'in', '2026-09-02T04:04', 'Build succeeded', 'notice', ALIAS);
    // …next to a genuine reply from the canonical address and our own mail to it.
    ins.run(OWN_ID, CANON, 'in', '2026-08-20T09:00', 'Re: hello', 'thanks', CANON);
    ins.run(OUT_ID, CANON, 'out', '2026-08-13T19:10', 'hello', 'hi', 'ops@alpha.example.net');

    const res = removeAlias(ALIAS.toUpperCase());
    expect(res).toEqual({ ok: true, canonical: CANON, refiled: 1 });
    expect(loadAliasMap().has(ALIAS)).toBe(false);
    const where = (id: string) =>
      (
        db.prepare('SELECT customer_email FROM email_messages WHERE id = ?').get(id) as {
          customer_email: string;
        }
      ).customer_email;
    expect(where(IN_ID)).toBe(ALIAS);
    expect(where(OWN_ID)).toBe(CANON);
    expect(where(OUT_ID)).toBe(CANON);
  });

  it('dit « alias inconnu » plutôt que d’inventer un retour', () => {
    expect(removeAlias(`nobody-${RUN}@example.net`)).toEqual({
      ok: false,
      reason: 'alias inconnu',
    });
  });
});
