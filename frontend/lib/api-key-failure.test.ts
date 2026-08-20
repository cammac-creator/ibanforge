import { describe, expect, it } from 'vitest';
import { KEY_FAILURE_MESSAGE_KEYS, routeKeyFailure } from './api-key-failure';
import en from '../messages/en.json';
import fr from '../messages/fr.json';
import de from '../messages/de.json';

/**
 * The refusals below are not invented: each one was played against a local
 * server on 2026-08-20 (`POST /v1/keys/generate`, mail relay stubbed) and the
 * `error` / `reason` pairs are the ones the route actually returned.
 */
describe('routeKeyFailure', () => {
  it('opens the code step on verification_required, with no scolding notice', () => {
    expect(routeKeyFailure('verification_required', undefined)).toEqual({
      step: 'verify',
      notice: null,
    });
  });

  it('KEEPS the visitor on the code step when the code is merely wrong', () => {
    // The challenge is still alive: sending them back to the e-mail field
    // would mail a second code and waste the daily allowance for that address.
    expect(routeKeyFailure('verification_failed', 'wrong_code')).toEqual({
      step: 'verify',
      notice: 'verify.wrongCode',
    });
  });

  it('LEAVES the code step once the challenge is locked, correct code or not', () => {
    // Measured 2026-08-20 against a local server: `checkVerificationCode`
    // tests the attempt counter before comparing digits, so a locked challenge
    // answers `too_many_attempts` to the RIGHT code too. A code field that can
    // no longer accept any code is the dead end this whole lot removes.
    expect(routeKeyFailure('verification_failed', 'too_many_attempts')).toEqual({
      step: 'form',
      notice: 'verify.locked',
    });
  });

  it('returns to the e-mail step whenever the challenge is gone', () => {
    for (const reason of ['expired', 'no_challenge', 'some_reason_added_later']) {
      expect(routeKeyFailure('verification_failed', reason)).toEqual({
        step: 'form',
        notice: 'verify.expired',
      });
    }
  });

  it('keeps a fixable address on the form instead of a dead-end screen', () => {
    expect(routeKeyFailure('disposable_email', undefined)).toEqual({
      step: 'form',
      notice: 'errors.disposableEmail',
    });
    expect(routeKeyFailure('invalid_email', undefined)).toEqual({
      step: 'form',
      notice: 'errors.invalidEmail',
    });
    expect(routeKeyFailure('invalid_json', undefined)).toEqual({
      step: 'form',
      notice: 'errors.invalidEmail',
    });
  });

  it('stops, in the visitor language, on the four refusals nothing can fix now', () => {
    expect(routeKeyFailure('verification_rate_limited', undefined)).toEqual({
      step: 'stop',
      message: 'errors.verificationRateLimited',
    });
    expect(routeKeyFailure('verification_unavailable', undefined)).toEqual({
      step: 'stop',
      message: 'errors.verificationUnavailable',
    });
    expect(routeKeyFailure('key_creation_limit', undefined)).toEqual({
      step: 'stop',
      message: 'errors.keyCreationLimit',
    });
    expect(routeKeyFailure('rate_limited', undefined)).toEqual({
      step: 'stop',
      message: 'errors.rateLimited',
    });
  });

  it('falls back to the API message on anything it does not know', () => {
    expect(routeKeyFailure('some_future_error', undefined)).toEqual({
      step: 'stop',
      message: null,
    });
    expect(routeKeyFailure(undefined, undefined)).toEqual({ step: 'stop', message: null });
  });
});

describe('i18n coverage', () => {
  const dialogs: Array<[string, Record<string, unknown>]> = [
    ['en', en.apiKeyDialog as unknown as Record<string, unknown>],
    ['fr', fr.apiKeyDialog as unknown as Record<string, unknown>],
    ['de', de.apiKeyDialog as unknown as Record<string, unknown>],
  ];

  /** next-intl throws at render time on a missing key, so this is not cosmetic. */
  it.each(dialogs)('%s translates every message routeKeyFailure can return', (_locale, dialog) => {
    for (const path of KEY_FAILURE_MESSAGE_KEYS) {
      const value = path
        .split('.')
        .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], dialog);
      expect(typeof value, `apiKeyDialog.${path} is missing`).toBe('string');
      expect((value as string).length).toBeGreaterThan(0);
    }
  });

  it.each(dialogs)('%s carries the whole verify step, including the {email} slot', (_locale, dialog) => {
    const verify = dialog.verify as Record<string, string> | undefined;
    for (const key of [
      'eyebrow', 'title', 'subtitle', 'why', 'codeLabel', 'submit', 'submitting', 'changeEmail',
    ]) {
      expect(typeof verify?.[key], `apiKeyDialog.verify.${key} is missing`).toBe('string');
    }
    // The visitor has to see WHICH mailbox to open; a subtitle without the
    // placeholder would silently drop the address.
    expect(verify?.subtitle).toContain('{email}');
  });
});
