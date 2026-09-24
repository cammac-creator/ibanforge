import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';

/**
 * La page du compte se trouve là où un lecteur, humain ou agent, cherche les
 * routes (lot C3, 25.09.2026) : le `/llms.txt` servi par l'API, le document de
 * découverte `GET /v1`, et les deux `llms` statiques du site, qui ne peuvent
 * rien importer et se relisent donc ici.
 *
 * 🚨 Adresse et routes écrites en littéral : un test qui relirait la constante
 * passerait quelle que soit sa valeur.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const ACCOUNT_URL = 'https://ibanforge.com/account';
const ROUTES = [
  'POST /v1/account/code',
  'POST /v1/account/session',
  'GET /v1/account/overview',
  'GET /v1/account/keys/report',
  'POST /v1/account/logout',
];
const STATIC = ['frontend/public/llms.txt', 'frontend/public/llms-full.txt'];

const app = buildApp();

describe('the API surfaces name the account page and its routes', () => {
  it('/llms.txt lists the five routes and the page, and no longer says "no account"', async () => {
    const text = await (await app.request('/llms.txt')).text();
    for (const route of ROUTES) expect(text, route).toContain(route);
    expect(text).toContain(ACCOUNT_URL);
    expect(text).not.toContain('No account, no password');
    expect(text).not.toContain('ibanforge.com/en/account');
  });

  it('GET /v1 lists them apart from the free routes an agent may try', async () => {
    const body = (await (await app.request('/v1')).json()) as {
      endpoints: { free: string[]; account?: string[] };
    };
    expect(body.endpoints.account).toEqual(ROUTES);
    for (const route of ROUTES) expect(body.endpoints.free).not.toContain(route);
  });
});

describe('the static llms files of the site list them too', () => {
  it.each(STATIC)('%s', (rel) => {
    const text = read(rel);
    // Les deux lignes de connexion et le rapport s'écrivent avec leur méthode ;
    // `keys/report` porte son paramètre, sans lequel la route répond 404.
    for (const route of ROUTES) expect(text, `${rel}: ${route}`).toContain(route.split(' ')[1]);
    expect(text).toContain('/v1/account/keys/report?prefix=');
    expect(text).toContain(ACCOUNT_URL);
    expect(text).not.toContain('ibanforge.com/en/account');
  });
});

describe('no served code points at /en/account any more', () => {
  /** Les fichiers de `src/` qui partent en production (les tests exceptés). */
  function served(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) served(full, out);
      else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name)) out.push(full);
    }
    return out;
  }

  it('src/ carries the root address only', () => {
    const files = served(join(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files
      .filter((f) => readFileSync(f, 'utf8').includes('ibanforge.com/en/account'))
      .map((f) => relative(ROOT, f));
    expect(offenders).toEqual([]);
  });
});

/**
 * La documentation des clés porte sa section « page du compte », en trois
 * langues et avec le même contenu : ce qu'on y voit, comment se connecter, la
 * durée de la session, le repli « coller une clé », et que renouveler ou
 * révoquer demande la clé elle-même.
 */
describe('the key documentation has its account section, in three languages', () => {
  it.each([
    ['en', '## Your account page'],
    ['fr', '## Votre page de compte'],
    ['de', '## Ihre Kontoseite'],
  ])('%s', (lang, heading) => {
    const text = read(`frontend/content/${lang}/docs/api-keys.mdx`);
    const start = text.indexOf(`${heading}\n`);
    expect(start, `${lang}: ${heading}`).toBeGreaterThan(-1);
    const section = text.slice(start, text.indexOf('\n## ', start + 3));
    expect(section).toContain('[ibanforge.com/account](/account)');
    for (const route of ROUTES) expect(section, `${lang}: ${route}`).toContain(route);
    expect(section).toMatch(/\b7 (days|jours|Tage)\b/);
    expect(section).toMatch(/\b15 (minutes|Minuten)\b/);
    expect(section).toContain('POST /v1/keys/rotate');
    expect(section).toContain('POST /v1/keys/revoke');
    expect(section, 'no em or en dash').not.toMatch(/[—–]/);
  });
});
