/**
 * La preuve de domaine d'OpenAI (src/routes/openai-domain.ts) :
 * `GET https://api.ibanforge.com/.well-known/openai-apps-challenge`.
 *
 * Passé par `buildApp()` et non par le routeur seul : ce qui doit être prouvé,
 * c'est que rien plus haut dans l'application (CORS, compression, limiteur,
 * télémétrie, 404 global) ne change la réponse, et que rien de ce qui est monté
 * avant la route ne l'intercepte.
 *
 * Le jeton de ce fichier est entièrement fictif. Le vrai n'existe nulle part
 * dans ce dépôt : il vit dans la variable d'environnement de l'hébergeur.
 *
 * Chaque promesse a son bloc :
 *  1. ABSENTE OU VIDE : 404, jamais une page vide qui ressemblerait à une preuve ;
 *  2. PRÉSENTE : 200, texte brut, le jeton octet pour octet, sans enveloppe ;
 *  3. HEAD annonce la même chose que GET, sans corps ;
 *  4. AUCUNE ÉCRITURE ni autre chemin que le sien ne répond ;
 *  5. RIEN D'AUTRE NE SORT : ni secret voisin, ni jeton dans les journaux ;
 *  6. AUCUN COMPTEUR : la télémétrie ne voit ni le 200 ni le 404.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { getStatsDB } from '../lib/db.js';
import { OPENAI_APPS_CHALLENGE_ENV, OPENAI_APPS_CHALLENGE_PATH } from './openai-domain.js';

/** Un jeton inventé, de la forme que prendrait un vrai : aucune valeur réelle. */
const TOKEN = 'acme-fictif-4f9c0a7d2b6e81135c0d9e7a2b4f6081';
const ADMIN_SECRET = 'acme-fictif-secret-admin-0001';
const STATS_TOKEN = 'acme-fictif-jeton-stats-0002';

const PATH = '/.well-known/openai-apps-challenge';
const SAVED = [OPENAI_APPS_CHALLENGE_ENV, 'ADMIN_SECRET', 'STATS_TOKEN'] as const;

let app: ReturnType<typeof buildApp>;
let saved: Record<string, string | undefined>;

beforeAll(() => {
  app = buildApp();
});

beforeEach(() => {
  saved = Object.fromEntries(SAVED.map((k) => [k, process.env[k]]));
  delete process.env[OPENAI_APPS_CHALLENGE_ENV];
  process.env.ADMIN_SECRET = ADMIN_SECRET;
  process.env.STATS_TOKEN = STATS_TOKEN;
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const k of SAVED) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const setToken = (value: string) => {
  process.env[OPENAI_APPS_CHALLENGE_ENV] = value;
};
const bytesOf = async (res: Response) => Buffer.from(await res.arrayBuffer());
const requestLogRows = (): number =>
  (getStatsDB().prepare('SELECT COUNT(*) AS n FROM request_log').get() as { n: number }).n;

describe('chemin et variable', () => {
  it("l'adresse exportée est celle que le portail d'OpenAI contrôle", () => {
    expect(OPENAI_APPS_CHALLENGE_PATH).toBe(PATH);
    expect(OPENAI_APPS_CHALLENGE_ENV).toBe('OPENAI_APPS_CHALLENGE');
  });
});

describe('variable absente ou vide : 404', () => {
  it('absente : 404, non mis en cache, et rien du jeton', async () => {
    const res = await app.request(PATH);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Le 404 générique de l'API : le même que pour n'importe quelle route inconnue.
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it.each([
    ['chaîne vide', ''],
    ['espaces seuls', '   '],
    ['saut de ligne seul', '\n'],
  ])('%s : 404 aussi, jamais une preuve vide', async (_label, value) => {
    setToken(value);
    const res = await app.request(PATH);
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).not.toMatch(/^text\/plain/);
  });

  it('HEAD, absente : 404 sans corps', async () => {
    const res = await app.request(PATH, { method: 'HEAD' });
    expect(res.status).toBe(404);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect((await bytesOf(res)).length).toBe(0);
  });

  it('POST, absente : 404 comme pour une route inconnue, pas un 405', async () => {
    const res = await app.request(PATH, { method: 'POST', body: '{}' });
    expect(res.status).toBe(404);
    expect(res.headers.get('allow')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('variable présente : 200, le jeton octet pour octet', () => {
  it('GET : 200, text/plain en UTF-8, no-store, exactement le jeton', async () => {
    setToken(TOKEN);
    const res = await app.request(PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const bytes = await bytesOf(res);
    expect(bytes.equals(Buffer.from(TOKEN, 'utf8'))).toBe(true);
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(TOKEN, 'utf8')));
  });

  it('ni enveloppe JSON, ni page, ni saut de ligne final', async () => {
    setToken(TOKEN);
    const text = await (await app.request(PATH)).text();
    expect(text).toBe(TOKEN);
    expect(text.endsWith('\n')).toBe(false);
    expect(() => JSON.parse(text)).toThrow();
    expect(text).not.toMatch(/<[a-z!]/i);
  });

  it('un client qui accepte gzip reçoit quand même les octets bruts', async () => {
    setToken(TOKEN);
    const res = await app.request(PATH, { headers: { 'Accept-Encoding': 'gzip, br' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBeNull();
    expect((await bytesOf(res)).equals(Buffer.from(TOKEN, 'utf8'))).toBe(true);
  });

  it("servi tel que posé : aucune espace ni saut de ligne n'est retiré ou ajouté", async () => {
    const raw = `  ${TOKEN}\n`;
    setToken(raw);
    const res = await app.request(PATH);
    expect(res.status).toBe(200);
    expect((await bytesOf(res)).equals(Buffer.from(raw, 'utf8'))).toBe(true);
  });

  it('la taille annoncée est celle des OCTETS, pas des caractères', async () => {
    const accented = 'jeton-fictif-é-ü-€';
    setToken(accented);
    const res = await app.request(PATH);
    const bytes = await bytesOf(res);
    expect(bytes.length).toBeGreaterThan(accented.length);
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect(bytes.toString('utf8')).toBe(accented);
  });

  it('la variable est lue à chaque requête : posée, changée, retirée', async () => {
    expect((await app.request(PATH)).status).toBe(404);
    setToken(TOKEN);
    expect(await (await app.request(PATH)).text()).toBe(TOKEN);
    setToken('acme-fictif-autre-valeur');
    expect(await (await app.request(PATH)).text()).toBe('acme-fictif-autre-valeur');
    delete process.env[OPENAI_APPS_CHALLENGE_ENV];
    expect((await app.request(PATH)).status).toBe(404);
  });

  it('une requête avec une origine de navigateur reçoit toujours le même corps', async () => {
    setToken(TOKEN);
    const res = await app.request(PATH, { headers: { Origin: 'https://ibanforge.com' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(TOKEN);
  });
});

describe('HEAD annonce ce que GET servirait, sans corps', () => {
  it('200, mêmes en-têtes utiles, même taille, corps vide', async () => {
    setToken(TOKEN);
    const get = await app.request(PATH);
    const head = await app.request(PATH, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('content-type')).toBe(get.headers.get('content-type'));
    expect(head.headers.get('cache-control')).toBe('no-store');
    expect(head.headers.get('content-length')).toBe(get.headers.get('content-length'));
    expect((await bytesOf(head)).length).toBe(0);
  });
});

describe('aucune écriture, aucun autre chemin', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    '%s : 405 avec Allow, jamais un 2xx, jamais le jeton',
    async (method) => {
      setToken(TOKEN);
      const res = await app.request(PATH, { method, body: method === 'DELETE' ? undefined : '{}' });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET, HEAD');
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.text()).not.toContain(TOKEN);
    },
  );

  it.each([
    `${PATH}/`,
    `${PATH}.txt`,
    `${PATH}s`,
    `${PATH}/extra`,
    '/.well-known/openai-apps-challenges',
    '/.well-known/openai-challenge',
    '/openai-apps-challenge',
    '/.well-known/OPENAI-APPS-CHALLENGE',
  ])("%s : 404, le jeton ne sort qu'à son adresse exacte", async (path) => {
    setToken(TOKEN);
    const res = await app.request(path);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain(TOKEN);
  });

  it('un paramètre de requête ne change rien', async () => {
    setToken(TOKEN);
    const res = await app.request(`${PATH}?token=autre&v=1`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(TOKEN);
  });

  it('les voisins de /.well-known répondent toujours, et ne servent pas le jeton', async () => {
    setToken(TOKEN);
    for (const path of [
      '/.well-known/security.txt',
      '/.well-known/x402',
      '/.well-known/agents.json',
    ]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(200);
      expect(await res.text(), path).not.toContain(TOKEN);
    }
  });
});

describe("rien d'autre ne sort", () => {
  it('ni secret voisin dans le corps ou dans un en-tête, ni cookie', async () => {
    setToken(TOKEN);
    const res = await app.request(PATH, {
      headers: { Authorization: `Bearer ${STATS_TOKEN}`, 'X-API-Key': ADMIN_SECRET },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(TOKEN);
    const headerText = [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n');
    expect(headerText).not.toContain(ADMIN_SECRET);
    expect(headerText).not.toContain(STATS_TOKEN);
    expect(headerText).not.toContain(TOKEN);
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('le jeton ne passe jamais dans un journal, un avertissement ou une erreur', async () => {
    setToken(TOKEN);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    for (const init of [{}, { method: 'HEAD' }, { method: 'POST', body: '{}' }]) {
      await (await app.request(PATH, init)).text();
    }
    delete process.env[OPENAI_APPS_CHALLENGE_ENV];
    await (await app.request(PATH)).text();

    // Témoin : l'espion voit bien le journal de requêtes de l'application.
    const logged = spies[0].mock.calls.map((args) => args.join(' '));
    expect(logged.some((line) => line.includes(PATH))).toBe(true);
    for (const spy of spies) {
      for (const args of spy.mock.calls) {
        expect(args.join(' ')).not.toContain(TOKEN);
      }
    }
  });
});

describe('aucun compteur : la télémétrie ne voit rien', () => {
  it('ni le 200, ni le HEAD, ni le 404, ni le refus ne laissent une ligne', async () => {
    const before = requestLogRows();
    setToken(TOKEN);
    await (await app.request(PATH)).text();
    await app.request(PATH, { method: 'HEAD' });
    await app.request(PATH, { method: 'POST', body: '{}' });
    delete process.env[OPENAI_APPS_CHALLENGE_ENV];
    await (await app.request(PATH)).text();
    expect(requestLogRows()).toBe(before);
  });

  it('témoin : un chemin voisin, lui, laisse une ligne (le compteur lit bien ce journal)', async () => {
    const before = requestLogRows();
    await (await app.request('/.well-known/security.txt')).text();
    expect(requestLogRows()).toBe(before + 1);
  });
});
