import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type DatabaseType from 'better-sqlite3';
import { memberPredicate, membersOf, type OverlayKind } from './restricted-family.js';

/**
 * Les bases de ce dépôt ne portent aucune ligne de la famille sous conditions.
 *
 * ## Pourquoi ce fichier existe
 *
 * Depuis l'étape du retrait (25/09/2026), la famille (src/lib/restricted-family.ts :
 * STEP2, OeNB, NBP, registres AT, BE et SM, liste PRA, liste de l'ONU, registres
 * EPC) n'est plus servie que depuis la surcouche privée. Ce dépôt est public : une
 * ligne de la famille commitée dans `data/` serait exactement la redistribution
 * que ce montage évite, et l'historique ne se réécrit pas.
 *
 * Les robots publics lancent ce fichier avant de commiter la base qu'ils ont
 * rafraîchie : la suite entière pour refresh-bic.yml et les relectures tchèque et
 * italienne, et ce fichier nommément pour refresh-compliance.yml. Un seeder qui
 * se remettrait à écrire la famille dans `data/` (une variable oubliée, un mode
 * par défaut changé) rougit ici, avant le commit, au lieu d'être découvert
 * après coup dans un dépôt public.
 *
 * Lit la base que l'API ouvrirait (BIC_DB_PATH, COMPLIANCE_DB_PATH, sinon `data/`),
 * en lecture seule. Compte, n'affiche jamais une ligne.
 */

const require = createRequire(import.meta.url);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const PATHS: Record<OverlayKind, string> = {
  bic: process.env.BIC_DB_PATH ?? join(ROOT, 'data/bic.sqlite'),
  compliance: process.env.COMPLIANCE_DB_PATH ?? join(ROOT, 'data/compliance.sqlite'),
};

function open(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path, { readonly: true, fileMustExist: true });
}

function tableExists(db: DatabaseType.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

describe.each(['bic', 'compliance'] as const)('la base %s de ce dépôt', (kind) => {
  it.each(membersOf(kind).map((m) => [m.id, m] as const))(
    'ne porte aucune ligne du membre %s',
    (_id, member) => {
      expect(existsSync(PATHS[kind]), PATHS[kind]).toBe(true);
      const db = open(PATHS[kind]);
      try {
        // Une table absente ne porte rien : c'est une forme permise de la base
        // publique (la fusion de la surcouche la recrée depuis la constante).
        if (!tableExists(db, member.table)) return;
        const predicate = memberPredicate(member);
        const { n } = db
          .prepare(`SELECT COUNT(*) AS n FROM "${member.table}" WHERE ${predicate.sql}`)
          .get(...predicate.params) as { n: number };
        expect(n, `${member.id} : lignes de la famille dans la base publique`).toBe(0);
      } finally {
        db.close();
      }
    },
  );
});

describe('la conformité de ce dépôt ne nomme pas une liste qu’elle ne porte pas', () => {
  it('sa clé `sources` ne cite ni l’ONU ni un registre EPC', () => {
    // `metadata.sources` est recalculée depuis les tables à chaque
    // rafraîchissement (scripts/refresh-compliance.ts) : sans la famille, elle ne
    // peut nommer que les listes publiques et le GAFI.
    const db = open(PATHS.compliance);
    try {
      const row = db.prepare("SELECT value FROM metadata WHERE key = 'sources'").get() as
        { value: string } | undefined;
      const sources = (row?.value ?? '').split(',');
      expect(sources).not.toContain('UN');
      expect(sources.filter((s) => s.startsWith('EPC-'))).toEqual([]);
    } finally {
      db.close();
    }
  });
});
