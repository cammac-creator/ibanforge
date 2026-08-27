import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

/**
 * The proxy, checked on what it actually puts on the wire.
 *
 * The redaction rules are the reason this file exists. They are a promise
 * about bytes leaving the server, so they are verified on the bytes: `fetch`
 * is replaced by a stub that keeps the request the route hands it, and the
 * assertions read that captured string. Reading the route's source proves
 * nothing about what a body of an unexpected shape does to it.
 *
 * Fixtures use reserved example domains and invented names. This repository is
 * public: a test carrying the configured value would republish what the
 * feature removes.
 */

vi.mock('@/lib/auth', () => ({ isAuthenticated: async () => true }));

/** The last body handed to the upstream generator, parsed. */
type Captured = { url: string; secret: string | null; body: Record<string, unknown> };
let captured: Captured | null = null;

beforeEach(() => {
  captured = null;
  vi.stubEnv('TABORNIO_CRM_URL', 'https://upstream.example.com');
  vi.stubEnv('CRM_DRAFT_SECRET', 'test-secret');
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: String(input),
      secret: new Headers(init?.headers).get('X-CRM-Secret'),
      body: JSON.parse(String(init?.body)),
    };
    return new Response(JSON.stringify({ subject: 'Suivi', emailEn: 'Hello.' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** The brief exactly as the composer builds it, minus anything server-side. */
const BRIEF = 'Contact: Someone\nGoal: relancer\nNo prior email: cold first touch.';

function post(body: unknown): Promise<Response> {
  return POST(
    new NextRequest('https://dashboard.example.com/api/crm/generate-draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

const draft = (to: string) => ({ account: 'main', to, subject: 'Suivi', context: BRIEF, deposit: false });

describe('POST /api/crm/generate-draft, redaction rules on the wire', () => {
  it('appends the instruction for a recipient on the configured domain', async () => {
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'example.com=Acme');
    const res = await post(draft('someone@example.com'));

    expect(res.status).toBe(200);
    expect(captured!.url).toBe('https://upstream.example.com/api/crm/generate-draft');
    expect(captured!.secret).toBe('test-secret');
    expect(captured!.body.context).toBe(`${BRIEF}\nIMPORTANT: never mention "Acme" anywhere.`);
    // The rest of the body is forwarded as sent, `deposit` included.
    expect(captured!.body).toMatchObject({ account: 'main', to: 'someone@example.com', subject: 'Suivi', deposit: false });
  });

  it('says nothing for a recipient on another domain, with the same variable set', async () => {
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'example.com=Acme');
    await post(draft('someone@example.net'));

    expect(captured!.body.context).toBe(BRIEF);
    expect(String(captured!.body.context)).not.toContain('Acme');
    expect(JSON.stringify(captured!.body)).not.toContain('never mention');
  });

  it('says nothing at all when the variable is unset, which is the old behaviour minus the rule', async () => {
    const res = await post(draft('someone@example.com'));

    expect(res.status).toBe(200);
    expect(captured!.body.context).toBe(BRIEF);
    expect(JSON.stringify(captured!.body)).not.toContain('never mention');
  });

  it('is unaffected by an empty variable', async () => {
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', '');
    await post(draft('someone@example.com'));

    expect(captured!.body.context).toBe(BRIEF);
  });

  it('carries every matching rule when several are configured', async () => {
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'example.com=Acme; example.org=Globex');
    await post(draft('A Person <someone@MAIL.Example.com>'));

    expect(captured!.body.context).toBe(`${BRIEF}\nIMPORTANT: never mention "Acme" anywhere.`);

    await post(draft('someone@example.org'));
    expect(captured!.body.context).toBe(`${BRIEF}\nIMPORTANT: never mention "Globex" anywhere.`);
  });

  it('fires on a protected recipient sitting first in a list of addresses', async () => {
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'example.com=Acme');
    await post(draft('someone@example.com, other@example.net'));

    expect(captured!.body.context).toBe(`${BRIEF}\nIMPORTANT: never mention "Acme" anywhere.`);
  });

  it('warns, and still forwards, when the variable parses to no rule', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'example.com Acme');
    const res = await post(draft('someone@example.com'));

    expect(res.status).toBe(200);
    expect(captured!.body.context).toBe(BRIEF);
    expect(warn).toHaveBeenCalledOnce();
    // The value never reaches the log.
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('Acme');
    warn.mockRestore();
  });

  it('refuses rather than generate a draft the rule could not reach', async () => {
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'example.com=Acme');
    const res = await post({ to: 'someone@example.com', context: { text: BRIEF } });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'unattachable_context' });
    // Nothing left the server.
    expect(captured).toBeNull();
  });
});

/**
 * `follow_up` selects the upstream system prompt: its follow-up mode asks for
 * two or three sentences, one new angle and no recap of the mail already sent.
 * The composer decides it; this route only has to carry it.
 *
 * Worth its own tests because the proxy does not forward the body it received.
 * It forwards the value `applyRedactionRules` returns, which on a matching rule
 * is a rebuilt object, and a field dropped there would leave the composer
 * choosing a mode that never arrives. The failure would be silent: the draft
 * would come back long and repetitive, exactly as it did before the mode
 * existed, with no error anywhere.
 */
describe('POST /api/crm/generate-draft, the follow-up mode on the wire', () => {
  it('carries follow_up true untouched', async () => {
    await post({ ...draft('someone@example.net'), follow_up: true });

    expect(captured!.body.follow_up).toBe(true);
  });

  it('carries follow_up false rather than dropping it', async () => {
    await post({ ...draft('someone@example.net'), follow_up: false });

    // Not `toBeFalsy`: an absent field is falsy too, and absent is what a
    // filtering proxy would produce.
    expect(captured!.body).toHaveProperty('follow_up', false);
  });

  it('keeps follow_up through the redaction rewrite, which rebuilds the body', async () => {
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'example.com=Acme');
    await post({ ...draft('someone@example.com'), follow_up: true });

    expect(captured!.body.context).toBe(`${BRIEF}\nIMPORTANT: never mention "Acme" anywhere.`);
    expect(captured!.body.follow_up).toBe(true);
  });

  it('sends no follow_up at all when the caller sends none', async () => {
    await post(draft('someone@example.net'));

    // The old body, unchanged: the upstream default is false, so a caller that
    // never heard of the mode keeps the behaviour it had.
    expect(captured!.body).not.toHaveProperty('follow_up');
  });
});

/**
 * The institutional road, checked on the wire for the same reason the redaction
 * rules are: what matters is the bytes the VPS receives.
 *
 * It is the one road where the enrichment MUST fire without any admin
 * credentials. The commercial one is keyed on API keys and returns the body
 * untouched when the address holds none, which an authority never does, so
 * without a branch of its own the single most consequential letter this CRM
 * writes would go out knowing nothing about who is writing it. No admin
 * environment is stubbed in this file, so these tests run in exactly the
 * degraded state that used to produce nothing at all.
 *
 * Fixtures invented, as everywhere in this repository: no real authority,
 * scheme or supplier is named, here or in a comment.
 */
describe('POST /api/crm/generate-draft, correspondence with an institution', () => {
  const institutional = (over: Record<string, unknown> = {}) => ({
    ...draft('registry@alpha.example.net'),
    contact_kind: 'institution',
    institution: {
      org: 'Autorité Alpha',
      category: 'autorite',
      country: 'CH',
      dossier: 'Permission de citer leur registre',
    },
    ...over,
  });

  it('flags the request institutional, server-side, so no send path can forget it', async () => {
    await post(institutional());

    expect(captured!.body).toHaveProperty('institutional', true);
    // The composer's own fields travel untouched beside it.
    expect(captured!.body).toMatchObject({ contact_kind: 'institution', to: 'registry@alpha.example.net' });
  });

  it('grounds the letter in who IBANforge is and how it treats public data', async () => {
    await post(institutional());
    const context = String(captured!.body.context);

    expect(context.startsWith(BRIEF)).toBe(true);
    expect(context).toContain('WRITTEN CORRESPONDENCE');
    expect(context).toContain('Swiss commercial API');
    expect(context).toContain('permission is asked IN WRITING');
    // The identity block and the address rule the commercial road also carries.
    expect(context).toContain('free tier 200 requests/month');
    expect(context).toContain('do not guess one');
  });

  it('carries the institution and the operator’s file line into the brief', async () => {
    await post(institutional());
    const context = String(captured!.body.context);

    expect(context).toContain('Autorité Alpha (autorite), CH');
    expect(context).toContain('Permission de citer leur registre');
  });

  it('still writes the identity block when the register row carries nothing but a name', async () => {
    await post(institutional({ institution: { org: 'Institut Gamma' } }));
    const context = String(captured!.body.context);

    expect(captured!.body).toHaveProperty('institutional', true);
    expect(context).toContain('Institut Gamma');
    expect(context).toContain('Swiss commercial API');
  });

  it('leaves an ordinary commercial draft exactly as it was', async () => {
    await post(draft('someone@example.net'));

    expect(captured!.body).not.toHaveProperty('institutional');
    expect(captured!.body.context).toBe(BRIEF);
  });

  it('still obeys a redaction rule on the institutional road', async () => {
    // The rules are applied before the enrichment, so the instruction has to
    // survive the rewrite that appends the facts. A confidentiality clause does
    // not stop applying because the recipient is an authority.
    vi.stubEnv('CRM_DRAFT_REDACTION_RULES', 'alpha.example.net=Acme');
    await post(institutional());
    const context = String(captured!.body.context);

    expect(context).toContain('IMPORTANT: never mention "Acme" anywhere.');
    expect(context).toContain('Swiss commercial API');
  });
});

describe('POST /api/crm/generate-draft, the paths around it', () => {
  it('answers 503 and calls nobody when the shared secret is missing', async () => {
    vi.stubEnv('CRM_DRAFT_SECRET', '');
    const res = await post(draft('someone@example.com'));

    expect(res.status).toBe(503);
    expect(captured).toBeNull();
  });

  it('answers 400 on a body that is not JSON', async () => {
    const res = await POST(
      new NextRequest('https://dashboard.example.com/api/crm/generate-draft', {
        method: 'POST',
        body: 'not json',
      }),
    );

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: 'invalid_json' });
    expect(captured).toBeNull();
  });

  it('answers 502 when the upstream cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down');
    });
    const res = await post(draft('someone@example.com'));

    expect(res.status).toBe(502);
  });

  it('passes the upstream status through', async () => {
    vi.stubGlobal('fetch', async () =>
      new Response(JSON.stringify({ error: 'no_mailbox', detail: 'aucun compte actif' }), { status: 404 }),
    );
    const res = await post(draft('someone@example.com'));

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: 'no_mailbox' });
  });
});
