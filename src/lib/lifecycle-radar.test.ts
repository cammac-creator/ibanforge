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
  subscriptionOffer,
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
      // Keys we issue to our own surfaces (the register pages since 29.09.2026).
      'pages-registres@ibanforge.internal',
      'probe@ibf-internal.dev',
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

  it('a subscription key anchored on its billing period is measured on that period, not on the calendar month (lot 2)', () => {
    // 12 000 calls this calendar month, but only 300 since its billing period began on the 10th.
    const quiet = detect([
      key({ email: 'd@acme.com', paid: 1, used: 12_000, quota_used: 300, monthly_limit: 10_000 }),
    ]);
    expect(quiet.map((e) => e.kind)).not.toContain('QUOTA_FULL');
    const full = detect([
      key({ email: 'e@acme.com', paid: 1, used: 300, quota_used: 10_000, monthly_limit: 10_000 }),
    ]);
    expect(full.map((e) => e.kind)).toEqual(['QUOTA_FULL']);
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

  it('une clé anonyme à 24/25 ne produit AUCUN événement', () => {
    // 🚨 C'est la surface la plus coûteuse du palier anonyme, parce que ce
    // module POUSSE sur Telegram. La sentinelle n'est pas interne (pas
    // d'arobase, donc pas de domaine), et le seuil est un RATIO : chaque clé
    // anonyme annoncerait QUOTA_80 dès 20 unités sur 25 puis QUOTA_FULL à 25,
    // huit fois plus tôt qu'une clé du palier gratuit, toutes agrégées sous une
    // identité unique et une société devinée depuis un domaine vide.
    const anon = key({
      tier: 'anonymous',
      email: 'anonymous',
      used: 24,
      monthly_limit: 25,
    });
    expect(detect([anon])).toHaveLength(0);
    // À 25/25 non plus.
    expect(
      detect([key({ tier: 'anonymous', email: 'anonymous', used: 25, monthly_limit: 25 })]),
    ).toHaveLength(0);

    // Le jumeau POSITIF : une clé réclamée garde son événement commercial. Sans
    // cette moitié, un vert ne prouverait qu'une boucle cassée.
    const claimed = key({
      tier: 'claimed',
      email: 'ops@acme.com',
      used: 160,
      monthly_limit: 200,
    });
    expect(detect([claimed]).map((e) => e.kind)).toEqual(['QUOTA_80']);
  });

  it('une fixture sans palier se comporte comme avant — le champ est optionnel', () => {
    // Le champ est optionnel à dessein : les fixtures antérieures ne le portent
    // pas, et un champ requis les aurait toutes cassées pour un filtre qui,
    // absent, doit se lire « palier inconnu », donc traité comme aujourd'hui.
    expect(
      detect([key({ email: 'ops@acme.com', used: 200, monthly_limit: 200 })]).map((e) => e.kind),
    ).toEqual(['QUOTA_FULL']);
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

describe('une clé qui paie un abonnement n’est jamais « gratuite » (27.11.2026)', () => {
  const subscriber = (over: Partial<AdminKey> = {}) =>
    key({ email: 'cto@alpha.example.net', monthly_limit: 10_000, paid: 1, ...over });

  it('garde son événement de quota, et il dit « abonnement », pas « quota gratuit »', () => {
    const [near] = detect([subscriber({ used: 9_000 })]);
    expect(near.kind).toBe('QUOTA_80');
    expect(near.paying).toBe(true);
    expect(near.detail).toContain('abonnement');
    expect(near.detail).not.toContain('gratuit');
    const [full] = detect([subscriber({ used: 10_000 })]);
    expect(full.kind).toBe('QUOTA_FULL');
    expect(full.detail).toContain('plafond de l’abonnement');
    expect(full.detail).not.toContain('gratuit');
  });

  it('le rapport lui donne ses propres titres, à côté de ceux des clés gratuites', () => {
    const events = detect([
      subscriber({ key_prefix: 'ifk_paying', used: 9_000 }),
      key({ key_prefix: 'ifk_gratis', email: 'a@alpha.example.net', used: 200 }),
    ]);
    const msg = formatReport(events, { now: NOW });
    expect(msg).toContain('ABONNÉ ≥ 80% DE SON PLAFOND');
    expect(msg).toContain('QUOTA GRATUIT ÉPUISÉ');
    const paying = msg.split('\n').filter((l) => l.includes('ifk_paying'));
    expect(paying).toHaveLength(1);
    expect(paying[0]).not.toContain('gratuit');
  });

  it('une clé gratuite garde ses mots', () => {
    const [free] = detect([key({ email: 'a@alpha.example.net', used: 160 })]);
    expect(free.paying).toBeUndefined();
    expect(free.detail).toContain('quota gratuit');
  });
});

describe('le relevé lit la formule servie par l’API, pas `paid` (27.11.2026)', () => {
  it('nomme l’offre d’un abonné Pro, sans jamais dire « gratuit »', () => {
    const [ev] = detect([
      key({
        email: 'cto@alpha.example.net',
        monthly_limit: 10_000,
        paid: 1,
        plan: 'pro',
        used: 8_100,
      }),
    ]);
    expect(ev.kind).toBe('QUOTA_80');
    expect(ev.paying).toBe(true);
    expect(ev.detail).toBe('abonnement Pro à 81% de son plafond (8100/10000)');
    const msg = formatReport([ev], { now: NOW });
    expect(msg).toContain('ABONNÉ ≥ 80% DE SON PLAFOND');
    expect(msg).not.toContain('gratuit');
  });

  it('nomme l’offre éditeur au plafond', () => {
    const [ev] = detect([
      key({
        email: 'cto@alpha.example.net',
        monthly_limit: 50_000,
        paid: 1,
        plan: 'editor',
        used: 50_000,
      }),
    ]);
    expect(ev.kind).toBe('QUOTA_FULL');
    expect(ev.detail).toContain('abonnement Editor/OEM');
  });

  it('un ancien abonné revenu au gratuit se lit « quota gratuit », malgré `paid` à 1', () => {
    const [ev] = detect([
      key({ email: 'cto@alpha.example.net', monthly_limit: 200, paid: 1, plan: 'free', used: 170 }),
    ]);
    expect(ev.kind).toBe('QUOTA_80');
    expect(ev.paying).toBeUndefined();
    expect(ev.detail).toBe('quota gratuit à 85% (170/200)');
  });

  it('sans formule servie (ancienne réponse), retombe sur `paid`', () => {
    const [ev] = detect([
      key({ email: 'cto@alpha.example.net', monthly_limit: 10_000, paid: 1, used: 9_000 }),
    ]);
    expect(ev.paying).toBe(true);
    expect(ev.detail).toBe('abonnement à 90% de son plafond (9000/10000)');
  });

  it('subscriptionOffer ne reconnaît que les abonnements en cours', () => {
    expect(subscriptionOffer('pro')).toBe('Pro');
    expect(subscriptionOffer('pro+pack')).toBe('Pro');
    expect(subscriptionOffer('editor')).toBe('Editor/OEM');
    for (const p of ['free', 'custom', 'pack', 'none', 'free+pack', undefined]) {
      expect(subscriptionOffer(p)).toBeNull();
    }
  });
});

describe('une allocation sur mesure n’est ni « gratuite » ni « abonnée » (27.11.2026)', () => {
  it('a son propre libellé et son propre titre, même avec `paid` à 1', () => {
    const [ev] = detect([
      key({
        email: 'cto@alpha.example.net',
        monthly_limit: 2_000,
        paid: 1,
        plan: 'custom',
        used: 1_700,
      }),
    ]);
    expect(ev.kind).toBe('QUOTA_80');
    expect(ev.paying).toBeUndefined();
    expect(ev.custom).toBe(true);
    expect(ev.detail).toBe('allocation sur mesure à 85% (1700/2000)');
    const msg = formatReport([ev], { now: NOW });
    expect(msg).toContain('ALLOCATION SUR MESURE ≥ 80%');
    expect(msg).not.toContain('gratuit');
    expect(msg).not.toContain('ABONNÉ');
  });

  it('une clé à formule mixte reste hors de la branche des quotas, comme avant', () => {
    // Une clé qui porte des crédits a ses propres événements (pack inactif) :
    // `pro+pack` ne produit donc aucun événement de quota.
    const events = detect([
      key({
        email: 'cto@alpha.example.net',
        monthly_limit: 10_000,
        paid: 1,
        plan: 'pro+pack',
        used: 9_500,
        credits_total: 1_000,
        credits_remaining: 900,
        created_at: '2026-06-30T00:00:00Z',
      }),
    ]);
    expect(events.filter((e) => e.kind.startsWith('QUOTA'))).toHaveLength(0);
  });
});
