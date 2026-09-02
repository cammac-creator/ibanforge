import { describe, it, expect, afterAll } from 'vitest';
import {
  GENERIC_EMAIL_DOMAINS,
  customerContextBlock,
  customerContextLines,
  getCompanyProfiles,
  uaWebsite,
  upsertCompanyProfile,
} from './company-profiles.js';
import { getStatsDB } from './db.js';

const RUN = Date.now();
const A = `alpha-${RUN}@alpha.example.net`;
const B = `beta-${RUN}@gmail.com`;

afterAll(() => {
  getStatsDB().prepare('DELETE FROM company_profiles WHERE email LIKE ?').run(`%-${RUN}@%`);
});

describe('company-profiles — identity table', () => {
  it('upserts and reads back, lowercased, empty strings as NULL', () => {
    upsertCompanyProfile({
      email: A.toUpperCase(),
      company: 'Société Alpha',
      website: 'https://alpha.example.net',
      country: 'CH',
      whatTheyDo: `Valide des IBAN de test ${RUN}.`,
      source: 'site',
    });
    upsertCompanyProfile({ email: B, company: '', whatTheyDo: '  ', source: 'unresolvable' });
    const all = getCompanyProfiles();
    expect(all[A].company).toBe('Société Alpha');
    expect(all[A].source).toBe('site');
    expect(all[B].company).toBe(null);
    expect(all[B].what_they_do).toBe(null);
  });

  it('replaces on re-upsert instead of duplicating', () => {
    upsertCompanyProfile({
      email: A,
      company: 'Alpha v2',
      whatTheyDo: `Nouvelle activité ${RUN}.`,
      source: 'manual',
    });
    const row = getCompanyProfiles()[A];
    expect(row.company).toBe('Alpha v2');
    expect(row.source).toBe('manual');
  });
});

describe('uaWebsite — the identity a polite User-Agent advertises', () => {
  it('extracts the +URL convention and ignores UAs without one', () => {
    expect(uaWebsite('AlphaCare/7.0.3.49 (+https://care.alpha.example.net)')).toBe(
      'https://care.alpha.example.net',
    );
    expect(uaWebsite('ibanforge-radar/1.0 (+https://ibanforge.com)')).toBe('https://ibanforge.com');
    expect(uaWebsite('python-requests/2.32.5')).toBe(null);
    expect(uaWebsite('Mozilla/5.0 (Macintosh)')).toBe(null);
  });
});

describe('customerContextLines — the real customer base as prompt context', () => {
  it('surfaces fresh profile descriptions, deduplicated, and wraps them in the guarded block', () => {
    const lines = customerContextLines();
    expect(lines.some((l) => l.includes(`Nouvelle activité ${RUN}`))).toBe(true);
    // The unresolvable row holds no description and must not appear.
    expect(lines.every((l) => l.trim() !== '')).toBe(true);
    const block = customerContextBlock();
    expect(block).toContain('never mention, name');
    expect(block).toContain(`Nouvelle activité ${RUN}`);
  });
});

describe('GENERIC_EMAIL_DOMAINS', () => {
  it('knows a mailbox provider from a company domain', () => {
    expect(GENERIC_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
    expect(GENERIC_EMAIL_DOMAINS.has('proton.me')).toBe(true);
    expect(GENERIC_EMAIL_DOMAINS.has('alpha.example.net')).toBe(false);
  });
});
