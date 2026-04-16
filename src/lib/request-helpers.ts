/**
 * Request body helpers — case-insensitive field extraction.
 *
 * Agents and LLMs commonly uppercase domain acronyms ("IBAN" instead of "iban").
 * To make IBANforge agent-friendly, we accept any case for known field names.
 */

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

export function getIbansArray(
  body: Record<string, unknown> | null | undefined,
): unknown[] | undefined {
  return pickField<unknown[]>(body, ['ibans', 'iban_list', 'list']);
}
