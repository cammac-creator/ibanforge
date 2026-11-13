import { describe, it, expect, afterAll } from 'vitest';
import {
  GENERIC_EMAIL_DOMAINS,
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
