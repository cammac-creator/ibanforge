import { describe, it, expect, vi } from 'vitest';
import {
  detectEvents,
  diffAgainstState,
  fetchAdmin,
  formatReport,
  isCorporate,
  isDisposable,
  isFreemail,
  isInternal,
  guessCompany,
  type AdminKey,
  type RadarState,
} from './lifecycle-radar.js';

const NOW = new Date('2026-07-02T05:30:00Z');

/** Build an AdminKey with sensible defaults (free, unused, old, corporate). */
function key(over: Partial<AdminKey> = {}): AdminKey {
  return {
    key_prefix: over.key_prefix ?? `ifk_${Math.random().toString(16).slice(2, 8)}`,
    email: 'ops@acme.com',
    monthly_limit: 200,
    active: 1,
    created_at: '2026-01-01T00:00:00Z',
    credits_total: null,
    credits_remaining: null,
    paid: 0,
    used: 0,
    used_prev: 0,
    used_all_time: 0,
    last_active_month: null,
    ...over,
  };
}

const detect = (keys: AdminKey[], lastRunAt?: Date) => detectEvents(keys, { now: NOW, lastRunAt });

describe('classifiers', () => {
  it('flags internal / test accounts', () => {
    for (const e of [
      'me@ibanforge.com',
      // The founder's own mailboxes used to be listed here as literals. They
      // are personal addresses and this repository is public, so they moved to
      // CRM_INTERNAL_EMAILS; the mechanism has its own test in
      // internal-accounts.test.ts. This list keeps only the generic patterns.
      'demo@example.com',
      'x@example.org',
      'playground@acme.com',
      'workflow-test@acme.com',
      'test-42@acme.com',
      'acme-test@corp.com',
      'smoke@acme.com',
      'audit@bigbank.com',
      'gpt-store@openai.com',
      'ca-alice@proton.me',
      'ca-bot-42@proton.me',
      'ferme-espagnole@cohorte.invalid',
      '',
    ]) {
      expect(isInternal(e), e).toBe(true);
    }
  });

  it('does not flag genuine customer addresses as internal', () => {
    for (const e of ['john@acme.com', 'buyer@gmail.com', 'dev@fintech.io', 'a.b@proton.me']) {
      expect(isInternal(e), e).toBe(false);
    }
  });

  it('recognises freemail vs corporate domains', () => {
    for (const d of [
      'gmail.com',
      'outlook.fr',
      'proton.me',
      'protonmail.com',
      'qq.com',
      'web.de',
      'mail.ru',
      '163.com',
      '126.com',
      'icloud.com',
      'gmx.net',
      'hotmail.com',
      'yahoo.co.uk',
    ]) {
      expect(isFreemail(d), d).toBe(true);
    }
    for (const d of ['acme.com', 'bigbank.de', 'fintech.io']) {
      expect(isFreemail(d), d).toBe(false);
    }
  });

  it('recognises disposable domains', () => {
    expect(isDisposable('mailinator.com')).toBe(true);
    expect(isDisposable('foo.guerrillamail.com')).toBe(true);
    expect(isDisposable('acme.com')).toBe(false);
  });

  it('isCorporate = real domain, not freemail, not disposable', () => {
    expect(isCorporate('ops@acme.com')).toBe(true);
    expect(isCorporate('buyer@gmail.com')).toBe(false);
    expect(isCorporate('x@mailinator.com')).toBe(false);
  });

  it('guesses a company label from the domain', () => {
    expect(guessCompany('acme.com')).toBe('Acme');
    expect(guessCompany('bank.co.uk')).toBe('Bank');
  });
});

describe('detectEvents — quota (free keys only)', () => {
  it('QUOTA_80 at 80% and QUOTA_FULL at 100%', () => {
    const e80 = detect([key({ email: 'a@acme.com', used: 160, monthly_limit: 200 })]);
    expect(e80.map((e) => e.kind)).toEqual(['QUOTA_80']);

    const eFull = detect([key({ email: 'b@acme.com', used: 200, monthly_limit: 200 })]);
    expect(eFull.map((e) => e.kind)).toEqual(['QUOTA_FULL']);
  });

  it('uses the default 200 limit when monthly_limit is null', () => {
    const e = detect([key({ email: 'c@acme.com', used: 170, monthly_limit: null })]);
    expect(e.map((x) => x.kind)).toEqual(['QUOTA_80']); // 85%
  });

  it('does not fire below 80%', () => {
    expect(detect([key({ email: 'd@acme.com', used: 100, monthly_limit: 200 })])).toHaveLength(0);
  });

  it('does not apply quota rules to paid keys', () => {
    const e = detect([
      key({
        email: 'p@acme.com',
        used: 5000,
        monthly_limit: 200,
        credits_total: 10000,
        credits_remaining: 5000,
      }),
    ]);
    expect(e.some((x) => x.kind.startsWith('QUOTA'))).toBe(false);
  });
});

describe('detectEvents — paid idle', () => {
  it('fires when <5% consumed and 7+ days old', () => {
    const e = detect([
      key({
        email: 'paid@acme.com',
        created_at: '2026-06-20T00:00:00Z',
        credits_total: 1000,
        credits_remaining: 990,
      }),
    ]);
    expect(e.map((x) => x.kind)).toEqual(['PAID_IDLE']);
  });

  it('does not fire when 5%+ consumed', () => {
    const e = detect([
      key({
        email: 'paid@acme.com',
        created_at: '2026-06-20T00:00:00Z',
        credits_total: 1000,
        credits_remaining: 900,
      }),
    ]);
    expect(e).toHaveLength(0);
  });

  it('does not fire before 7 days', () => {
    const e = detect([
      key({
        email: 'paid@acme.com',
        created_at: '2026-06-30T00:00:00Z',
        credits_total: 1000,
        credits_remaining: 999,
      }),
    ]);
    expect(e).toHaveLength(0);
  });
});

describe('detectEvents — new corporate', () => {
  const lastRun = new Date('2026-07-01T05:30:00Z');

  it('greets a corporate key created since the last run', () => {
    const e = detect(
      [key({ email: 'cfo@newco.com', created_at: '2026-07-01T12:00:00Z' })],
      lastRun,
    );
    expect(e.map((x) => x.kind)).toEqual(['NEW_CORPORATE']);
    expect(e[0]?.company).toBe('Newco');
  });

  it('ignores freemail signups', () => {
    const e = detect(
      [key({ email: 'someone@gmail.com', created_at: '2026-07-01T12:00:00Z' })],
      lastRun,
    );
    expect(e).toHaveLength(0);
  });

  it('ignores corporate keys created before the last run', () => {
    const e = detect(
      [key({ email: 'cfo@oldco.com', created_at: '2026-06-15T12:00:00Z' })],
      lastRun,
    );
    expect(e).toHaveLength(0);
  });
});

describe('detectEvents — gone quiet', () => {
  // Mid-month so the day-of-month guard is satisfied.
  const MID = new Date('2026-07-15T05:30:00Z');
  const detectMid = (keys: AdminKey[]) => detectEvents(keys, { now: MID });

  it('fires for a corporate key active last month but silent this month', () => {
    const e = detectMid([key({ email: 'ops@acme.com', used_prev: 50, used: 0 })]);
    expect(e.map((x) => x.kind)).toEqual(['GONE_QUIET']);
  });

  it('ignores freemail churn', () => {
    expect(detectMid([key({ email: 'user@gmail.com', used_prev: 50, used: 0 })])).toHaveLength(0);
  });

  it('does not fire when it was silent last month too', () => {
    expect(detectMid([key({ email: 'ops@acme.com', used_prev: 0, used: 0 })])).toHaveLength(0);
  });

  it('does not fire when still active this month', () => {
    expect(detectMid([key({ email: 'ops@acme.com', used_prev: 50, used: 3 })])).toHaveLength(0);
  });

  it('is suppressed early in the month (month-boundary guard)', () => {
    // Day 2 of July: silence is not yet a churn signal.
    const early = detectEvents([key({ email: 'ops@acme.com', used_prev: 50, used: 0 })], {
      now: new Date('2026-07-02T05:30:00Z'),
    });
    expect(early).toHaveLength(0);
  });
});

describe('detectEvents — exclusions', () => {
  it('never surfaces internal accounts even when a rule would match', () => {
    const keys = [
      key({ email: 'audit@ibanforge.com', used: 200 }), // would be QUOTA_FULL
      key({ email: 'ca-bot@proton.me', used_prev: 99, used: 0 }), // would be GONE_QUIET (proton corp? no: freemail anyway)
      key({ email: 'workflow-test@acme.com', created_at: '2026-07-02T00:00:00Z' }), // would be NEW_CORPORATE
    ];
    expect(detect(keys, new Date('2026-07-01T00:00:00Z'))).toHaveLength(0);
  });

  it('skips deactivated keys', () => {
    expect(detect([key({ email: 'ops@acme.com', used: 200, active: 0 })])).toHaveLength(0);
  });
});

describe('diffAgainstState — anti-repetition', () => {
  const empty: RadarState = { keys: {} };

  it('suppresses an event already signalled, then re-fires on escalation', () => {
    const k = key({ key_prefix: 'ifk_x', email: 'a@acme.com', used: 170, monthly_limit: 200 });

    const first = diffAgainstState(detect([k]), empty, NOW);
    expect(first.fresh.map((e) => e.kind)).toEqual(['QUOTA_80']);

    // same condition next run → deduped
    const second = diffAgainstState(detect([k]), first.nextState, NOW);
    expect(second.fresh).toHaveLength(0);

    // escalates to full → fires again
    const kFull = key({ key_prefix: 'ifk_x', email: 'a@acme.com', used: 200, monthly_limit: 200 });
    const third = diffAgainstState(detect([kFull]), second.nextState, NOW);
    expect(third.fresh.map((e) => e.kind)).toEqual(['QUOTA_FULL']);
  });

  it('drops keys whose condition cleared, so they re-arm', () => {
    const k = key({ key_prefix: 'ifk_y', email: 'a@acme.com', used: 200 });
    const first = diffAgainstState(detect([k]), empty, NOW);
    expect(first.nextState.keys['ifk_y']).toBeDefined();

    // condition gone (new month reset) → not in next state
    const cleared = diffAgainstState(
      detect([key({ key_prefix: 'ifk_y', email: 'a@acme.com', used: 0 })]),
      first.nextState,
      NOW,
    );
    expect(cleared.fresh).toHaveLength(0);
    expect(cleared.nextState.keys['ifk_y']).toBeUndefined();
  });
});

describe('formatReport', () => {
  it('renders a grouped French report with an action line', () => {
    const events = detect(
      [
        key({ email: 'a@acme.com', used: 200 }),
        key({ email: 'cfo@newco.com', created_at: '2026-07-01T12:00:00Z' }),
      ],
      new Date('2026-07-01T00:00:00Z'),
    );
    const msg = formatReport(events, { now: NOW });
    expect(msg).toContain('RADAR CLIENTS IBANFORGE');
    expect(msg).toContain('QUOTA GRATUIT ÉPUISÉ');
    expect(msg).toContain('NOUVEAU LEAD CORPORATE');
    expect(msg).toContain('Action :');
    expect(msg).toContain('Dory · radar lifecycle quotidien');
  });
});

describe('fetchAdmin', () => {
  it('sends X-Admin-Secret and parses JSON', async () => {
    const mock = vi.fn(
      async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await fetchAdmin<{ ok: number }>(
      'https://api.test',
      'sekret',
      '/v1/admin/keys',
      mock,
    );
    expect(out).toEqual({ ok: 1 });
    const call = (mock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('https://api.test/v1/admin/keys');
    expect((call[1] as RequestInit).headers).toMatchObject({ 'X-Admin-Secret': 'sekret' });
  });

  it('throws on a non-2xx response', async () => {
    const mock = vi.fn(
      async () => new Response('nope', { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(fetchAdmin('https://api.test', 'x', '/v1/admin/keys', mock)).rejects.toThrow(
      'HTTP 401',
    );
  });
});
