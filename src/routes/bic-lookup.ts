import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateBIC } from '../lib/bic-validator.js';
import { lookup } from '../lib/bic-lookup.js';
import { hasNonLatinScript } from '../lib/gleif-address.js';
import { classifyBicInput } from '../lib/input-normalize.js';
import { recordOperation, recordRejection } from '../lib/stats.js';
import { computeRevenue } from '../lib/request-helpers.js';
import type { BICLookupResult } from '../types.js';

const COST_USDC = 0.003;

const bicLookup = new Hono<HonoEnv>();

bicLookup.get('/v1/bic/:code', (c) => {
  const start = performance.now();
  const code = c.req.param('code');

  // `classifyBicInput` rend null EXACTEMENT quand l'ancienne garde
  // « 8 ou 11 alphanumériques » acceptait déjà : les statuts et les corps de
  // réponse ci-dessous sont inchangés, on ne fait qu'étiqueter le rejet.
  // Attention : dans l'app montée, ce sont les gardes de src/index.ts qui
  // répondent en premier (elles s'exécutent avant le paiement x402) et qui
  // portent le même comptage — les deux ne peuvent pas se déclencher ensemble.
  const rejection = classifyBicInput(code);

  if (rejection === 'placeholder_literal') {
    recordRejection('bic_lookup', rejection);
    return c.json(
      {
        error: 'placeholder_literal',
        message: "You sent the literal OpenAPI placeholder '" + code + "'. Substitute it with a real BIC.",
        example: 'GET /v1/bic/UBSWCHZH',
        schema: 'https://api.ibanforge.com/openapi.json',
      },
      400,
    );
  }

  if (rejection !== null) {
    recordRejection('bic_lookup', rejection);
    return c.json(
      {
        error: 'invalid_bic_format',
        message: 'BIC code must be 8 or 11 alphanumeric characters',
      },
      400,
    );
  }

  const validation = validateBIC(code);

  if (!validation.valid) {
    // Passe la garde de format mais viole la forme ISO 9362 (ex. 12345678, qui
    // n'a pas [A-Z]{4} en tête). Sans ce compteur, ces 400 n'apparaîtraient
    // dans aucune catégorie et le total des rejets serait sous-estimé.
    recordRejection('bic_lookup', 'invalid_bic_shape');
    return c.json(
      {
        error: 'invalid_bic_format',
        message: 'BIC code must be 8 or 11 alphanumeric characters',
        valid_format: false,
        found: false,
        cost_usdc: COST_USDC,
      },
      400,
    );
  }

  const row = lookup(validation.bic11!);
  const found = row !== null;

  const errorDetail = found ? undefined : validation.bic;
  const revenue = computeRevenue(c, COST_USDC);
  recordOperation('bic_lookup', validation.country_code ?? null, found, revenue, errorDetail);

  // Provenance of the Latin reading, decided from the ACTUAL script of the
  // stored street — not the GLEIF language tag, which marks Greek/Arabic
  // entities 'el'/'ar' even when they filed an already-Latin address. We never
  // fabricate a transliteration: a genuinely non-Latin address with no official
  // English variant is reported as 'unavailable'.
  const streetIsNonLatin = hasNonLatinScript(row?.street);
  const romanizedReading = streetIsNonLatin
    ? (row?.address_en ?? null)
    : (row?.street ?? row?.address_en ?? null);
  const romanization: 'original_latin' | 'gleif_english' | 'unavailable' = !streetIsNonLatin
    ? 'original_latin'
    : row?.address_en
      ? 'gleif_english'
      : 'unavailable';

  const result: BICLookupResult = {
    bic: validation.bic,
    bic8: validation.bic8!,
    bic11: validation.bic11!,
    found,
    valid_format: true,
    institution: row?.institution ?? null,
    country: {
      code: validation.country_code!,
      name: row?.country_name ?? validation.country_code!,
    },
    city: row?.city ?? null,
    address:
      row && (row.street || row.address_en)
        ? {
            type: 'registered' as const,
            street: row.street,
            post_code: row.post_code,
            region: row.region,
            city: row.city,
            country: validation.country_code!,
            romanized: romanizedReading,
            romanization,
            source: row.address_source ?? 'GLEIF',
            language: row.address_lang,
            as_of: row.address_as_of,
          }
        : null,
    address_available: !!(row && (row.street || row.address_en)),
    branch_code: validation.branch_code!,
    branch_info: row?.branch_info ?? null,
    lei: row?.lei ?? null,
    lei_status: row?.lei_status ?? null,
    is_test_bic: validation.is_test_bic!,
    source: row?.source ?? null,
    cost_usdc: c.get('apiKeyAuthenticated') ? 0 : COST_USDC,
    processing_ms: Math.round((performance.now() - start) * 100) / 100,
  };

  if (!found) {
    result.note =
      'BIC format valid but not found in database. Data sourced from GLEIF — coverage may be partial.';
  }

  return c.json(result);
});

export { bicLookup };
