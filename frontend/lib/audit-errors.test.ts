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

/**
 * 11.11.2026 (C23) : « Le fichier dépasse 10 Mo. » s'affichait pour tout
 * `file_too_large`, alors que seul le 413 de la route est un refus en octets.
 * Les autres viennent de l'ouverture du fichier ; leurs messages ci-dessous ont
 * la forme de ceux de l'API (`src/lib/audit-file.ts`, `src/routes/audit.ts`).
 */
describe('Refus de taille et audit plein', () => {
  const OPENED = [
    'The workbook expands to more than 40 MB once unzipped; the audit reads at most that much.',
    'The workbook holds more than 200 parts; the audit reads one sheet of creditors.',
    'The sheet has 300 columns; the audit reads at most 100 columns. Remove the unused columns and upload it again.',
    'The sheet spans 20000 rows by 90 columns; the audit reads at most 50 columns over 20000 rows. Remove the unused columns and upload it again.',
    'The sheet holds more than 1000000 formatted empty cells; clear the formatting outside the data and upload it again.',
    'The table holds more than 4000000 characters of text; the audit reads at most that much. Remove the columns or notes the audit does not need and upload the file again.',
    'A cell holds more than 32767 characters, the most a spreadsheet cell holds, so the report could not carry it. Shorten that cell and upload the file again.',
    'The sheet is larger than the audit reads. Remove the unused rows and columns and upload it again.',
    'The annotated report for this file would weigh more than 30 MB, more than the audit keeps before payment. Split the file and upload the parts.',
  ];

  it.each([
    ['fr', fr], ['en', en], ['de', de],
  ] as const)('ne dit « 10 Mo » que pour le refus en octets, en %s', (locale, messages) => {
    const t = createTranslator({ locale, messages, namespace: 'audit' });
    const bytes = auditErrorText(t, 'file_too_large', 'The file must be under 10 MB.', { status: 413 });
    expect(bytes).toBe(t('upload.error.tooLarge'));
    for (const message of OPENED) {
      const text = auditErrorText(t, 'file_too_large', message, { status: 400 });
      expect(text).not.toContain(t('upload.error.tooLarge'));
      expect(text).not.toMatch(/10 M[oB]/);
      expect(text.startsWith(t('upload.error.tooBig'))).toBe(true);
      expect(text).toContain(message);
    }
    expect(auditErrorText(t, 'file_too_large', undefined, { status: 400 })).toBe(t('upload.error.tooBig'));
  });

  it.each([
    ['fr', fr, 'environ 25 minutes'], ['en', en, 'about 25 minutes'], ['de', de, 'etwa 25 Minuten'],
  ] as const)('dit l’attente de capacity_reached en mots, en %s', (locale, messages, words) => {
    const t = createTranslator({ locale, messages, namespace: 'audit' });
    const tCommon = createTranslator({ locale, messages, namespace: 'common' });
    const waitText = (p: { unit: string; count: string }) => tCommon('wait', { unit: p.unit, count: p.count });
    const api = 'The audit is holding as many unpaid reports as it keeps at once.';
    const text = auditErrorText(t, 'capacity_reached', api, { status: 503, retryAfter: '1500', waitText });
    expect(text).toContain(words);
    expect(text).not.toContain(api);
    for (const retryAfter of [null, '', '0', 'abc']) {
      expect(auditErrorText(t, 'capacity_reached', api, { status: 503, retryAfter, waitText })).toBe(
        t('upload.error.capacityLater'),
      );
    }
    // Sans l'en-tête lisible, jamais un délai inventé.
    expect(auditErrorText(t, 'capacity_reached', api)).toBe(t('upload.error.capacityLater'));
  });
});
