/**
 * MCP resources and prompts — shared between stdio and HTTP MCP servers
 */
import { IBAN_LENGTHS, getSepaInfo, getCountryRisk, getCountryName } from './countries.js';

export interface CountryInfo {
  code: string;
  name: string | null;
  iban_length: number;
  sepa: {
    member: boolean;
    schemes: string[];
    vop_required: boolean;
  };
  risk: 'standard' | 'elevated' | 'high';
}

export function buildCountriesPayload(): {
  countries: CountryInfo[];
  total: number;
  last_updated: string;
} {
  const countries: CountryInfo[] = Object.entries(IBAN_LENGTHS).map(([code, length]) => ({
    code,
    name: getCountryName(code),
    iban_length: length,
    sepa: getSepaInfo(code),
    risk: getCountryRisk(code),
  }));
  return {
    countries: countries.sort((a, b) => a.code.localeCompare(b.code)),
    total: countries.length,
    last_updated: new Date().toISOString().slice(0, 10),
  };
}

export interface PricingEntry {
  endpoint: string;
  method: string;
  price_usdc: number;
  description: string;
}

export function buildPricingPayload(): {
  pricing: PricingEntry[];
  currency: string;
  network: string;
  free_tier: string;
  note: string;
} {
  return {
    pricing: [
      {
        endpoint: '/v1/iban/validate',
        method: 'POST',
        price_usdc: 0.005,
        description: 'IBAN validation + BIC lookup + SEPA info + risk indicators',
      },
      {
        endpoint: '/v1/iban/batch',
        method: 'POST',
        price_usdc: 0.002,
        description: 'Batch IBAN validation (per IBAN, up to 100)',
      },
      {
        endpoint: '/v1/bic/:code',
        method: 'GET',
        price_usdc: 0.003,
        description: 'BIC/SWIFT lookup with LEI enrichment',
      },
      {
        endpoint: '/v1/iban/compliance',
        method: 'POST',
        price_usdc: 0.02,
        description: 'Full compliance check: sanctions + SEPA + VoP + risk score',
      },
      {
        endpoint: '/v1/ch/clearing/:iid',
        method: 'GET',
        price_usdc: 0.003,
        description: 'Swiss BC-Nummer clearing lookup',
      },
    ],
    currency: 'USDC',
    network: 'Base L2 (eip155:8453)',
    free_tier: '200 requests/month with API key (no card required)',
    note: 'Prices in USDC. Pay-per-call via x402 or use free API key tier.',
  };
}

export function buildValidateAndExplainPrompt(iban: string): string {
  return `Please validate this IBAN and explain the results in plain language for a non-technical user.

IBAN to validate: ${iban}

Use the validate_iban tool first, then:
1. State whether the IBAN is valid or not
2. If valid: identify the country, bank name (from BIC lookup), and whether it's a traditional bank or an EMI/neobank
3. Explain the SEPA reachability and whether Verification of Payee (VoP) is required for this country
4. Summarize the risk indicators in plain language
5. If invalid: explain what's wrong (wrong format, failed checksum, unsupported country)

Keep the explanation under 150 words and avoid jargon.`;
}
