/**
 * La vue d'ensemble du compte client, `GET /v1/account/overview` (lot C1,
 * relecture de sécurité, points 10 et 13) : quelles clés elle montre, ce
 * qu'elle en dit, ce qu'elle tait, et ce qu'elle coûte à la base.
 *
 * Les sessions sont créées directement (`createSession`) : le parcours par code
 * a ses propres tests, et celui-ci porte sur ce que voit une session ouverte.
 * Fixtures inventées (dépôt public) : alpha.example.net.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';
import {
  OEM_MONTHLY_LIMIT,
  PRO_MONTHLY_LIMIT,
  decrementCredits,
  generateApiKey,
  generateCreditKey,
  generateOemKey,
  recordMonthlyObservation,
  revokeApiKey,
  validateApiKey,
} from '../lib/api-keys.js';
import { ACCOUNT_COOKIE, OVERVIEW_PAGE_SIZE, createSession } from '../lib/account.js';
import { normalizeEmail } from '../lib/email-norm.js';
import { PRO_PORTAL_URL } from '../lib/payment-links.js';

const ENV = { ...process.env };

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

function cookieFor(email: string): string {
  const { token } = createSession(normalizeEmail(email) as string, email);
  return `${ACCOUNT_COOKIE}=${token}`;
}

async function overviewOf(
  email: string,
  page?: number,
): Promise<{ res: Response; body: Record<string, unknown> & { keys: KeyView[] } }> {
  const res = await makeApp().request(`/v1/account/overview${page ? `?page=${page}` : ''}`, {
    headers: { Cookie: cookieFor(email) },
  });
  return { res, body: (await res.json()) as Record<string, unknown> & { keys: KeyView[] } };
}

interface KeyView {
  key_prefix: string;
  plan: string;
  allowance: { basis: string; limit: number; used: number; remaining: number } | null;
  credits: { remaining: number; purchased_total: number } | null;
  subscription: { plan: string; status: string; manage_url: string } | null;
  calls_this_month: number;
  last_call_at: string | null;
  alerts: Array<{ kind: string; sent_at: string | null }>;
  actions: Record<string, string | null>;
  created_at: string | null;
}

const MONTH = () => new Date().toISOString().slice(0, 7);

function keyHashOf(rawKey: string): string {
  return validateApiKey(rawKey).keyHash;
}

function setUsage(keyHash: string, month: string, count: number): void {
  getStatsDB()
    .prepare(
      `INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)
         ON CONFLICT(key_hash, month) DO UPDATE SET count = excluded.count`,
    )
    .run(keyHash, month, count);
}

function logCall(keyPrefix: string, at: string, ipHash: string | null = null): void {
  getStatsDB()
    .prepare(
      `INSERT INTO request_log (method, path, status, response_ms, created_at, key_prefix, ip_hash)
         VALUES ('POST', '/v1/iban/validate', 200, 2, ?, ?, ?)`,
    )
    .run(at, keyPrefix, ipHash);
}

beforeEach(() => {
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
});

afterEach(() => {
  process.env = { ...ENV };
  vi.restoreAllMocks();
});

describe('GET /v1/account/overview', () => {
  it('sans session : 401 signed_out, et rien ne se met en cache', async () => {
    const app = makeApp();
    const none = await app.request('/v1/account/overview');
    expect(none.status).toBe(401);
    expect(((await none.json()) as { error: string }).error).toBe('signed_out');
    expect(none.headers.get('cache-control')).toBe('no-store');

    // Un cookie qui ne mène à aucune session est effacé chez le navigateur.
    const bogus = await app.request('/v1/account/overview', {
      headers: { Cookie: `${ACCOUNT_COOKIE}=ifs_${'0'.repeat(64)}` },
    });
    expect(bogus.status).toBe(401);
    expect(bogus.headers.get('set-cookie')).toMatch(new RegExp(`${ACCOUNT_COOKIE}=;.*Max-Age=0`));
  });

  it('seulement les clés actives de l’adresse normalisée', async () => {
    const mine = generateApiKey('acme.ops@alpha.example.net');
    const tagged = generateCreditKey('acme.ops+ci@alpha.example.net', 1000);
    const upper = generateCreditKey('Acme.Ops@Alpha.Example.NET', 1000);
    const revoked = generateCreditKey('acme.ops@alpha.example.net', 1000);
    revokeApiKey(revoked.api_key);
    const other = generateCreditKey('other@alpha.example.net', 1000);
    const anonymous = generateApiKey(null);
    if (!mine || !anonymous) throw new Error('frappe impossible');

    const { res, body } = await overviewOf('acme.ops@alpha.example.net');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(body.email).toBe('acme.ops@alpha.example.net');
    const prefixes = body.keys.map((k) => k.key_prefix).sort();
    expect(prefixes).toEqual([mine.key_prefix, tagged.key_prefix, upper.key_prefix].sort());
    expect(prefixes).not.toContain(revoked.key_prefix);
    expect(prefixes).not.toContain(other.key_prefix);
    expect(prefixes).not.toContain(anonymous.key_prefix);
    // La clé révoquée n'est qu'un nombre, sans détail.
    expect(body.inactive_keys).toBe(1);
  });

  it('jamais une clé regroupée en @cohorte.invalid', async () => {
    const email = 'ferme@alpha.example.net';
    const live = generateCreditKey(email, 1000);
    const dead = generateCreditKey(email, 1000);
    revokeApiKey(dead.api_key);
    // Le regroupement réécrit `email` et laisse `email_norm` : c'est le cas piégé.
    getStatsDB()
      .prepare(
        "UPDATE api_keys SET email = 'client-2026-09-24@cohorte.invalid' WHERE key_prefix IN (?, ?)",
      )
      .run(live.key_prefix, dead.key_prefix);
    const { res, body } = await overviewOf(email);
    expect(res.status).toBe(200);
    expect(body.keys).toEqual([]);
    expect(body.inactive_keys).toBe(0);
  });

  it('jamais la clé brute, son empreinte ni sa lignée', async () => {
    const email = 'minimal@alpha.example.net';
    const k = generateApiKey(email);
    if (!k) throw new Error('frappe impossible');
    getStatsDB()
      .prepare(
        "UPDATE api_keys SET shield_episode = 'episode-secret', issued_by_us = 1 WHERE key_hash = ?",
      )
      .run(k.key_hash);
    logCall(k.key_prefix, '2026-09-20 10:00:00', 'iphash-secret-0001');

    const { body } = await overviewOf(email);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(k.api_key);
    expect(raw).not.toContain(k.key_hash);
    const lineage = (
      getStatsDB()
        .prepare('SELECT lineage_hash FROM api_keys WHERE key_hash = ?')
        .get(k.key_hash) as {
        lineage_hash: string;
      }
    ).lineage_hash;
    expect(lineage).toBeTruthy();
    expect(raw).not.toContain(lineage);
    for (const secret of [
      'iphash-secret-0001',
      'episode-secret',
      'ip_hash',
      'key_hash',
      'lineage',
      'no_recredit',
      'shield',
      'issued_by_us',
      'tier',
    ]) {
      expect(raw, secret).not.toContain(secret);
    }
    // Une liste FERMÉE de champs : un champ neuf doit être ajouté ici exprès.
    expect(Object.keys(body.keys[0]).sort()).toEqual(
      [
        'actions',
        'alerts',
        'allowance',
        'calls_this_month',
        'created_at',
        'credits',
        'key_prefix',
        'last_call_at',
        'plan',
        'subscription',
      ].sort(),
    );
    expect(Object.keys(body).sort()).toEqual(
      ['email', 'inactive_keys', 'keys', 'month', 'page', 'pages', 'session_expires_at'].sort(),
    );
  });

  it('mêmes chiffres que /v1/keys/usage pour la même clé', async () => {
    const app = makeApp();
    const email = 'chiffres@alpha.example.net';
    const free = generateApiKey(email);
    const pro = generateOemKey(email, PRO_MONTHLY_LIMIT, 'cs_test_chiffres', 'sub_test_chiffres');
    if (!free || !pro.api_key) throw new Error('frappe impossible');
    setUsage(free.key_hash, MONTH(), 37);
    setUsage(keyHashOf(pro.api_key), MONTH(), 1234);

    // Une clé mesurée sur sa vie entière (no_recredit) : la base de calcul la
    // plus facile à trahir, puisque le mois courant n'est pas son assiette.
    const lifetimeEmail = 'vie@alpha.example.net';
    const lifetime = generateApiKey(lifetimeEmail);
    if (!lifetime) throw new Error('frappe impossible');
    getStatsDB()
      .prepare('UPDATE api_keys SET no_recredit = 1 WHERE key_hash = ?')
      .run(lifetime.key_hash);
    setUsage(lifetime.key_hash, '2026-01', 150);
    setUsage(lifetime.key_hash, MONTH(), 20);

    const pick = (b: Record<string, unknown>) => ({
      basis: b.basis,
      limit: b.limit,
      used: b.used,
      remaining: b.remaining,
    });
    const cases: Array<[string, string, string]> = [
      [email, free.api_key, free.key_prefix],
      [email, pro.api_key, pro.key_prefix],
      [lifetimeEmail, lifetime.api_key, lifetime.key_prefix],
    ];
    for (const [owner, rawKey, prefix] of cases) {
      const usage = (await (
        await app.request('/v1/keys/usage', { headers: { Authorization: `Bearer ${rawKey}` } })
      ).json()) as Record<string, unknown>;
      const { body } = await overviewOf(owner);
      const view = body.keys.find((k) => k.key_prefix === prefix);
      expect(view, prefix).toBeDefined();
      expect(view!.allowance, prefix).toEqual(pick(usage));
    }
    // Et le cas qui vérifie qu'on ne compare pas deux zéros.
    const { body } = await overviewOf(lifetimeEmail);
    expect(body.keys[0].allowance).toEqual({
      basis: 'lifetime',
      limit: 200,
      used: 170,
      remaining: 30,
    });
    expect(body.keys[0].calls_this_month).toBe(20);
  });

  it('pack : solde et cumul', async () => {
    const email = 'pack@alpha.example.net';
    const pack = generateCreditKey(email, 1000);
    const hash = keyHashOf(pack.api_key);
    expect(decrementCredits(hash, 45).ok).toBe(true);
    recordMonthlyObservation(hash, 45);

    const { body } = await overviewOf(email);
    expect(body.keys).toHaveLength(1);
    const view = body.keys[0];
    expect(view.plan).toBe('pack');
    expect(view.credits).toEqual({ remaining: 955, purchased_total: 1000 });
    // Un pack n'a pas d'allocation mensuelle : aucun plafond fictif à lire.
    expect(view.allowance).toBeNull();
    expect(view.calls_this_month).toBe(45);
    expect(view.subscription).toBeNull();
    expect(view.actions).toEqual({ topup: null, subscribe_pro: null, manage_subscription: null });
  });

  it('abonné : lien du portail', async () => {
    const email = 'abonne@alpha.example.net';
    // La clé gratuite d'abord : `generateApiKey` refuse une adresse qui a reçu
    // une clé, quelle qu'elle soit, dans la journée.
    const free = generateApiKey(email);
    if (!free) throw new Error('frappe impossible');
    const pro = generateOemKey(email, PRO_MONTHLY_LIMIT, 'cs_test_pro', 'sub_test_pro');
    const editor = generateOemKey(email, OEM_MONTHLY_LIMIT, 'cs_test_editor', 'sub_test_editor');

    const { body } = await overviewOf(email);
    const byPrefix = new Map(body.keys.map((k) => [k.key_prefix, k]));
    const proView = byPrefix.get(pro.key_prefix)!;
    expect(proView.plan).toBe('pro');
    expect(proView.subscription).toEqual({
      plan: 'pro',
      status: 'active',
      manage_url: PRO_PORTAL_URL,
    });
    expect(proView.actions.manage_subscription).toBe(PRO_PORTAL_URL);
    // « Recharger » attend le lot B1, « passer en Pro » le lot B2.
    expect(proView.actions.topup).toBeNull();
    expect(proView.actions.subscribe_pro).toBeNull();
    expect(byPrefix.get(editor.key_prefix)!.plan).toBe('editor');
    expect(byPrefix.get(editor.key_prefix)!.subscription?.plan).toBe('editor');
    const freeView = byPrefix.get(free.key_prefix)!;
    expect(freeView.plan).toBe('free');
    expect(freeView.subscription).toBeNull();
    expect(freeView.actions.manage_subscription).toBeNull();
  });

  it('dernier appel et alertes reçues', async () => {
    const email = 'appels@alpha.example.net';
    const older = generateApiKey(email);
    const newer = generateCreditKey(email, 1000);
    const never = generateCreditKey(email, 1000);
    if (!older) throw new Error('frappe impossible');
    // Écrites dans l'ordre du temps, comme le journal les écrit.
    logCall(older.key_prefix, '2026-09-20 10:00:00');
    logCall(older.key_prefix, '2026-09-22 09:00:00');
    logCall(newer.key_prefix, '2026-09-23 19:40:02');
    const notice = getStatsDB().prepare(
      'INSERT INTO quota_notices (key_hash, month, sent_at) VALUES (?, ?, ?)',
    );
    notice.run(older.key_hash, '2026-09', '2026-09-20 10:00:00');
    notice.run(keyHashOf(newer.api_key), 'credits-1000', '2026-09-21 08:00:00');
    notice.run(keyHashOf(newer.api_key), 'forme-inconnue', '2026-09-21 09:00:00');

    const { body } = await overviewOf(email);
    // Le dernier appel d'abord, puis les clés jamais appelées.
    expect(body.keys.map((k) => k.key_prefix)).toEqual([
      newer.key_prefix,
      older.key_prefix,
      never.key_prefix,
    ]);
    expect(body.keys[0].last_call_at).toBe('2026-09-23T19:40:02Z');
    expect(body.keys[1].last_call_at).toBe('2026-09-22T09:00:00Z');
    expect(body.keys[2].last_call_at).toBeNull();
    expect(body.keys[1].alerts).toEqual([{ kind: 'quota_80', sent_at: '2026-09-20T10:00:00Z' }]);
    expect(body.keys[0].alerts).toEqual([{ kind: 'credits_low', sent_at: '2026-09-21T08:00:00Z' }]);
    expect(body.keys[2].alerts).toEqual([]);
  });

  it('aucune clé : 200 avec une liste vide', async () => {
    const { res, body } = await overviewOf('personne@alpha.example.net');
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      email: 'personne@alpha.example.net',
      keys: [],
      inactive_keys: 0,
      page: 1,
      pages: 1,
      month: MONTH(),
    });
    expect(typeof body.session_expires_at).toBe('string');
  });

  it('au-delà de 50 clés, la vue est paginée et ne lit request_log qu’une fois par page', async () => {
    const email = 'editeur@alpha.example.net';
    const keys = Array.from({ length: OVERVIEW_PAGE_SIZE + 1 }, () =>
      generateCreditKey(email, 100),
    );
    // La PREMIÈRE clé née a le dernier appel : elle doit ouvrir la page 1, ce qui
    // prouve que le tri porte sur toutes les clés et pas sur une page.
    logCall(keys[5].key_prefix, '2026-09-10 08:00:00');
    logCall(keys[0].key_prefix, '2026-09-23 08:00:00');

    const db = getStatsDB();
    const pages: KeyView[][] = [];
    for (const page of [1, 2, 3]) {
      const spy = vi.spyOn(db, 'prepare');
      const { res, body } = await overviewOf(email, page);
      const statements = spy.mock.calls.map((call) => String(call[0]));
      spy.mockRestore();
      expect(res.status).toBe(200);
      expect(body.page).toBe(page);
      expect(body.pages).toBe(2);
      const readsOfLog = statements.filter((s) => s.includes('request_log'));
      // Une requête qui nomme le journal par page, pleine ou vide, jamais une par clé.
      expect(readsOfLog.length, `page ${page}`).toBe(1);
      pages.push(body.keys);
    }
    expect(pages[0]).toHaveLength(OVERVIEW_PAGE_SIZE);
    expect(pages[1]).toHaveLength(1);
    expect(pages[2]).toHaveLength(0);
    expect(pages[0][0].key_prefix).toBe(keys[0].key_prefix);
    expect(pages[0][1].key_prefix).toBe(keys[5].key_prefix);
    const all = [...pages[0], ...pages[1]].map((k) => k.key_prefix);
    expect(new Set(all).size).toBe(OVERVIEW_PAGE_SIZE + 1);
    expect(new Set(all)).toEqual(new Set(keys.map((k) => k.key_prefix)));
  });

  it('la requête des clés descend les index, sans parcourir api_keys ni request_log', async () => {
    // Le plan de la requête RÉELLEMENT préparée par la route, relu sur une base
    // sans statistiques ANALYZE, comme celle du service. Sans le `+` de
    // `+active = 1`, SQLite y choisissait l'index des clés actives, donc toute
    // la table à chaque ouverture de la page.
    const email = 'plan@alpha.example.net';
    generateCreditKey(email, 100);
    const db = getStatsDB();
    const spy = vi.spyOn(db, 'prepare');
    const { res } = await overviewOf(email);
    const sql = spy.mock.calls
      .map((call) => String(call[0]))
      .find((s) => s.includes('request_log'));
    spy.mockRestore();
    expect(res.status).toBe(200);
    expect(sql).toBeDefined();
    const plan = (
      db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(email, OVERVIEW_PAGE_SIZE, 0) as Array<{
        detail: string;
      }>
    ).map((row) => row.detail);
    expect(plan.join('\n')).toMatch(/SEARCH api_keys USING INDEX idx_api_keys_email_norm/);
    expect(plan.join('\n')).toMatch(/SEARCH r USING INDEX idx_request_log_key_prefix/);
    expect(plan.filter((detail) => /\bSCAN\b/.test(detail))).toEqual([]);
  });
});
