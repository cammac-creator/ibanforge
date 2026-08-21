/**
 * Request body helpers — case-insensitive field extraction.
 *
 * Agents and LLMs commonly uppercase domain acronyms ("IBAN" instead of "iban").
 * To make IBANforge agent-friendly, we accept any case for known field names.
 */

import type { Context } from 'hono';
import type { HonoEnv } from '../types.js';

/**
 * Compute the revenue we actually collected for this request.
 *
 * A request only produces revenue when x402 settlement actually happened.
 * That means ALL of the following are true:
 *   - x402 is enabled in the environment
 *   - the caller is NOT authenticated with an API key (free tier / paid plan)
 *   - the dev bypass header is NOT set
 *
 * In every other case (api-key, dev skip, x402 disabled) the endpoint was
 * served for free — we MUST pass 0 to stats so the dashboard reflects real
 * revenue instead of the posted price.
 */
export function computeRevenue(c: Context<HonoEnv>, priceUsdc: number): number {
  if (c.get('apiKeyAuthenticated')) return 0;
  if (process.env.X402_ENABLED !== 'true') return 0;
  if (
    process.env.NODE_ENV === 'development' &&
    c.req.header('X-Dev-Skip') === 'true'
  ) {
    return 0;
  }
  return priceUsdc;
}

export function pickField<T = unknown>(
  body: Record<string, unknown> | null | undefined,
  names: string[],
): T | undefined {
  if (!body || typeof body !== 'object') return undefined;
  for (const name of names) {
    if (name in body) return body[name] as T;
    const lower = name.toLowerCase();
    for (const k of Object.keys(body)) {
      if (k.toLowerCase() === lower) return body[k] as T;
    }
  }
  return undefined;
}

export function getIban(body: Record<string, unknown> | null | undefined): string | undefined {
  return pickField<string>(body, ['iban']);
}

/**
 * The BIC an agent may send to /v1/iban/compliance instead of an IBAN.
 *
 * `swift` is accepted as an alias because that is what half the industry calls
 * the same string, and an agent that guesses the wrong one should not get a
 * 400 for a synonym.
 */
export function getBic(body: Record<string, unknown> | null | undefined): string | undefined {
  return pickField<string>(body, ['bic', 'swift', 'bic_code', 'swift_code']);
}

export function getIbansArray(
  body: Record<string, unknown> | null | undefined,
): unknown[] | undefined {
  return pickField<unknown[]>(body, ['ibans', 'iban_list', 'list']);
}
