export interface IBANforgeConfig {
  baseUrl?: string;
}

export interface IBANValidationResult {
  iban: string;
  valid: boolean;
  country?: { code: string; name: string };
  check_digits?: string;
  bban?: { bank_code: string; branch_code?: string; account_number: string };
  bic?: { code: string; bank_name: string | null; city: string | null } | null;
  formatted?: string;
  error?: string;
  error_detail?: string;
  cost_usdc: number;
  processing_ms?: number;
}

export interface BICLookupResult {
  bic: string;
  found: boolean;
  valid_format: boolean;
  institution: string | null;
  country: { code: string; name: string };
  city: string | null;
  lei: string | null;
  lei_status: string | null;
  cost_usdc: number;
  processing_ms?: number;
}

export class IBANforge {
  private baseUrl: string;

  constructor(config: IBANforgeConfig = {}) {
    this.baseUrl = config.baseUrl || 'https://api.ibanforge.com';
  }

  async validateIBAN(iban: string): Promise<IBANValidationResult> {
    const res = await fetch(`${this.baseUrl}/v1/iban/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ iban }),
    });
    if (!res.ok) throw new Error(`IBANforge API error: ${res.status}`);
    return res.json();
  }

  async validateBatch(ibans: string[]): Promise<{
    results: IBANValidationResult[];
    count: number;
    valid_count: number;
    cost_usdc: number;
  }> {
    const res = await fetch(`${this.baseUrl}/v1/iban/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ibans }),
    });
    if (!res.ok) throw new Error(`IBANforge API error: ${res.status}`);
    return res.json();
  }

  async lookupBIC(code: string): Promise<BICLookupResult> {
    const res = await fetch(`${this.baseUrl}/v1/bic/${encodeURIComponent(code)}`);
    if (!res.ok) throw new Error(`IBANforge API error: ${res.status}`);
    return res.json();
  }

  async health(): Promise<{ status: string; version: string; bic_database_entries: number }> {
    const res = await fetch(`${this.baseUrl}/health`);
    if (!res.ok) throw new Error(`IBANforge API error: ${res.status}`);
    return res.json();
  }
}

export default IBANforge;
