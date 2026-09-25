import { describe, expect, it } from 'vitest';
import {
  buildActivationNudgeEmail,
  buildApiKeyEmail,
  buildCreditsWarningEmail,
  buildFreeKeyEmail,
  buildOemKeyEmail,
  buildProKeyEmail,
  buildQuotaWarningEmail,
} from './email.js';
import { FREE_TIER_MONTHLY_LIMIT } from './tiers.js';

/**
 * La page du compte, là où un client la cherche (lot C3, 25.09.2026).
 *
 * Un client au pack a demandé son solde : aucun mail ne lui disait qu'il
 * pouvait le lire sans coller sa clé, et le lien menait à `/en/account`, une
 * adresse qui ne vit plus que par une redirection. Chaque mail qui porte une
 * clé (ou qui en parle à son porteur) dit donc désormais deux choses : l'adresse
 * de la page, à la racine, et qu'on s'y connecte avec l'adresse de ce mail.
 *
 * 🚨 L'adresse attendue est écrite EN LITTÉRAL, jamais relue dans
 * `ACCOUNT_PAGE` : un test qui compare un mail à la constante passe quelle que
 * soit sa valeur, et remettre `/en/` dans la constante ne le ferait pas rougir.
 *
 * Fixtures inventées (CLAUDE.md) : une clé de forme réelle qui n'est à personne.
 */
const ACCOUNT_URL = 'https://ibanforge.com/account';
const OLD_URL = 'ibanforge.com/en/account';
const SIGN_IN = /with this e-mail address, no key to paste/i;

const FAKE_KEY = 'ifk_' + 'a1b2c3d4'.repeat(8);
const FAKE_PREFIX = FAKE_KEY.slice(0, 12);

const MAILS: Record<string, { subject: string; text: string; html: string }> = {
  'clé gratuite': buildFreeKeyEmail({ rawKey: FAKE_KEY, monthlyLimit: FREE_TIER_MONTHLY_LIMIT }),
  'achat de pack': buildApiKeyEmail({ rawKey: FAKE_KEY, credits: 1000, bundle: '1k' }),
  'relance de la première clé': buildActivationNudgeEmail({ keyPrefix: FAKE_PREFIX }),
  'alerte à 80 %': buildQuotaWarningEmail({
    used: Math.round(FREE_TIER_MONTHLY_LIMIT * 0.8),
    limit: FREE_TIER_MONTHLY_LIMIT,
    month: '2026-09',
    keyPrefix: FAKE_PREFIX,
  }),
  'alerte à 10 % du pack': buildCreditsWarningEmail({
    keyPrefix: FAKE_PREFIX,
    remaining: 100,
    total: 1000,
    proMonthlyLimit: 10_000,
  }),
  Pro: buildProKeyEmail({ rawKey: FAKE_KEY, monthlyLimit: 10_000 }),
  éditeur: buildOemKeyEmail({ rawKey: FAKE_KEY, monthlyLimit: 50_000 }),
};

describe('chaque mail client mène à la page du compte, à la racine', () => {
  it.each(Object.entries(MAILS))('%s : le texte et le HTML', (_name, mail) => {
    expect(mail.text, 'partie texte').toContain(ACCOUNT_URL);
    expect(mail.html, 'partie HTML : un lien, pas seulement une mention').toContain(
      `href="${ACCOUNT_URL}"`,
    );
    expect(mail.text).not.toContain(OLD_URL);
    expect(mail.html).not.toContain(OLD_URL);
  });
});

describe('chaque mail client dit comment se connecter, sans clé à coller', () => {
  it.each(Object.entries(MAILS))(
    '%s : la phrase de connexion, dans les deux parties',
    (_n, mail) => {
      expect(mail.text, 'partie texte').toMatch(SIGN_IN);
      expect(mail.html, 'partie HTML').toMatch(SIGN_IN);
    },
  );

  it.each(Object.entries(MAILS))('%s : ne demande plus de coller la clé', (_n, mail) => {
    for (const part of [mail.text, mail.html]) {
      expect(part).not.toMatch(/paste (this|the) key/i);
    }
  });
});

describe('le mail Pro ou éditeur nomme le compte', () => {
  it.each([
    ['Pro', MAILS.Pro],
    ['éditeur', MAILS['éditeur']],
  ])('%s : solde, consommation, abonnement', (_n, mail) => {
    expect(mail.text).toContain(`Your account (balance, usage, subscription): ${ACCOUNT_URL}`);
    expect(mail.html).toContain('Your account: balance, usage, subscription');
    expect(mail.text).not.toContain('key at a glance');
    expect(mail.html).not.toContain('key at a glance');
  });
});
