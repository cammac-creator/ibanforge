/**
 * @ibanforge/sdk — Official TypeScript SDK for the IBANforge API
 * Zero dependencies — uses native fetch
 */

import {
  IBANforgeError,
  type IBANValidationResult,
  type BatchValidationResult,
  type BICLookupResult,
  type ComplianceCheckResult,
  type UsageResult,
} from './types.js';

export * from './types.js';

const DEFAULT_BASE_URL = 'https://api.ibanforge.com';

export interface IBANforgeOptions {
  baseUrl?: string;
}

export class IBANforge {
  private readonly apiKey?: string;
  private readonly baseUrl: string;

  constructor(apiKey?: string, options?: IBANforgeOptions) {
    this.apiKey = apiKey;
    this.baseUrl = options?.baseUrl ?? DEFAULT_BASE_URL;
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': '@ibanforge/sdk/1.0.0',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorBody: { error?: string; message?: string } = {};
      try {
        errorBody = (await response.json()) as { error?: string; message?: string };
      } catch {
        // ignore JSON parse errors
      }

      const code = errorBody.error ?? 'unknown_error';
      let message = errorBody.message ?? `HTTP ${response.status}`;

      if (response.status === 402) {
        message =
          'Payment required — provide an API key or use x402. Visit https://ibanforge.com to get a free key.';
      }

      throw new IBANforgeError(message, response.status, code);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Validate a single IBAN.
   * @param iban - The IBAN string to validate (spaces are stripped automatically by the API)
   */
  async validate(iban: string): Promise<IBANValidationResult> {
    return this.request<IBANValidationResult>('POST', '/v1/iban/validate', { iban });
  }

  /**
   * Validate up to 100 IBANs in a single request.
   * @param ibans - Array of IBAN strings
   */
  async validateBatch(ibans: string[]): Promise<BatchValidationResult> {
    return this.request<BatchValidationResult>('POST', '/v1/iban/batch', { ibans });
  }

  /**
   * Look up a BIC/SWIFT code in the GLEIF database (39K+ entries).
   * @param code - BIC8 or BIC11 code
   */
  async lookupBIC(code: string): Promise<BICLookupResult> {
    return this.request<BICLookupResult>('GET', `/v1/bic/${encodeURIComponent(code)}`);
  }

  /**
   * Run a full compliance check on an IBAN (sanctions, SEPA reachability, VoP, risk score).
   * @param iban - The IBAN string to check
   */
  async compliance(iban: string): Promise<ComplianceCheckResult> {
    return this.request<ComplianceCheckResult>('POST', '/v1/iban/compliance', { iban });
  }

  /**
   * Check API key usage for the current month.
   * Requires a valid API key to be set in the constructor.
   */
  async usage(): Promise<UsageResult> {
    return this.request<UsageResult>('GET', '/v1/keys/usage');
  }
}
