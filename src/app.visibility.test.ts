import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { closeAll } from './lib/db.js';

let app: ReturnType<typeof buildApp>;
const headers = { 'x-real-ip': '192.0.2.43' };

beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('X402_ENABLED', 'false');
  app = buildApp();
});

afterAll(() => {
  closeAll();
  vi.unstubAllEnvs();
});

describe('API landing indexing and catalogue discovery', () => {
  it.each(['GET', 'HEAD'])('advertises the catalogue and noindex on %s /', async (method) => {
    const res = await app.request('/', { method, headers });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('x-robots-tag')).toBe('noindex, follow');
    expect(res.headers.get('link')).toBe(
      '<https://api.ibanforge.com/.well-known/api-catalog>; rel="api-catalog"',
    );
    const body = await res.text();
    if (method === 'HEAD') {
      expect(body).toBe('');
    } else {
      expect(body).toMatch(/<meta\s+name="robots"\s+content="noindex, follow"/);
    }
  });

  it.each([
    ['/llms.txt', 'text/plain'],
    ['/openapi.json', 'application/json'],
    ['/.well-known/api-catalog', 'application/linkset+json'],
    ['/.well-known/agents.json', 'application/json'],
    ['/v1', 'application/json'],
  ])('keeps GET and HEAD %s free of the landing headers', async (path, contentType) => {
    for (const method of ['GET', 'HEAD']) {
      const res = await app.request(path, { method, headers });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain(contentType);
      expect(res.headers.get('x-robots-tag')).toBeNull();
      expect(res.headers.get('link')).toBeNull();
    }
  });

  it('links to the existing catalogue with the OpenAPI description', async () => {
    const root = await app.request('/', { headers });
    const catalogueUrl = root.headers.get('link')!.match(/^<([^>]+)>/)![1];
    const res = await app.request(catalogueUrl, { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/linkset+json');
    expect(await res.json()).toMatchObject({
      linkset: [
        {
          'service-desc': [
            { href: 'https://api.ibanforge.com/openapi.json', type: 'application/json' },
          ],
        },
      ],
    });
  });

  it('does not apply landing headers to a rejected POST /', async () => {
    const res = await app.request('/', { method: 'POST', headers });
    expect(res.status).toBe(405);
    expect(res.headers.get('x-robots-tag')).toBeNull();
    expect(res.headers.get('link')).toBeNull();
  });
});
