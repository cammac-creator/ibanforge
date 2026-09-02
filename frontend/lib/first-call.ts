/**
 * The first call, made from the key dialog itself.
 *
 * Measured on the external keys of the summer (02/09/2026): most of the keys
 * that ever made a successful call did so within the hour that followed the
 * key, and the ones that did not call on day one almost never called at all. The moment the key appears on screen is therefore the moment
 * that decides activation, and until now that screen offered a copy button
 * and a link to the docs. The purchase page already had a "Run this call
 * now" button; this module gives the free-key dialog the same thing.
 *
 * Pure helpers only, so the snippets and the summary can be unit-tested
 * without a DOM. The panel that renders them lives in
 * components/first-call-panel.tsx.
 */

/** The playground's default example: a valid Swiss IBAN resolving to a real bank. */
export const SAMPLE_IBAN = 'CH1000230000000012345';
export const FIRST_CALL_PATH = '/v1/iban/validate';

export type SnippetLanguage = 'curl' | 'node' | 'python';
export type Snippets = Record<SnippetLanguage, string>;

export function firstCallUrl(apiBase: string): string {
  return `${apiBase.replace(/\/+$/, '')}${FIRST_CALL_PATH}`;
}

/** The same call in the three shapes a visitor is most likely to paste. */
export function buildSnippets(apiBase: string, apiKey: string, iban: string = SAMPLE_IBAN): Snippets {
  const url = firstCallUrl(apiBase);
  return {
    curl:
      `curl -X POST ${url} \\\n` +
      `  -H "Authorization: Bearer ${apiKey}" \\\n` +
      `  -H "Content-Type: application/json" \\\n` +
      `  -d '{"iban":"${iban}"}'`,
    node:
      `const r = await fetch('${url}', {\n` +
      `  method: 'POST',\n` +
      `  headers: { Authorization: 'Bearer ${apiKey}', 'Content-Type': 'application/json' },\n` +
      `  body: JSON.stringify({ iban: '${iban}' }),\n` +
      `});\n` +
      `console.log(await r.json());`,
    python:
      `import requests\n\n` +
      `r = requests.post(\n` +
      `    "${url}",\n` +
      `    headers={"Authorization": "Bearer ${apiKey}"},\n` +
      `    json={"iban": "${iban}"},\n` +
      `    timeout=10,\n` +
      `)\n` +
      `print(r.json())`,
  };
}

export interface FirstCallSummary {
  valid: boolean | null;
  countryName: string | null;
  bankName: string | null;
  bic: string | null;
  schemes: string[];
  bankCodeStatus: string | null;
  quotaUsed: number | null;
  quotaLimit: number | null;
}

interface HeaderReader {
  get(name: string): string | null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function int(v: string | null): number | null {
  if (v === null) return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * The few fields worth reading aloud from a validate response, plus the quota
 * headers the API exposes to browsers. Every field is optional on purpose: a
 * response shape that drifts must degrade to "valid: yes" rather than throw
 * inside the dialog that just issued a key.
 */
export function summarizeFirstCall(body: unknown, headers: HeaderReader | null): FirstCallSummary {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const country = o.country && typeof o.country === 'object' ? (o.country as Record<string, unknown>) : {};
  const bic = o.bic && typeof o.bic === 'object' ? (o.bic as Record<string, unknown>) : {};
  const sepa = o.sepa && typeof o.sepa === 'object' ? (o.sepa as Record<string, unknown>) : {};
  const check =
    o.bank_code_check && typeof o.bank_code_check === 'object'
      ? (o.bank_code_check as Record<string, unknown>)
      : {};
  const schemes = Array.isArray(sepa.schemes) ? sepa.schemes.filter((s): s is string => typeof s === 'string') : [];
  return {
    valid: typeof o.valid === 'boolean' ? o.valid : null,
    countryName: str(country.name),
    bankName: str(bic.bank_name),
    bic: str(bic.code),
    schemes,
    bankCodeStatus: str(check.status),
    quotaUsed: int(headers?.get('x-quota-used') ?? null),
    quotaLimit: int(headers?.get('x-quota-limit') ?? null),
  };
}
