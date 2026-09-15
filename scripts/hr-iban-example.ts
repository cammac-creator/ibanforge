/** Exemple côté serveur : ne journalise ni IBAN, ni clé, ni identité d'employé. */
export type HrIbanReview =
  | { status: 'format_valid'; bic: string | null; bankCodeStatus: string | null }
  | { status: 'invalid_input' }
  | { status: 'check_unavailable'; httpStatus: number | null };

export async function reviewEmployeeIban(
  iban: string,
  apiKey: string,
  request: typeof fetch = fetch,
): Promise<HrIbanReview> {
  if (!apiKey.trim()) throw new Error('Clé API requise côté serveur');
  try {
    const response = await request('https://api.ibanforge.com/v1/iban/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ iban }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { status: 'check_unavailable', httpStatus: response.status };
    const data: unknown = await response.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !('valid' in data) ||
      typeof data.valid !== 'boolean'
    ) {
      return { status: 'check_unavailable', httpStatus: response.status };
    }
    if (!data.valid) return { status: 'invalid_input' };
    const bic =
      'bic' in data &&
      data.bic &&
      typeof data.bic === 'object' &&
      'code' in data.bic &&
      typeof data.bic.code === 'string'
        ? data.bic.code
        : null;
    const bank = 'bank_code_check' in data ? data.bank_code_check : null;
    const bankCodeStatus =
      bank && typeof bank === 'object' && 'status' in bank && typeof bank.status === 'string'
        ? bank.status
        : null;
    // « format_valid » ne confirme ni l'existence du compte, ni son titulaire.
    return { status: 'format_valid', bic, bankCodeStatus };
  } catch {
    return { status: 'check_unavailable', httpStatus: null };
  }
}
