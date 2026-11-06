/** Gardes de lecture, pas des latences promises. */
export const DASHBOARD_READ_TIMEOUT_MS = 15_000;
// Le lecteur Stripe vérifie son budget de 45 s entre des appels de 10 s,
// chacun pouvant être relancé. Laisser finir cette lecture et sa réponse.
export const STRIPE_READ_TIMEOUT_MS = 75_000;

/** Le signal couvre aussi le corps JSON ; aucun minuteur ne survit à la lecture. */
export async function withReadDeadline<T>(
  read: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DASHBOARD_READ_TIMEOUT_MS,
): Promise<T> {
  const duration = Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 300_000
    ? timeoutMs : DASHBOARD_READ_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), duration);
  try {
    return await read(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
