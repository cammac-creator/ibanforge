import { describe, it, expect } from 'vitest';
import { buildAccountCodeEmail } from './email.js';
import { VERIFICATION_TTL_MINUTES } from './key-creation-guard.js';

/**
 * Le mail du code de connexion au compte (lot C1, relecture de sécurité).
 *
 * Il part que l'adresse porte des clés ou non : c'est ce qui rend la connexion
 * muette sur l'existence d'un compte. Ces trois règles sont donc des
 * protections, pas du style : un mot sur les clés trahirait ce que la route
 * tait, et un lien serait le premier geste qu'un hameçonnage imite.
 */
const mail = buildAccountCodeEmail({ code: '482915', ttlMinutes: VERIFICATION_TTL_MINUTES });
const parts = { subject: mail.subject, text: mail.text, html: mail.html };

describe('buildAccountCodeEmail', () => {
  it('le mail ne dit rien des clés', () => {
    for (const [name, body] of Object.entries(parts)) {
      expect(body, name).not.toMatch(/\bkeys?\b/i);
      expect(body, name).not.toMatch(/\bapi\b/i);
      expect(body, name).not.toContain('ifk_');
      expect(body, name).not.toMatch(/credit|balance|account page/i);
    }
  });

  it('aucun lien', () => {
    for (const [name, body] of Object.entries(parts)) {
      expect(body, name).not.toMatch(/https?:\/\//i);
      expect(body, name).not.toMatch(/\bwww\./i);
      expect(body, name).not.toMatch(/<a\b|href\s*=/i);
      // Un nom de domaine nu est rendu cliquable par la plupart des clients de
      // messagerie : c'est un lien aussi.
      expect(body, name).not.toMatch(/\b[a-z0-9-]+\.(com|net|org|ch|io|dev)\b/i);
    }
  });

  it('aucun tiret long', () => {
    for (const [name, body] of Object.entries(parts)) {
      expect(/[—–]/.test(body), name).toBe(false);
    }
  });

  it('le code est en tête de l’objet et seul sur sa ligne, et la durée vient de la constante', () => {
    expect(mail.subject).toBe('482915 is your IBANforge sign-in code');
    expect(mail.text.split('\n')).toContain('482915');
    expect(mail.text).toContain(`within ${VERIFICATION_TTL_MINUTES} minutes`);
    expect(mail.html).toContain(`within ${VERIFICATION_TTL_MINUTES} minutes`);
    // La phrase qui rassure la personne qui n'a rien demandé.
    expect(mail.text).toContain('nobody can sign in without this code');
  });

  it('le mail dit de ne jamais transmettre le code, dans ses deux parties', () => {
    // N'importe qui peut faire envoyer un code à n'importe quelle adresse : la
    // mise en garde est la parade à la personne qui le demanderait ensuite.
    const warning = 'Never share this code. IBANforge will never ask you for it.';
    expect(mail.text).toContain(warning);
    expect(mail.html).toContain(warning);
  });
});
