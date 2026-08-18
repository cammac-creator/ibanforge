import { describe, expect, it } from 'vitest';
import {
  buildProspectMailPrompt,
  extractEmails,
  parseProspectMail,
  pickEmail,
  recommendedLang,
  sameOrg,
  type ProspectForMail,
} from './prospect-radar.js';

describe('extractEmails', () => {
  it('finds mailto links and plain-text mentions, deduplicated', () => {
    const html = `
      <a href="mailto:contact@alpha.example.net">write us</a>
      <p>or contact@alpha.example.net directly, or team@alpha.example.net</p>`;
    expect(extractEmails(html).sort()).toEqual(['contact@alpha.example.net', 'team@alpha.example.net']);
  });

  it('decodes the cheap entity obfuscations', () => {
    const html = 'reach us: hello&#64;alpha.example.net or <a href="mailto:info%40alpha.example.net">x</a>';
    expect(extractEmails(html).sort()).toEqual(['hello@alpha.example.net', 'info@alpha.example.net']);
  });

  it('does not mistake asset filenames for addresses', () => {
    expect(extractEmails('<img src="logo@2x.png"> <link href="app@1.2.css">')).toEqual([]);
  });
});

describe('sameOrg', () => {
  it('accepts the exact host and subdomains in both directions', () => {
    expect(sameOrg('alpha.example.net', 'alpha.example.net')).toBe(true);
    expect(sameOrg('mail.alpha.example.net', 'alpha.example.net')).toBe(true);
    expect(sameOrg('alpha.example.net', 'app.alpha.example.net')).toBe(true);
    expect(sameOrg('beta.example.org', 'alpha.example.net')).toBe(false);
  });
});

describe('pickEmail', () => {
  const site = 'https://www.alpha.example.net';

  it('keeps own-domain addresses only: a gmail on their page proves nothing', () => {
    expect(pickEmail(['someone@gmail.example.com'], site)).toBe(null);
    expect(pickEmail(['someone@gmail.example.com', 'contact@alpha.example.net'], site)).toBe(
      'contact@alpha.example.net',
    );
  });

  it('never picks a machine or wrong-desk inbox', () => {
    expect(pickEmail(['noreply@alpha.example.net', 'press@alpha.example.net', 'jobs@alpha.example.net'], site)).toBe(
      null,
    );
  });

  it('prefers a generic human inbox, then a person, then the service desks', () => {
    expect(pickEmail(['support@alpha.example.net', 'maria@alpha.example.net', 'hello@alpha.example.net'], site)).toBe(
      'hello@alpha.example.net',
    );
    expect(pickEmail(['support@alpha.example.net', 'maria@alpha.example.net'], site)).toBe('maria@alpha.example.net');
    expect(pickEmail(['support@alpha.example.net'], site)).toBe('support@alpha.example.net');
  });

  it('accepts an address on a subdomain of the site', () => {
    expect(pickEmail(['contact@mail.alpha.example.net'], site)).toBe('contact@mail.alpha.example.net');
  });
});

describe('recommendedLang', () => {
  it('speaks French to the francophone home markets, English elsewhere', () => {
    expect(recommendedLang('CH')).toBe('fr');
    expect(recommendedLang('FR')).toBe('fr');
    expect(recommendedLang('DE')).toBe('en');
    expect(recommendedLang(null)).toBe('en');
  });
});

describe('parseProspectMail', () => {
  it('reads the four marked sections, multi-line bodies intact', () => {
    const out = parseProspectMail(`===SUBJECT_EN===
iban check for your payout flow
===BODY_EN===
Hi,

Two paragraphs.
===SUBJECT_FR===
controle iban pour vos paiements
===BODY_FR===
Bonjour,

Deux paragraphes.
===END===`);
    expect(out?.subjectEn).toBe('iban check for your payout flow');
    expect(out?.bodyEn).toContain('Two paragraphs.');
    expect(out?.bodyFr).toContain('Bonjour,');
  });

  it('returns null when a section is missing, never a half-mail', () => {
    expect(parseProspectMail('===SUBJECT_EN===\nx\n===BODY_EN===\ny\n===END===')).toBe(null);
  });
});

describe('buildProspectMailPrompt', () => {
  const base: ProspectForMail = {
    id: 'p1',
    company: 'Société Alpha',
    website: 'https://alpha.example.net',
    country: 'CH',
    segment: 'x402',
    what_they_do: 'stablecoin off-ramp settling in SEPA',
    fit_reason: 'they push payouts to user IBANs',
    buying_signal: null,
    signal_source_url: null,
    personalization_hook: 'their docs mention manual IBAN checks',
    contact_name: null,
    contact_role: null,
  };

  it('carries the hook and says when no contact name is known', () => {
    const prompt = buildProspectMailPrompt(base);
    expect(prompt).toContain('Société Alpha');
    expect(prompt).toContain('manual IBAN checks');
    expect(prompt).toContain('neutral greeting');
  });

  it('names the contact when one exists', () => {
    const prompt = buildProspectMailPrompt({ ...base, contact_name: 'Maria Muster', contact_role: 'CTO' });
    expect(prompt).toContain('Maria Muster (CTO)');
  });
});
