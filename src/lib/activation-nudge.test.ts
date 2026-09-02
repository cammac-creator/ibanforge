import { describe, it, expect } from 'vitest';
import {
  NUDGE_MAX_PER_PASS,
  buildFounderDraft,
  draftId,
  isExcludedFromOutreach,
  neverCalled,
  selectNudgeCandidates,
  type NudgeCandidateRow,
} from './activation-nudge.js';

/** Invented fixtures only (CLAUDE.md): alpha.example.net, never a real address. */
function row(p: Partial<NudgeCandidateRow> & { email: string }): NudgeCandidateRow {
  return {
    key_prefix: `ifk_${p.email.slice(0, 8)}`,
    created_at: '2026-08-20 09:00:00',
    usage_units: 0,
    credits_used: 0,
    logged_calls: 0,
    issued_by_us: 0,
    ...p,
  };
}

describe('isExcludedFromOutreach', () => {
  it('keeps an ordinary customer address', () => {
    expect(isExcludedFromOutreach('ops@alpha.example.net')).toBe(false);
  });

  it.each([
    ['our own mailbox', 'someone@ibanforge.com'],
    ['a regrouped abuse cohort', 'ua-abc-2026-08-20@cohorte.invalid'],
    ['a probe key', 'lookup-probe@alpha.example.net'],
    ['anything carrying test', 'contest@alpha.example.net'],
    ['anything carrying probe', 'probemaster@alpha.example.net'],
    ['anything carrying smoke', 'smokestack@alpha.example.net'],
    ['the pilot convention', 'societe-alpha-pilot@alpha.example.net'],
    ['an address that is not one', 'not-an-address'],
    ['nothing at all', null],
  ])('excludes %s', (_label, email) => {
    expect(isExcludedFromOutreach(email)).toBe(true);
  });
});

describe('neverCalled — the three silences', () => {
  it('is true only when all three ledgers are empty', () => {
    expect(neverCalled(row({ email: 'a@alpha.example.net' }))).toBe(true);
  });

  it('is false when the monthly quota ledger moved', () => {
    expect(neverCalled(row({ email: 'a@alpha.example.net', usage_units: 3 }))).toBe(false);
  });

  it('is false when prepaid credits were burnt', () => {
    expect(neverCalled(row({ email: 'a@alpha.example.net', credits_used: 12 }))).toBe(false);
  });

  it('is false when the call was logged but billed nothing', () => {
    // The case the two billing ledgers cannot see: every call answered 400 or
    // 402. That person HAS tried, and must never be told they never did.
    expect(neverCalled(row({ email: 'a@alpha.example.net', logged_calls: 9 }))).toBe(false);
  });
});

describe('selectNudgeCandidates', () => {
  it('takes the never-called externals, newest first', () => {
    const picked = selectNudgeCandidates([
      row({ email: 'old@alpha.example.net', created_at: '2026-08-01 08:00:00' }),
      row({ email: 'recent@alpha.example.net', created_at: '2026-08-25 08:00:00' }),
    ]);
    expect(picked.map((r) => r.email)).toEqual([
      'recent@alpha.example.net',
      'old@alpha.example.net',
    ]);
  });

  it('sends one message per PERSON, not per key', () => {
    // Three unused keys behind one mailbox is one person, and three copies of
    // the same mail in one morning is how a nudge becomes spam.
    const picked = selectNudgeCandidates([
      row({
        email: 'dup@alpha.example.net',
        key_prefix: 'ifk_dup_1',
        created_at: '2026-08-25 08:00:00',
      }),
      row({
        email: 'DUP@alpha.example.net',
        key_prefix: 'ifk_dup_2',
        created_at: '2026-08-24 08:00:00',
      }),
      row({
        email: 'dup@alpha.example.net',
        key_prefix: 'ifk_dup_3',
        created_at: '2026-08-23 08:00:00',
      }),
    ]);
    expect(picked).toHaveLength(1);
    expect(picked[0].key_prefix).toBe('ifk_dup_1');
  });

  it('never nudges a key the operator minted, whatever its address looks like', () => {
    // The mail that carried the key is the reason it exists. "Your key was
    // created and never used" would be false twice over for its recipient —
    // the flag is declared at mint time, so no address pattern is needed.
    const picked = selectNudgeCandidates([
      row({ email: 'cto@acme.example.com', issued_by_us: 1 }),
      row({ email: 'real@alpha.example.net' }),
    ]);
    expect(picked.map((r) => r.email)).toEqual(['real@alpha.example.net']);
  });

  it('collapses two aliased addresses into one person', () => {
    // The operator declared "this address IS that customer". The draft half of
    // the pass already honours it; this pins that the nudge half does too.
    const canonicalOf = (e: string) =>
      e === 'second@alpha.example.net' ? 'first@alpha.example.net' : e;
    const picked = selectNudgeCandidates(
      [
        row({
          email: 'first@alpha.example.net',
          key_prefix: 'ifk_alias_1',
          created_at: '2026-08-25 08:00:00',
        }),
        row({
          email: 'second@alpha.example.net',
          key_prefix: 'ifk_alias_2',
          created_at: '2026-08-24 08:00:00',
        }),
      ],
      25,
      { canonicalOf },
    );
    expect(picked).toHaveLength(1);
    expect(picked[0].key_prefix).toBe('ifk_alias_1');
  });

  it('stays away from anyone in the blocked set, resolved canonically', () => {
    // The founder already wrote to them, or another of their addresses already
    // holds the one nudge: an automated "you never tried" after his own mail
    // unmasks every message as a sequence.
    const canonicalOf = (e: string) =>
      e === 'alias@alpha.example.net' ? 'talked@alpha.example.net' : e;
    const picked = selectNudgeCandidates(
      [row({ email: 'alias@alpha.example.net' }), row({ email: 'fresh@alpha.example.net' })],
      25,
      { canonicalOf, blocked: new Set(['talked@alpha.example.net']) },
    );
    expect(picked.map((r) => r.email)).toEqual(['fresh@alpha.example.net']);
  });

  it('drops internal, probe and pilot addresses', () => {
    const picked = selectNudgeCandidates([
      row({ email: 'ops@ibanforge.com' }),
      row({ email: 'smoke-runner@alpha.example.net' }),
      row({ email: 'societe-alpha-pilot@alpha.example.net' }),
      row({ email: 'real@alpha.example.net' }),
    ]);
    expect(picked.map((r) => r.email)).toEqual(['real@alpha.example.net']);
  });

  it('drops anyone who already called', () => {
    const picked = selectNudgeCandidates([
      row({ email: 'active@alpha.example.net', logged_calls: 1 }),
      row({ email: 'silent@alpha.example.net' }),
    ]);
    expect(picked.map((r) => r.email)).toEqual(['silent@alpha.example.net']);
  });

  it('caps a pass so the first run after deploy is not a hundred-mail burst', () => {
    const many = Array.from({ length: NUDGE_MAX_PER_PASS + 12 }, (_, i) =>
      row({ email: `client${i}@alpha.example.net` }),
    );
    expect(selectNudgeCandidates(many)).toHaveLength(NUDGE_MAX_PER_PASS);
    expect(selectNudgeCandidates(many, 3)).toHaveLength(3);
  });
});

describe('the founder draft', () => {
  it('uses the CRM draft id, case-insensitive on the address', () => {
    expect(draftId('Ops@Alpha.Example.Net')).toBe(draftId('ops@alpha.example.net'));
    expect(draftId('ops@alpha.example.net')).toMatch(/^draft-[0-9a-f]{32}$/);
  });

  it('asks both questions and offers help, without a pitch', () => {
    const { subject, body } = buildFounderDraft();
    expect(subject).toBeTruthy();
    expect(body).toContain('What are you trying to do with it?');
    expect(body).toContain('How did you find us?');
    expect(body).toContain('Claude-Alain Martin');
    expect(body.toLowerCase()).not.toContain('credits');
    expect(body.toLowerCase()).not.toContain('$');
  });

  it('carries no em or en dash', () => {
    const { subject, body } = buildFounderDraft();
    expect(/[—–]/.test(subject)).toBe(false);
    expect(/[—–]/.test(body)).toBe(false);
  });
});
