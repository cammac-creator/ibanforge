/**
 * The owner's purchase alert names the ORGANISATION behind a key, never the
 * person (ask of 10/11/2026). The alert travels through Telegram, which is not
 * a declared sub-processor: what these tests hold is that no address and no
 * unvetted free text can reach it through this label.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { upsertCompanyProfile } from './company-profiles.js';
import { getStatsDB } from './db.js';
import {
  OWNER_LABEL_MAX,
  cleanOwnerLabel,
  ownerLabelForEmail,
  ownerLabelForKeyPrefix,
} from './owner-label.js';

const RUN = Date.now();
const TAG = `owner-label-${RUN}`;
// example.net on purpose: a `.example` TLD cannot route and would be refused.
const PROSPECT = `achats-${RUN}@alpha.example.net`;
const PROFILED = `it-${RUN}@beta.example.net`;
const BARE = `contact-${RUN}@gamma.example.net`;
const MISFILED = `compta-${RUN}@delta.example.net`;
const PRIVATE = `quelquun-${RUN}@gmail.com`;
const PREFIX = `ifk_${String(RUN).slice(-8)}`;

const db = getStatsDB();
db.prepare('INSERT INTO prospects (id, company, contact_email) VALUES (?, ?, ?)').run(
  `${TAG}-a`,
  'Société Alpha',
  PROSPECT.toUpperCase(),
);
upsertCompanyProfile({ email: PROSPECT, company: 'Alpha (profil)', source: 'site' });
upsertCompanyProfile({ email: PROFILED, company: 'Société Beta', source: 'site' });
upsertCompanyProfile({ email: PRIVATE, company: '', source: 'unresolvable' });
// A company field that holds an address by mistake must never be relayed.
upsertCompanyProfile({
  email: MISFILED,
  company: `ventes-${RUN}@delta.example.net`,
  source: 'manual',
});
db.prepare('INSERT INTO api_keys (key_hash, key_prefix, email) VALUES (?, ?, ?)').run(
  `${TAG}-hash`,
  PREFIX,
  PROFILED,
);

afterAll(() => {
  db.prepare('DELETE FROM prospects WHERE id LIKE ?').run(`${TAG}%`);
  db.prepare('DELETE FROM company_profiles WHERE email LIKE ?').run(`%-${RUN}@%`);
  db.prepare('DELETE FROM api_keys WHERE key_hash LIKE ?').run(`${TAG}%`);
});

describe('the organisation behind a signup address', () => {
  it('prefers the company of the prospect row, matched without regard to case', () => {
    expect(ownerLabelForEmail(PROSPECT)).toBe('Société Alpha');
  });

  it('falls back to the enrichment profile', () => {
    expect(ownerLabelForEmail(PROFILED)).toBe('Société Beta');
  });

  it("falls back to the address's own domain when no company is known", () => {
    expect(ownerLabelForEmail(BARE)).toBe('gamma.example.net');
  });

  it('names nobody behind a public mailbox provider', () => {
    expect(ownerLabelForEmail(PRIVATE)).toBeNull();
  });

  it('names nobody behind a domain that cannot route', () => {
    expect(ownerLabelForEmail(`groupe-${RUN}@cohorte.invalid`)).toBeNull();
  });

  it('never relays a company field that holds an address', () => {
    const label = ownerLabelForEmail(MISFILED);
    expect(label).toBe('delta.example.net');
    expect(label).not.toContain('@');
  });

  it('answers null without an address', () => {
    expect(ownerLabelForEmail(null)).toBeNull();
    expect(ownerLabelForEmail('')).toBeNull();
    expect(ownerLabelForEmail('pas-une-adresse')).toBeNull();
  });
});

describe('the same, from the key prefix the alert carries', () => {
  it('reads the address of the key, then names its organisation', () => {
    expect(ownerLabelForKeyPrefix(PREFIX)).toBe('Société Beta');
  });

  it('answers null for a prefix that belongs to no key', () => {
    expect(ownerLabelForKeyPrefix('ifk_00000000')).toBeNull();
  });
});

describe('what a label may look like', () => {
  it('fits on one line', () => {
    expect(cleanOwnerLabel('  Société\n Alpha\t SA ')).toBe('Société Alpha SA');
  });

  it('is cut to one Telegram line', () => {
    const long = cleanOwnerLabel('A'.repeat(OWNER_LABEL_MAX * 2));
    expect(long).toHaveLength(OWNER_LABEL_MAX);
    expect(long?.endsWith('…')).toBe(true);
  });

  it('refuses anything that looks like an address, and the empty string', () => {
    expect(cleanOwnerLabel('a.dupont@alpha.example.net')).toBeNull();
    expect(cleanOwnerLabel('   ')).toBeNull();
    expect(cleanOwnerLabel(null)).toBeNull();
  });
});
