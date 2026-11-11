import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from './app.js';
import { closeAll } from './lib/db.js';

/**
 * 11.11.2026 (C23) : le site appelle l'API depuis le navigateur, sur une autre
 * origine. Un en-tête de réponse absent de `exposeHeaders` y est illisible par
 * le code de la page, même quand le serveur l'envoie. Le refus du dépôt de
 * fichier quand l'audit est plein (503 `capacity_reached`) ne donne son attente
 * que par `Retry-After` : sans cette ligne, le site ne pouvait pas la dire.
 */
let app: ReturnType<typeof buildApp>;

beforeAll(() => {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('X402_ENABLED', 'false');
  app = buildApp();
});

afterAll(() => {
  closeAll();
  vi.unstubAllEnvs();
});

describe('en-têtes lisibles par une page d’une autre origine', () => {
  it('expose Retry-After, à côté des en-têtes du limiteur', async () => {
    const res = await app.request('/health', {
      headers: { Origin: 'https://ibanforge.com', 'x-real-ip': '192.0.2.61' },
    });
    const exposed = (res.headers.get('access-control-expose-headers') ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase());
    expect(exposed).toContain('x-ratelimit-reset');
    expect(exposed).toContain('retry-after');
  });
});
