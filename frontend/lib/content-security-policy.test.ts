import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * WEB-03 (audit du 10.11.2026) : la règle de sécurité du contenu était posée en
 * témoin seulement (`Content-Security-Policy-Report-Only`) depuis le 01.09.2026.
 * Elle est appliquée depuis le 11.11.2026, après un relevé dans Chromium et
 * WebKit des pages principales servies par `next start` (voir la PR).
 *
 * Ce test lit les en-têtes que `next.config.ts` remet à Next, pour la route qui
 * couvre tout le site.
 */

type Header = { key: string; value: string };

async function siteHeaders(env: Record<string, string>): Promise<Header[]> {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const config = (await import('../next.config')).default;
  const rules = await config.headers!();
  const all = rules.find((r) => r.source === '/(.*)');
  if (!all) throw new Error('aucune règle /(.*) dans next.config.ts');
  return all.headers as Header[];
}

function directives(policy: string): Record<string, string[]> {
  return Object.fromEntries(
    policy
      .split(';')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name, values];
      }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('règle de sécurité du contenu', () => {
  it('est appliquée sur tout le site, avec object-src, base-uri et form-action, et reste un témoin sous next dev', async () => {
    const headers = await siteHeaders({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'https://api.ibanforge.com' });
    const enforced = headers.find((h) => h.key === 'Content-Security-Policy');
    expect(enforced, 'en-tête Content-Security-Policy appliqué').toBeDefined();
    expect(headers.some((h) => h.key === 'Content-Security-Policy-Report-Only')).toBe(false);

    const d = directives(enforced!.value);
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['script-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d['style-src']).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d['font-src']).toEqual(["'self'"]);
    expect(d['img-src']).toEqual(["'self'", 'data:', 'https:']);
    expect(d['connect-src']).toEqual(["'self'", 'https://api.ibanforge.com']);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['report-uri']).toEqual(['/api/csp-report']);
    // Ni 'unsafe-eval', ni relais ouvert, ni hôte de polices tiers.
    expect(enforced!.value).not.toMatch(/unsafe-eval|scalar\.com|googleapis|gstatic/);
    expect(headers.find((h) => h.key === 'Reporting-Endpoints')?.value).toBe('csp-endpoint="/api/csp-report"');

    // Sous `next dev`, React évalue du code et le rechargement ouvre une
    // connexion locale : la même règle y reste un témoin, pour ne jamais
    // casser le poste de développement.
    const dev = await siteHeaders({ NODE_ENV: 'development', NEXT_PUBLIC_API_URL: 'https://api.ibanforge.com' });
    expect(dev.some((h) => h.key === 'Content-Security-Policy')).toBe(false);
    expect(dev.find((h) => h.key === 'Content-Security-Policy-Report-Only')?.value).toBe(enforced!.value);
  });

  it("autorise l'adresse de l'API inscrite dans le paquet client, et elle seule en plus", async () => {
    const headers = await siteHeaders({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4999/v1' });
    const policy = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(directives(policy)['connect-src']).toEqual(["'self'", 'https://api.ibanforge.com', 'http://127.0.0.1:4999']);

    const malformed = await siteHeaders({ NODE_ENV: 'production', NEXT_PUBLIC_API_URL: 'javascript:alert(1)' });
    const fallback = malformed.find((h) => h.key === 'Content-Security-Policy')?.value ?? '';
    expect(directives(fallback)['connect-src']).toEqual(["'self'", 'https://api.ibanforge.com']);
  });
});
