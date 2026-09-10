import { describe, expect, it } from 'vitest';
import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';
import { auditErrorText } from './audit-errors';

describe('Messages des refus Checkout', () => {
  it.each([
    ['fr', fr], ['en', en], ['de', de],
  ] as const)('localise les délais et distingue les paiements à examiner en %s', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'audit' });
    for (const code of ['job_not_found', 'already_paid', 'checkout_expired', 'checkout_in_progress', 'payment_session_mismatch', 'additional_payment', 'job_missing', 'payments_unavailable']) {
      const text = auditErrorText(t, code, 'Texte API de secours');
      expect(text).not.toBe('Texte API de secours');
      expect(text).not.toContain('upload.error.');
      expect(text.length).toBeGreaterThan(20);
    }
    const review = auditErrorText(t, 'job_missing');
    expect(review).toBe(auditErrorText(t, 'additional_payment'));
    expect(review).toContain('support@ibanforge.com');
    expect(review).not.toBe(auditErrorText(t, 'checkout_expired'));
  });

  it('préserve le secours pour un code que le site ne connaît pas encore', () => {
    const t = createTranslator({ locale: 'fr', messages: fr, namespace: 'audit' });
    expect(auditErrorText(t, 'code_futur', 'Information nouvelle')).toBe('Information nouvelle');
    expect(auditErrorText(t)).toBe(t('upload.error.generic'));
  });
});
