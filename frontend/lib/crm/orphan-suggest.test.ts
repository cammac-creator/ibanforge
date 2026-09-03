import { describe, expect, it } from 'vitest';
import { senderTokens, suggestFor, type PersonRow } from './orphan-suggest';

// Invented fixtures only — this repo is public. The name motif "zed" is
// synthetic on purpose; never echo a real customer's name or address here.
const ROWS: PersonRow[] = [
  { email: 'ops@alpha.example.net', label: 'Société Alpha', kind: 'client' },
  { email: 'a123456zed@example.com', label: 'example.com', kind: 'client' },
  { email: 'billing@beta.example.org', label: 'Beta GmbH', kind: 'prospect' },
  { email: 'zederson@example.org', label: 'Zederson AG', kind: 'prospect' },
];

describe('senderTokens', () => {
  it('extracts letter runs of length >= 3 from the local part', () => {
    expect(senderTokens('a904312zed@gmail.com')).toEqual(['zed']);
  });

  it('keeps a company domain but drops generic mailbox providers', () => {
    expect(senderTokens('j.dupont@alpha.example.net')).toEqual(['dupont', 'alpha']);
    expect(senderTokens('somebody@bluewin.ch')).toEqual(['somebody']);
  });

  it('skips generic subdomain labels and keeps the first name-bearing one', () => {
    // "mail." is a provider-ish label, not a name; "alpha" is the company.
    expect(senderTokens('x@mail.alpha.example')).toEqual(['alpha']);
  });

  it('survives a string with no @', () => {
    expect(senderTokens('not-an-address')).toEqual(['not', 'address']);
  });
});

describe('suggestFor with a query', () => {
  it('filters on email and label, case-insensitively', () => {
    const hits = suggestFor('x@example.com', 'alpha', ROWS);
    expect(hits.map((r) => r.email)).toEqual(['ops@alpha.example.net']);
  });

  it('puts prefix matches on the local part or label first', () => {
    const hits = suggestFor('x@example.com', 'zed', ROWS);
    // "zederson" starts with the query; "a123456zed" merely contains it.
    expect(hits.map((r) => r.email)).toEqual(['zederson@example.org', 'a123456zed@example.com']);
  });

  it('falls back to the sender heuristic while the query is under two characters', () => {
    // One typed letter would match half the directory, so the sender's own
    // name fragments keep doing the work until the query is meaningful. This
    // must NOT collapse to "no suggestions": the sender carries a token.
    const hits = suggestFor('a904312zed@gmail.com', 'z', ROWS);
    expect(hits.map((r) => r.email)).toEqual(['a123456zed@example.com', 'zederson@example.org']);
  });

  it('caps the number of suggestions', () => {
    const many: PersonRow[] = Array.from({ length: 20 }, (_, i) => ({
      email: `user${String(i).padStart(2, '0')}@acme.example`,
      label: 'ACME',
      kind: 'client' as const,
    }));
    expect(suggestFor('x@example.com', 'acme', many, 6)).toHaveLength(6);
  });
});

describe('suggestFor without a query (sender heuristic)', () => {
  it('finds the person whose address carries the same name fragment', () => {
    const hits = suggestFor('a904312zed@gmail.com', '', ROWS);
    expect(hits.map((r) => r.email)).toEqual(['a123456zed@example.com', 'zederson@example.org']);
  });

  it('answers nothing rather than everything when no token matches', () => {
    expect(suggestFor('zqx@gmail.com', '', ROWS)).toEqual([]);
  });
});

import { bestMatch, isAutomatedNotice } from './orphan-suggest';

describe('bestMatch (the pre-selected client)', () => {
  const rows: PersonRow[] = [
    { email: 'ops@alpha.example.net', label: 'Societe Alpha', kind: 'client' },
    { email: 'sales@alpha.example.net', label: 'Societe Alpha', kind: 'prospect' },
    { email: 'j.dupont@beta.example.org', label: 'Beta SA', kind: 'client' },
    { email: 'zed@gmail.com', label: 'Zed', kind: 'prospect' },
  ];
  it('prefers a shared company domain, clients first', () => {
    expect(bestMatch('cfo@alpha.example.net', rows)).toEqual({ row: rows[0], reason: 'same_domain' });
  });
  it('never treats a mailbox provider as a shared domain', () => {
    expect(bestMatch('someone@gmail.com', rows)).toBeNull();
  });
  it('finds the sender domain in a file label', () => {
    expect(bestMatch('info@beta.example.org', rows)?.reason).toBe('same_domain');
    expect(bestMatch('hello@betasa.io', rows)).toBeNull();
    expect(bestMatch('hello@beta.io', rows)?.row.email).toBe('j.dupont@beta.example.org');
  });
  it('falls back to a name fragment of the address, and says so', () => {
    expect(bestMatch('jean.dupont@gmail.com', rows)).toEqual({ row: rows[2], reason: 'name_in_address' });
  });
  it('never proposes the sender itself', () => {
    expect(bestMatch('ops@alpha.example.net', rows)?.row.email).toBe('sales@alpha.example.net');
  });
});

describe('isAutomatedNotice', () => {
  it('recognises DMARC reports and no-reply senders', () => {
    expect(isAutomatedNotice('dmarcreport@microsoft.com', '[Preview] Report Domain: ibanforge.com Submitter: x')).toBe(true);
    expect(isAutomatedNotice('no-reply@example.com', 'Your listing is live')).toBe(true);
    expect(isAutomatedNotice('noreply@example.com', null)).toBe(true);
  });
  it('leaves a person alone', () => {
    expect(isAutomatedNotice('jean@alpha.example.net', 'Re: our call')).toBe(false);
  });
});
