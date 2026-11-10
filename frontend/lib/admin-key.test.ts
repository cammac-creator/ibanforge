import { afterEach, describe, expect, it, vi } from 'vitest';
import { siteAdminKey } from './admin-key';

/**
 * La clé que le site envoie à l'API (audit WEB-02#1, lot C08) : sa clé à portée
 * quand elle est posée, la clé complète sinon, le temps de la bascule.
 */
describe('siteAdminKey', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('sends the site key when it is set, even beside the full secret', () => {
    vi.stubEnv('SITE_ADMIN_TOKEN', 'cle-du-site-fictive');
    vi.stubEnv('ADMIN_SECRET', 'secret-complet-fictif');
    expect(siteAdminKey()).toBe('cle-du-site-fictive');
  });

  it('falls back to ADMIN_SECRET while the site key is not set', () => {
    vi.stubEnv('SITE_ADMIN_TOKEN', '');
    vi.stubEnv('ADMIN_SECRET', 'secret-complet-fictif');
    expect(siteAdminKey()).toBe('secret-complet-fictif');
  });

  it('treats a site key made of spaces as absent', () => {
    vi.stubEnv('SITE_ADMIN_TOKEN', '   ');
    vi.stubEnv('ADMIN_SECRET', 'secret-complet-fictif');
    expect(siteAdminKey()).toBe('secret-complet-fictif');
  });

  it('answers an empty string when neither is set, so callers say "not configured"', () => {
    vi.stubEnv('SITE_ADMIN_TOKEN', '');
    vi.stubEnv('ADMIN_SECRET', '');
    expect(siteAdminKey()).toBe('');
  });

  it('reads the environment at each call, never once at import', () => {
    vi.stubEnv('SITE_ADMIN_TOKEN', '');
    vi.stubEnv('ADMIN_SECRET', 'premier');
    expect(siteAdminKey()).toBe('premier');
    vi.stubEnv('SITE_ADMIN_TOKEN', 'second');
    expect(siteAdminKey()).toBe('second');
  });
});
