import { describe, expect, it } from 'vitest';
import {
  generateApiKey,
  generateCreditKey,
  generateOemKey,
  generateStripeKey,
  rotateApiKey,
} from './api-keys.js';
import { getStatsDB } from './db.js';

/**
 * L'invariant de naissance, dans les DEUX sens (spec 02 §6.3).
 *
 * Une clé libre a exactement UNE ligne dans key_creations : ni zéro (elle
 * serait invisible au disjoncteur et irrévocable), ni deux (le disjoncteur
 * compterait double et s'armerait à la moitié du volume réel). Une clé
 * payante n'en a aucune : une rafale d'achats n'est pas un abus.
 *
 * Fixtures inventées : ce dépôt est public.
 */
const RUN = Date.now();

function births(prefix: string): Array<{ ip_hash: string; user_agent: string | null }> {
  return getStatsDB()
    .prepare('SELECT ip_hash, user_agent FROM key_creations WHERE key_prefix = ?')
    .all(prefix) as Array<{ ip_hash: string; user_agent: string | null }>;
}

describe('invariant de naissance', () => {
  it('une clé libre avec adresse : exactement une ligne, avec le réseau et le client', () => {
    const k = generateApiKey(`birth-a-${RUN}@alpha.example.net`, undefined, undefined, false, {
      ipHash: `net-${RUN}`,
      userAgent: 'demo-http-client/1.0',
    });
    expect(k).not.toBeNull();
    const rows = births(k!.key_prefix);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ ip_hash: `net-${RUN}`, user_agent: 'demo-http-client/1.0' });
  });

  it('une clé anonyme : exactement une ligne aussi', () => {
    const k = generateApiKey(null, undefined, undefined, false, {
      ipHash: `net-anon-${RUN}`,
      userAgent: 'curl/8.7.1',
    });
    expect(k).not.toBeNull();
    expect(births(k!.key_prefix)).toHaveLength(1);
  });

  it("sans réseau connu, la sentinelle 'unknown' compte sans ancre", () => {
    const k = generateApiKey(`birth-b-${RUN}@alpha.example.net`);
    expect(k).not.toBeNull();
    const rows = births(k!.key_prefix);
    expect(rows).toHaveLength(1);
    expect(rows[0].ip_hash).toBe('unknown');
    expect(rows[0].user_agent).toBeNull();
  });

  it('une clé payante ne produit aucune ligne, sur les trois rails', () => {
    const credit = generateCreditKey(null, 1000, `ref-${RUN}`);
    const stripe = generateStripeKey(null, 1000, `cs_test_${RUN}`);
    const oem = generateOemKey(null, 50_000, `cs_test_oem_${RUN}`, null);
    expect(births(credit.key_prefix)).toHaveLength(0);
    expect(births(stripe.key_prefix)).toHaveLength(0);
    expect(births(oem.key_prefix)).toHaveLength(0);
  });

  it('la rotation ne recopie pas la naissance : la lignée passe par origin_prefix', () => {
    const k = generateApiKey(`birth-c-${RUN}@alpha.example.net`, undefined, undefined, false, {
      ipHash: `net-rot-${RUN}`,
      userAgent: 'demo-http-client/1.0',
    })!;
    const before = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM key_creations').get() as { n: number }
    ).n;
    const rotated = rotateApiKey(k.api_key)!;
    const after = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM key_creations').get() as { n: number }
    ).n;
    expect(after).toBe(before);
    expect(births(rotated.key_prefix)).toHaveLength(0);
    const row = getStatsDB()
      .prepare('SELECT origin_prefix FROM api_keys WHERE key_prefix = ?')
      .get(rotated.key_prefix) as { origin_prefix: string };
    expect(row.origin_prefix).toBe(k.key_prefix);
    // Et une seconde rotation garde l'ORIGINE, pas le préfixe intermédiaire.
    const twice = rotateApiKey(rotated.api_key)!;
    const row2 = getStatsDB()
      .prepare('SELECT origin_prefix FROM api_keys WHERE key_prefix = ?')
      .get(twice.key_prefix) as { origin_prefix: string };
    expect(row2.origin_prefix).toBe(k.key_prefix);
  });
});
