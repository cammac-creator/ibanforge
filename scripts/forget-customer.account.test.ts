import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { closeAll, getStatsDB } from '../src/lib/db.js';
import { createSession, issueLoginCode, readSession } from '../src/lib/account.js';
import { normalizeEmail } from '../src/lib/email-norm.js';

/**
 * L'outil d'oubli efface aussi le compte client par e-mail (relecture de
 * sécurité du lot C1, point M4) : les sessions de lecture et le code de
 * connexion en cours, par l'adresse NORMALISÉE, qui est l'identité du compte.
 *
 * Le script est lancé pour de vrai, dans un processus à part, contre la base
 * privée de ce fichier (STATS_DB_PATH, posée par test/hermetic-stats.ts). C'est
 * la seule preuve de ce qu'il fait : il s'exécute dès son chargement, et il
 * recopie la normalisation au lieu de l'importer.
 *
 * Fixtures inventées (dépôt public).
 */
const SCRIPT = resolve(__dirname, 'forget-customer.cjs');
const DB_PATH = process.env.STATS_DB_PATH as string;

function forget(email: string, execute = false): string {
  return execFileSync(process.execPath, [SCRIPT, email, ...(execute ? ['--execute'] : [])], {
    env: { ...process.env, STATS_DB_PATH: DB_PATH },
    encoding: 'utf8',
  });
}

function identityOf(output: string): string | undefined {
  return /^Account identity: (.*)$/m.exec(output)?.[1];
}

describe('forget-customer.cjs efface le compte client par e-mail', () => {
  afterAll(() => closeAll());

  it('travaille sur la base qu’on lui donne', () => {
    getStatsDB();
    expect(DB_PATH).toBeTruthy();
    expect(forget('acme@example.com')).toContain(`Database: ${DB_PATH}`);
  });

  it('la normalisation recopiée s’accorde avec src/lib/email-norm.ts', () => {
    for (const raw of [
      'Acme@Example.com',
      'acme+facturation@alpha.example.net',
      'first.last@alpha.example.net',
      'a.c.m.e+x@gmail.com',
      'A.C.M.E@GoogleMail.com',
      '+tag@alpha.example.net',
    ]) {
      expect(identityOf(forget(raw)), raw).toBe(normalizeEmail(raw));
    }
  });

  it('sessions et code en cours de l’adresse normalisée, et rien d’autre', () => {
    const db = getStatsDB();
    const norm = 'acmeops@gmail.com';
    // Deux sessions et un code, ouverts sous des formes différentes de la même boîte.
    const phone = createSession(norm, 'ac.me.ops@gmail.com').token;
    const laptop = createSession(norm, 'acme.ops+work@googlemail.com').token;
    issueLoginCode(norm);
    // Le voisin garde tout.
    const neighbourNorm = 'voisin@alpha.example.net';
    const neighbour = createSession(neighbourNorm, neighbourNorm).token;
    issueLoginCode(neighbourNorm);
    const rows = (table: string, who: string) =>
      (
        db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE email_norm = ?`).get(who) as {
          n: number;
        }
      ).n;

    // Demandé sous une autre forme encore : casse, points, étiquette.
    const request = 'AC.ME.OPS+Oubli@Gmail.com';
    const dry = forget(request);
    expect(dry).toMatch(/account_sessions\s+2 row\(s\)/);
    expect(dry).toMatch(/account_login_codes\s+1 row\(s\)/);
    expect(rows('account_sessions', norm), 'le mode d’essai n’efface rien').toBe(2);

    const done = forget(request, true);
    expect(done).toMatch(/deleted\s+2\s+account_sessions/);
    expect(done).toMatch(/deleted\s+1\s+account_login_codes/);
    expect(rows('account_sessions', norm)).toBe(0);
    expect(rows('account_login_codes', norm)).toBe(0);
    // Une session vivante cesse de lire tout de suite, sans attendre son terme.
    expect(readSession(phone)).toBeNull();
    expect(readSession(laptop)).toBeNull();
    // Le voisin n'a rien perdu.
    expect(readSession(neighbour)?.emailNorm).toBe(neighbourNorm);
    expect(rows('account_login_codes', neighbourNorm)).toBe(1);
  });
});
