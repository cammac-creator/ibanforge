import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * FRT-11 (audit 2026-09-01): every route under crm/ and dashboard/ checked the
 * session, but nothing enforced it. The next route added to these folders would
 * have been guarded by discipline alone. This turns the discipline into a
 * barrier: the file list is discovered, not written down, so a new route.ts is
 * enrolled the moment it lands.
 *
 * `next/headers` is mocked to return a cookie jar with nothing in it — the real
 * cookies() throws outside a Next request scope, which would look like a route
 * failure instead of the "no session" case under test. `fetch` is stubbed to
 * throw so that a route which forgot its check cannot quietly reach the backend:
 * the test fails loudly instead of sending a request with ADMIN_SECRET on it.
 */
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const routeModules = {
  ...import.meta.glob('./crm/**/route.ts'),
  ...import.meta.glob('./dashboard/**/route.ts'),
} as Record<string, () => Promise<Record<string, unknown>>>;

const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

beforeEach(() => {
  // Set the secrets on purpose: a route must answer 401 even when it is fully
  // configured, otherwise this suite would pass for the wrong reason (503).
  vi.stubEnv('API_URL', 'http://backend.invalid');
  vi.stubEnv('ADMIN_SECRET', 'test-admin-secret');
  vi.stubEnv('STATS_TOKEN', 'test-stats-token');
  vi.stubEnv('TABORNIO_CRM_URL', 'http://upstream.invalid');
  vi.stubEnv('CRM_DRAFT_SECRET', 'test-crm-secret');
  vi.stubGlobal('fetch', async () => {
    throw new Error('a route without a session must not reach the network');
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function requestFor(verb: string, path: string): NextRequest {
  const url = `http://site.test/api/${path.replace(/^\.\//, '').replace(/\/route\.ts$/, '')}`;
  if (verb === 'GET' || verb === 'DELETE') {
    return new NextRequest(url, { method: verb });
  }
  return new NextRequest(url, {
    method: verb,
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

describe('every private API route refuses a request with no session cookie', () => {
  it('found the route files to check', () => {
    // A broken glob would make this whole suite pass by testing nothing.
    expect(Object.keys(routeModules).length).toBeGreaterThanOrEqual(20);
  });

  for (const [path, load] of Object.entries(routeModules)) {
    it(`${path} answers 401 on every verb it exports`, async () => {
      const mod = await load();
      const handlers = VERBS.filter((verb) => typeof mod[verb] === 'function');
      expect(handlers.length).toBeGreaterThan(0);

      for (const verb of handlers) {
        const handler = mod[verb] as (req: NextRequest) => Promise<Response>;
        const res = await handler(requestFor(verb, path));
        expect(res.status, `${verb} ${path}`).toBe(401);
      }
    });
  }
});
