/**
 * GET /v1/demo garde ses exemples une minute (SEC-07#2, audit du 10.11.2026).
 *
 * La route est exemptée du limiteur général, et elle recalculait à chaque appel
 * sept validations enrichies, une conformité et deux lectures de l'annuaire :
 * une seule adresse pouvait l'appeler en boucle sans jamais recevoir de 429. Le
 * calcul est désormais gardé DEMO_CACHE_MS ; `served_at` reste celui de la
 * requête, et `computed_at` date les exemples.
 *
 * L'espion enrobe le vrai `enrichResult` (jamais remplacé) : il compte les
 * calculs, la réponse reste la vraie.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';

vi.mock('../lib/enrich.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/enrich.js')>();
  return { ...actual, enrichResult: vi.fn(actual.enrichResult) };
});

import { demo, DEMO_CACHE_MS, resetDemoCache } from './demo.js';
import { enrichResult } from '../lib/enrich.js';

function makeApp() {
  const app = new Hono();
  app.route('/', demo);
  return app;
}

async function getDemo(): Promise<Record<string, unknown>> {
  const res = await makeApp().request('/v1/demo');
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

const enrichCalls = (): number => vi.mocked(enrichResult).mock.calls.length;

/** Le corps sans `served_at`, le seul champ qui change d'une requête à l'autre. */
function withoutServedAt(body: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'served_at'));
}

afterEach(() => {
  vi.useRealTimers();
  resetDemoCache();
});

describe('GET /v1/demo : les exemples sont gardés une minute', () => {
  it('deux appels de suite rendent le même corps hors served_at, et ne calculent qu’une fois', async () => {
    resetDemoCache();
    const before = enrichCalls();
    const first = await getDemo();
    const afterFirst = enrichCalls();
    // Le premier appel calcule bien : sans cela, le test ne prouverait rien.
    expect(afterFirst).toBeGreaterThan(before);

    const second = await getDemo();
    expect(enrichCalls(), 'le second appel n’a rien recalculé').toBe(afterFirst);

    expect(withoutServedAt(second)).toEqual(withoutServedAt(first));
  });

  it('date les exemples par computed_at, jamais après served_at', async () => {
    resetDemoCache();
    const body = await getDemo();
    expect(body.computed_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(Date.parse(String(body.computed_at))).toBeLessThanOrEqual(
      Date.parse(String(body.served_at)),
    );
  });

  it('recalcule une fois la minute passée', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-11T08:00:00Z'));
    resetDemoCache();
    const first = await getDemo();
    const afterFirst = enrichCalls();

    vi.setSystemTime(new Date(Date.parse('2026-11-11T08:00:00Z') + DEMO_CACHE_MS - 1));
    await getDemo();
    expect(enrichCalls(), 'encore dans la minute').toBe(afterFirst);

    vi.setSystemTime(new Date(Date.parse('2026-11-11T08:00:00Z') + DEMO_CACHE_MS));
    const later = await getDemo();
    expect(enrichCalls(), 'la minute est passée').toBeGreaterThan(afterFirst);
    expect(later.computed_at).not.toBe(first.computed_at);
  });
});
