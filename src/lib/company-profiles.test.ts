import { describe, it, expect, afterAll } from 'vitest';
import {
  GENERIC_EMAIL_DOMAINS,
  carryCompanyProfile,
  getCompanyProfile,
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

/**
 * 13 November 2026: the Privacy Policy says the description is deleted with
 * the address. A relabel rewrites the address of a key; without this the
 * profile stayed under the old one, where an erasure request made with the
 * new address would not find it.
 */
describe('carryCompanyProfile — the profile follows the address of the key', () => {
  const db = getStatsDB();
  const key = (prefix: string, email: string): void => {
    db.prepare('INSERT INTO api_keys (key_hash, key_prefix, email) VALUES (?, ?, ?)').run(
      `carry-hash-${prefix}`,
      prefix,
      email,
    );
  };
  const profile = (email: string, text: string): void =>
    upsertCompanyProfile({ email, company: 'Société Alpha', whatTheyDo: text, source: 'manual' });
  afterAll(() => {
    db.prepare('DELETE FROM api_keys WHERE key_prefix LIKE ?').run(`ibf_carry_${RUN}%`);
  });

  it('moves the profile to a real new address that has none', () => {
    const from = `ancienne-${RUN}@alpha.example.net`;
    const to = `nouvelle-${RUN}@alpha.example.net`;
    profile(from, `Facturation ${RUN}.`);
    key(`ibf_carry_${RUN}_a`, to);
    carryCompanyProfile(from.toUpperCase(), to);
    expect(getCompanyProfile(from)).toBeNull();
    expect(getCompanyProfile(to)?.what_they_do).toBe(`Facturation ${RUN}.`);
  });

  it('deletes it when the new address is a grouping label', () => {
    const from = `groupee-${RUN}@alpha.example.net`;
    profile(from, `Paie ${RUN}.`);
    carryCompanyProfile(from, `groupe-${RUN}@cohorte.invalid`);
    expect(getCompanyProfile(from)).toBeNull();
    expect(getCompanyProfile(`groupe-${RUN}@cohorte.invalid`)).toBeNull();
  });

  it('deletes it when the new address already has its own profile', () => {
    const from = `doublon-${RUN}@alpha.example.net`;
    const to = `titulaire-${RUN}@alpha.example.net`;
    profile(from, `Ancienne ${RUN}.`);
    profile(to, `Titulaire ${RUN}.`);
    carryCompanyProfile(from, to);
    expect(getCompanyProfile(from)).toBeNull();
    expect(getCompanyProfile(to)?.what_they_do).toBe(`Titulaire ${RUN}.`);
  });

  it('leaves it alone while another key still carries the old address', () => {
    const from = `partagee-${RUN}@alpha.example.net`;
    profile(from, `Partagée ${RUN}.`);
    key(`ibf_carry_${RUN}_b`, from);
    carryCompanyProfile(from, `ailleurs-${RUN}@alpha.example.net`);
    expect(getCompanyProfile(from)?.what_they_do).toBe(`Partagée ${RUN}.`);
  });
});

describe('GENERIC_EMAIL_DOMAINS', () => {
  it('knows a mailbox provider from a company domain', () => {
    expect(GENERIC_EMAIL_DOMAINS.has('gmail.com')).toBe(true);
    expect(GENERIC_EMAIL_DOMAINS.has('proton.me')).toBe(true);
    expect(GENERIC_EMAIL_DOMAINS.has('alpha.example.net')).toBe(false);
  });
});

/**
 * POST /v1/admin/company-profiles (11.11.2026) : une source absente ou inconnue
 * n'est plus une validation. Elle était rangée comme `manual`, comme si une
 * personne l'avait relue ; elle est rangée `unspecified`, à valider.
 */
describe('POST /v1/admin/company-profiles', () => {
  const SECRET = `admin-secret-for-the-profiles-test-${RUN}`;
  const before = process.env.ADMIN_SECRET;
  const post = async (profiles: unknown[]) => {
    process.env.ADMIN_SECRET = SECRET;
    try {
      const { apiKeys } = await import('../routes/api-keys.js');
      const { Hono } = await import('hono');
      return await new Hono().route('/', apiKeys).request('/v1/admin/company-profiles', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Admin-Secret': SECRET },
        body: JSON.stringify({ profiles }),
      });
    } finally {
      if (before === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = before;
    }
  };

  it('stores a profile without a known source as unspecified, never as validated', async () => {
    const absent = `sans-source-${RUN}@alpha.example.net`;
    const unknown = `source-inconnue-${RUN}@alpha.example.net`;
    const manual = `manuelle-${RUN}@alpha.example.net`;
    const res = await post([
      { email: absent, what_they_do: `Sans source ${RUN}.` },
      { email: unknown, what_they_do: `Source inconnue ${RUN}.`, source: 'radar' },
      { email: manual, what_they_do: `Validée ${RUN}.`, source: 'manual' },
    ]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ upserted: 3, to_validate: 2 });
    const all = getCompanyProfiles();
    expect(all[absent]?.source).toBe('unspecified');
    expect(all[unknown]?.source).toBe('unspecified');
    expect(all[manual]?.source).toBe('manual');
  });
});
