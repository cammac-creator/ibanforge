/** Transport REST du paquet publié : une erreur reste exploitable par l'agent. */
export interface JsonRecord {
  [key: string]: unknown;
}

export const DEFAULT_TIMEOUT_MS = 30_000;

export function requestTimeout(value: string | undefined): number {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout >= 1 && timeout <= 120_000
    ? Math.floor(timeout)
    : DEFAULT_TIMEOUT_MS;
}

function record(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function retryAfter(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = /^\d+(\.\d+)?$/.test(value)
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, Math.ceil(seconds)) : undefined;
}

export function createApiClient(config: {
  baseUrl: string;
  apiKey?: string;
  version: string;
  timeoutMs?: number;
}) {
  const baseUrl = config.baseUrl.replace(/\/+$/, '');
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async function apiCall(
    method: 'GET' | 'POST',
    path: string,
    body?: JsonRecord,
    form?: FormData,
  ): Promise<JsonRecord> {
    const headers: Record<string, string> = {
      'User-Agent': `ibanforge-mcp/${config.version}`,
      Accept: 'application/json',
    };
    if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
    // FormData doit garder la frontière calculée par fetch.
    if (body && !form) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Aucun rejeu automatique : un POST interrompu peut avoir été exécuté.
      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: form ?? (body ? JSON.stringify(body) : undefined),
        signal: controller.signal,
      });
      // Le délai couvre aussi un corps qui reste ouvert après les en-têtes.
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }

      if (!res.ok) {
        const payload = record(parsed) ? parsed : {};
        const cause = record(payload.cause) ? payload.cause : undefined;
        const delay = retryAfter(res.headers.get('retry-after'));
        return {
          ...payload,
          // Le corps ne peut pas contredire le statut HTTP ni effacer l'erreur.
          _error: true,
          status: res.status,
          error: typeof payload.error === 'string' ? payload.error : 'api_error',
          ...(delay !== undefined ? { retry_after: delay } : {}),
          _hint:
            typeof cause?.detail === 'string'
              ? cause.detail
              : res.status === 402
                ? 'The API requires payment or an available key quota. Create a key without e-mail with POST https://api.ibanforge.com/v1/keys/generate, then configure IBANFORGE_API_KEY. An existing key can be claimed for a larger allowance; the allowances in force are served at https://api.ibanforge.com/.well-known/rate-limits.yml. This MCP package does not sign x402 payments; use an x402-capable HTTP client with the returned payment requirements, or prepaid credits. Do not recreate keys to evade a limit.'
                : res.status === 429
                  ? 'Rate limit reached. Follow retry_after when present; do not loop or recreate keys. No request was retried by this client.'
                  : res.status >= 500
                    ? 'The API is temporarily unavailable. This is not a negative verdict on the bank or account. No request was retried by this client.'
                    : undefined,
        };
      }

      if (!record(parsed)) {
        return {
          _error: true,
          status: res.status,
          error: 'invalid_response',
          message: 'The API returned no JSON object. No validation result is available.',
          _hint:
            'Check IBANFORGE_API_BASE and API availability. Do not treat this as an invalid IBAN or an absent bank.',
        };
      }
      return parsed;
    } catch (err) {
      const cause = err as { cause?: { code?: string } };
      const code = cause?.cause?.code;
      return {
        _error: true,
        _transport_error: true,
        status: 0,
        error: controller.signal.aborted ? 'request_timeout' : 'transport_error',
        ...(code ? { code } : {}),
        message: controller.signal.aborted
          ? `No complete API response within ${timeoutMs} ms.`
          : 'No complete response was received from the IBANforge API.',
        _hint:
          code === 'UND_ERR_HEADERS_OVERFLOW'
            ? 'Response headers exceeded the Node HTTP limit. Use a valid IBANFORGE_API_KEY or start Node with --max-http-header-size=65536.'
            : 'Check connectivity and IBANFORGE_API_BASE. The request may have reached the server; this client did not retry it. Do not infer a bank or account verdict from a transport failure.',
      };
    } finally {
      clearTimeout(timer);
    }
  };
}
