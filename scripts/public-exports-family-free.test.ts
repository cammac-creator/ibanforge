/**
 * Les fichiers que ce dépôt exporte pour le site ne portent rien de la famille
 * sous conditions (audit du 10.11.2026, OPS-31#1).
 *
 * `src/lib/public-base-family-free.test.ts` garde les deux bases suivies
 * (`data/bic.sqlite`, `data/compliance.sqlite`). Il ne voyait pas ce que les
 * scripts d'export tirent de l'API en mémoire et commitent sous `frontend/` :
 * `frontend/data/registers/*.json` et `frontend/data/countries.json`
 * (`npm run pages:export`, `npm run pages:export-countries`) et la réponse
 * capturée de l'accueil (`scripts/capture-fold-response.ts`). Lancés avec une
 * surcouche posée, ils auraient recopié dans un fichier public, puis dans
 * l'image publique du site, des lignes que le dépôt ne doit jamais porter.
 *
 * Deux défenses, deux blocs :
 *  - les trois scripts refusent de tourner quand une donnée privée est désignée
 *    (`scripts/public-export-guard.ts`) ;
 *  - les fichiers exportés, lus sur le disque (un robot lance la suite avant de
 *    commiter : un fichier nouveau n'est pas encore suivi), n'ont que la forme
 *    publique : quatre registres, aucun champ SEPA tiré des registres de l'EPC,
 *    aucune source d'annuaire de la famille, aucune réponse exportée pour un pays
 *    que la famille décide.
 *
 * Un nouveau registre public exporté demande d'ajouter son fichier à
 * `PUBLIC_REGISTER_FILES`, et seulement s'il n'est pas de la famille.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  curatedMapCountries,
  restrictedBicSources,
  restrictedRegisterCountries,
} from '../src/lib/restricted-family.js';
import { privateDataVariables } from './public-export-guard.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'frontend', 'data');
const REGISTERS = join(DATA, 'registers');
const COUNTRIES = join(DATA, 'countries.json');

/** Les registres publics que `npm run pages:export` écrit, et rien d'autre (ni AT, ni BE, ni SM). */
const PUBLIC_REGISTER_FILES = ['ch-iid.json', 'de-blz.json', 'it-bank.json', 'sk-bank.json'];

/**
 * Les clés d'un bloc `sepa` exporté. Le grain du pays seulement (membre, schémas
 * du pays, obligation VoP) : `basis`, `vop_participant`, `bank_schemes`,
 * `bank_reachability`, `vop_register_status` et `register_source` ne se lisent
 * que dans les registres de l'EPC (src/lib/enrich.ts). Les pages de registres
 * n'impriment même pas `schemes` (en-tête de scripts/export-register-pages.ts).
 */
const SEPA_KEYS_REGISTERS = ['member', 'vop_required'];
const SEPA_KEYS_COUNTRY = ['member', 'schemes', 'vop_required'];

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

/** Chaque objet rangé sous la clé `key`, où qu'il soit dans `node`. */
function objectsUnder(node: Json, key: string): { [key: string]: Json }[] {
  const found: { [key: string]: Json }[] = [];
  const visit = (n: Json): void => {
    if (Array.isArray(n)) {
      n.forEach(visit);
    } else if (n && typeof n === 'object') {
      for (const [k, v] of Object.entries(n)) {
        if (k === key && v && typeof v === 'object' && !Array.isArray(v)) found.push(v);
        visit(v);
      }
    }
  };
  visit(node);
  return found;
}

function extraKeys(block: { [key: string]: Json }, allowed: string[]): string[] {
  return Object.keys(block).filter((k) => !allowed.includes(k));
}

/**
 * Les noms que l'API donne aux sources d'annuaire de la famille (STEP2, NBP,
 * OeNB), lus dans `SOURCE_NAMES` de src/lib/bic-lookup.ts : c'est ce nom, pas
 * l'identifiant de la base, qu'une réponse porte dans `bic.source`.
 */
function familyBicSourceNames(): string[] {
  const text = readFileSync(join(ROOT, 'src', 'lib', 'bic-lookup.ts'), 'utf8');
  return [...restrictedBicSources()].map((id) => {
    const match = new RegExp(`\\b${id}: '([^']+)'`).exec(text);
    if (!match) throw new Error(`no name for the directory source ${id} in bic-lookup.ts`);
    return match[1];
  });
}

/** Les fichiers exportés, par leur chemin dans le dépôt. */
const EXPORTS = [
  ...PUBLIC_REGISTER_FILES.map((f) => `frontend/data/registers/${f}`),
  'frontend/data/countries.json',
  'frontend/app/[locale]/playground/captured-iban.json',
];

/** Le `source` de chaque bloc `bic` d'un fichier. */
function bicSources(rel: string): string[] {
  return objectsUnder(readJson(join(ROOT, rel)), 'bic')
    .map((b) => b.source)
    .filter((s): s is string => typeof s === 'string');
}

describe('les fichiers exportés pour le site', () => {
  it('frontend/data/registers ne contient que les quatre registres publics', () => {
    expect(readdirSync(REGISTERS).sort()).toEqual(PUBLIC_REGISTER_FILES);
  });

  it.each(PUBLIC_REGISTER_FILES)(
    '%s : aucun bloc sepa ne porte un champ des registres de l’EPC, ni les schémas',
    (file) => {
      const blocks = objectsUnder(readJson(join(REGISTERS, file)), 'sepa');
      const offending = blocks.flatMap((b) => extraKeys(b, SEPA_KEYS_REGISTERS));
      expect([...new Set(offending)]).toEqual([]);
    },
  );

  it.each(EXPORTS.slice(PUBLIC_REGISTER_FILES.length))(
    '%s : les blocs sepa restent au grain du pays',
    (rel) => {
      const blocks = objectsUnder(readJson(join(ROOT, rel)), 'sepa');
      expect(blocks.length).toBeGreaterThan(0);
      const offending = blocks.flatMap((b) => extraKeys(b, SEPA_KEYS_COUNTRY));
      expect([...new Set(offending)]).toEqual([]);
    },
  );

  it.each(EXPORTS)('%s : aucune mention des registres de l’EPC', (rel) => {
    // La mention que l'EPC exige accompagne toute réponse lue dans ses registres.
    expect(readFileSync(join(ROOT, rel), 'utf8')).not.toContain('European Payments Council');
  });

  it('la lecture des sources de BIC voit quelque chose (sinon la garde suivante est aveugle)', () => {
    expect(familyBicSourceNames().length).toBeGreaterThan(0);
    expect(EXPORTS.flatMap(bicSources).length).toBeGreaterThan(0);
  });

  it.each(EXPORTS)('%s : aucun BIC tiré d’une source d’annuaire de la famille', (rel) => {
    const names = familyBicSourceNames();
    expect(bicSources(rel).filter((s) => names.some((n) => s.includes(n)))).toEqual([]);
  });

  it('countries.json : aucune réponse exportée pour un pays que la famille décide', () => {
    const file = readJson(COUNTRIES) as {
      countries: Record<string, { api: Json; private_register?: boolean }>;
    };
    const decidedByFamily = new Set([...restrictedRegisterCountries(), ...curatedMapCountries()]);
    expect(decidedByFamily.size).toBeGreaterThan(0);
    const exported = Object.entries(file.countries)
      .filter(
        ([cc, c]) => (decidedByFamily.has(cc) || c.private_register === true) && c.api !== null,
      )
      .map(([cc]) => cc);
    expect(exported).toEqual([]);
  });
});

describe('les scripts d’export refusent une donnée privée', () => {
  it('reconnaît la surcouche et les registres privés, et seulement posés', () => {
    expect(privateDataVariables({})).toEqual([]);
    expect(privateDataVariables({ RESTRICTED_BIC_OVERLAY_PATH: '' })).toEqual([]);
    expect(
      privateDataVariables({
        RESTRICTED_BIC_OVERLAY_PATH: '/x/a.sqlite',
        RESTRICTED_COMPLIANCE_OVERLAY_PATH: '/x/b.sqlite',
        GR_REGISTER_PATH: '/x/gr.json',
        BIC_DB_PATH: '/x/bic.sqlite',
        STATS_DB_PATH: '/x/stats.sqlite',
      }),
    ).toEqual([
      'GR_REGISTER_PATH',
      'RESTRICTED_BIC_OVERLAY_PATH',
      'RESTRICTED_COMPLIANCE_OVERLAY_PATH',
    ]);
  });

  const dir = mkdtempSync(join(tmpdir(), 'ibf-export-guard-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it.each([
    ['export-register-pages', 'scripts/export-register-pages.ts'],
    ['export-country-pages', 'scripts/export-country-pages.ts'],
    ['capture-fold-response', 'scripts/capture-fold-response.ts'],
  ])(
    '%s sort en erreur, avant toute lecture, quand RESTRICTED_BIC_OVERLAY_PATH est posée',
    (name, script) => {
      const run = spawnSync('npx', ['tsx', script], {
        cwd: ROOT,
        env: {
          ...process.env,
          RESTRICTED_BIC_OVERLAY_PATH: join(dir, 'restricted-bic.sqlite'),
          // Si la garde venait à manquer, le script mourrait en ouvrant la base
          // au lieu de réécrire frontend/ pendant la suite.
          BIC_DB_PATH: join(dir, 'absent-bic.sqlite'),
          STATS_DB_PATH: join(dir, 'stats.sqlite'),
        },
        encoding: 'utf8',
        timeout: 60_000,
      });
      const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;
      expect(run.status, run.error?.message ?? out).toBe(1);
      expect(run.stderr).toContain(`${name}: refused, RESTRICTED_BIC_OVERLAY_PATH is set`);
      // Le nom seulement, jamais la valeur.
      expect(out).not.toContain(dir);
    },
    90_000,
  );
});
