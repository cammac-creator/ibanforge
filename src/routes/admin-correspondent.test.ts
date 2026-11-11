import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../app.js';
import { resetScopedCeilings, SCOPED_ADMIN_KEYS } from '../lib/admin-auth.js';
import { CARD_KEYS } from '../lib/correspondent.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { ensureAliasTable } from '../lib/email-aliases.js';
import { ensureInstitutionalTable } from '../lib/institutional-contacts.js';

/**
 * Lot 3I (11.11.2026) : `POST /v1/admin/correspondent`, la fiche d'UN
 * correspondant pour le bureau, et la famille `BUREAU_CONTEXT_TOKEN`.
 *
 * Données INVENTÉES (le dépôt est public) : alpha.example.net et Société Alpha.
 * Jamais @example.com pour un client : c'est une adresse interne
 * (INTERNAL_EMAIL_RE), que l'activation écarte.
 */
const PFX = 'ifk_corresp';
const CLIENT = 'buyer@alpha.example.net';
const ALIAS = 'billing@alpha.example.net';
const PROSPECT = 'lead@alpha.example.net';
const INSTITUTION = 'desk@authority.alpha.example.net';
const INTERNAL = 'corresp-probe@example.com';
const UNKNOWN = 'inconnu@alpha.example.net';
/** Un prospect dont les notes recopient son adresse : la fiche ne doit jamais la redire. */
const LEAKY = 'leaky@alpha.example.net';

const BUREAU = 'bureau-context-token-for-the-tests-0123456789';
const ADMIN = 'full-admin-secret-for-the-correspondent-tests-0123456789';
const READ = 'read-only-token-for-the-correspondent-tests-0123456789';
const SITE = 'site-token-for-the-correspondent-tests-0123456789';

const ENV_NAMES = ['ADMIN_SECRET', ...Object.keys(SCOPED_ADMIN_KEYS)];
const before: Record<string, string | undefined> = {};

function iso(d: Date): string {
  return d.toISOString().replace('T', ' ').slice(0, 19);
}
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));

let app: ReturnType<typeof buildApp>;
let ipCounter = 0;
const nextIp = () => {
  ipCounter += 1;
  return `192.0.2.${(ipCounter % 250) + 1}`;
};

function ask(email: unknown, token: string | null, raw?: string): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-forwarded-for': nextIp(),
  };
  if (token !== null) headers['X-Admin-Secret'] = token;
  return Promise.resolve(
    app.request('/v1/admin/correspondent', {
      method: 'POST',
      headers,
      body: raw ?? JSON.stringify({ email }),
    }),
  );
}

async function card(email: string): Promise<Record<string, unknown>> {
  const res = await ask(email, BUREAU);
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

beforeAll(() => {
  for (const name of ENV_NAMES) {
    before[name] = process.env[name];
    delete process.env[name];
  }
  process.env.ADMIN_SECRET = ADMIN;
  process.env.BUREAU_CONTEXT_TOKEN = BUREAU;
  process.env.ADMIN_READ_TOKEN = READ;
  process.env.SITE_ADMIN_TOKEN = SITE;
  app = buildApp();

  const db = getStatsDB();
  ensureAliasTable();
  ensureInstitutionalTable();
  const insKey = db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, active, monthly_limit, credits_total, credits_remaining, source, tier)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
  );
  insKey.run(`${PFX}_free`, `${PFX}_free`, CLIENT, daysAgo(60), 200, null, null, 'mcp', 'email');
  insKey.run(`${PFX}_pack`, `${PFX}_pack`, CLIENT, daysAgo(10), null, 10000, 3400, null, 'paid');
  insKey.run(`${PFX}_int`, `${PFX}_int`, INTERNAL, daysAgo(5), 200, null, null, null, 'email');
  db.prepare(
    `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix)
     VALUES ('POST', '/v1/iban/validate', 200, 12, ?, ?)`,
  ).run(daysAgo(1), `${PFX}_pack`);
  db.prepare('INSERT INTO email_aliases (alias, canonical) VALUES (?, ?)').run(ALIAS, CLIENT);

  const insProspect = db.prepare(
    `INSERT INTO prospects (id, company, segment, country, what_they_do, fit_reason, contact_role,
                            contact_email, status, outcome, outcome_at, wake_up_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  insProspect.run(
    `${PFX}_p1`,
    'Société Alpha',
    'psp',
    'CH',
    'Paiements pour PME',
    'Valide des IBAN chaque jour',
    'CTO',
    PROSPECT,
    'contacte',
    'pas_maintenant',
    '2026-11-01',
    '2026-12-01',
  );
  // Une ligne rejetée sur la même adresse : jamais elle.
  insProspect.run(
    `${PFX}_p0`,
    'Rejet Alpha',
    'autre',
    'FR',
    null,
    null,
    null,
    PROSPECT,
    'rejete',
    null,
    null,
    null,
  );
  insProspect.run(
    `${PFX}_p2`,
    'Fuite Alpha',
    'psp',
    'DE',
    `Écrire à ${LEAKY.toUpperCase()} pour tout`,
    `Contact : ${LEAKY}`,
    'Head of payments',
    LEAKY,
    'a_mailer',
    'bizarre',
    null,
    null,
  );
  // Le client est aussi un prospect : la société vient de là, le bloc prospect non.
  insProspect.run(
    `${PFX}_p3`,
    'Acheteur Alpha',
    'psp',
    'CH',
    null,
    null,
    null,
    CLIENT,
    'converti',
    null,
    null,
    null,
  );
  db.prepare(
    `INSERT INTO institutional_contacts (email, org, category, country, role, dossier)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    INSTITUTION,
    'Autorité Alpha',
    'autorite',
    'CH',
    'Guichet des données',
    'Licence du registre',
  );
});

afterAll(() => {
  const db = getStatsDB();
  db.prepare(`DELETE FROM request_log WHERE key_prefix LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM api_keys WHERE key_prefix LIKE '${PFX}%'`).run();
  db.prepare(`DELETE FROM prospects WHERE id LIKE '${PFX}%'`).run();
  db.prepare('DELETE FROM email_aliases WHERE alias = ?').run(ALIAS);
  db.prepare('DELETE FROM institutional_contacts WHERE email = ?').run(INSTITUTION);
  for (const name of ENV_NAMES) {
    if (before[name] === undefined) delete process.env[name];
    else process.env[name] = before[name];
  }
  closeAll();
});

beforeEach(() => resetScopedCeilings());
afterEach(() => resetScopedCeilings());

describe('the card, by kind', () => {
  it('a client: the API verdict as is, the company from its prospect row, no other block', async () => {
    const c = await card(CLIENT);
    expect(c).toMatchObject({
      version: 1,
      kind: 'client',
      internal: false,
      company: 'Acheteur Alpha',
      country: 'CH',
      prospect: null,
      institution: null,
    });
    expect(c.client).toEqual({
      status: 'paying',
      paid: true,
      packs: 1,
      subscriber: false,
      credits_remaining: 3400,
      credits_total: 10000,
      // La clé représentante est la clé à crédits (règle du CRM) : pas de plafond écrit.
      monthly_limit: null,
      calls_90d: 1,
      first_call_at: daysAgo(1),
      last_active_month: daysAgo(1).slice(0, 7),
      created_at: daysAgo(60),
      source: 'mcp',
    });
  });

  it('an alias reads as its customer, whatever its case', async () => {
    expect(await card(` ${ALIAS.toUpperCase()} `)).toEqual(await card(CLIENT));
  });

  it('a prospect: the first non-rejected row, an unknown outcome reads null', async () => {
    const c = await card(PROSPECT);
    expect(c).toEqual({
      version: 1,
      kind: 'prospect',
      internal: false,
      company: 'Société Alpha',
      country: 'CH',
      client: null,
      prospect: {
        segment: 'psp',
        what_they_do: 'Paiements pour PME',
        fit_reason: 'Valide des IBAN chaque jour',
        status: 'contacte',
        outcome: 'pas_maintenant',
        outcome_at: '2026-11-01',
        wake_up_at: '2026-12-01',
        contact_role: 'CTO',
      },
      institution: null,
    });
    const leaky = await card(LEAKY);
    expect((leaky.prospect as { outcome: unknown }).outcome).toBeNull();
  });

  it('an institution: its own block, the organisation as company', async () => {
    expect(await card(INSTITUTION)).toEqual({
      version: 1,
      kind: 'institution',
      internal: false,
      company: 'Autorité Alpha',
      country: 'CH',
      client: null,
      prospect: null,
      institution: {
        org: 'Autorité Alpha',
        category: 'autorite',
        country: 'CH',
        role: 'Guichet des données',
        dossier: 'Licence du registre',
      },
    });
  });

  it('an internal address holding a key is never a client', async () => {
    expect(await card(INTERNAL)).toEqual({
      version: 1,
      kind: 'unknown',
      internal: true,
      company: null,
      country: null,
      client: null,
      prospect: null,
      institution: null,
    });
  });

  it('an unknown address: kind unknown, same shape', async () => {
    expect(await card(UNKNOWN)).toEqual({
      version: 1,
      kind: 'unknown',
      internal: false,
      company: null,
      country: null,
      client: null,
      prospect: null,
      institution: null,
    });
  });

  it('a closed shape: exactly the keys of version 1, for every kind', async () => {
    for (const email of [CLIENT, PROSPECT, INSTITUTION, INTERNAL, UNKNOWN, LEAKY]) {
      expect(Object.keys(await card(email))).toEqual([...CARD_KEYS]);
    }
  });
});

describe('the address is never said back, never written down', () => {
  it('no answer carries the address asked, its alias or its canonical', async () => {
    for (const email of [CLIENT, ALIAS, PROSPECT, INSTITUTION, INTERNAL, UNKNOWN, LEAKY]) {
      const text = JSON.stringify(await card(email)).toLowerCase();
      expect(text).not.toContain(email);
      expect(text).not.toContain(CLIENT);
    }
  });

  it('a free text that copies the address is withheld (null), the rest kept', async () => {
    const c = await card(LEAKY);
    expect(c.prospect).toMatchObject({
      what_they_do: null,
      fit_reason: null,
      contact_role: 'Head of payments',
      segment: 'psp',
    });
  });

  it('nothing printed, nothing in the admin journal but the route, the key name and the status', async () => {
    const printed: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        printed.push(args.map((a) => String(a)).join(' '));
      }),
    );
    try {
      for (const email of [CLIENT, ALIAS, PROSPECT, UNKNOWN]) await card(email);
      await ask(CLIENT, READ);
      await ask(CLIENT, null);
      await ask(null, BUREAU, `{"email": "${UNKNOWN}", "broken"`);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    for (const line of printed) {
      for (const email of [CLIENT, ALIAS, PROSPECT, UNKNOWN]) {
        expect(line.toLowerCase()).not.toContain(email);
      }
    }
    const rows = getStatsDB()
      .prepare(`SELECT * FROM admin_calls WHERE route = '/v1/admin/correspondent'`)
      .all();
    expect(rows.length).toBeGreaterThan(0);
    const journal = JSON.stringify(rows).toLowerCase();
    for (const email of [CLIENT, ALIAS, PROSPECT, UNKNOWN]) expect(journal).not.toContain(email);
    expect(journal).toContain('bureau_context_token');
  });
});

describe('the door', () => {
  it('401 without a key, 401 with a wrong one, private no-store on every answer', async () => {
    for (const token of [null, 'not-a-key-at-all-0123456789']) {
      const res = await ask(UNKNOWN, token);
      expect(res.status).toBe(401);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
    const ok = await ask(UNKNOWN, BUREAU);
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
  });

  it('403 with the key of another family (read-only, site)', async () => {
    for (const token of [READ, SITE]) {
      const res = await ask(UNKNOWN, token);
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
    }
  });

  it('the full secret still opens it', async () => {
    expect((await ask(UNKNOWN, ADMIN)).status).toBe(200);
  });

  it('the office key opens its two aggregates, and never the registry of keys', async () => {
    const get = (path: string) =>
      app.request(path, { headers: { 'X-Admin-Secret': BUREAU, 'x-forwarded-for': nextIp() } });
    expect((await get('/v1/admin/business-pulse')).status).toBe(200);
    expect((await get('/v1/admin/stripe-revenue')).status).toBe(200);
    for (const path of ['/v1/admin/keys', '/v1/admin/prospects', '/v1/admin/activation']) {
      expect((await get(path)).status, path).toBe(403);
    }
  });

  it.each([
    ['not JSON', 'pas du json'],
    ['an array', '["a@alpha.example.net"]'],
    ['no email', '{}'],
    ['a second key', '{"email":"a@alpha.example.net","limit":5}'],
    ['a number', '{"email":42}'],
    ['no domain', '{"email":"nobody@"}'],
    ['no local part', '{"email":"@alpha.example.net"}'],
    ['a space inside', '{"email":"a b@alpha.example.net"}'],
    ['too long an address', JSON.stringify({ email: `${'a'.repeat(250)}@alpha.example.net` })],
    ['too long a body', JSON.stringify({ email: 'a@alpha.example.net', pad: 'x'.repeat(2000) })],
  ])('400 on %s, with a fixed sentence', async (_label, raw) => {
    const res = await ask(null, BUREAU, raw);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body).toEqual({
      error: 'invalid_body',
      message: 'Expected a JSON object with a single "email" string.',
    });
  });

  it('the address in the query string is ignored, never read', async () => {
    const res = await app.request(`/v1/admin/correspondent?email=${encodeURIComponent(CLIENT)}`, {
      method: 'POST',
      headers: {
        'X-Admin-Secret': BUREAU,
        'content-type': 'application/json',
        'x-forwarded-for': nextIp(),
      },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });
});

describe('the hourly ceiling of the office family', () => {
  it('120 accepted passages per hour across its routes, then 429; refusals cost nothing', async () => {
    // Des refus d'abord : ils ne consomment rien.
    for (let i = 0; i < 5; i++) {
      const res = await app.request('/v1/admin/keys', {
        headers: { 'X-Admin-Secret': BUREAU, 'x-forwarded-for': nextIp() },
      });
      expect(res.status).toBe(403);
    }
    for (let i = 0; i < 119; i++) {
      expect((await ask(UNKNOWN, BUREAU)).status, `passage ${i + 1}`).toBe(200);
    }
    const pulse = await app.request('/v1/admin/business-pulse', {
      headers: { 'X-Admin-Secret': BUREAU, 'x-forwarded-for': nextIp() },
    });
    expect(pulse.status).toBe(200); // le 120e, sur une autre route de la famille

    const over = await ask(UNKNOWN, BUREAU);
    expect(over.status).toBe(429);
    expect(over.headers.get('cache-control')).toBe('private, no-store');
    const wait = Number(over.headers.get('retry-after'));
    expect(wait).toBeGreaterThan(3500);
    expect(wait).toBeLessThanOrEqual(3600);
    expect(await over.json()).toEqual({
      error: 'rate_limited',
      message: 'This admin key has reached its hourly ceiling.',
    });
    const pulseOver = await app.request('/v1/admin/business-pulse', {
      headers: { 'X-Admin-Secret': BUREAU, 'x-forwarded-for': nextIp() },
    });
    expect(pulseOver.status).toBe(429);

    // Le secret complet et les autres familles ne sont pas bornés par ce plafond.
    expect((await ask(UNKNOWN, ADMIN)).status).toBe(200);
  });

  it('the window slides: an hour later the family is open again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-11-11T10:00:00Z'));
      for (let i = 0; i < 120; i++) expect((await ask(UNKNOWN, BUREAU)).status).toBe(200);
      expect((await ask(UNKNOWN, BUREAU)).status).toBe(429);
      vi.setSystemTime(new Date('2026-11-11T10:59:59Z'));
      expect((await ask(UNKNOWN, BUREAU)).status).toBe(429);
      vi.setSystemTime(new Date('2026-11-11T11:00:01Z'));
      expect((await ask(UNKNOWN, BUREAU)).status).toBe(200);
    } finally {
      vi.useRealTimers();
    }
  });
});
