import { playgroundVerdict } from '@/lib/playground-verdict';
import type { RayState } from './engine';

export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);

/** Les lumières suivent les constats reçus ; une source partielle ne confirme pas un compte. */
export function lensResponse(payload: Record<string, unknown>) {
  const verdict = playgroundVerdict(payload, 'iban');
  const bankKnown = ['verified', 'matched', 'retired', 'ambiguous'].includes(verdict.bankStatus);
  const bic = payload.valid === true && verdict.bankStatus !== 'notAllocated' ? verdict.bic : null;
  const states: RayState[] = [
    verdict.structure === 'valid' ? 'ok' : verdict.structure === 'invalid' ? 'erreur' : 'absent',
    verdict.bankStatus === 'notAllocated' || verdict.localCheckInvalid
      ? 'erreur'
      : bankKnown
        ? 'ok'
        : 'absent',
    bic ? 'ok' : 'absent',
  ];
  // Les crédits et réserves éventuels sont reproduits sans réduction.
  const notices = new Set<string>();
  function collect(value: unknown, depth = 0) {
    if (depth > 8 || !value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (
        [
          'attribution',
          'disclaimer',
          'notice',
          'credit',
          'license_notice',
          'licence_notice',
        ].includes(key)
      ) {
        const sentence = text(item) ?? text(record(item).text);
        if (sentence) notices.add(sentence);
      }
      collect(item, depth + 1);
    }
  }
  collect(payload);
  return {
    verdict,
    states,
    bic,
    bankName: bankKnown ? verdict.bankName : null,
    notices: [...notices],
  };
}
