import { describe, it, expect } from 'vitest';
import { buildAuditReadyEmail } from './email.js';

describe('buildAuditReadyEmail', () => {
  it('writes the subject and the link in the customer language, without em dashes', () => {
    for (const lang of ['en', 'fr', 'de'] as const) {
      const m = buildAuditReadyEmail({
        to: 'buyer@example.com',
        lang,
        link: 'https://ibanforge.com/fr/audit/done?job=abc&session_id=cs_1',
        rows: 1240,
        price_chf: 149,
      });
      expect(m.subject).toContain('1240');
      expect(m.text).toContain('https://ibanforge.com/fr/audit/done?job=abc&session_id=cs_1');
      expect(m.html).toContain(
        'href="https://ibanforge.com/fr/audit/done?job=abc&session_id=cs_1"',
      );
      expect(m.text).not.toContain('\u2014');
      expect(m.html).toContain('149 CHF');
    }
    expect(
      buildAuditReadyEmail({ to: 'a@b.c', lang: 'fr', link: 'x', rows: 3, price_chf: 149 }).subject,
    ).toBe('Votre audit de fichier de créanciers est prêt (3 lignes)');
  });
});
