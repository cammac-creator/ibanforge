import { BACKUP_FORMAT } from '../lib/backup.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { apiKeys } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { generateApiKey, getKeyTier, validateApiKey } from '../lib/api-keys.js';
import { burstRevocationFor, revokeBurstBatch } from '../lib/key-revocations.js';
import {
  ANONYMOUS_MONTHLY_LIMIT,
  CLAIM_MIN_PAID_USD,
  FREE_TIER_MONTHLY_LIMIT,
  KEY_CLAIM_URL,
} from '../lib/tiers.js';
import {
  CLAIM_SUCCESS_PER_SOURCE_DAY,
  createVerificationChallenge,
  keyCreationSource,
} from '../lib/key-creation-guard.js';
import { Hono } from 'hono';

function makeApp() {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

/** Unique per run: the stats DB is a file, and these rows outlive the process. */
const RUN_TAG = String(Date.now());

/**
 * Le code en clair d'un défi posé à la main, comme la route le fait.
 *
 * `createVerificationChallenge` rend `string | { refused: 'in_flight' }` depuis
 * que la réclamation partage la table des défis. Un défi sans cible n'est
 * jamais refusé par un autre défi sans cible : le narrow est là pour tsc, et
 * il jette plutôt que de masquer un refus qui voudrait dire autre chose.
 */
function plant(challenge: string | { refused: string }): string {
  if (typeof challenge !== 'string') throw new Error(`challenge refused: ${challenge.refused}`);
  return challenge;
}

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.ADMIN_SECRET = 'correct-horse-battery-staple';
  // Allow @example.com / disposable domains in test suite so we don't have to
  // invent unique real-looking emails for every test case.
  process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
});
afterEach(() => {
  process.env = { ...originalEnv };
});

describe('/v1/admin/keys — admin auth (timing-safe)', () => {
  it('rejects requests without X-Admin-Secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of same length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'wrong-horse-battery-staple-BAD', // padded to 30 chars
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong secret of different length', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'short',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects when ADMIN_SECRET env is not set (defence in depth)', async () => {
    delete process.env.ADMIN_SECRET;
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'anything',
      },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(res.status).toBe(401);
  });

  it('accepts correct secret and issues a key', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({ email: `admin-test-${Date.now()}@example.com` }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { api_key: string };
    expect(json.api_key).toMatch(/^ifk_/);
  });
});

/**
 * Who minted the key. Nothing about quota or billing turns on it; the Conquest
 * badge does — a key we fabricated and handed over cannot have been won by the
 * mail that carried it.
 */
describe('/v1/admin/keys — issued_by_us', () => {
  const admin = {
    'Content-Type': 'application/json',
    'X-Admin-Secret': 'correct-horse-battery-staple',
  };

  async function mint(email: string, body: Record<string, unknown>): Promise<string> {
    const res = await makeApp().request('/v1/admin/keys', {
      method: 'POST',
      headers: admin,
      body: JSON.stringify({ email, ...body }),
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { key_prefix: string }).key_prefix;
  }

  async function listed(prefix: string): Promise<number> {
    const res = await makeApp().request('/v1/admin/keys', { headers: admin });
    const body = (await res.json()) as {
      keys: Array<{ key_prefix: string; issued_by_us: number }>;
    };
    return body.keys.find((k) => k.key_prefix === prefix)!.issued_by_us;
  }

  it('is off unless the operator says otherwise, and travels back out on the listing', async () => {
    const ours = await mint(`ours-${Date.now()}@example.com`, { issued_by_us: true });
    const theirs = await mint(`theirs-${Date.now()}@example.com`, {});
    expect(await listed(ours)).toBe(1);
    expect(await listed(theirs)).toBe(0);
  });

  it('backfills by pattern, and the column defaults to "not ours"', () => {
    const db = getStatsDB();
    const col = (
      db.prepare('PRAGMA table_info(api_keys)').all() as Array<{
        name: string;
        dflt_value: string | null;
      }>
    ).find((c) => c.name === 'issued_by_us');
    expect(col).toBeDefined();
    expect(col!.dflt_value).toBe('0');

    // The migration runs once per database, so the RULE is re-applied here to
    // two freshly minted rows rather than re-running the boot path. Patterns
    // only: this repo is public and a backfill must never carry an address.
    const stamp = Date.now();
    const seeded = generateApiKey(`alpha-${stamp}-pilot@alpha.example.net`);
    const organic = generateApiKey(`ops-${stamp}@alpha.example.net`);
    expect(seeded).not.toBeNull();
    expect(organic).not.toBeNull();
    expect(flag(seeded!.key_prefix)).toBe(0);

    db.exec(
      "UPDATE api_keys SET issued_by_us = 1 WHERE email LIKE '%-pilot@%' OR email LIKE '%@cohorte.invalid'",
    );

    expect(flag(seeded!.key_prefix)).toBe(1);
    expect(flag(organic!.key_prefix)).toBe(0);
  });

  function flag(prefix: string): number {
    return (
      getStatsDB()
        .prepare('SELECT issued_by_us FROM api_keys WHERE key_prefix = ?')
        .get(prefix) as {
        issued_by_us: number;
      }
    ).issued_by_us;
  }
});

describe('/v1/admin/keys GET — listing', () => {
  it('unauthorized without secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys');
    expect(res.status).toBe(401);
  });

  it('authorized with correct secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { keys: unknown[] };
    expect(Array.isArray(json.keys)).toBe(true);
  });
});

describe('/v1/keys/generate — acquisition source (best-effort)', () => {
  it('stores a well-formed source and ignores a malformed one', async () => {
    process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
    const app = makeApp();
    const { getStatsDB } = await import('../lib/db.js');

    const okEmail = `src-ok-${Date.now()}@example.com`;
    const ok = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: okEmail, source: 'NPM-Readme' }),
    });
    expect(ok.status).toBe(201);
    const row = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE email = ?')
      .get(okEmail) as { source: string | null };
    expect(row.source).toBe('npm-readme');

    // Malformed source (spaces, too long, injection-ish) must not block the
    // key. It used to land as NULL; since 22/09/2026 it falls back to the DOOR,
    // because an empty origin is unrecoverable afterwards and left nearly every
    // external key unattributable. Best-effort still means "never refuse",
    // not "never record". No `attribution` object here, so the door is the
    // one a caller without a browser comes through.
    const badEmail = `src-bad-${Date.now()}@example.com`;
    const bad = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: badEmail, source: 'not a valid source!! ' + 'x'.repeat(60) }),
    });
    expect(bad.status).toBe(201);
    const rowBad = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE email = ?')
      .get(badEmail) as { source: string | null };
    expect(rowBad.source).toBe('api-direct');
  });

  it('écrit la porte quand rien de plus fin n’est connu, des deux côtés', async () => {
    process.env.IBANFORGE_ADMIN_TEST_KEYS = 'true';
    const app = makeApp();
    const { getStatsDB } = await import('../lib/db.js');
    const sourceOf = (email: string) =>
      (
        getStatsDB().prepare('SELECT source FROM api_keys WHERE email = ?').get(email) as {
          source: string | null;
        }
      ).source;

    // Sans navigateur : ni `source`, ni `attribution`. C'était le cas le plus
    // fréquent et le seul qui n'écrivait rien du tout.
    const curlEmail = `porte-api-${Date.now()}@example.com`;
    const curl = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: curlEmail }),
    });
    expect(curl.status).toBe(201);
    expect(sourceOf(curlEmail)).toBe('api-direct');

    // Avec navigateur : le dialogue envoie TOUJOURS un objet `attribution`,
    // même vide. C'est ce qui distingue un navigateur d'un curl, et la porte
    // qui en découle.
    const webEmail = `porte-web-${Date.now()}@example.com`;
    const web = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: webEmail, attribution: {} }),
    });
    expect(web.status).toBe(201);
    expect(sourceOf(webEmail)).toBe('site-signup');
  });
});

describe('/v1/admin/activation — per-email activation view', () => {
  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/activation');
    expect(res.status).toBe(401);
  });

  it('returns the four blocks with a clamped period', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/activation?days=45', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      clients: unknown[];
      funnel: { period_days: number };
      sources: unknown[];
      cohorts: unknown[];
    };
    expect(Array.isArray(body.clients)).toBe(true);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.cohorts).toHaveLength(8);
    // Only 30 and 90 are served; anything else falls back to 30.
    expect(body.funnel.period_days).toBe(30);
  });
});

describe('POST /v1/admin/events — manual annotations', () => {
  it('rejects without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'nope' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an empty label, records a real one', async () => {
    const app = makeApp();
    const headers = {
      'Content-Type': 'application/json',
      'X-Admin-Secret': 'correct-horse-battery-staple',
    };
    const bad = await app.request('/v1/admin/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: '  ' }),
    });
    expect(bad.status).toBe(400);
    const ok = await app.request('/v1/admin/events', {
      method: 'POST',
      headers,
      body: JSON.stringify({ label: 'admin-events-route-fixture' }),
    });
    expect(ok.status).toBe(201);
    const { getEvents } = await import('../lib/events.js');
    expect(
      getEvents(1).some((e) => e.label === 'admin-events-route-fixture' && e.kind === 'manual'),
    ).toBe(true);
    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare(`DELETE FROM events WHERE label = 'admin-events-route-fixture'`).run();
  });
});

describe('/v1/admin/weekly-facts + /v1/admin/digest — Monday digest plumbing', () => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Secret': 'correct-horse-battery-staple',
  };

  it('facts endpoint requires the secret and serves the WoW block', async () => {
    const app = makeApp();
    expect((await app.request('/v1/admin/weekly-facts')).status).toBe(401);
    const res = await app.request('/v1/admin/weekly-facts', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      week: string;
      requests: { current: number; previous: number };
    };
    expect(body.week).toMatch(/^\d{4}-W\d{2}$/);
    expect(typeof body.requests.current).toBe('number');
  });

  it('digest POST upserts by week (re-running the cron never duplicates)', async () => {
    const app = makeApp();
    const week = '1999-W01'; // far outside any real listing window
    const post = (body_fr: string) =>
      app.request('/v1/admin/digest', {
        method: 'POST',
        headers,
        body: JSON.stringify({ week, body_fr }),
      });
    expect((await post('premier jet')).status).toBe(201);
    expect((await post('version corrigée')).status).toBe(201);
    const { getStatsDB } = await import('../lib/db.js');
    const rows = getStatsDB()
      .prepare('SELECT body_fr FROM weekly_digest WHERE week = ?')
      .all(week) as Array<{ body_fr: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].body_fr).toBe('version corrigée');
    getStatsDB().prepare('DELETE FROM weekly_digest WHERE week = ?').run(week);
  });

  it('digest POST rejects a malformed week or empty body', async () => {
    const app = makeApp();
    const bad = await app.request('/v1/admin/digest', {
      method: 'POST',
      headers,
      body: JSON.stringify({ week: 'lundi', body_fr: 'x' }),
    });
    expect(bad.status).toBe(400);
    const empty = await app.request('/v1/admin/digest', {
      method: 'POST',
      headers,
      body: JSON.stringify({ week: '2026-W01', body_fr: '  ' }),
    });
    expect(empty.status).toBe(400);
  });

  it('digest GET lists rows newest week first', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/digest?limit=3', { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { digests: Array<{ week: string }> };
    expect(Array.isArray(body.digests)).toBe(true);
  });
});

describe('/v1/admin/thread-summary — cached French thread summaries', () => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Secret': 'correct-horse-battery-staple',
  };

  it('misses on unknown email, upserts, hits on matching key, misses on a changed key', async () => {
    const app = makeApp();
    const email = 'summary-probe@alpha.example.net';
    const miss = await app.request(
      `/v1/admin/thread-summary?email=${encodeURIComponent(email)}&key=k1`,
      { headers },
    );
    expect(miss.status).toBe(200);
    expect(((await miss.json()) as { summary: unknown }).summary).toBeNull();

    const post = await app.request('/v1/admin/thread-summary', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        email,
        thread_key: 'k1',
        summary_fr: 'Il attend le pricing entreprise.',
      }),
    });
    expect(post.status).toBe(201);

    const hit = await app.request(
      `/v1/admin/thread-summary?email=${encodeURIComponent(email)}&key=k1`,
      { headers },
    );
    const hitBody = (await hit.json()) as { summary: { summary_fr: string } | null };
    expect(hitBody.summary?.summary_fr).toContain('pricing');

    // A new message moves the key: the stale summary must not be served.
    const stale = await app.request(
      `/v1/admin/thread-summary?email=${encodeURIComponent(email)}&key=k2`,
      { headers },
    );
    expect(((await stale.json()) as { summary: unknown }).summary).toBeNull();

    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare('DELETE FROM thread_summaries WHERE email = ?').run(email);
  });

  it('rejects an empty summary or missing key', async () => {
    const app = makeApp();
    const bad = await app.request('/v1/admin/thread-summary', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: 'x@alpha.example.net', thread_key: '', summary_fr: '  ' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('/v1/admin/contact-notes — the operator working memory', () => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Admin-Secret': 'correct-horse-battery-staple',
  };
  const EMAIL = 'notes-probe@alpha.example.net';

  it('adds, lists (newest first) and deletes a note', async () => {
    const app = makeApp();
    const a = await app.request('/v1/admin/contact-notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: EMAIL, note: 'migre depuis iban.com, décision en septembre' }),
    });
    expect(a.status).toBe(201);
    const b = await app.request('/v1/admin/contact-notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: EMAIL, note: 'veut le VoP' }),
    });
    expect(b.status).toBe(201);

    const list = await app.request(`/v1/admin/contact-notes?email=${encodeURIComponent(EMAIL)}`, {
      headers,
    });
    const notes = ((await list.json()) as { notes: Array<{ id: number; note: string }> }).notes;
    expect(notes.length).toBe(2);
    expect(notes[0].note).toContain('VoP');

    const del = await app.request(`/v1/admin/contact-notes?id=${notes[0].id}`, {
      method: 'DELETE',
      headers,
    });
    expect(del.status).toBe(200);
    const after = await app.request(`/v1/admin/contact-notes?email=${encodeURIComponent(EMAIL)}`, {
      headers,
    });
    expect(((await after.json()) as { notes: unknown[] }).notes.length).toBe(1);

    const { getStatsDB } = await import('../lib/db.js');
    getStatsDB().prepare('DELETE FROM contact_notes WHERE email = ?').run(EMAIL);
  });

  it('rejects an empty note', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/contact-notes', {
      method: 'POST',
      headers,
      body: JSON.stringify({ email: EMAIL, note: '   ' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('/v1/admin/keys — a prepaid customer is not a dormant one', () => {
  const admin = { 'X-Admin-Secret': 'correct-horse-battery-staple' };
  const P = 'ifk_testcred';

  function seed(creditsTotal: number, creditsRemaining: number, calls: number): void {
    const db = getStatsDB();
    db.prepare('DELETE FROM api_keys WHERE key_prefix = ?').run(P);
    db.prepare('DELETE FROM request_log WHERE key_prefix = ?').run(P);
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, credits_remaining, credits_total)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run(`hash-${P}`, P, 'acme@example.com', creditsRemaining, creditsTotal);
    const insert = db.prepare(
      "INSERT INTO request_log (method, path, status, key_prefix, created_at) VALUES ('POST', '/v1/iban/batch', 200, ?, datetime('now'))",
    );
    for (let i = 0; i < calls; i++) insert.run(P);
  }

  function clean(): void {
    const db = getStatsDB();
    db.prepare('DELETE FROM api_keys WHERE key_prefix = ?').run(P);
    db.prepare('DELETE FROM request_log WHERE key_prefix = ?').run(P);
  }

  async function readKey(): Promise<Record<string, unknown>> {
    const res = await makeApp().request('/v1/admin/keys', { headers: admin });
    const body = (await res.json()) as { keys: Array<Record<string, unknown>> };
    return body.keys.find((k) => k.key_prefix === P)!;
  }

  it('counts credits spent as usage, not as silence', async () => {
    // The defect this pins: a credit key writes no api_usage row, because the
    // middleware takes the decrementCredits branch instead. Reading only that
    // ledger showed a customer who had just spent 3,373 units as one who had
    // never called, on the very screen used to decide who to contact.
    seed(5000, 1627, 12);
    const key = await readKey();
    expect(key.used_all_time).toBe(3373);
    expect(key.credits_used).toBe(3373);
    clean();
  });

  it('draws the sparkline from the call log when the quota ledger is silent', async () => {
    seed(5000, 1627, 12);
    const key = await readKey();
    expect(key.series_unit).toBe('calls');
    expect((key.series as number[]).at(-1)).toBe(12);
    // A month must be named, otherwise the CRM reads the customer as never seen.
    expect(key.last_active_month).toBe(new Date().toISOString().slice(0, 7));
    clean();
  });

  it('never reports negative usage when a refund overshoots', async () => {
    // refundCredit clamps at credits_total, but a row edited by hand or an old
    // migration could still hold remaining > total. Reporting -50 units used
    // would be worse than reporting zero.
    seed(1000, 1050, 0);
    const key = await readKey();
    expect(key.credits_used).toBe(0);
    expect(key.used_all_time).toBe(0);
    clean();
  });
});

describe('POST /v1/admin/keys/relabel — regroup abuse cohorts', () => {
  it('rejects requests without the admin secret', async () => {
    const app = makeApp();
    const res = await app.request('/v1/admin/keys/relabel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key_prefixes: ['ifk_whatever'], email: 'c@cohorte.invalid' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects an empty prefix list and an address without @', async () => {
    const app = makeApp();
    for (const body of [
      { key_prefixes: [], email: 'c@cohorte.invalid' },
      { key_prefixes: ['ifk_x'], email: 'not-an-address' },
    ]) {
      const res = await app.request('/v1/admin/keys/relabel', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Secret': 'correct-horse-battery-staple',
        },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(400);
    }
  });

  it('relabels listed keys, returns the previous mapping, and lists unknown prefixes', async () => {
    const app = makeApp();
    const db = getStatsDB();
    const suffix = Date.now();

    // Two invented farm keys + one bystander that must NOT be touched.
    const gen = async (email: string) => {
      const res = await app.request('/v1/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json()) as { key_prefix: string };
      return json.key_prefix;
    };
    const farm1 = await gen(`aaaa-${suffix}@example.com`);
    const farm2 = await gen(`bbbb-${suffix}@example.com`);
    const bystander = await gen(`real-${suffix}@example.com`);

    const res = await app.request('/v1/admin/keys/relabel', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': 'correct-horse-battery-staple',
      },
      body: JSON.stringify({
        key_prefixes: [farm1, farm2, 'ifk_absent000'],
        email: 'cohorte-test@cohorte.invalid',
      }),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      relabeled: number;
      not_found: string[];
      previous: Array<{ key_prefix: string; email: string }>;
    };
    expect(json.relabeled).toBe(2);
    expect(json.not_found).toEqual(['ifk_absent000']);
    // The previous mapping is the undo path — it must carry the old addresses.
    expect(json.previous.map((p) => p.email).sort()).toEqual(
      [`aaaa-${suffix}@example.com`, `bbbb-${suffix}@example.com`].sort(),
    );

    const relabeled = db
      .prepare('SELECT email FROM api_keys WHERE key_prefix IN (?, ?)')
      .all(farm1, farm2) as Array<{ email: string }>;
    expect(relabeled.every((r) => r.email === 'cohorte-test@cohorte.invalid')).toBe(true);

    const untouched = db
      .prepare('SELECT email FROM api_keys WHERE key_prefix = ?')
      .get(bystander) as {
      email: string;
    };
    expect(untouched.email).toBe(`real-${suffix}@example.com`);
  });
});

describe('POST /v1/keys/generate — per-network creation guard', () => {
  // The guard is skipped when IBANFORGE_ADMIN_TEST_KEYS is set (the rest of
  // the suite generates keys freely), so these tests unset it and identify
  // themselves through X-Forwarded-For instead.
  const gen = (app: Hono, email: string, ip: string, code?: string) =>
    app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify(code ? { email, code } : { email }),
    });

  it('first key from a network stays one-step; the second demands a mailbox code; the code unlocks it', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const app = makeApp();
    // Two octets derived from the clock: the creation counter persists in the
    // DB across runs, so a colliding fixture IP would inherit a previous
    // run's count and flip the first expectation.
    const ts = Date.now();
    const ip = `198.51.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
    const suffix = ts;

    const first = await gen(app, `guard-a-${suffix}@alpha-corp.example.net`, ip);
    expect(first.status).toBe(201);

    // No mail relay is configured in tests, so the route cannot deliver the
    // code and answers 503 (fail-CLOSED: a second key never slips through
    // unverified just because mail is down). In production the relay is set
    // and this leg answers 403 verification_required with the code mailed.
    const second = await gen(app, `guard-b-${suffix}@alpha-corp.example.net`, ip);
    expect(second.status).toBe(503);
    expect(((await second.json()) as { error: string }).error).toBe('verification_unavailable');

    // Read the code straight from the challenge we just planted (the mail
    // relay is unset in tests). checkVerificationCode consumes it, so plant a
    // fresh one exactly like the route did.
    // `plant` narrows the string | { refused } the challenge now returns: the
    // claim path shares this table, and only a COMPETING target can refuse.
    const code = plant(
      createVerificationChallenge(`guard-b-${suffix}@alpha-corp.example.net`, 'test'),
    );
    const unlocked = await gen(app, `guard-b-${suffix}@alpha-corp.example.net`, ip, code);
    expect(unlocked.status).toBe(201);
  });

  it('refuses the fourth key of the day from one network with 429 and a paid path', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const app = makeApp();
    // Same clock-derived scheme as above, offset into another /16 so the two
    // tests can never share a counter whatever the interleaving.
    const ts = Date.now();
    const ip = `198.52.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
    const suffix = ts + 1;

    expect((await gen(app, `cap-1-${suffix}@alpha-corp.example.net`, ip)).status).toBe(201);
    for (const n of [2, 3]) {
      const email = `cap-${n}-${suffix}@alpha-corp.example.net`;
      const code = plant(createVerificationChallenge(email, 'test'));
      expect((await gen(app, email, ip, code)).status).toBe(201);
    }

    const fourth = await gen(app, `cap-4-${suffix}@alpha-corp.example.net`, ip);
    expect(fourth.status).toBe(429);
    const body = (await fourth.json()) as { error: string; message: string };
    expect(body.error).toBe('key_creation_limit');
    expect(body.message).toContain('credits');
  });

  it('an address the mail server refuses answers 400 undeliverable_email, not a 503 that blames the relay', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    process.env.MAIL_RELAY_URL = 'https://relay.test/api/relay/send';
    process.env.MAIL_RELAY_SECRET = 'shared-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            "send failed: {'x@alpha.example.net': (550, b'5.1.2 Recipient address rejected: Domain not found')}",
            { status: 502 },
          ),
      ),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = makeApp();
      const ts = Date.now();
      const ip = `198.54.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
      expect((await gen(app, `owner-${ts}@alpha-corp.example.net`, ip)).status).toBe(201);
      const second = await gen(app, `nobody-${ts}@alpha-corp.example.net`, ip);
      expect(second.status).toBe(400);
      expect(((await second.json()) as { error: string }).error).toBe('undeliverable_email');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('a relay that rejects our shared secret still answers 503 verification_unavailable', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    process.env.MAIL_RELAY_URL = 'https://relay.test/api/relay/send';
    process.env.MAIL_RELAY_SECRET = 'shared-secret';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unauthorized', { status: 401 })),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const app = makeApp();
      const ts = Date.now();
      const ip = `198.55.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
      expect((await gen(app, `owner-${ts}@alpha-corp.example.net`, ip)).status).toBe(201);
      const second = await gen(app, `second-${ts}@alpha-corp.example.net`, ip);
      expect(second.status).toBe(503);
      expect(((await second.json()) as { error: string }).error).toBe('verification_unavailable');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('records where a browser signup came from, and counts a curl signup as api', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const app = makeApp();
    const ts = Date.now();
    const tag = `t${ts}`;
    const browserIp = `198.56.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
    const curlIp = `198.57.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
    const first = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': browserIp },
      body: JSON.stringify({
        email: `origin-${ts}@alpha-corp.example.net`,
        source: 'npm',
        attribution: {
          landing: '/en/docs/quickstart',
          referrer: 'Google.com',
          utm_source: tag,
          utm_medium: 'Email',
          junk: 'x',
        },
      }),
    });
    expect(first.status).toBe(201);
    expect((await gen(app, `origin-curl-${ts}@alpha-corp.example.net`, curlIp)).status).toBe(201);

    const { signupSources } = await import('../lib/signup-attribution.js');
    const s = signupSources(1);
    expect(s.channels.find((c) => c.channel === `utm:${tag}`)?.n).toBe(1);
    expect(s.campaigns.find((c) => c.utm_source === tag)).toEqual({
      utm_source: tag,
      utm_medium: 'email',
      utm_campaign: null,
      n: 1,
    });
    expect(s.landings.find((l) => l.path === '/en/docs/quickstart')?.n).toBeGreaterThanOrEqual(1);
    expect(s.referrers.find((r) => r.host === 'google.com')?.n).toBeGreaterThanOrEqual(1);
    // 🚨 Le canal d'une inscription SANS navigateur n'est plus `api` mais la
    // porte `src:api-direct` : depuis le 22/09/2026 chaque chemin de frappe
    // écrit une origine, et `api` ne restait que pour les lignes d'avant.
    expect(s.channels.find((c) => c.channel === 'src:api-direct')?.n).toBeGreaterThanOrEqual(1);
  });

  it('serves the origins to the admin only', async () => {
    const { adminSignupSources } = await import('./admin-signup-sources.js');
    const app = new Hono();
    app.route('/', adminSignupSources);
    expect((await app.request('/v1/admin/signup-sources')).status).toBe(401);
    const ok = await app.request('/v1/admin/signup-sources?days=7', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { period_days: number; channels: unknown[]; total: number };
    expect(body.period_days).toBe(7);
    expect(Array.isArray(body.channels)).toBe(true);
  });

  it('keeps disposable suffixes out at creation — the wave used tempmail.edu.ge', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const app = makeApp();
    const res = await gen(app, `x-${Date.now()}@tempmail.edu.ge`, '198.51.100.250');
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('disposable_email');
  });

  it('fails open when no client IP is resolvable — a header change must never brick signups', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const app = makeApp();
    const res = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `noip-${Date.now()}@alpha-corp.example.net` }),
    });
    expect(res.status).toBe(201);
  });

  it('stops mailing verification codes to the same address after the daily cap (anti-bombing)', async () => {
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const app = makeApp();
    const ts = Date.now();
    const ip = `198.53.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
    // One real key on this network so the second-key verification branch fires.
    expect((await gen(app, `bomb-owner-${ts}@alpha-corp.example.net`, ip)).status).toBe(201);

    const victim = `victim-${ts}@bank.example.net`;
    const { VERIFICATION_SENDS_PER_EMAIL_DAY } = await import('../lib/key-creation-guard.js');
    // The mail relay is unset in tests, so each allowed attempt answers 503
    // (verification_unavailable) — but it still counts as a send.
    for (let i = 0; i < VERIFICATION_SENDS_PER_EMAIL_DAY; i++) {
      expect((await gen(app, victim, ip)).status).toBe(503);
    }
    // One more request for the same victim is refused BEFORE any mail: 429.
    const capped = await gen(app, victim, ip);
    expect(capped.status).toBe(429);
    expect(((await capped.json()) as { error: string }).error).toBe('verification_rate_limited');
  });
});

/**
 * The self-service report. Auth is the key itself, so what matters is that a
 * holder can never reach another holder's rows, and that a hostile window
 * parameter cannot turn the endpoint into a full-table scan.
 *
 * Keys are minted through the library rather than through /v1/admin/keys: the
 * route is rate-limited on purpose (the anti-farm guard of 18/08), and three
 * mints in a row trip it — which is the guard working, not a test to weaken.
 *
 * Addresses are invented. This repository is public.
 */
describe('/v1/keys/report — the customer reads their own key', () => {
  function mintKey(email: string): string {
    const db = getStatsDB();
    // A same-day key for this address would make generateApiKey return null.
    db.prepare('DELETE FROM api_keys WHERE email = ?').run(email);
    const made = generateApiKey(email);
    if (!made) throw new Error(`could not mint a test key for ${email}`);
    return made.api_key;
  }

  it('refuses a request with no key', async () => {
    const res = await makeApp().request('/v1/keys/report');
    expect(res.status).toBe(401);
  });

  it('refuses a key that does not exist', async () => {
    const res = await makeApp().request('/v1/keys/report', {
      headers: { Authorization: 'Bearer ifk_nope_nope_nope' },
    });
    expect(res.status).toBe(401);
  });

  it('answers a valid key with its own usage and report', async () => {
    const key = mintKey('acme@example.com');
    const res = await makeApp().request('/v1/keys/report', {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      key_prefix: string;
      usage: { used: number; month: string };
      report: { total: number; footprint: { unusual: boolean | null } };
    };
    expect(body.key_prefix).toBe(key.slice(0, 12));
    expect(body.usage.month).toMatch(/^\d{4}-\d{2}$/);
    // A key minted a second ago has no history — and no history is not a
    // clean bill of health.
    expect(body.report.footprint.unusual).toBeNull();
  });

  it('shows a holder their own calls and never a neighbour key rows', async () => {
    const mine = mintKey('acme@example.com');
    const theirs = mintKey('ops@alpha.example.net');
    const db = getStatsDB();
    db.prepare(
      `INSERT INTO request_log (method, path, status, response_ms, hour, day_of_week, key_prefix)
       VALUES ('POST', '/v1/iban/validate', 200, 12, 10, 2, ?)`,
    ).run(theirs.slice(0, 12));

    const res = await makeApp().request('/v1/keys/report', {
      headers: { Authorization: `Bearer ${mine}` },
    });
    const body = (await res.json()) as { report: { total: number } };
    // The neighbour's call must not appear in my report.
    expect(body.report.total).toBe(0);
  });

  it('clamps an absurd window instead of scanning the whole table', async () => {
    const key = mintKey('acme@example.com');
    const res = await makeApp().request('/v1/keys/report?days=99999', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as { report: { window_days: number } };
    expect(body.report.window_days).toBe(365);
  });

  it('falls back to the default window when days is not a number', async () => {
    const key = mintKey('acme@example.com');
    const res = await makeApp().request('/v1/keys/report?days=drop-table', {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as { report: { window_days: number } };
    expect(body.report.window_days).toBe(30);
  });

  /**
   * Security audit, improvement 1 (2026-09-01). These two routes accepted
   * `Authorization: Bearer` and nothing else, while every billed route accepts
   * three dialects through `extractKey` (src/middleware/api-key.ts) and the docs
   * advertise `X-API-Key`. A client following the documented header could not
   * read its own usage and got a 401 that reads exactly like "your key is
   * invalid", which is a self-inflicted cause of the silence measured after
   * the purchase.
   */
  describe('the documented key dialects all work', () => {
    for (const [name, headersFor] of [
      ['Authorization: Bearer', (k: string) => ({ Authorization: `Bearer ${k}` })],
      ['X-API-Key', (k: string) => ({ 'X-API-Key': k })],
      ['x-api-key (lowercase)', (k: string) => ({ 'x-api-key': k })],
    ] as const) {
      it(`serves /v1/keys/usage with ${name}`, async () => {
        const key = mintKey('acme@example.com');
        const res = await makeApp().request('/v1/keys/usage', { headers: headersFor(key) });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { key_prefix: string };
        // The prefix comes from the presented key, whichever door it came in.
        expect(body.key_prefix).toBe(key.slice(0, 12));
      });

      it(`serves /v1/keys/report with ${name}`, async () => {
        const key = mintKey('acme@example.com');
        const res = await makeApp().request('/v1/keys/report', { headers: headersFor(key) });
        expect(res.status).toBe(200);
        const body = (await res.json()) as { key_prefix: string };
        expect(body.key_prefix).toBe(key.slice(0, 12));
      });
    }

    it('serves both routes with ?api_key=, like every billed route', async () => {
      const key = mintKey('acme@example.com');
      for (const path of ['/v1/keys/usage', '/v1/keys/report']) {
        const res = await makeApp().request(`${path}?api_key=${key}`);
        expect(res.status, path).toBe(200);
      }
    });

    it('still refuses a value that is not one of our keys, whatever the header', async () => {
      const refused: Record<string, string>[] = [
        { 'X-API-Key': 'not-a-key' },
        { Authorization: 'Bearer not-a-key' },
        // Right shape, no such key: 401 for a different reason, still 401.
        { 'X-API-Key': 'ifk_nope' },
      ];
      for (const headers of refused) {
        expect((await makeApp().request('/v1/keys/usage', { headers })).status).toBe(401);
      }
    });

    it('names every accepted door in the refusal, so nobody guesses', async () => {
      const res = await makeApp().request('/v1/keys/usage');
      expect(res.status).toBe(401);
      const body = (await res.json()) as { message: string };
      expect(body.message).toContain('X-API-Key');
      expect(body.message).toContain('Bearer');
    });
  });
});

/**
 * The backup endpoint. It hands out customer data, so the only thing that
 * really matters is that it never answers without the admin secret.
 */
describe('/v1/admin/backup', () => {
  it('refuses a request with no secret', async () => {
    const res = await makeApp().request('/v1/admin/backup');
    expect(res.status).toBe(401);
  });

  it('refuses a wrong secret of the same length', async () => {
    // Same length, different content: the case a naive length check would let
    // through, and the reason the comparison is timing-safe.
    const wrong = 'wrong-horse-battery-stapleXX'.padEnd('correct-horse-battery-staple'.length, 'X');
    expect(wrong.length).toBe('correct-horse-battery-staple'.length);
    const res = await makeApp().request('/v1/admin/backup', {
      headers: { 'X-Admin-Secret': wrong },
    });
    expect(res.status).toBe(401);
  });

  it('answers a valid secret with a stamped, countable dump', async () => {
    const res = await makeApp().request('/v1/admin/backup', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      format: number;
      taken_at: string;
      counts: { api_keys: number; api_usage: number };
      api_keys: unknown[];
    };
    // Le format suit la constante : un dump doit annoncer ce qu'il contient,
    // et il contient les deux journaux du palier de clé depuis le lot 2.
    expect(body.format).toBe(BACKUP_FORMAT);
    expect(body.taken_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The declared count must match what is actually in the payload: a dump
    // that says 300 and carries 200 is the failure nobody notices until the
    // day it is restored.
    expect(body.counts.api_keys).toBe(body.api_keys.length);
  });
});

/**
 * The institutional correspondents registry. It holds who an address belongs
 * to and which dossier it answers, so the endpoints matter as much for what
 * they refuse (no secret, no organisation) as for what they store.
 */
describe('/v1/admin/institutional-contacts', () => {
  const ADMIN = {
    'Content-Type': 'application/json',
    'X-Admin-Secret': 'correct-horse-battery-staple',
  };
  const ALPHA = 'registry@alpha.example.net';

  const post = (path: string, body: unknown, headers: Record<string, string> = ADMIN) =>
    makeApp().request(path, { method: 'POST', headers, body: JSON.stringify(body) });

  async function purge() {
    const { ensureInstitutionalTable } = await import('../lib/institutional-contacts.js');
    ensureInstitutionalTable();
    getStatsDB()
      .prepare(`DELETE FROM institutional_contacts WHERE email LIKE '%@alpha.example.net'`)
      .run();
  }

  it('refuses all three endpoints without the admin secret', async () => {
    // The registry names who we are asking things of. It answers nobody else.
    expect((await makeApp().request('/v1/admin/institutional-contacts')).status).toBe(401);
    const json = { 'Content-Type': 'application/json' };
    expect((await post('/v1/admin/institutional-contacts', { email: ALPHA }, json)).status).toBe(
      401,
    );
    expect(
      (await post('/v1/admin/institutional-contacts/delete', { email: ALPHA }, json)).status,
    ).toBe(401);
  });

  it('lists the registry for an authorised caller', async () => {
    const res = await makeApp().request('/v1/admin/institutional-contacts', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { contacts: unknown[] };
    expect(Array.isArray(json.contacts)).toBe(true);
  });

  it('stores a correspondent and hands back the updated list', async () => {
    await purge();
    const res = await post('/v1/admin/institutional-contacts', {
      email: ' Registry@Alpha.Example.NET ',
      org: 'Autorité Alpha',
      category: 'autorite',
      country: 'ch',
      dossier: 'Réutilisation des données publiées',
    });
    expect(res.status).toBe(200);
    const { contacts } = (await res.json()) as { contacts: Array<Record<string, string | null>> };
    const row = contacts.find((r) => r.email === ALPHA)!;
    expect(row.org).toBe('Autorité Alpha');
    expect(row.country).toBe('CH');
    await purge();
  });

  it('answers 400 in French rather than storing a nameless row', async () => {
    const res = await post('/v1/admin/institutional-contacts', {
      email: ALPHA,
      org: '',
      category: 'autorite',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_input');
    expect(body.message).toContain('organisation');
  });

  it('answers 400 on a body that is not an object, instead of crashing', async () => {
    expect((await post('/v1/admin/institutional-contacts', null)).status).toBe(400);
    expect((await post('/v1/admin/institutional-contacts', [{ email: ALPHA }])).status).toBe(400);
  });

  it('deletes a known address and reports a miss on an unknown one', async () => {
    await purge();
    await post('/v1/admin/institutional-contacts', {
      email: ALPHA,
      org: 'Autorité Alpha',
      category: 'autorite',
    });
    const del = await post('/v1/admin/institutional-contacts/delete', {
      email: ALPHA.toUpperCase(),
    });
    expect(del.status).toBe(200);
    const body = (await del.json()) as { deleted: number; contacts: Array<{ email: string }> };
    expect(body.deleted).toBe(1);
    expect(body.contacts.some((r) => r.email === ALPHA)).toBe(false);
    // A second delete must not pretend to have removed anything.
    expect((await post('/v1/admin/institutional-contacts/delete', { email: ALPHA })).status).toBe(
      404,
    );
  });
});

describe('GET /v1/admin/email-messages — the two optional cuts (TABS-12, TABS-03)', () => {
  const app = () => makeApp();
  const H = {
    'X-Admin-Secret': 'correct-horse-battery-staple',
    'Content-Type': 'application/json',
  };
  const DAY = '2026-09-01';
  const OLD = '2026-07-04';

  async function seed() {
    await app().request('/v1/admin/email-messages', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        messages: [
          {
            id: `fields-today-${RUN_TAG}`,
            customer_email: 'acme@example.com',
            direction: 'out',
            msg_date: `${DAY}T09:12:31`,
            subject: 'Suivi',
            snippet: 'Des nouvelles',
            body: 'Un corps de message assez long pour que son absence se voie.',
          },
          {
            id: `fields-old-${RUN_TAG}`,
            customer_email: 'acme@example.com',
            direction: 'out',
            msg_date: `${OLD}T09:00:00`,
            subject: 'Ancien',
            snippet: 'Ancien',
            body: 'Un autre corps.',
          },
        ],
      }),
    });
  }

  async function list(qs: string) {
    const res = await app().request(`/v1/admin/email-messages${qs}`, { headers: H });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { messages: Array<Record<string, unknown>> };
    return j.messages.filter((m) => String(m.id).endsWith(RUN_TAG));
  }

  it('answers exactly as before when no parameter is given', async () => {
    await seed();
    const rows = await list('');
    expect(rows).toHaveLength(2);
    // Retro-compatibility is the whole promise: an older caller keeps its body.
    expect(rows.every((m) => typeof m.body === 'string' && m.body.length > 0)).toBe(true);
  });

  it('drops the bodies on fields=summary, and nothing else', async () => {
    await seed();
    const rows = await list('?fields=summary');
    expect(rows).toHaveLength(2);
    expect(rows.every((m) => !('body' in m))).toBe(true);
    // Everything a list view actually draws is still there.
    expect(rows.every((m) => typeof m.snippet === 'string' && typeof m.subject === 'string')).toBe(
      true,
    );
  });

  it('keeps only the rows dated on or after `since`', async () => {
    await seed();
    const rows = await list(`?since=${DAY}`);
    expect(rows.map((m) => m.id)).toEqual([`fields-today-${RUN_TAG}`]);
  });

  it('ignores a malformed `since` rather than emptying the list', async () => {
    await seed();
    expect(await list('?since=hier')).toHaveLength(2);
    expect(await list('?since=2026-9-1')).toHaveLength(2);
  });

  it('combines both cuts, which is what the send path asks for', async () => {
    await seed();
    const rows = await list(`?fields=summary&since=${DAY}`);
    expect(rows).toHaveLength(1);
    expect('body' in rows[0]).toBe(false);
  });
});

describe('POST /v1/admin/email-messages — where a sent mail came from', () => {
  const app = () => makeApp();
  const H = {
    'X-Admin-Secret': 'correct-horse-battery-staple',
    'Content-Type': 'application/json',
  };
  /**
   * One id per test, and never one ending in RUN_TAG.
   *
   * Two separate traps, both of which bit here. The block above filters its own
   * rows with `String(m.id).endsWith(RUN_TAG)` and then asserts an exact
   * length, so a row of ours ending in that tag would be swept into counts
   * that have nothing to do with origin — hence the suffix after the tag. And
   * the stats DB is a FILE: rows outlive the process, and this whole feature is
   * "a second write does not erase the first", so two tests sharing an id would
   * hand each other a mark. The tag keeps ids unique across runs, the per-test
   * name keeps them unique within one.
   */
  const idFor = (name: string) => `origin-${RUN_TAG}-${name}`;

  /**
   * Send one row, with whatever this call declares about it.
   *
   * The subject carries the id since 2026-09-07: the store now reconciles two
   * ids that name one message (same address, minute and subject), so five
   * tests sharing one subject in one minute would all land on the first row
   * and read each other's marks. Distinct subjects keep them distinct
   * messages, which is what they were meant to be.
   */
  async function put(ID: string, extra: Record<string, unknown>) {
    const res = await app().request('/v1/admin/email-messages', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({
        messages: [
          {
            id: ID,
            customer_email: 'acme@example.com',
            direction: 'out',
            msg_date: '2026-09-07T08:15:00',
            subject: `Demande de réutilisation des données (${ID})`,
            snippet: 'Bonjour, nous sollicitons…',
            ...extra,
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
  }

  /** One row, read back through the very endpoint the dashboard reads. */
  async function stored(ID: string, qs = ''): Promise<Record<string, unknown>> {
    const res = await app().request(`/v1/admin/email-messages${qs}`, { headers: H });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { messages: Array<Record<string, unknown>> };
    return j.messages.find((m) => m.id === ID)!;
  }

  it('stores the origin declared at insertion, and serves it back', async () => {
    const id = idFor('insert');
    await put(id, { origin: 'claude' });
    expect((await stored(id)).origin).toBe('claude');
  });

  it('keeps it when a re-sync of the same message declares none', async () => {
    // The whole mailbox is re-ingested nightly by a script that reads IMAP and
    // cannot know a mail was written by the agent rather than by hand. Without
    // COALESCE, that sync would erase every mark the same evening it was placed.
    const id = idFor('resync');
    await put(id, { origin: 'claude' });
    await put(id, { snippet: 'Bonjour, nous sollicitons… (resynchronisé)' });
    const row = await stored(id);
    expect(row.origin).toBe('claude');
    // …while still updating everything the re-sync does know about.
    expect(String(row.snippet)).toContain('resynchronisé');
  });

  it('lets a later write place a mark on a row already stored', async () => {
    // The retrofit road: mail that left before this column existed is labelled
    // by a second POST on the same stable id, not by a migration guessing.
    const id = idFor('retrofit');
    await put(id, {});
    expect((await stored(id)).origin).toBe(null);
    await put(id, { origin: 'dashboard' });
    expect((await stored(id)).origin).toBe('dashboard');
  });

  it('folds a mis-cased word and ignores an unknown one', async () => {
    // Folded rather than refused: a marking POST that says 'Claude' would
    // otherwise fall to null, be preserved by COALESCE, and report success
    // having changed nothing — the silent no-op this column cannot afford.
    const id = idFor('vocabulary');
    await put(id, { origin: ' Claude ' });
    expect((await stored(id)).origin).toBe('claude');
    // Unknown reads as "not declared", so it keeps what is stored rather than
    // storing a word no badge knows how to draw.
    await put(id, { origin: 'facteur' });
    expect((await stored(id)).origin).toBe('claude');
  });

  it('serves the origin on the light cut too, which is what a list view asks', async () => {
    const id = idFor('summary');
    await put(id, { origin: 'dashboard' });
    const row = await stored(id, '?fields=summary');
    expect(row.origin).toBe('dashboard');
    expect('body' in row).toBe(false);
  });
});

describe('POST /v1/admin/email-messages — one message, one row, whatever id its writer computed', () => {
  const app = () => makeApp();
  const H = {
    'X-Admin-Secret': 'correct-horse-battery-staple',
    'Content-Type': 'application/json',
  };
  const TO = `twin-${RUN_TAG}@alpha.example.net`;
  const SUBJECT =
    'Permission request, reuse of the register of financial institution codes in a commercial API';

  async function post(messages: unknown[]): Promise<number> {
    const res = await app().request('/v1/admin/email-messages', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ messages }),
    });
    expect(res.status).toBe(200);
    return ((await res.json()) as { upserted: number }).upserted;
  }

  async function rowsTo(): Promise<Array<Record<string, unknown>>> {
    const res = await app().request('/v1/admin/email-messages?since=2026-09-07&fields=summary', {
      headers: H,
    });
    const j = (await res.json()) as { messages: Array<Record<string, unknown>> };
    return j.messages.filter((m) => m.customer_email === TO);
  }

  it('the sync’s folded-subject, minute-grain copy lands on the sender’s row and keeps its origin', async () => {
    // The sender records first: seconds in the date, the subject as typed.
    await post([
      {
        id: `sender-${RUN_TAG}`,
        customer_email: TO,
        direction: 'out',
        msg_date: '2026-09-07T06:32:57',
        subject: SUBJECT,
        snippet: 'Dear Sir or Madam',
        origin: 'claude',
      },
    ]);
    // Fifteen minutes later the IMAP sync posts the Sent copy: another id,
    // the minute only, and the subject as the SMTP library folded it.
    await post([
      {
        id: `sync-${RUN_TAG}`,
        customer_email: TO,
        direction: 'out',
        msg_date: '2026-09-07T06:32',
        subject:
          'Permission request, reuse of the register of financial institution\r\n codes in a commercial API',
        snippet: 'Dear Sir or Madam',
      },
    ]);
    const rows = await rowsTo();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`sender-${RUN_TAG}`);
    expect(rows[0].origin).toBe('claude');
    // Stored collapsed: the line break the fold introduced never reaches a screen.
    expect(rows[0].subject).toBe(SUBJECT);
  });

  it('a send recorded just past the minute boundary still meets its Sent copy', async () => {
    await post([
      {
        id: `late-${RUN_TAG}`,
        customer_email: TO,
        direction: 'out',
        msg_date: '2026-09-07T07:00:02',
        subject: 'Follow-up on the prevodnik',
        snippet: 'A short follow-up',
        origin: 'dashboard',
      },
    ]);
    await post([
      {
        id: `late-sync-${RUN_TAG}`,
        customer_email: TO,
        direction: 'out',
        msg_date: '2026-09-07T06:59',
        subject: 'Follow-up on the prevodnik',
        snippet: 'A short follow-up',
      },
    ]);
    const rows = (await rowsTo()).filter((m) => String(m.subject).startsWith('Follow-up'));
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(`late-${RUN_TAG}`);
    expect(rows[0].origin).toBe('dashboard');
  });

  it('two different subjects in the same minute stay two rows', async () => {
    await post([
      {
        id: `a-${RUN_TAG}`,
        customer_email: TO,
        direction: 'out',
        msg_date: '2026-09-07T08:10:05',
        subject: 'First letter',
        snippet: 'x',
      },
      {
        id: `b-${RUN_TAG}`,
        customer_email: TO,
        direction: 'out',
        msg_date: '2026-09-07T08:10:40',
        subject: 'Second letter',
        snippet: 'y',
      },
    ]);
    const rows = (await rowsTo()).filter((m) => /letter$/.test(String(m.subject)));
    expect(rows.map((m) => m.id).sort()).toEqual([`a-${RUN_TAG}`, `b-${RUN_TAG}`]);
  });
});

// ---------------------------------------------------------------------------
// Le palier anonyme et la réclamation (chantier « clé sans e-mail », lot 3)
// ---------------------------------------------------------------------------

/** Faire servir des appels à une clé, sans monter tout le middleware. */
function fakeUsage(keyHash: string, count: number): void {
  const month = new Date().toISOString().slice(0, 7);
  getStatsDB()
    .prepare(
      'INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?) ON CONFLICT(key_hash, month) DO UPDATE SET count = excluded.count',
    )
    .run(keyHash, month, count);
}

/** Une clé anonyme née par la fonction de frappe, comme la route le fait. */
function anonKey(ipHash: string) {
  const k = generateApiKey(null, undefined, undefined, false, {
    ipHash,
    userAgent: 'demo-http-client/1.0',
  });
  if (!k) throw new Error('mint anonyme impossible');
  return k;
}

describe('POST /v1/keys/generate — la branche anonyme', () => {
  // 🚨 CE BLOC EST DU TEMPS DE PAIX, ET IL FAUT LE DIRE AU DISJONCTEUR.
  //
  // Ce fichier pilote la route de création des dizaines de fois, et plusieurs de
  // ses blocs posent un `X-Forwarded-For` différent à chaque appel pour
  // exercer le plafond par réseau. Vu du disjoncteur (lot 5), c'est exactement
  // la forme d'une rafale : assez de créations dans l'heure, depuis assez de
  // réseaux distincts. Il s'arme donc en cours de fichier, et les clés nées
  // ensuite sortent au plafond réduit — ce qui fait rougir les deux assertions
  // « le chemin actuel, intact » sans qu'aucun bug n'existe.
  //
  // Patron imposé pour les trois gardes d'environnement du chantier :
  // sauvegarder, poser, restaurer DANS LE TEST. Jamais dans
  // `test/hermetic-stats.ts` ni dans un `setupFiles` — un drapeau posé
  // globalement ferait passer au VERT toute la suite en testant une branche
  // que personne n'a demandée, et rien ne le signalerait. Portée réduite à ce
  // bloc, pas au fichier, pour la même raison.
  //
  // L'armement et la dégradation se prouvent ailleurs, sur leurs propres
  // fixtures : `src/lib/creation-breaker.integration.test.ts`.
  //
  // 🚨 `beforeEach` et NON `beforeAll` : l'`afterEach` de ce fichier remplace
  // `process.env` en entier par l'instantané pris à l'import (ligne 41). Un
  // `beforeAll` serait donc effacé après le PREMIER test du bloc, et seuls les
  // suivants rougiraient — une panne qui se lit comme un bug du code.
  let breakerBefore: string | undefined;
  beforeEach(() => {
    breakerBefore = process.env.IBANFORGE_BREAKER_DISABLED;
    process.env.IBANFORGE_BREAKER_DISABLED = '1';
  });
  afterEach(() => {
    if (breakerBefore === undefined) delete process.env.IBANFORGE_BREAKER_DISABLED;
    else process.env.IBANFORGE_BREAKER_DISABLED = breakerBefore;
  });

  it('sans corps du tout : 201, palier anonyme, AUCUN champ email', async () => {
    const res = await makeApp().request('/v1/keys/generate', { method: 'POST' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.api_key).toMatch(/^ifk_/);
    expect(json.tier).toBe('anonymous');
    expect(json.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(json.claim_url).toBe(KEY_CLAIM_URL);
    // 🚨 La sentinelle est un détail de stockage : la publier apprendrait à un
    // agent à recopier le mot comme si c'était une adresse.
    expect(json).not.toHaveProperty('email');
    expect(String(json.message)).toContain('/v1/keys/claim');
    // Le plafond est ÉCRIT en base, jamais laissé NULL (un NULL se relit
    // « palier gratuit » et donnerait 200 à une clé qui existe pour avoir 25).
    const row = getStatsDB()
      .prepare('SELECT tier, monthly_limit, email, email_norm FROM api_keys WHERE key_prefix = ?')
      .get(json.key_prefix) as {
      tier: string;
      monthly_limit: number | null;
      email: string;
      email_norm: string | null;
    };
    expect(row.tier).toBe('anonymous');
    expect(row.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(row.email).toBe('anonymous');
    expect(row.email_norm).toBeNull();
  });

  it.each([
    ['{}', '{}'],
    ['le drapeau explicite', '{"anonymous":true}'],
    ['une adresse nulle', '{"email":null}'],
    ['une adresse vide', '{"email":""}'],
  ])('corps « %s » : 201 anonyme', async (_label, body) => {
    const res = await makeApp().request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { tier: string }).tier).toBe('anonymous');
  });

  it('garde la source d’acquisition sur la branche anonyme', async () => {
    const res = await makeApp().request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"source":"npm"}',
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { key_prefix: string };
    const row = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE key_prefix = ?')
      .get(json.key_prefix) as { source: string | null };
    expect(row.source).toBe('npm');
  });

  it('un corps ILLISIBLE garde son 400 et ne consomme aucune création', async () => {
    // 🚨 Le piège que ce test ferme : si le catch de JSON.parse devenait la
    // branche anonyme, un appelant qui a mal tapé son corps recevrait
    // silencieusement une clé au lieu du 400 qui lui dit quoi corriger.
    // L'en-tête content-type est indispensable — sans lui la requête n'emprunte
    // pas le même chemin de lecture.
    const before = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM key_creations').get() as { n: number }
    ).n;
    const res = await makeApp().request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{oops',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_json');
    const after = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM key_creations').get() as { n: number }
    ).n;
    expect(after).toBe(before);
  });

  it.each(['{"email":42}', '{"email":true}', '{"email":{}}', '{"email":[]}'])(
    'une adresse qui n’est pas une chaîne reste un 400 : %s',
    async (body) => {
      // 🚨 Une tentative d'adresse n'est PAS une intention anonyme, quel que
      // soit son type. Et sans le contrôle de type, `.includes('@')` sur un
      // nombre ou un booléen jette — donc un 500 sur la route publique la plus
      // chaude, là où le contrat promet un 400 qui dit quoi corriger. Le cas
      // est nommé dans la spec ; il ne se voit dans aucun test qui ne poste que
      // des chaînes.
      const res = await makeApp().request('/v1/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_email');
    },
  );

  it('une adresse MALFORMÉE reste un 400, elle ne bascule pas en anonyme', async () => {
    const res = await makeApp().request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"email":"pasuneadresse"}',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_email');
  });

  it('avec une adresse : le chemin actuel, intact', async () => {
    const res = await makeApp().request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `owner-${Date.now()}@alpha-corp.example.net` }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.tier).toBe('email');
    expect(json.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(json.email).toBeDefined();
    expect(json).not.toHaveProperty('claim_url');
  });

  it('ANONYMOUS_TIER_DISABLED=1 referme la porte, son retrait la rouvre', async () => {
    // Patron imposé : sauvegarder, poser, restaurer DANS le test. Posé
    // globalement, ce drapeau ferait passer au VERT tous les tests du palier
    // anonyme en testant la branche 400 — la panne silencieuse classique.
    const before = process.env.ANONYMOUS_TIER_DISABLED;
    try {
      process.env.ANONYMOUS_TIER_DISABLED = '1';
      const closed = await makeApp().request('/v1/keys/generate', { method: 'POST' });
      expect(closed.status).toBe(400);
      expect(((await closed.json()) as { error: string }).error).toBe('invalid_email');

      delete process.env.ANONYMOUS_TIER_DISABLED;
      const open = await makeApp().request('/v1/keys/generate', { method: 'POST' });
      expect(open.status).toBe(201);
      expect(((await open.json()) as { tier: string }).tier).toBe('anonymous');
    } finally {
      if (before === undefined) delete process.env.ANONYMOUS_TIER_DISABLED;
      else process.env.ANONYMOUS_TIER_DISABLED = before;
    }
  });
});

describe('POST /v1/keys/claim', () => {
  const claim = (app: Hono, key: string | null, body: Record<string, unknown>, ip?: string) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    if (ip) headers['X-Forwarded-For'] = ip;
    return app.request('/v1/keys/claim', { method: 'POST', headers, body: JSON.stringify(body) });
  };

  it('sans clé : 401 — et la clé dans le CORPS ne compte pas', async () => {
    const app = makeApp();
    const k = anonKey(`claim-body-${RUN_TAG}`);
    const none = await claim(app, null, { email: `a-${RUN_TAG}@alpha-corp.example.net` });
    expect(none.status).toBe(401);
    expect(((await none.json()) as { error: string }).error).toBe('missing_key');
    // 🚨 Une clé dans un corps JSON finit dans un journal de requêtes, un
    // historique de shell et un exemple de documentation.
    const inBody = await claim(app, null, {
      api_key: k.api_key,
      email: `b-${RUN_TAG}@alpha-corp.example.net`,
    });
    expect(inBody.status).toBe(401);
    expect(((await inBody.json()) as { error: string }).error).toBe('missing_key');
  });

  it('une clé inconnue : 401 invalid_key', async () => {
    const res = await claim(makeApp(), `ifk_${'0'.repeat(64)}`, {
      email: `c-${RUN_TAG}@alpha-corp.example.net`,
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_key');
  });

  it('une clé qui n’a JAMAIS servi ne se réclame pas, même avec une ligne d’usage à zéro', async () => {
    const app = makeApp();
    // (a) La moitié qui prouve quelque chose : une clé qui n'a reçu qu'un 4xx
    // remboursé PORTE une ligne api_usage, à 0. Avec un test d'existence de
    // ligne, la condition d'entrée coûtait ZÉRO unité — un seul appel
    // volontairement invalide suffisait.
    const refunded = anonKey(`claim-unused-${RUN_TAG}`);
    fakeUsage(refunded.key_hash, 0);
    const a = await claim(app, refunded.api_key, { email: `d-${RUN_TAG}@alpha-corp.example.net` });
    expect(a.status).toBe(403);
    expect(((await a.json()) as { error: string }).error).toBe('unused_key');

    // (b) Une clé qui a réellement servi passe la condition : sans relais de
    // mail configuré, la route va jusqu'au 503 fail-CLOSED, ce qui prouve
    // qu'elle a franchi la précondition.
    const served = anonKey(`claim-served-${RUN_TAG}`);
    fakeUsage(served.key_hash, 1);
    const b = await claim(app, served.api_key, { email: `e-${RUN_TAG}@alpha-corp.example.net` });
    expect(b.status).toBe(503);
    expect(((await b.json()) as { error: string }).error).toBe('verification_unavailable');
  });

  it('une clé qui n’est plus anonyme : 409 already_claimed', async () => {
    const withEmail = generateApiKey(`held-${RUN_TAG}@alpha-corp.example.net`);
    if (!withEmail) throw new Error('mint impossible');
    fakeUsage(withEmail.key_hash, 5);
    const res = await claim(makeApp(), withEmail.api_key, {
      email: `held-${RUN_TAG}@alpha-corp.example.net`,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('already_claimed');
  });

  it('rail complet : le bon code promeut la clé, et /usage le dit', async () => {
    const app = makeApp();
    const k = anonKey(`claim-ok-${RUN_TAG}`);
    fakeUsage(k.key_hash, 3);
    const email = `raise-${RUN_TAG}@alpha-corp.example.net`;
    // Le défi posé à la main, comme la suite le fait déjà ailleurs : aucun
    // relais n'est configuré en test, donc le temps 1 ne rend jamais 202. La
    // CIBLE est la clé présentée — c'est ce que la colonne key_prefix porte.
    const code = plant(createVerificationChallenge(email, 'test', k.key_prefix));

    const res = await claim(app, k.api_key, { email, code });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.claimed).toBe(true);
    expect(json.tier).toBe('claimed');
    expect(json.claim_method).toBe('email_code');
    expect(json.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    // 'monthly' : le rail de l'adresse EFFACE no_recredit. Sans cela la clé
    // vaudrait 200 à vie pendant qu'on lui annonce 200 par mois.
    expect(json.basis).toBe('monthly');
    expect(json.previous_monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(json.claimed_at).toBeTruthy();

    // La ligne de journal est écrite, exactement une, dans la transaction.
    const claims = getStatsDB()
      .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE event = 'claim' AND key_hash = ?")
      .get(k.key_hash) as { n: number };
    expect(claims.n).toBe(1);

    const usage = await app.request('/v1/keys/usage', {
      headers: { Authorization: `Bearer ${k.api_key}` },
    });
    const block = (await usage.json()) as Record<string, unknown>;
    expect(block.tier).toBe('claimed');
    expect(block.limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(block.basis).toBe('monthly');
    // Plus rien à réclamer : le bloc disparaît.
    expect(block).not.toHaveProperty('claim');
  });

  it('un MAUVAIS code : 403, la clé reste au palier anonyme et rien n’est journalisé', async () => {
    const app = makeApp();
    const k = anonKey(`claim-bad-${RUN_TAG}`);
    fakeUsage(k.key_hash, 2);
    const email = `bad-${RUN_TAG}@alpha-corp.example.net`;
    plant(createVerificationChallenge(email, 'test', k.key_prefix));
    const res = await claim(app, k.api_key, { email, code: '000000' });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('verification_failed');
    expect(getKeyTier(k.key_hash)!.tier).toBe('anonymous');
    const claims = getStatsDB()
      .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE event = 'claim' AND key_hash = ?")
      .get(k.key_hash) as { n: number };
    expect(claims.n).toBe(0);
  });

  it('un code émis pour une AUTRE clé est refusé, sans punir la victime', async () => {
    const app = makeApp();
    const target = anonKey(`claim-target-${RUN_TAG}`);
    const other = anonKey(`claim-other-${RUN_TAG}`);
    fakeUsage(other.key_hash, 1);
    const email = `target-${RUN_TAG}@alpha-corp.example.net`;
    const code = plant(createVerificationChallenge(email, 'test', target.key_prefix));
    const res = await claim(app, other.api_key, { email, code });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('verification_failed');
    expect(body.reason).toBe('wrong_target');
    // 🚨 Le compteur d'essais de la VICTIME n'a pas bougé : sinon cinq requêtes
    // de ce type bloquaient son défi en cours jusqu'à expiration.
    const row = getStatsDB()
      .prepare('SELECT attempts FROM pending_verifications WHERE email = ?')
      .get(email) as { attempts: number };
    expect(row.attempts).toBe(0);
    // Et le défi de la victime marche toujours, pour SA clé.
    fakeUsage(target.key_hash, 1);
    const good = await claim(app, target.api_key, { email, code });
    expect(good.status).toBe(200);
  });

  it('une adresse qui porte déjà une clé vivante au palier gratuit : 409, et seulement après le bon code', async () => {
    const app = makeApp();
    const email = `dup-${RUN_TAG}@alpha-corp.example.net`;
    const held = generateApiKey(email);
    if (!held) throw new Error('mint impossible');
    const k = anonKey(`claim-dup-${RUN_TAG}`);
    fakeUsage(k.key_hash, 1);
    const code = plant(createVerificationChallenge(email, 'test', k.key_prefix));
    const res = await claim(app, k.api_key, { email, code });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('already_claimed_elsewhere');
    // Le message nomme la clé à réutiliser, et ne dit JAMAIS « réclamez plutôt
    // celle-là » : celle-là est déjà au palier gratuit.
    expect(body.message).toContain(held.key_prefix);
    expect(body.message).not.toContain('claim that one');
    expect(getKeyTier(k.key_hash)!.tier).toBe('anonymous');
  });

  it('réclamer, révoquer, re-réclamer le même jour avec la même adresse : 409 ; passé 24 h : 200', async () => {
    const app = makeApp();
    const email = `loop-${RUN_TAG}@alpha-corp.example.net`;
    const first = anonKey(`claim-loop-${RUN_TAG}`);
    fakeUsage(first.key_hash, 1);
    const c1 = plant(createVerificationChallenge(email, 'test', first.key_prefix));
    expect((await claim(app, first.api_key, { email, code: c1 })).status).toBe(200);

    // La révocation est en LIBRE-SERVICE : c'est elle qui rendait la boucle
    // gratuite, puisque « cette adresse porte-t-elle une clé active » s'efface
    // dans l'instant. Le journal des réclamations, lui, survit.
    const revoked = await app.request('/v1/keys/revoke', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.api_key}` },
    });
    expect(revoked.status).toBe(200);

    const second = anonKey(`claim-loop2-${RUN_TAG}`);
    fakeUsage(second.key_hash, 1);
    const c2 = plant(createVerificationChallenge(email, 'test', second.key_prefix));
    const again = await claim(app, second.api_key, { email, code: c2 });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe('already_claimed_elsewhere');

    // Le jumeau POSITIF, et il compte autant : la règle borne le RYTHME, elle
    // n'interdit pas la suivante. Croire qu'elle ferme le débit à zéro serait
    // faux, et une session future doit pouvoir le lire ici.
    getStatsDB()
      .prepare(
        "UPDATE key_claims SET created_at = datetime('now', '-30 hours') WHERE email_norm = ?",
      )
      .run(email);
    const third = anonKey(`claim-loop3-${RUN_TAG}`);
    fakeUsage(third.key_hash, 1);
    const c3 = plant(createVerificationChallenge(email, 'test', third.key_prefix));
    expect((await claim(app, third.api_key, { email, code: c3 })).status).toBe(200);
  });

  it('une étiquette et des points ne font pas deux personnes', async () => {
    const app = makeApp();
    const base = `alias${RUN_TAG}@gmail.com`;
    const aliased = `alias.${RUN_TAG}+ci@gmail.com`;
    const first = anonKey(`claim-alias-${RUN_TAG}`);
    fakeUsage(first.key_hash, 1);
    const c1 = plant(createVerificationChallenge(base, 'test', first.key_prefix));
    expect((await claim(app, first.api_key, { email: base, code: c1 })).status).toBe(200);

    const second = anonKey(`claim-alias2-${RUN_TAG}`);
    fakeUsage(second.key_hash, 1);
    const c2 = plant(createVerificationChallenge(aliased, 'test', second.key_prefix));
    const res = await claim(app, second.api_key, { email: aliased, code: c2 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('already_claimed_elsewhere');
  });

  it('plafond par réseau : la parité avec la création, et un mauvais code ne le consomme pas', async () => {
    const app = makeApp();
    const ip = `198.53.${(Date.now() % 240) + 1}.${(Math.floor(Date.now() / 240) % 240) + 1}`;
    for (let i = 0; i < CLAIM_SUCCESS_PER_SOURCE_DAY; i++) {
      const k = anonKey(`claim-cap-${RUN_TAG}-${i}`);
      fakeUsage(k.key_hash, 1);
      const email = `cap${i}-${RUN_TAG}@alpha-corp.example.net`;
      const code = plant(createVerificationChallenge(email, 'test', k.key_prefix));
      expect((await claim(app, k.api_key, { email, code }, ip)).status).toBe(200);
    }
    const over = anonKey(`claim-cap-${RUN_TAG}-over`);
    fakeUsage(over.key_hash, 1);
    const email = `capover-${RUN_TAG}@alpha-corp.example.net`;
    const code = plant(createVerificationChallenge(email, 'test', over.key_prefix));
    const res = await claim(app, over.api_key, { email, code }, ip);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('claim_rate_limited');
    // La phrase NOMME la parité plutôt qu'un chiffre isolé : c'est ce qui
    // empêche une session future de relever l'un des deux sans l'autre.
    expect(body.message).toContain('/v1/keys/generate');
    expect(getKeyTier(over.key_hash)!.tier).toBe('anonymous');

    // Le plafond compte des SUCCÈS : un code faux ne le consomme pas, sinon un
    // tiers derrière le même NAT épuiserait le budget d'un bureau entier.
    const budgetBefore = (
      getStatsDB()
        .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE event = 'claim' AND ip_hash = ?")
        .get(keyCreationSource(ip)) as { n: number }
    ).n;
    const k = anonKey(`claim-cap-${RUN_TAG}-wrong`);
    fakeUsage(k.key_hash, 1);
    const e2 = `capwrong-${RUN_TAG}@alpha-corp.example.net`;
    plant(createVerificationChallenge(e2, 'test', k.key_prefix));
    await claim(app, k.api_key, { email: e2, code: '000000' }, ip);
    const budgetAfter = (
      getStatsDB()
        .prepare("SELECT COUNT(*) AS n FROM key_claims WHERE event = 'claim' AND ip_hash = ?")
        .get(keyCreationSource(ip)) as { n: number }
    ).n;
    expect(budgetAfter).toBe(budgetBefore);
  });

  it('un corps illisible garde son 400 sur la réclamation aussi', async () => {
    const k = anonKey(`claim-json-${RUN_TAG}`);
    const res = await makeApp().request('/v1/keys/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.api_key}` },
      body: '{oops',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_json');
  });
});

describe('le palier se lit et survit', () => {
  it('GET /v1/keys/usage porte le palier, l’assiette et le chemin de sortie', async () => {
    const app = makeApp();
    const k = anonKey(`usage-anon-${RUN_TAG}`);
    fakeUsage(k.key_hash, 7);
    const res = await app.request('/v1/keys/usage', {
      headers: { Authorization: `Bearer ${k.api_key}` },
    });
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.tier).toBe('anonymous');
    expect(json.limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    // 🚨 Une clé anonyme ORDINAIRE est MENSUELLE : 25 par mois. Seules une clé
    // née sous limite protectrice et une clé promue par paiement sont « à vie ».
    expect(json.basis).toBe('monthly');
    expect(json.used).toBe(7);
    const claimBlock = json.claim as Record<string, unknown>;
    expect(claimBlock.url).toBe(KEY_CLAIM_URL);
    expect(claimBlock.raises_limit_to).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(claimBlock.paid_so_far_usd).toBe(0);
    expect(claimBlock.paid_needed_usd).toBe(CLAIM_MIN_PAID_USD);
    expect(claimBlock.methods).toEqual(['email_code', 'x402', 'credits']);
  });

  it('une clé hors du reset mensuel s’annonce « à vie », sur la même assiette que son plafond', async () => {
    const app = makeApp();
    const k = anonKey(`usage-life-${RUN_TAG}`);
    // Ce que pose une promotion payante, et ce que posera le bouclier.
    getStatsDB().prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_hash = ?').run(k.key_hash);
    fakeUsage(k.key_hash, 4);
    const json = (await (
      await app.request('/v1/keys/usage', { headers: { Authorization: `Bearer ${k.api_key}` } })
    ).json()) as Record<string, unknown>;
    expect(json.basis).toBe('lifetime');
    expect(String(json.note)).toContain('whole life');
  });

  it('POST /v1/keys/rotate ne perd pas le palier', async () => {
    const app = makeApp();
    const k = anonKey(`rotate-anon-${RUN_TAG}`);
    const res = await app.request('/v1/keys/rotate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${k.api_key}` },
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.tier).toBe('anonymous');
    expect(json.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(json.basis).toBe('monthly');
    const rotated = getStatsDB()
      .prepare('SELECT tier, monthly_limit FROM api_keys WHERE key_prefix = ?')
      .get(json.key_prefix) as { tier: string; monthly_limit: number };
    expect(rotated.tier).toBe('anonymous');
    expect(rotated.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
  });

  it('GET /v1/admin/keys expose tier, claimed_at et claim_method', async () => {
    const app = makeApp();
    anonKey(`admin-tier-${RUN_TAG}`);
    const res = await app.request('/v1/admin/keys', {
      headers: { 'X-Admin-Secret': 'correct-horse-battery-staple' },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { keys: Array<Record<string, unknown>> };
    const anon = json.keys.find((k) => k.tier === 'anonymous');
    expect(anon, 'la route doit servir le palier, le CRM et le radar le lisent').toBeDefined();
    expect(anon!).toHaveProperty('claimed_at');
    expect(anon!).toHaveProperty('claim_method');
  });

  it('une création avec code vérifié porte la preuve de sa boîte dès la naissance', async () => {
    // 🚨 L'autre moitié de la garde du bouclier : la PREMIÈRE clé d'un réseau
    // neuf n'exige aucun code et naît au palier gratuit sans être dégradée,
    // donc un prédicat par palier laisserait passer une ferme montée sur des
    // réseaux sans historique. C'est claimed_at qui porte la preuve.
    delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
    const app = makeApp();
    const ts = Date.now();
    const ip = `198.55.${(ts % 240) + 1}.${(Math.floor(ts / 240) % 240) + 1}`;
    const gen = (email: string, code?: string) =>
      app.request('/v1/keys/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
        body: JSON.stringify(code ? { email, code } : { email }),
      });
    const firstEmail = `proof-a-${ts}@alpha-corp.example.net`;
    const first = await gen(firstEmail);
    expect(first.status).toBe(201);
    const firstPrefix = ((await first.json()) as { key_prefix: string }).key_prefix;
    // Sans code : aucune preuve, quel que soit le palier.
    const firstRow = getStatsDB()
      .prepare('SELECT tier, claimed_at FROM api_keys WHERE key_prefix = ?')
      .get(firstPrefix) as { tier: string; claimed_at: string | null };
    expect(firstRow.tier).toBe('email');
    expect(firstRow.claimed_at).toBeNull();

    const secondEmail = `proof-b-${ts}@alpha-corp.example.net`;
    const code = plant(createVerificationChallenge(secondEmail, 'test'));
    const second = await gen(secondEmail, code);
    expect(second.status).toBe(201);
    const secondPrefix = ((await second.json()) as { key_prefix: string }).key_prefix;
    const secondRow = getStatsDB()
      .prepare('SELECT tier, claimed_at, claim_method FROM api_keys WHERE key_prefix = ?')
      .get(secondPrefix) as {
      tier: string;
      claimed_at: string | null;
      claim_method: string | null;
    };
    // Le palier reste 'email' : cette clé n'a jamais été anonyme, rien n'a été
    // « réclamé ». Seule la preuve change.
    expect(secondRow.tier).toBe('email');
    expect(secondRow.claimed_at).not.toBeNull();
    expect(secondRow.claim_method).toBe('email_code');
  });
});

describe('POST /v1/keys/claim — lot 6b : une clé coupée pour rafale se rend par la réclamation', () => {
  const claim = (app: Hono, key: string, body: Record<string, unknown>) =>
    app.request('/v1/keys/claim', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const burst = (k: { key_hash: string; key_prefix: string }) => ({
    keyHash: k.key_hash,
    keyPrefix: k.key_prefix,
    originPrefix: null,
    episodeId: 'ep-repair',
    anchor: 'ua:demo-http-client/1.0',
    anchorShare: 1,
    anchorKeys: 16,
    burstFrom: '2026-09-15 10:00:00',
    burstTo: '2026-09-15 10:00:30',
    burstKeys: 16,
    windowMinutes: 0.5,
    distinctSources: 5,
  });

  it('reconnue au temps 1, rendue ET promue au temps 2, dans la même transaction', async () => {
    const app = makeApp();
    const db = getStatsDB();
    const k = anonKey(`repair-${RUN_TAG}`);
    fakeUsage(k.key_hash, 2);
    expect(revokeBurstBatch([burst(k)]).revoked).toBe(1);
    expect(validateApiKey(k.api_key).valid, 'coupée : le middleware la refuse').toBe(false);

    const email = `repair-${RUN_TAG}@alpha.example.net`;
    // Temps 1 : la clé coupée est RECONNUE — pas de 401. Sans relais en test le
    // temps 1 ne rend jamais 202 ; ce qui compte ici est que la route ne la
    // traite pas comme une clé inconnue.
    const step1 = await claim(app, k.api_key, { email });
    expect(step1.status).not.toBe(401);

    // Temps 2 : le code planté, ciblé sur cette clé, la rend et la promeut.
    const code = plant(createVerificationChallenge(email, 'test', k.key_prefix));
    const res = await claim(app, k.api_key, { email, code });
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.claimed).toBe(true);
    expect(json.restored).toBe(true);
    expect(json.tier).toBe('claimed');
    expect(json.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(String(json.message)).toContain('active again');

    expect(validateApiKey(k.api_key).valid, 'rendue : le middleware l’accepte de nouveau').toBe(
      true,
    );
    expect(burstRevocationFor(k.key_hash), 'plus de motif « coupée » à servir').toBeNull();
    const row = db
      .prepare(
        'SELECT active, deactivated_at, tier, monthly_limit, no_recredit FROM api_keys WHERE key_hash = ?',
      )
      .get(k.key_hash);
    expect(row).toEqual({
      active: 1,
      deactivated_at: null,
      tier: 'claimed',
      monthly_limit: FREE_TIER_MONTHLY_LIMIT,
      no_recredit: 0,
    });
    const journal = db
      .prepare('SELECT restored_at FROM key_revocations WHERE key_hash = ?')
      .get(k.key_hash) as { restored_at: string | null };
    expect(journal.restored_at).toBeTruthy();
  });

  it('une clé révoquée par son PORTEUR reste refusée : le journal anon_burst est la seule porte', async () => {
    const app = makeApp();
    const k = anonKey(`repair-owner-${RUN_TAG}`);
    fakeUsage(k.key_hash, 1);
    getStatsDB()
      .prepare(
        "UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE key_hash = ?",
      )
      .run(k.key_hash);
    const res = await claim(app, k.api_key, { email: `owner-${RUN_TAG}@alpha.example.net` });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_key');
  });

  it('une clé coupée qui n’a jamais servi est quand même réclamable : le radar coupe sur la naissance, pas sur l’usage', async () => {
    const app = makeApp();
    const k = anonKey(`repair-unused-${RUN_TAG}`);
    expect(revokeBurstBatch([burst(k)]).revoked).toBe(1);
    // Sans relais en test, le temps 1 rend 503 ; ce qui compte est qu'il n'y a
    // ni 401 (clé inconnue) ni 403 unused_key (la boucle du constat 3).
    const res = await claim(app, k.api_key, { email: `unused-${RUN_TAG}@alpha.example.net` });
    expect([202, 503]).toContain(res.status);
  });
});
