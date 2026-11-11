import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCALAR_NETWORK_CONFIGURATION } from './scalar-network';

/**
 * WEB-03 (audit du 10.11.2026) : la règle de sécurité du contenu appliquée ne
 * nomme que le site et api.ibanforge.com. La référence de l'API (Scalar) doit
 * donc tout faire avec eux : sans ces réglages, « Test Request » part par le
 * relais https://proxy.scalar.com, que la règle bloquerait (et ne doit pas
 * autoriser : il relaie vers n'importe quelle adresse).
 */
describe('référence de l’API, réseau', () => {
  it('ne passe par aucun service de Scalar, et la page utilise bien ces réglages', () => {
    // Une chaîne vide, pas undefined : undefined rend le relais de Scalar.
    expect(SCALAR_NETWORK_CONFIGURATION.proxyUrl).toBe('');
    expect(SCALAR_NETWORK_CONFIGURATION.withDefaultFonts).toBe(false);
    expect(SCALAR_NETWORK_CONFIGURATION.agent.disabled).toBe(true);
    expect(SCALAR_NETWORK_CONFIGURATION.telemetry).toBe(false);

    const client = readFileSync(new URL('./client.tsx', import.meta.url), 'utf8');
    expect(client).toMatch(/\.\.\.SCALAR_NETWORK_CONFIGURATION,/);
    // Écrits après l'étalement, ces réglages l'écraseraient en silence.
    const after = client.slice(client.indexOf('...SCALAR_NETWORK_CONFIGURATION'));
    expect(after).not.toMatch(/\b(proxyUrl|proxy|withDefaultFonts|agent|telemetry)\s*:/);
    expect(client).toMatch(/url: 'https:\/\/api\.ibanforge\.com\/openapi\.json'/);
  });
});
