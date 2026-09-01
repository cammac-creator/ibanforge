import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { createHash } from 'crypto';
import { HARD_CAP } from '@/lib/crm/sent-today';

/**
 * The one irreversible gesture of the dashboard, checked on what it actually
 * puts on the wire (audit finding TABS-03, 2026-09-01).
 *
 * Until this file existed, the three blocking rules lived only in the browser
 * and this route had no test at all. Both halves are asserted here: a draft
 * that breaks a rule must NOT reach the upstream sender, and a clean one must,
 * unchanged. `fetch` is a stub that records every call, so "the mail did not
 * leave" is read off the recorded calls rather than off the status code.
 *
 * Fixtures use reserved example domains. This repository is public.
 */

vi.mock('@/lib/auth', () => ({ isAuthenticated: async () => true }));

interface Call {
  url: string;
  method: string;
  body: Record<string, unknown>;
}

let calls: Call[] = [];
/** Rows the fake admin API answers with when the route counts today's sends. */
let storedMessages: Array<{ direction: string; msg_date: string }> = [];

beforeEach(() => {
  calls = [];
  storedMessages = [];
  vi.stubEnv('TABORNIO_CRM_URL', 'https://upstream.example.com');
  vi.stubEnv('CRM_DRAFT_SECRET', 'test-secret');
  vi.stubEnv('API_URL', 'https://api.example.com');
  vi.stubEnv('ADMIN_SECRET', 'test-admin-secret');
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });
    if (url.includes('/v1/admin/email-messages') && (init?.method ?? 'GET') === 'GET') {
      return new Response(JSON.stringify({ messages: storedMessages }), { status: 200 });
    }
    if (url.includes('/api/crm/send')) {
      return new Response(JSON.stringify({ sent: true }), { status: 200 });
    }
    return new Response(JSON.stringify({ upserted: 1 }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('https://dashboard.example.com/api/crm/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

/** A body long enough to be an ordinary mail, with nothing a rule objects to. */
const CLEAN_BODY =
  'Bonjour, je reviens vers vous au sujet de la validation des IBAN pour vos virements sortants. ' +
  'Nous couvrons la zone SEPA et le clearing suisse, et la mise en route tient en une clé API. ' +
  'Dites-moi si un essai vous intéresse, sinon répondez stop et je ne reviendrai pas.';

/** Today's outbound rows, as the admin API would return them. */
function sentToday(n: number) {
  const day = new Date().toISOString().slice(0, 10);
  return Array.from({ length: n }, () => ({ direction: 'out', msg_date: `${day}T09:00` }));
}

const upstreamSends = () => calls.filter((c) => c.url.includes('/api/crm/send'));

describe('POST /api/crm/send — the blocking rules are replayed on the server', () => {
  it('relays a clean outbound draft and records it into the timeline', async () => {
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
      intent: 'outbound',
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ sent: true });

    const sends = upstreamSends();
    expect(sends).toHaveLength(1);
    expect(sends[0].url).toBe('https://upstream.example.com/api/crm/send');
    // The four fields the VPS knows, and nothing this route invented.
    expect(sends[0].body).toEqual({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
    });
    // And the send is filed at once, which is what keeps the thread honest.
    const recorded = calls.filter(
      (c) => c.url.includes('/v1/admin/email-messages') && c.method === 'POST',
    );
    expect(recorded).toHaveLength(1);
  });

  it('refuses an em dash and the mail never leaves', async () => {
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: `Bonjour, un point rapide — et rien de plus. ${CLEAN_BODY}`,
      intent: 'outbound',
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string; codes: string[] };
    expect(j.error).toBe('guardrail_blocked');
    expect(j.codes).toContain('em_dash');
    expect(upstreamSends()).toHaveLength(0);
  });

  it('catches an em dash hiding in the subject alone', async () => {
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN — suivi',
      body: CLEAN_BODY,
      intent: 'outbound',
    });
    expect(res.status).toBe(400);
    expect(upstreamSends()).toHaveLength(0);
  });

  it('refuses an empty body on the reply path too', async () => {
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Re: votre question',
      body: '   \n  ',
      intent: 'reply',
    });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { codes: string[] };
    expect(j.codes).toContain('empty_body');
    expect(upstreamSends()).toHaveLength(0);
  });

  it('refuses past the daily cap with a 429, counted from the stored rows', async () => {
    storedMessages = sentToday(HARD_CAP);
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
      intent: 'outbound',
    });
    expect(res.status).toBe(429);
    const j = (await res.json()) as { error: string; sentToday: number };
    expect(j.error).toBe('daily_cap');
    expect(j.sentToday).toBe(HARD_CAP);
    expect(upstreamSends()).toHaveLength(0);
  });

  it('counts only what left TODAY, so yesterday cannot close the door', async () => {
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10);
    storedMessages = Array.from({ length: HARD_CAP + 5 }, () => ({
      direction: 'out',
      msg_date: `${yesterday}T09:00`,
    }));
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
      intent: 'outbound',
    });
    expect(res.status).toBe(200);
    expect(upstreamSends()).toHaveLength(1);
  });

  it('lets an explicit override through, and only for the code it covers', async () => {
    storedMessages = sentToday(HARD_CAP);
    const granted = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
      intent: 'outbound',
      override: ['daily_cap'],
    });
    expect(granted.status).toBe(200);
    expect(upstreamSends()).toHaveLength(1);

    // A grant given against the cap says nothing about an em dash.
    const other = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: `Un point rapide — voilà. ${CLEAN_BODY}`,
      intent: 'outbound',
      override: ['daily_cap'],
    });
    expect(other.status).toBe(400);
    expect(upstreamSends()).toHaveLength(1);
  });

  it('does not apply the prospecting cap to a reply', async () => {
    storedMessages = sentToday(HARD_CAP + 3);
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Re: votre question',
      body: 'Oui, la zone SEPA est couverte.',
      intent: 'reply',
    });
    expect(res.status).toBe(200);
    expect(upstreamSends()).toHaveLength(1);
  });

  it('treats a missing intent as outbound, the strict road', async () => {
    storedMessages = sentToday(HARD_CAP);
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
    });
    expect(res.status).toBe(429);
    expect(upstreamSends()).toHaveLength(0);
  });

  it('never blocks on a cap it could not count', async () => {
    // The admin endpoint answers an error: the count is unknown, and an unknown
    // count must not be read as zero OR as full.
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : {} });
      if (url.includes('/v1/admin/email-messages') && (init?.method ?? 'GET') === 'GET') {
        return new Response('nope', { status: 503 });
      }
      return new Response(JSON.stringify({ sent: true }), { status: 200 });
    });
    const res = await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
      intent: 'outbound',
    });
    expect(res.status).toBe(200);
    expect(upstreamSends()).toHaveLength(1);
  });

  it('refuses a recipient that is not an address', async () => {
    const res = await post({ account: 'main', to: '', subject: 'x', body: CLEAN_BODY });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_recipient' });
    expect(upstreamSends()).toHaveLength(0);
  });

  it('asks the admin API for today only, and without the bodies', async () => {
    await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
      intent: 'outbound',
    });
    const counted = calls.find(
      (c) => c.url.includes('/v1/admin/email-messages') && c.method === 'GET',
    );
    expect(counted?.url).toContain('fields=summary');
    expect(counted?.url).toContain(`since=${new Date().toISOString().slice(0, 10)}`);
  });
});

describe('the recorded row (TABS-19)', () => {
  it('keeps the id at the grain sync-sent.py rebuilds, and dates to the second', async () => {
    // The id is the ONLY thing stopping the IMAP sync from filing a second copy
    // of the same mail fifteen minutes later, and it is rebuilt on the VPS from
    // the Sent copy's Date header at minute granularity. Seconds in the id here
    // would duplicate every mail the dashboard sends.
    await post({
      account: 'main',
      to: 'acme@example.net',
      subject: 'Validation IBAN',
      body: CLEAN_BODY,
      intent: 'outbound',
    });
    const recorded = calls.find(
      (c) => c.url.includes('/v1/admin/email-messages') && c.method === 'POST',
    );
    const msg = (recorded!.body as { messages: Array<Record<string, string>> }).messages[0];
    expect(msg.msg_date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    const expected = createHash('md5')
      .update(`acme@example.net|out|${msg.msg_date.slice(0, 16)}|Validation IBAN`)
      .digest('hex');
    expect(msg.id).toBe(expected);
  });
})
