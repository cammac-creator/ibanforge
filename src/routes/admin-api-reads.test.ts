import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  API_READS_SQL,
  clientFamily,
  pathFamily,
  registerApiReadsFunctions,
  statusClass,
  type ApiReads,
} from '../lib/api-reads.js';

/**
 * La route du comptage, montée dans l'application réelle. Base synthétique, secret factice,
 * valeurs inventées (ce dépôt est public), écrites en SQL brut pour échapper à la
 * normalisation : c'est ce qu'une ligne ancienne pourrait contenir qui est testé.
 */
const SECRET = 'secret-factice-du-comptage';
const INVENTED_IBAN = 'CH0000000000000000001';
const INVENTED_PREFIX = 'ifk_inventee1';
const INVENTED_HASH = 'aaaabbbbccccdddd';
const INVENTED_AGENT = `AlphaAgent/1.0 (${INVENTED_IBAN})`;

let ip = 0;
const headers = (secret?: string): Record<string, string> => {
  ip += 1;
  return {
    'x-forwarded-for': `198.51.100.${ip}`,
    ...(secret ? { 'X-Admin-Secret': secret } : {}),
  };
};

function insert(p: {
  path: string;
  at: string;
  method?: string;
  status?: number;
  agent?: string | null;
  key?: string | null;
}): void {
  getStatsDB()
    .prepare(
      `INSERT INTO request_log (method, path, status, created_at, user_agent, key_prefix, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      p.method ?? 'GET',
      p.path,
      p.status ?? 200,
      p.at,
      p.agent ?? null,
      p.key ?? null,
      INVENTED_HASH,
    );
}

describe('GET /v1/admin/api-reads', () => {
  const previous = process.env.ADMIN_SECRET;
  const app = buildApp();
  const url = (query: string) => `/v1/admin/api-reads${query}`;
  const WINDOW = '?from=2031-03-03T10:00:00Z&to=2031-03-03T11:00:00Z';

  beforeAll(() => {
    process.env.ADMIN_SECRET = SECRET;
    const at = '2031-03-03 10:30:00';
    const chatgpt = 'Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0';
    insert({ path: '/v1/iban/validate', at, method: 'POST', agent: chatgpt });
    insert({ path: '/v1/iban/validate', at, method: 'POST', agent: chatgpt });
    insert({ path: '/v1/iban/validate', at, method: 'POST', agent: chatgpt, status: 402 });
    insert({ path: '/v1/iban/batch', at, method: 'POST', key: INVENTED_PREFIX, agent: 'curl/8.0' });
    insert({ path: '/v1/bic/:code', at, agent: 'Perplexity-User/1.0' });
    insert({ path: '/v1/demo', at, agent: 'Mozilla/5.0 (compatible; Googlebot/2.1)' });
    insert({ path: '/v1/demo/DE', at, agent: 'Mozilla/5.0 (Macintosh)' });
    insert({ path: '/v1/demo/:other', at, agent: 'Mozilla/5.0 (Macintosh)' });
    insert({ path: '/llms.txt', at, agent: null });
    insert({ path: '/openapi.json', at, agent: '' });
    insert({ path: '/v1', at, agent: 'AlphaAgent/1.0' });
    insert({ path: '/mcp:tools-call', at, method: 'POST', agent: 'AlphaAgent/1.0' });
    // Les valeurs qui ne doivent jamais ressortir.
    insert({ path: `/${INVENTED_IBAN}`, at, agent: INVENTED_AGENT, key: INVENTED_PREFIX });
    insert({ path: `/v1/demo/${INVENTED_IBAN}`, at, agent: INVENTED_AGENT });
    // Hors fenêtre, de chaque côté, et sur les bornes.
    insert({ path: '/v1', at: '2031-03-03 09:59:59' });
    insert({ path: '/v1', at: '2031-03-03 11:00:00' });
    insert({ path: '/llms.txt', at: '2031-03-03 10:00:00' });
  });

  afterAll(() => {
    if (previous === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = previous;
    closeAll();
  });

  it('refuse sans secret et avec un mauvais secret, sans cache, avant de regarder la fenêtre', async () => {
    for (const init of [{ headers: headers() }, { headers: headers('mauvais-secret') }]) {
      const res = await app.request(url(''), init);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it.each([
    ['absente', ''],
    ['sans fin', '?from=2031-03-03T10:00:00Z'],
    ['sans début', '?to=2031-03-03T10:00:00Z'],
    ['mal formée', '?from=hier&to=aujourdhui'],
    ['date seule', '?from=2031-03-03&to=2031-03-04'],
    ['date impossible', '?from=2031-02-31T10:00:00Z&to=2031-03-01T10:00:00Z'],
    ['heure impossible', '?from=2031-03-03T25:00:00Z&to=2031-03-04T10:00:00Z'],
    ['autre fuseau', '?from=2031-03-03T10:00:00%2B02:00&to=2031-03-04T10:00:00Z'],
    ['injection', "?from=2031-03-03T10:00:00Z'%20OR%201=1&to=2031-03-04T10:00:00Z"],
    ['inversée', '?from=2031-03-04T10:00:00Z&to=2031-03-03T10:00:00Z'],
    ['vide', '?from=2031-03-03T10:00:00Z&to=2031-03-03T10:00:00Z'],
  ])('refuse une fenêtre %s sans recopier ce qu’elle a reçu', async (_name, query) => {
    const res = await app.request(url(query), { headers: headers(SECRET) });
    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.json()).toEqual({ error: 'invalid_window' });
  });

  it('accepte sept jours pile et refuse une seconde de plus', async () => {
    const ok = await app.request(url('?from=2031-03-01T00:00:00Z&to=2031-03-08T00:00:00Z'), {
      headers: headers(SECRET),
    });
    expect(ok.status).toBe(200);
    const long = await app.request(url('?from=2031-03-01T00:00:00Z&to=2031-03-08T00:00:01Z'), {
      headers: headers(SECRET),
    });
    expect(long.status).toBe(400);
    expect(await long.json()).toEqual({ error: 'window_too_long' });
  });

  it('compte en familles, début inclus et fin exclue, et le total vaut la somme', async () => {
    const res = await app.request(url(WINDOW), { headers: headers(SECRET) });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const body = (await res.json()) as ApiReads;
    expect(body.window).toEqual({ from: '2031-03-03 10:00:00', to: '2031-03-03 11:00:00' });
    // 14 lignes à 10:30, et celle posée sur la borne de début.
    expect(body.total).toBe(15);
    expect(body.rows.reduce((sum, r) => sum + r.count, 0)).toBe(15);
    const count = (family: string): number =>
      body.rows.filter((r) => r.path_family === family).reduce((sum, r) => sum + r.count, 0);
    expect(count('validation')).toBe(3);
    expect(count('lot')).toBe(1);
    expect(count('bic')).toBe(1);
    expect(count('demonstration')).toBe(1);
    expect(count('demonstration_pays')).toBe(3);
    expect(count('llms')).toBe(2);
    expect(count('openapi')).toBe(1);
    expect(count('racine_v1')).toBe(1);
    expect(count('mcp')).toBe(1);
    expect(count('autre')).toBe(1);
    expect(body.rows).toContainEqual({
      path_family: 'validation',
      method: 'POST',
      status_class: '2xx',
      with_key: false,
      client_family: 'chatgpt',
      count: 2,
    });
    expect(body.rows).toContainEqual({
      path_family: 'validation',
      method: 'POST',
      status_class: '4xx',
      with_key: false,
      client_family: 'chatgpt',
      count: 1,
    });
    expect(body.rows).toContainEqual({
      path_family: 'lot',
      method: 'POST',
      status_class: '2xx',
      with_key: true,
      client_family: 'curl',
      count: 1,
    });
  });

  it('ne laisse sortir ni IBAN, ni chemin, ni agent, ni préfixe, ni empreinte', async () => {
    const res = await app.request(url(WINDOW), { headers: headers(SECRET) });
    const text = await res.text();
    for (const secret of [
      INVENTED_IBAN,
      INVENTED_PREFIX,
      INVENTED_HASH,
      'AlphaAgent',
      'ChatGPT-User',
      '/v1/',
      '/mcp',
      ':other',
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it('lit la fenêtre par l’index de la date, sans parcourir l’historique', () => {
    const db = getStatsDB();
    registerApiReadsFunctions(db);
    const plan = db
      .prepare(`EXPLAIN QUERY PLAN ${API_READS_SQL}`)
      .all('2031-03-03 10:00:00', '2031-03-03 11:00:00') as Array<{ detail: string }>;
    const details = plan.map((r) => r.detail).join(' | ');
    expect(details).toContain('SEARCH request_log USING INDEX idx_request_log_date');
    expect(details).not.toContain('SCAN request_log');
  });
});

describe('les listes fermées', () => {
  it.each([
    ['/v1/iban/validate', 'validation'],
    ['/v1/iban/batch', 'lot'],
    ['/v1/bic/:code', 'bic'],
    ['/v1/demo', 'demonstration'],
    ['/v1/demo/DE', 'demonstration_pays'],
    ['/v1/demo/:other', 'demonstration_pays'],
    ['/v1/demo/:redacted', 'demonstration_pays'],
    ['/llms.txt', 'llms'],
    ['/openapi.json', 'openapi'],
    ['/v1', 'racine_v1'],
    ['/mcp', 'mcp'],
    ['/mcp/chatgpt', 'mcp'],
    ['/mcp:tools-call:refused', 'mcp'],
    ['/mcpfoo', 'autre'],
    ['/v1/demonstration', 'autre'],
    ['/v1/iban/format', 'autre'],
    [null, 'autre'],
  ])('le chemin %s va dans %s', (path, family) => {
    expect(pathFamily(path)).toBe(family);
  });

  it.each([
    ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)', 'chatgpt'],
    ['Mozilla/5.0 (compatible; GPTBot/1.1; +https://openai.com/gptbot)', 'chatgpt'],
    ['Mozilla/5.0 (compatible; Perplexity-User/1.0)', 'perplexity'],
    ['Mozilla/5.0 (compatible; Google-Extended)', 'google'],
    ['curl/8.0.1', 'curl'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', 'navigateur'],
    [null, 'aucun'],
    ['', 'aucun'],
    ['   ', 'aucun'],
    ['AlphaAgent/1.0', 'autre'],
  ])('l’agent %s va dans %s', (agent, family) => {
    expect(clientFamily(agent)).toBe(family);
  });

  it.each([
    [200, '2xx'],
    [302, '3xx'],
    [429, '4xx'],
    [503, '5xx'],
    [101, 'autre'],
    [null, 'autre'],
  ])('le code %s va dans %s', (status, family) => {
    expect(statusClass(status)).toBe(family);
  });
});
