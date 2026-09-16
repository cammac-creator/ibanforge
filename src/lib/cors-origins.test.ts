import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAllowedOrigin } from './cors-origins.js';

/**
 * Audit du 16/09/2026, constat 7 : la production acceptait n'importe quelle
 * origine `localhost` (mesuré : `Origin: http://localhost:9999` renvoyé tel
 * quel). Sans cookie l'impact est faible, mais une tolérance de développement
 * n'a rien à faire en production.
 */
describe('CORS: la tolérance localhost', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('est honorée hors production', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CORS_ORIGIN', 'https://ibanforge.com');
    expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
    expect(isAllowedOrigin('http://127.0.0.1:9999')).toBe(true);
  });

  it('est refusée en production, où seule la liste explicite compte', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('CORS_ORIGIN', 'https://ibanforge.com,https://www.ibanforge.com');
    expect(isAllowedOrigin('http://localhost:3000')).toBe(false);
    expect(isAllowedOrigin('http://localhost:9999')).toBe(false);
    expect(isAllowedOrigin('https://ibanforge.com')).toBe(true);
    expect(isAllowedOrigin('https://evil.example.net')).toBe(false);
  });
});
