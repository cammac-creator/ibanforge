/**
 * Les reçus du compte client (28.09.2026) : `GET /v1/account/receipts` (quels
 * achats une adresse voit) et `GET /v1/account/receipt?ref=rcpt_…` (le lien du
 * reçu Stripe d'un de ces achats, demandé au clic).
 *
 * Les achats sont écrits directement dans `key_purchases`, dans la forme que
 * leurs écrivains leur donnent (une ligne carte du webhook porte l'adresse de
 * Checkout ; une ligne rattrapée n'en porte pas) : le webhook a ses propres
 * tests, et celui-ci porte sur ce que voit une session ouverte. L'appel à
 * Stripe est remplacé (`setReceiptUrlFetcherForTests`). Les cas I1, M1, M2 et
 * M3 sont ceux de la relecture de sécurité du 28.09.2026.
 * Fixtures inventées (dépôt public) : alpha.example.net, beta.example.net.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { generateCreditKey, rotateApiKey } from '../lib/api-keys.js';
import { ACCOUNT_COOKIE, createSession, receiptRefOf } from '../lib/account.js';
import {
  RECEIPT_FAILURE_CACHE_MS,
  RECEIPT_LINK_CACHE_MS,
  setReceiptUrlFetcherForTests,
  type AccountReceipt,
} from '../lib/account-receipts.js';
import { normalizeEmail } from '../lib/email-norm.js';
import { PRO_PORTAL_URL } from '../lib/payment-links.js';

const RECEIPT_URL = 'https://pay.stripe.com/receipts/payment/CAcaFwoVYWxwaGEtcmVjZWlwdA';
const FORGET_SCRIPT = resolve(__dirname, '../../scripts/forget-customer.cjs');

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

function cookieFor(email: string): string {
  const { token } = createSession(normalizeEmail(email) as string, email);
  return `${ACCOUNT_COOKIE}=${token}`;
}

let seq = 0;

interface Key {
  rawKey: string;
  keyHash: string;
  keyPrefix: string;
  lineage: string;
  email: string;
}

/**
 * Une clé neuve à cette adresse. Une clé à crédits, parce qu'une adresse
 * n'obtient qu'une clé gratuite par jour.
 */
function keyAt(email: string): Key {
  const k = generateCreditKey(email, 1000);
  return withLineage(k.api_key, k.key_hash, k.key_prefix, email);
}

function withLineage(rawKey: string, keyHash: string, keyPrefix: string, email: string): Key {
  const row = getStatsDB()
    .prepare('SELECT COALESCE(lineage_hash, key_hash) AS lineage FROM api_keys WHERE key_hash = ?')
    .get(keyHash) as { lineage: string };
  return { rawKey, keyHash, keyPrefix, lineage: row.lineage, email };
}

interface PurchaseInput {
  key: Key;
  rail?: 'card' | 'usdc';
  kind?: 'pack' | 'subscription';
  outcome?: string;
  /** Par défaut : l'adresse de la clé pour la carte (Checkout la recueille), aucune pour l'USDC. */
  payerEmail?: string | null;
  backfilled?: 0 | 1;
  session?: string | null;
  amountMinor?: number | null;
  currency?: string | null;
  credits?: number | null;
  bundle?: string | null;
  issuedByUs?: 0 | 1;
  settledAt?: string | null;
}

/** Écrit une ligne d'achat et rend sa référence de paiement et sa référence servie. */
function purchase(p: PurchaseInput): { paymentRef: string; ref: string } {
  seq += 1;
  const rail = p.rail ?? 'card';
  const card = rail === 'card';
  const session = p.session === undefined ? (card ? `cs_test_alpha_${seq}` : null) : p.session;
  const paymentRef = card ? `stripe:${session ?? `none-${seq}`}` : `x402:alpha-${seq}`;
  const payer =
    p.payerEmail !== undefined ? p.payerEmail : card && !p.backfilled ? p.key.email : null;
  getStatsDB()
    .prepare(
      `INSERT INTO key_purchases
         (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix, bundle, credits,
          amount_minor, currency, stripe_session_id, payer_email, issued_by_us, backfilled,
          created_at, settled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      paymentRef,
      rail,
      p.kind ?? 'pack',
      p.outcome ?? 'minted',
      p.key.lineage,
      p.key.keyHash,
      p.key.keyPrefix,
      p.bundle === undefined ? (p.kind === 'subscription' ? 'pro' : '1k') : p.bundle,
      p.credits === undefined ? 1000 : p.credits,
      p.amountMinor === undefined ? (card ? 400 : null) : p.amountMinor,
      p.currency === undefined ? (card ? 'usd' : null) : p.currency,
      session,
      payer,
      p.issuedByUs ?? 0,
      p.backfilled ?? 0,
      `2026-09-2${seq % 7} 10:00:00`,
      p.settledAt === undefined ? null : p.settledAt,
    );
  return { paymentRef, ref: receiptRefOf(paymentRef) };
}

async function receiptsOf(email: string): Promise<{ res: Response; list: AccountReceipt[] }> {
  const res = await makeApp().request('/v1/account/receipts', {
    headers: { Cookie: cookieFor(email) },
  });
  const body = (await res.json()) as { receipts?: AccountReceipt[] };
  return { res, list: body.receipts ?? [] };
}

const refsOf = async (email: string): Promise<string[]> =>
  (await receiptsOf(email)).list.map((r) => r.ref).sort();

async function openReceipt(
  email: string,
  ref: string,
): Promise<{ res: Response; body: Record<string, unknown> }> {
  const res = await makeApp().request(`/v1/account/receipt?ref=${encodeURIComponent(ref)}`, {
    headers: { Cookie: cookieFor(email) },
  });
  return { res, body: (await res.json()) as Record<string, unknown> };
}

afterEach(() => {
  setReceiptUrlFetcherForTests(null);
  vi.restoreAllMocks();
});

describe('GET /v1/account/receipts', () => {
  it('sans session : 401 signed_out, sur les deux routes, et rien en cache', async () => {
    const app = makeApp();
    for (const path of ['/v1/account/receipts', `/v1/account/receipt?ref=rcpt_${'0'.repeat(24)}`]) {
      const res = await app.request(path);
      expect(res.status, path).toBe(401);
      expect(((await res.json()) as { error: string }).error, path).toBe('signed_out');
      expect(res.headers.get('cache-control'), path).toBe('no-store');
    }
  });

  it('un achat par carte appartient au payeur, adresse normalisée, et à lui seul', async () => {
    const owner = 'rcpt.owner@alpha.example.net';
    const payer = 'rcpt.payer@beta.example.net';
    const key = keyAt(owner);
    // Un tiers recharge la clé : le reçu est à lui, pas au propriétaire de la clé.
    const byThirdParty = purchase({ key, payerEmail: 'Rcpt.Payer+billing@Beta.example.net' });
    const byOwner = purchase({ key });

    expect(await refsOf(owner)).toEqual([byOwner.ref]);
    expect(await refsOf(payer)).toEqual([byThirdParty.ref]);
  });

  it("une ligne rattrapée sans payeur appartient à l'adresse de sa clé, même désactivée", async () => {
    const email = 'rcpt.backfill@alpha.example.net';
    const live = keyAt(email);
    const dead = keyAt(email);
    getStatsDB().prepare('UPDATE api_keys SET active = 0 WHERE key_hash = ?').run(dead.keyHash);
    const a = purchase({ key: live, backfilled: 1 });
    const b = purchase({ key: dead, backfilled: 1 });

    const { res, list } = await receiptsOf(email);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(list.map((r) => r.ref).sort()).toEqual([a.ref, b.ref].sort());
  });

  it("I1 : une ligne carte NON rattrapée sans payeur n'est à personne (payeur effacé)", async () => {
    const owner = 'rcpt.erased@alpha.example.net';
    const key = keyAt(owner);
    const erased = purchase({ key, payerEmail: null, backfilled: 0 });
    const blank = purchase({ key, payerEmail: '   ', backfilled: 0 });
    const backfilled = purchase({ key, payerEmail: null, backfilled: 1 });

    const mine = await refsOf(owner);
    expect(mine).toEqual([backfilled.ref]);
    expect(mine).not.toContain(erased.ref);
    expect(mine).not.toContain(blank.ref);
    // Et son reçu ne s'ouvre pas non plus.
    const fetcher = vi.fn(async () => RECEIPT_URL);
    setReceiptUrlFetcherForTests(fetcher);
    expect((await openReceipt(owner, erased.ref)).res.status).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("I1 de bout en bout : l'oubli d'un payeur tiers ne donne pas son reçu au propriétaire", async () => {
    const owner = 'rcpt.forget.owner@alpha.example.net';
    const payer = 'rcpt.forget.payer@beta.example.net';
    const key = keyAt(owner);
    const paid = purchase({ key, payerEmail: payer });
    expect(await refsOf(payer)).toEqual([paid.ref]);
    expect(await refsOf(owner)).toEqual([]);

    // Le vrai outil d'oubli, dans un processus à part, contre la base de ce fichier.
    const out = execFileSync(process.execPath, [FORGET_SCRIPT, payer, '--execute'], {
      env: { ...process.env, STATS_DB_PATH: process.env.STATS_DB_PATH as string },
      encoding: 'utf8',
    });
    expect(out).toContain('key_purchases');
    const left = getStatsDB()
      .prepare('SELECT payer_email FROM key_purchases WHERE payment_ref = ?')
      .get(paid.paymentRef) as { payer_email: string | null };
    expect(left.payer_email).toBeNull();

    expect(await refsOf(payer)).toEqual([]);
    expect(await refsOf(owner)).toEqual([]);
  });

  it("M1 : après rotation puis réétiquetage de la clé active, l'ancienne adresse ne voit plus ses achats", async () => {
    const a = 'rcpt.rot.a@alpha.example.net';
    const b = 'rcpt.rot.b@beta.example.net';
    const k1 = keyAt(a);
    const beforeRotation = purchase({ key: k1, backfilled: 1 });
    const rotated = rotateApiKey(k1.rawKey);
    if (!rotated) throw new Error('rotation impossible');
    const k2 = withLineage(rotated.api_key, rotated.key_hash, rotated.key_prefix, a);
    const usdcOnK2 = purchase({ key: k2, rail: 'usdc' });
    // Tant que K2 porte A, A voit les deux achats.
    expect(await refsOf(a)).toEqual([beforeRotation.ref, usdcOnK2.ref].sort());

    // Le réétiquetage réécrit l'adresse de K2 sans toucher `email_norm`.
    getStatsDB().prepare('UPDATE api_keys SET email = ? WHERE key_hash = ?').run(b, k2.keyHash);
    const afterRelabel = purchase({ key: k2, rail: 'usdc' });

    expect(await refsOf(a)).toEqual([beforeRotation.ref]);
    expect(await refsOf(a)).not.toContain(afterRelabel.ref);
  });

  it("M2 : l'adresse libre d'un achat USDC ne donne rien ; l'achat est à l'adresse de sa clé", async () => {
    const holder = 'rcpt.usdc.holder@alpha.example.net';
    const target = 'rcpt.usdc.target@beta.example.net';
    const key = keyAt(holder);
    const usdc = purchase({ key, rail: 'usdc', payerEmail: target });

    expect(await refsOf(target)).toEqual([]);
    expect(await refsOf(holder)).toEqual([usdc.ref]);
  });

  it("ne montre jamais l'achat d'une autre adresse, d'une cohorte ou d'une clé réétiquetée", async () => {
    const email = 'rcpt.filters@alpha.example.net';
    keyAt(email);
    const other = keyAt('rcpt.stranger@beta.example.net');
    purchase({ key: other });
    purchase({ key: other, backfilled: 1 });

    const cohort = keyAt(email);
    getStatsDB()
      .prepare("UPDATE api_keys SET email = 'farm-1@cohorte.invalid' WHERE key_hash = ?")
      .run(cohort.keyHash);
    purchase({ key: cohort, backfilled: 1 });

    const relabelled = keyAt(email);
    getStatsDB()
      .prepare("UPDATE api_keys SET email = 'someone.else@beta.example.net' WHERE key_hash = ?")
      .run(relabelled.keyHash);
    purchase({ key: relabelled, rail: 'usdc' });

    expect((await receiptsOf(email)).list).toEqual([]);
  });

  it("ne liste que l'argent passé : ni en attente, ni échoué, ni un pack offert", async () => {
    const email = 'rcpt.outcomes@alpha.example.net';
    const key = keyAt(email);
    purchase({ key, outcome: 'pending' });
    purchase({ key, outcome: 'failed' });
    purchase({ key, issuedByUs: 1 });
    const refunded = purchase({ key, outcome: 'refunded' });
    const disputed = purchase({ key, outcome: 'disputed' });
    const credited = purchase({ key, outcome: 'credited' });

    const list = (await receiptsOf(email)).list;
    expect(list.map((r) => r.ref).sort()).toEqual(
      [refunded.ref, disputed.ref, credited.ref].sort(),
    );
    const status = Object.fromEntries(list.map((r) => [r.ref, r.status]));
    expect(status[refunded.ref]).toBe('refunded');
    expect(status[disputed.ref]).toBe('disputed');
    expect(status[credited.ref]).toBe('paid');
  });

  it('dit pour chaque achat où trouver sa preuve, sans servir ni lien, ni compteur, ni payeur', async () => {
    const email = 'rcpt.shapes@alpha.example.net';
    const key = keyAt(email);
    const pack = purchase({ key, settledAt: '2026-09-23 16:43:08' });
    const pro = purchase({ key, kind: 'subscription', credits: null, amountMinor: 2900 });
    const oem = purchase({ key, kind: 'subscription', credits: null, bundle: 'oem' });
    const usdc = purchase({ key, rail: 'usdc' });
    const noSession = purchase({ key, session: null });
    const fetcher = vi.fn(async () => RECEIPT_URL);
    setReceiptUrlFetcherForTests(fetcher);

    const { res, list } = await receiptsOf(email);
    const byRef = Object.fromEntries(list.map((r) => [r.ref, r]));
    expect(byRef[pack.ref]).toEqual({
      ref: pack.ref,
      paid_at: '2026-09-23T16:43:08Z',
      kind: 'pack',
      plan: null,
      rail: 'card',
      credits: 1000,
      amount: { minor: 400, currency: 'usd' },
      status: 'paid',
      key_prefix: key.keyPrefix,
      receipt: `/v1/account/receipt?ref=${pack.ref}`,
      invoices: null,
    });
    expect(pack.ref).toMatch(/^rcpt_[0-9a-f]{24}$/);
    expect(byRef[pro.ref]).toEqual(
      expect.objectContaining({ plan: 'pro', receipt: null, invoices: PRO_PORTAL_URL }),
    );
    expect(byRef[oem.ref].plan).toBe('editor');
    // Un achat USDC réel n'a pas de montant enregistré (la cotation n'est pas un reçu).
    expect(byRef[usdc.ref]).toEqual(
      expect.objectContaining({ rail: 'usdc', amount: null, receipt: null, invoices: null }),
    );
    expect(byRef[noSession.ref].receipt).toBeNull();
    // La liste n'appelle jamais Stripe.
    expect(fetcher).not.toHaveBeenCalled();
    const text = JSON.stringify(list);
    expect(text).not.toContain('pay.stripe.com');
    // Ni lignée, ni payeur, ni session Stripe, ni référence de paiement, ni numéro de ligne.
    expect(text).not.toContain(key.lineage);
    expect(text).not.toContain('cs_test_alpha');
    expect(text).not.toContain('stripe:');
    expect(text).not.toContain('@');
    for (const r of list) expect(Object.keys(r)).not.toContain('id');
    expect(res.status).toBe(200);
  });
});

describe('GET /v1/account/receipt?ref=rcpt_…', () => {
  it("donne le lien frais du reçu d'un pack payé par carte, puis le garde une heure", async () => {
    const email = 'rcpt.open@alpha.example.net';
    const key = keyAt(email);
    const { ref } = purchase({ key, session: 'cs_test_alpha_open' });
    const fetcher = vi.fn(async (session: string) => {
      expect(session).toBe('cs_test_alpha_open');
      return RECEIPT_URL;
    });
    setReceiptUrlFetcherForTests(fetcher);

    const first = await openReceipt(email, ref);
    expect(first.res.status).toBe(200);
    expect(first.body).toEqual({ ref, url: RECEIPT_URL });
    expect(first.res.headers.get('cache-control')).toBe('no-store');

    await openReceipt(email, ref);
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Passé l'heure, le lien est redemandé à Stripe.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + RECEIPT_LINK_CACHE_MS + 1_000);
    await openReceipt(email, ref);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('M3 : dix clics simultanés sur le même reçu font un seul appel à Stripe', async () => {
    const email = 'rcpt.burst@alpha.example.net';
    const key = keyAt(email);
    const { ref } = purchase({ key });
    const fetcher = vi.fn(
      () => new Promise<string>((done) => setTimeout(() => done(RECEIPT_URL), 50)),
    );
    setReceiptUrlFetcherForTests(fetcher);

    const answers = await Promise.all(Array.from({ length: 10 }, () => openReceipt(email, ref)));
    expect(answers.map((a) => a.res.status)).toEqual(Array(10).fill(200));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('M3 : un échec est gardé une minute, puis Stripe est redemandé', async () => {
    const email = 'rcpt.retry@alpha.example.net';
    const key = keyAt(email);
    const { ref } = purchase({ key });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValue(RECEIPT_URL);
    setReceiptUrlFetcherForTests(fetcher);

    expect((await openReceipt(email, ref)).res.status).toBe(503);
    expect((await openReceipt(email, ref)).res.status).toBe(503);
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + RECEIPT_FAILURE_CACHE_MS + 1_000);
    expect((await openReceipt(email, ref)).body).toEqual({ ref, url: RECEIPT_URL });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("404 uniforme : référence inconnue, d'une autre adresse, sans reçu de carte, ou mal formée", async () => {
    const email = 'rcpt.notfound@alpha.example.net';
    const mine = keyAt(email);
    const theirs = keyAt('rcpt.notmine@beta.example.net');
    const other = purchase({ key: theirs });
    const usdc = purchase({ key: mine, rail: 'usdc' });
    const sub = purchase({ key: mine, kind: 'subscription' });
    const failed = purchase({ key: mine, outcome: 'failed' });
    const fetcher = vi.fn(async () => RECEIPT_URL);
    setReceiptUrlFetcherForTests(fetcher);

    const bodies = new Set<string>();
    for (const ref of [
      other.ref,
      usdc.ref,
      sub.ref,
      failed.ref,
      `rcpt_${'f'.repeat(24)}`,
      'rcpt_ABC',
      '1',
      other.paymentRef,
      '',
      `${other.ref} `,
    ]) {
      const { res, body } = await openReceipt(email, ref);
      expect(res.status, ref).toBe(404);
      bodies.add(JSON.stringify(body));
    }
    expect([...bodies]).toEqual([
      JSON.stringify({ error: 'receipt_not_found', message: 'No such receipt in this account.' }),
    ]);
    expect(fetcher).not.toHaveBeenCalled();
    // L'ancienne forme par numéro n'existe pas.
    const byId = await makeApp().request('/v1/account/receipt?id=1', {
      headers: { Cookie: cookieFor(email) },
    });
    expect(byId.status).toBe(404);
  });

  it('503 receipt_unavailable quand Stripe échoue, ne rend rien, ou rend une autre adresse', async () => {
    const email = 'rcpt.down@alpha.example.net';
    const key = keyAt(email);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cases: Array<() => Promise<string | null>> = [
      async () => {
        throw Object.assign(new Error('No such checkout.session: cs_test_alpha_secret'), {
          type: 'StripeInvalidRequestError',
        });
      },
      async () => null,
      async () => 'https://evil.example.net/receipts/payment/x',
      async () => 'http://pay.stripe.com/receipts/payment/x',
    ];
    for (const fetcher of cases) {
      const { ref } = purchase({ key });
      setReceiptUrlFetcherForTests(fetcher);
      const { res, body } = await openReceipt(email, ref);
      expect(res.status).toBe(503);
      expect(body.error).toBe('receipt_unavailable');
      expect(JSON.stringify(body)).not.toContain('evil');
    }
    // Le journal ne cite ni la session Stripe, ni un lien, ni la référence servie.
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('StripeInvalidRequestError');
    expect(logged).not.toContain('cs_test_alpha');
    expect(logged).not.toContain('https://');
    expect(logged).not.toContain('rcpt_');
  });

  it('sans clé Stripe dans l’environnement : 503, sans appel réseau', async () => {
    const email = 'rcpt.nokey@alpha.example.net';
    const key = keyAt(email);
    const { ref } = purchase({ key });
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { res, body } = await openReceipt(email, ref);
      expect(res.status).toBe(503);
      expect(body.error).toBe('receipt_unavailable');
    } finally {
      if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
    }
  });
});
