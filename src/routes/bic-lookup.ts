import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { validateBIC } from '../lib/bic-validator.js';
import { lookup, registeredAddress, sharedBic8Stats } from '../lib/bic-lookup.js';
import { screenBicSanctions } from '../lib/compliance.js';
import { praAuthorisationByLei, type PraAuthorisation } from '../lib/pra-banks.js';
import { officialIdentityByLei, type OfficialIdentity } from '../lib/official-identity.js';
import { classifyBicInput } from '../lib/input-normalize.js';
import { recordOperation, recordRejection } from '../lib/stats.js';
import { computeRevenue } from '../lib/request-helpers.js';
import type { BICLookupResult } from '../types.js';
import type { SharedBic8Stats } from '../lib/bic-lookup.js';

/**
 * The served payload, plus what we hold under a BIC8 that resolves no single
 * institution.
 *
 * Declared here rather than on BICLookupResult on purpose: several agents were
 * editing src/types.ts the morning this landed, and a shared type file is the
 * worst place to take a lock for one route's optional field. Fold it into
 * BICLookupResult when the tree is quiet — nothing else depends on it.
 */
type BicLookupPayload = BICLookupResult & {
  shared_bic8?: SharedBic8Stats;
  /**
   * Same reasoning as shared_bic8 above: declared beside its usage rather than
   * in the shared types file. The IBAN path needs it on IBANValidationResult,
   * so the interface itself lives in lib/pra-banks.ts and both surfaces import
   * the one definition.
   */
  pra_authorisation?: PraAuthorisation;
  /**
   * Same placement reasoning again: the interface lives in
   * lib/official-identity.ts so this route and the IBAN path serve one
   * definition, and the optional field is declared beside its usage.
   */
  official_identity?: OfficialIdentity;
};

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
  const sanctions = screenBicSanctions(validation.bic8!);
  // Only consulted when no single institution resolved: this is what we still
  // hold under the BIC8, so a miss can stop claiming we know nothing.
  const shared = found ? null : sharedBic8Stats(validation.bic8!);

  const errorDetail = found ? undefined : validation.bic;
  const revenue = computeRevenue(c, COST_USDC);
  recordOperation('bic_lookup', validation.country_code ?? null, found, revenue, errorDetail, c.get('apiKeyPrefix'));

  // Built by the shared helper so /v1/iban/validate cannot serve a different
  // shape from the same row. The romanization rule (decided from the actual
  // script of the stored street, never from the GLEIF language tag) lives there.
  const address = registeredAddress(row);

  // Bank of England, List of Banks — joined on the LEI this row already carries,
  // scoped to the BIC's own country. See lib/pra-banks.ts: the branch section
  // publishes the head office's LEI, so an unscoped join would announce a UK
  // deposit authorisation on the parent's foreign BICs.
  const pra = praAuthorisationByLei(row?.lei, validation.country_code);

  // European Central Bank, daily list of monetary financial institutions —
  // joined on the LEI this row already carries. Unlike the PRA block there is
  // no country scope: this states who the LEI holder IS, not what it is
  // authorised to do somewhere, and a legal name does not change with which of
  // an entity's BICs was asked about. See lib/official-identity.ts.
  //
  // Additive only. It does not touch `found`, `institution` or any existing
  // field — a caller comparing our directory name against the central bank's
  // must be able to see both, not one silently overwritten by the other.
  const identity = officialIdentityByLei(row?.lei);

  const result: BicLookupPayload = {
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
    address,
    address_available: address !== null,
    branch_code: validation.branch_code!,
    branch_info: row?.branch_info ?? null,
    lei: row?.lei ?? null,
    lei_status: row?.lei_status ?? null,
    is_test_bic: validation.is_test_bic!,
    source: row?.source ?? null,
    // Screened on every answer, found or not. See the field note in types.ts:
    // answering a plain "not found" about a bank a sanctions authority has
    // designated is the most reassuring thing this endpoint can say about the
    // least reassuring institution it knows.
    sanctions,
    ...(pra ? { pra_authorisation: pra } : {}),
    ...(identity ? { official_identity: identity } : {}),
    ...(shared ? { shared_bic8: shared } : {}),
    cost_usdc: c.get('apiKeyAuthenticated') ? 0 : COST_USDC,
    processing_ms: Math.round((performance.now() - start) * 100) / 100,
  };

  if (!found) {
    // Composed from parts rather than chosen between branches: a BIC8 can be
    // both shared AND designated, and an if/else would silently drop one of the
    // two facts. Sanctions come first — it is the one that stops a payment.
    const parts: string[] = [];

    // The designation itself, stated without any claim about our coverage —
    // that claim belongs below and depends on what we actually hold. An earlier
    // draft asserted "absent from our BIC directory" here and then announced
    // the rows we hold two sentences later: a BIC8 can be shared AND
    // designated (measured: it happens), so the two facts have to be told by
    // parts that cannot contradict each other.
    if (sanctions.listed) {
      parts.push(
        'This BIC is named on a sanctions list. A missing directory record is a gap in our coverage, ' +
          'NOT a clean screening result. Screen it with POST /v1/iban/compliance {"bic": "..."}.',
      );
    }

    if (shared) {
      // We hold the code; what we cannot do is name ONE holder. Saying so beats
      // "not found", and beats naming a bank picked by row order.
      parts.push(
        `No head-office (XXX) record exists for this BIC8, but the directory holds ${shared.entries} ` +
          `${shared.entries === 1 ? 'entry' : 'entries'} under it, covering ${shared.institutions} ` +
          `distinct ${shared.institutions === 1 ? 'institution' : 'institutions'}. ` +
          'A shared BIC8 identifies the clearing institution, not the account holder: supply the full ' +
          '11-character BIC including its branch code to resolve one of them. We do not pick one for you.',
      );
    } else if (sanctions.listed) {
      parts.push('We hold no record under this BIC8, so we cannot name the institution behind it.');
    } else {
      parts.push('BIC format valid but not found in database. Data sourced from GLEIF — coverage may be partial.');
    }

    result.note = parts.join(' ');
  }

  return c.json(result);
});

export { bicLookup };
