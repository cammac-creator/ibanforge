/**
 * The owner's purchase alert carries the COMPANY LABEL our tables hold for a
 * key (ask of 10/11/2026). The alert travels through Telegram, which is not a
 * declared sub-processor. What these tests hold: the key's address never
 * reaches the label, a public mailbox provider is never shown as a client, and
 * a prefix shared by two addresses names nobody. What they do NOT claim: that
 * a company label cannot be a one-person business's trading name; that case is
 * pinned below as the behaviour the owner accepted.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { GENERIC_EMAIL_DOMAINS, upsertCompanyProfile } from './company-profiles.js';
import { getStatsDB } from './db.js';
import { PUBLIC_MAILBOX_DOMAINS } from './key-creation-guard.js';
import {
  OWNER_LABEL_MAX,
  cleanOwnerLabel,
  isPublicMailboxDomain,
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
const SOLO = `studio-${RUN}@epsilon.example.net`;
const PREFIX = `ifk_${String(RUN).slice(-8)}`;
const SHARED = `ifk_${String(RUN + 1).slice(-8)}`;
const TWICE = `ifk_${String(RUN + 2).slice(-8)}`;

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
// A one-person business: the "company" our tables hold is a trading name.
upsertCompanyProfile({ email: SOLO, company: 'Atelier Epsilon', source: 'site' });
const insertKey = db.prepare('INSERT INTO api_keys (key_hash, key_prefix, email) VALUES (?, ?, ?)');
insertKey.run(`${TAG}-hash`, PREFIX, PROFILED);
// One prefix, two addresses. db.ts makes the prefix unique only when the base
// held no duplicate at boot; where it could not, the index is absent and the
// label must still not guess. This file's base is its own: drop the index to
// stand in that case.
db.exec('DROP INDEX IF EXISTS idx_api_keys_prefix_unique');
insertKey.run(`${TAG}-shared-a`, SHARED, PROFILED);
insertKey.run(`${TAG}-shared-b`, SHARED, PROSPECT);
// One prefix, the same address twice (written in two casings): still one client.
insertKey.run(`${TAG}-twice-a`, TWICE, PROFILED);
insertKey.run(`${TAG}-twice-b`, TWICE, PROFILED.toUpperCase());

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

  // The enrichment list alone missed access providers: the alert would have
  // said "Client : <the provider>" for a private person (review of PR 587).
  it.each([
    'sunrise.ch',
    'hispeed.ch',
    'bluewin.ch',
    'hotmail.ch',
    'hotmail.fr',
    'gmx.com',
    't-online.de',
    'orange.fr',
    'free.fr',
    'laposte.net',
    'tuta.io',
  ])('names nobody behind %s', (domain) => {
    expect(ownerLabelForEmail(`quelquun-${RUN}@${domain}`)).toBeNull();
  });

  it('knows every domain of both lists as a mailbox provider', () => {
    for (const domain of [...GENERIC_EMAIL_DOMAINS, ...PUBLIC_MAILBOX_DOMAINS]) {
      expect(isPublicMailboxDomain(domain)).toBe(true);
      expect(isPublicMailboxDomain(domain.toUpperCase())).toBe(true);
    }
    expect(isPublicMailboxDomain('alpha.example.net')).toBe(false);
  });

  /**
   * Pinned on purpose, not an oversight: a company label is free text and a
   * one-person business's label is its trading name. The owner chose "company
   * name" knowing it (10/11/2026); nothing here pretends to tell the two apart.
   */
  it('relays the company label as the tables hold it, a trading name included', () => {
    expect(ownerLabelForEmail(SOLO)).toBe('Atelier Epsilon');
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

  it('names nobody when two addresses share the prefix, rather than guess', () => {
    expect(ownerLabelForKeyPrefix(SHARED)).toBeNull();
  });

  it('still names the client when the prefix repeats under one address', () => {
    expect(ownerLabelForKeyPrefix(TWICE)).toBe('Société Beta');
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
