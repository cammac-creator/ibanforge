/**
 * Les textes des alertes de quota (chantier « compte client et alertes », lot 1,
 * 27.11.2026) : une clé gratuite garde SON texte, une clé qui paie lit celui de
 * sa formule, et le code d'une adresse ajoutée ne dit rien de ce que le
 * titulaire a saisi. Fixtures inventées (dépôt public).
 */
import { describe, it, expect } from 'vitest';
import { buildAlertRecipientCodeEmail, buildQuotaWarningEmail } from './email.js';

const base = { used: 160, limit: 200, month: '2026-11', keyPrefix: 'ifk_aaaaaaaa' };
const DASHES = /[—–]/;

describe('la clé gratuite : le texte d’avant, à l’identique', () => {
  const mail = buildQuotaWarningEmail(base);

  it('dit « free » et « until the 1st », sous le titre d’avant', () => {
    expect(mail.subject).toBe('You are at 80% of your IBANforge free tier (80% alert)');
    expect(mail.text).toContain('has used 160 of its 200 free requests for 2026-11');
    expect(mail.text).toContain('before validation stops until the 1st of next month');
    expect(mail.html).toContain('You are at 80% of your free tier');
  });

  it('le seuil qui a déclenché l’alerte se lit dans l’objet', () => {
    expect(buildQuotaWarningEmail({ ...base, used: 100, threshold: 50 }).subject).toBe(
      'You are at 50% of your IBANforge free tier (50% alert)',
    );
  });

  it('une clé qui n’a pas de formule dite reste gratuite : le plan « free » change rien', () => {
    expect(buildQuotaWarningEmail({ ...base, plan: 'free' })).toEqual(mail);
  });
});

describe('la clé qui paie : le texte de SA formule', () => {
  const resetsAt = '2026-12-01T00:00:00.000Z';
  const pro = buildQuotaWarningEmail({
    ...base,
    used: 9000,
    limit: 10_000,
    plan: 'pro',
    resetsAt,
    threshold: 90,
  });

  it('dit l’allocation de la formule, jamais « free »', () => {
    expect(pro.subject).toBe('You are at 90% of your IBANforge Pro plan (90% alert)');
    expect(pro.text).toContain(
      'has used 9,000 of the 10,000 requests of your Pro plan for 2026-11',
    );
    for (const part of [pro.subject, pro.text, pro.html]) {
      expect(part).not.toMatch(/free/i);
      expect(part).not.toContain('until the 1st');
    }
  });

  it('dit ce qui arrive au plafond et la date exacte de la remise à zéro', () => {
    expect(pro.text).toContain('answer HTTP 402');
    expect(pro.text).toContain('starts over on 2026-12-01 00:00 UTC');
    expect(pro.html).toContain('2026-12-01 00:00 UTC');
  });

  it('avec des crédits sur la clé, ils prennent le relais, sans 402 annoncé', () => {
    const mixed = buildQuotaWarningEmail({
      ...base,
      used: 9000,
      limit: 10_000,
      plan: 'pro',
      resetsAt,
      creditsRemaining: 1200,
    });
    expect(mixed.text).toContain('your 1,200 prepaid credits on this key take over');
    expect(mixed.text).not.toContain('answer HTTP 402');
  });

  it('un autre abonnement que Pro est nommé « subscription », pas « Pro »', () => {
    const editor = buildQuotaWarningEmail({
      ...base,
      used: 40_000,
      limit: 50_000,
      plan: 'subscription',
      resetsAt,
    });
    expect(editor.text).toContain('of your subscription');
    expect(editor.text).not.toContain('Pro plan');
  });

  it('propose les crédits sur CETTE clé et renvoie vers les réglages d’alerte', () => {
    const withRef = buildQuotaWarningEmail({
      ...base,
      used: 9000,
      limit: 10_000,
      plan: 'pro',
      resetsAt,
      topupRef: 'ref-alpha-1',
    });
    expect(withRef.text).toContain('lands on this same key');
    expect(withRef.text).toContain('50, 80, 90 or 100%');
    expect(withRef.text).toContain('up to 3 more addresses');
  });

  it('pas de tiret long, ni dans le texte ni dans le HTML', () => {
    for (const m of [pro, buildQuotaWarningEmail({ ...base, plan: 'subscription' })]) {
      expect(DASHES.test(m.subject + m.text + m.html)).toBe(false);
    }
  });
});

describe('une adresse AJOUTÉE reçoit la phrase qui dit pourquoi et comment arrêter', () => {
  it.each([{ plan: 'free' as const }, { plan: 'pro' as const }])('%j', (extra) => {
    const m = buildQuotaWarningEmail({ ...base, ...extra, extraRecipient: true });
    expect(m.text).toContain('added your address to its usage alerts and you confirmed it');
    expect(m.text).toContain('Reply STOP');
    expect(m.html).toContain('Reply STOP');
    expect(m.text).toContain('ask the key holder to remove your address');
    // Une adresse ajoutée n'est l'adresse d'aucune clé : on ne lui dit jamais de
    // se connecter avec elle, ni de régler des alertes qu'elle ne possède pas.
    for (const part of [m.text, m.html]) {
      expect(part).not.toContain('Sign in with this e-mail address');
      expect(part).not.toContain('add up to 3 more addresses');
      expect(part).not.toContain('Choose the thresholds');
    }
    expect(m.text).toContain('The key holder can see');
    const plain = buildQuotaWarningEmail({ ...base, ...extra });
    expect(plain.text).not.toContain('Reply STOP');
    expect(plain.html).not.toContain('Reply STOP');
  });
});

describe('le code d’une adresse ajoutée', () => {
  const mail = buildAlertRecipientCodeEmail({ code: '482913', ttlMinutes: 15 });

  it('porte le code seul sur sa ligne, dans l’objet et dans le texte', () => {
    expect(mail.subject).toBe('482913 confirms your address for IBANforge usage alerts');
    expect(mail.text).toMatch(/^482913$/m);
    expect(mail.html).toContain('482913');
    expect(mail.text).toContain('valid 15 minutes');
  });

  it('dit que l’ignorer suffit : sans code, elle ne reçoit rien', () => {
    expect(mail.text).toContain('ignore this mail');
    expect(mail.text).toContain('you will receive no alerts');
    // Jamais une promesse absolue : le titulaire peut ajouter l'adresse de nouveau.
    expect(mail.text).not.toContain('nothing more will be sent');
  });

  it('ne contient aucun lien, aucun tiret long, aucune adresse, aucun préfixe de clé', () => {
    const all = `${mail.subject}\n${mail.text}\n${mail.html}`;
    expect(all).not.toMatch(/https?:\/\//);
    expect(all).not.toContain('@');
    expect(all).not.toContain('ifk_');
    expect(DASHES.test(all)).toBe(false);
  });
});
