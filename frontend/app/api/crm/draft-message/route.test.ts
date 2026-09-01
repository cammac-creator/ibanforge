import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * What actually reaches the store when a draft is saved.
 *
 * The route had no test, and the one thing it silently did wrong was invisible
 * from the screen: it cut the body at 6000 characters while the send path
 * accepted 50000, so a long mail came back amputated with nothing said (audit
 * TABS-10, 2026-09-01). A length is exactly the kind of promise that has to be
 * read off the bytes on the wire.
 */

vi.mock('@/lib/auth', () => ({ isAuthenticated: async () => true }));

let sent: { messages: Array<Record<string, unknown>> } | null = null;

beforeEach(() => {
  sent = null;
  vi.stubEnv('API_URL', 'https://api.example.com');
  vi.stubEnv('ADMIN_SECRET', 'test-admin-secret');
  vi.stubGlobal('fetch', async (_input: string | URL | Request, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ upserted: 1 }), { status: 200 });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('https://dashboard.example.com/api/crm/draft-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

describe('POST /api/crm/draft-message', () => {
  it('keeps a long draft whole, up to the ceiling the send path uses', () => {
    const long = 'a'.repeat(20_000);
    return post({ email: 'acme@example.net', subject: 'Suivi', body: long, account: 'main' }).then(async (res) => {
      expect(res.status).toBe(200);
      expect(String(sent!.messages[0].body)).toHaveLength(20_000);
    });
  });

  it('stops being the one that cuts, up to 50000', async () => {
    await post({ email: 'acme@example.net', subject: 'Suivi', body: 'b'.repeat(60_000) });
    expect(String(sent!.messages[0].body)).toHaveLength(50_000);
  });

  it('stores the draft on the address, so saving again replaces it', async () => {
    await post({ email: 'Acme@Example.net', subject: 'Suivi', body: 'x' });
    const first = sent!.messages[0].id;
    await post({ email: 'acme@example.net', subject: 'Autre', body: 'y' });
    expect(sent!.messages[0].id).toBe(first);
  });

  it('refuses a body with no address or no subject', async () => {
    const res = await post({ subject: 'Suivi', body: 'x' });
    expect(res.status).toBe(400);
  });
});
