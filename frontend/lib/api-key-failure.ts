/**
 * What the key dialog must DO with a refusal from `POST /v1/keys/generate`.
 *
 * Kept out of the component so it can be tested without a DOM, because this
 * table is the thing that was broken: until 2026-08-20 every refusal routed to
 * one terminal error screen whose only button re-sent the request unchanged.
 * On `403 verification_required` that button mailed a fresh 6-digit code on
 * every press, burned the daily send allowance for that address, and came back
 * to the same wall. Anyone behind a shared office NAT, a VPN or a carrier
 * CGNAT, and anyone asking for a second key, could not get one from the web.
 *
 * The rule that makes the difference, and the reason `wrong_code` and
 * `too_many_attempts` do NOT route the same way: a merely wrong code leaves
 * the challenge alive, so the visitor stays on the code step with the code
 * they already received. Every other verification failure means the challenge
 * is unusable and only a NEW request can help, which is what the API's own
 * message prescribes ("request a key again without a code to receive a fresh
 * one").
 *
 * `too_many_attempts` belongs to that second group, and the reason is not
 * obvious from its name. `checkVerificationCode` tests the attempt counter
 * BEFORE comparing the digits, so once a challenge is locked it answers
 * `too_many_attempts` to the CORRECT code too (measured on 2026-08-20: five
 * wrong codes, then the real one, still 403). Keeping the visitor on a code
 * field that can no longer accept any code would rebuild the dead end this
 * whole lot exists to remove. Asking again without a code re-issues the
 * challenge with `attempts = 0` and works immediately (measured too).
 *
 * Returned strings are `apiKeyDialog.*` message keys, never sentences: the
 * component owns the translation, this module owns the decision.
 */
export type KeyFailureRoute =
  /** Ask for the 6-digit code. `notice` is null on a freshly mailed code. */
  | { step: 'verify'; notice: null | 'verify.wrongCode' | 'verify.locked' }
  /** Back to the e-mail field, with an inline explanation above it. */
  | {
      step: 'form';
      notice: 'verify.expired' | 'verify.locked' | 'errors.disposableEmail' | 'errors.invalidEmail';
    }
  /**
   * Nothing the visitor can do in this dialog right now. `message` is null
   * when we have no translation, and the API's own message is then shown: it
   * is written to be actionable, and an English sentence beats an empty one.
   */
  | { step: 'stop'; message: string | null };

const TERMINAL: Record<string, string> = {
  verification_rate_limited: 'errors.verificationRateLimited',
  verification_unavailable: 'errors.verificationUnavailable',
  key_creation_limit: 'errors.keyCreationLimit',
  rate_limited: 'errors.rateLimited',
};

export function routeKeyFailure(error: unknown, reason: unknown): KeyFailureRoute {
  const kind = typeof error === 'string' ? error : '';
  const why = typeof reason === 'string' ? reason : '';

  if (kind === 'verification_required') return { step: 'verify', notice: null };

  if (kind === 'verification_failed') {
    // The only failure a code field can still fix.
    if (why === 'wrong_code') return { step: 'verify', notice: 'verify.wrongCode' };
    if (why === 'too_many_attempts') return { step: 'form', notice: 'verify.locked' };
    // expired, no_challenge, and any reason added later: the challenge is gone.
    return { step: 'form', notice: 'verify.expired' };
  }

  // Fixable on the spot: keep the e-mail field so it can just be edited.
  if (kind === 'disposable_email') return { step: 'form', notice: 'errors.disposableEmail' };
  if (kind === 'invalid_email' || kind === 'invalid_json') {
    return { step: 'form', notice: 'errors.invalidEmail' };
  }

  return { step: 'stop', message: TERMINAL[kind] ?? null };
}

/** Every message key this module can hand back, for the i18n coverage test. */
export const KEY_FAILURE_MESSAGE_KEYS: string[] = [
  'verify.wrongCode',
  'verify.locked',
  'verify.expired',
  'errors.disposableEmail',
  'errors.invalidEmail',
  ...Object.values(TERMINAL),
];
