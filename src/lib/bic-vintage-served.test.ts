/**
 * Chaque BIC servi dit l'âge de sa donnée (25/09/2026). Intégration sur la base
 * livrée, par INVARIANTS : aucun compte ni aucun nom de banque n'est figé ici,
 * ils bougent à chaque rafraîchissement.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup, lookupByCountryBank } from './bic-lookup.js';
import { sourceVintage } from './source-vintage.js';
import { enrichResult, registerCoverage } from './enrich.js';
import { validateIBAN } from './iban.js';
import { traceIndex } from './bic-trace.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MAP = JSON.parse(readFileSync(resolve(HERE, '../db/bic_data.json'), 'utf8')) as Record<
  string,
  { bic: string }
>;

/** Les clés de la carte composite hors des pays dont un registre décide. */
const CURATED_KEYS = Object.keys(MAP).filter(
  (k) => registerCoverage(k.slice(0, 2)).basis === 'none',
);

/** La ligne qui décrit le BIC d'une clé : BIC11, sinon le BIC8, comme lookupByCountryBank. */
function descriptionRow(bic: string) {
  return (bic.length === 11 ? lookup(bic) : null) ?? lookup(bic.slice(0, 8));
}

describe('curated-map answers date a frozen directory row', () => {
  it('every curated-map answer whose directory row is frozen carries source_as_of', () => {
    let exact = 0;
    let dated = 0;
    for (const key of CURATED_KEYS) {
      const [cc, code] = [key.slice(0, 2), key.slice(3)];
      const hit = lookupByCountryBank(cc, code);
      if (!hit || hit.match !== 'register') continue;
      exact += 1;
      const expected = sourceVintage(descriptionRow(hit.code)?.source)?.as_of;
      expect(hit.source_as_of, key).toBe(expected);
      if (expected) dated += 1;
    }
    // Le parcours a bien vu des réponses, et des réponses datées : sinon il ne
    // prouverait rien.
    expect(exact).toBeGreaterThan(1000);
    expect(dated).toBeGreaterThan(0);
  });

  it('never serves an empty bank_name or city', () => {
    for (const key of Object.keys(MAP)) {
      const hit = lookupByCountryBank(key.slice(0, 2), key.slice(3));
      if (!hit) continue;
      expect(hit.bank_name, key).not.toBe('');
      expect(hit.city, key).not.toBe('');
    }
  });
});

describe('the validation bic block', () => {
  // Registres publics (DE, CZ, SK, BG, CH) : exemples publiés ou IBAN fabriqués.
  const REGISTER_IBANS = [
    'DE89370400440532013000',
    'CZ6508000000192000145399',
    'SK3112000000198742637541',
    'BG80BNBG96611020345678',
    'CH1000230000000012345',
  ];

  it('never dates a national_register answer with source_as_of', () => {
    let seen = 0;
    for (const iban of REGISTER_IBANS) {
      const r = validateIBAN(iban);
      enrichResult(r);
      if (r.bic?.basis !== 'national_register') continue;
      seen += 1;
      expect(r.bic, iban).not.toHaveProperty('source_as_of');
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('listed_in_current_source is a boolean on every resolved bic block when the index is complete', () => {
    const complete = traceIndex().complete;
    const ibans = [
      ...REGISTER_IBANS,
      'NL19BICK0123456789',
      'IT26X0311111101000000123456',
      'FR1420041010050500013M02606',
      'GB29NWBK60161331926819',
      'NO9386011117947',
      'AE070331234567890123456',
    ];
    for (const iban of ibans) {
      const r = validateIBAN(iban);
      enrichResult(r);
      if (!r.bic) continue;
      if (complete) expect(typeof r.bic.listed_in_current_source, iban).toBe('boolean');
      // Index incomplet : jamais `false` par défaut.
      else expect([true, null], iban).toContain(r.bic.listed_in_current_source);
    }
  });
});
