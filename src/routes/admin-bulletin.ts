import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { isAdminAuthorized } from './api-keys.js';
import { getBulletin, readMissingBics, resolveBulletinWeek } from '../lib/bulletin.js';
import {
  FEED_BODY_MAX_BYTES,
  feedWeekAt,
  isFeedSource,
  validateFeedPayload,
  writeFeed,
} from '../lib/bulletin-feed.js';
import { addSessionProposal, isAnswer, recordAnswer } from '../lib/bulletin-decisions.js';
import { deleteCost, listCosts, saveCost } from '../lib/bulletin-money.js';
import { getStripeRevenue } from './admin-stripe-revenue.js';

/**
 * The Monday bulletin (Claude-Alain's approval of 28.09.2026, steps A1 and A2).
 *
 * `GET /v1/admin/bulletin?week=AAAA-Wss`: one Swiss week, the last complete one by
 * default. Read-only: every block reads what already runs (`src/lib/bulletin.ts`
 * names each source), and a block that cannot be read says `unread` instead of
 * showing zeros.
 *
 * AGGREGATES only: no address, no key, no hash. Never cached: an intermediary that
 * kept the body would show a frozen week to someone who believes they read today's
 * state. The header is set before the secret is checked, so the 401 carries it too.
 *
 * L'étape A2 (07.10.2026) ajoute trois écritures, chacune derrière sa porte :
 *
 *  - `POST /internal/bulletin/:source` : les deux veilles du lundi déposent leur
 *    résumé (`bulletin-feed.ts`), avec `BULLETIN_FEED_TOKEN` ;
 *  - `POST /v1/admin/bulletin/proposals` : la session principale pose une proposition ;
 *  - `POST /v1/admin/bulletin/answers` : Oui / Plus tard / Non, depuis la page du
 *    tableau de bord par la route du site, qui garde le secret côté serveur.
 *
 * La priorité 05 ajoute le registre des coûts, derrière le secret d'administration
 * (`bulletin-money.ts`) : `GET`, `POST` et `DELETE /v1/admin/bulletin/costs`. Les
 * montants ne vivent que dans la base privée ; aucun n'est écrit dans ce dépôt public.
 */
export const adminBulletin = new Hono();

adminBulletin.get('/v1/admin/bulletin', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json(await getBulletin({ week: c.req.query('week') ?? null, stripe: getStripeRevenue }));
});

// ─── Le dépôt des veilles ────────────────────────────────────────────────────

/**
 * ⚠️ BULLETIN_FEED_TOKEN, jamais HEARTBEAT_TOKEN et jamais ADMIN_SECRET.
 *
 * Le jeton vit dans les secrets GitHub Actions d'un dépôt PUBLIC. Un nom à lui lui
 * donne le bon rayon d'explosion : s'il fuit, l'attaquant peut écrire trois lignes et
 * un score dans une page privée, et rien d'autre ; il ne fait taire aucun homme mort
 * (le jeton des battements) et n'ouvre pas le tableau de bord (le secret
 * d'administration). Non posé, la porte refuse tout : elle ne s'ouvre jamais par défaut.
 */
function isFeedAuthorized(provided: string | undefined): boolean {
  const expected = process.env.BULLETIN_FEED_TOKEN;
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  if (expectedBuf.length !== providedBuf.length) {
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

/**
 * 🚨 La réponse est `{ ok: true }` et rien d'autre, et un refus donne un code court,
 * jamais ce qui a été reçu : les workflows qui appellent cette route tournent dans un
 * dépôt public, et les lignes qu'ils déposent peuvent porter des chiffres réels.
 */
adminBulletin.post('/internal/bulletin/:source', async (c) => {
  c.header('Cache-Control', 'no-store');
  // Le refus ne dit pas lequel des deux (jeton ou source) est faux.
  if (!isFeedAuthorized(c.req.header('x-bulletin-token'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const source = c.req.param('source');
  if (!isFeedSource(source)) return c.json({ error: 'unknown_source' }, 404);
  const declared = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > FEED_BODY_MAX_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  const text = await c.req.text();
  if (Buffer.byteLength(text, 'utf8') > FEED_BODY_MAX_BYTES) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const valid = validateFeedPayload(source, body);
  if (!valid.ok) return c.json({ error: valid.error }, 400);
  writeFeed(source, feedWeekAt(Date.now()).label, valid.payload);
  return c.json({ ok: true });
});

// ─── Les propositions et les réponses ───────────────────────────────────────

async function jsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

/**
 * Une proposition de la session principale : `{ title, detail?, origin? }`, en texte
 * brut, montrée dès le bulletin de la dernière semaine close et jusqu'à sa réponse.
 */
adminBulletin.post('/v1/admin/bulletin/proposals', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await jsonBody(c);
  const week = resolveBulletinWeek(null, Date.now()).week;
  const result = addSessionProposal(body, week);
  if (!result.ok) return c.json({ error: result.error }, 400);
  return c.json(result, 201);
});

/**
 * Une réponse à une proposition MONTRÉE par le bulletin de ce lundi : `{ key, answer }`,
 * la réponse valant `oui`, `plus_tard` ou `non`. Une clé que le bulletin ne montre pas
 * répond 404 : on ne répond pas à une proposition qu'on ne voit pas.
 */
adminBulletin.post('/v1/admin/bulletin/answers', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const body = await jsonBody(c);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const { key, answer } = body as Record<string, unknown>;
  if (typeof key !== 'string' || key.length > 80 || !isAnswer(answer)) {
    return c.json({ error: 'invalid_body' }, 400);
  }
  const now = Date.now();
  const { week } = resolveBulletinWeek(null, now);
  let bics: ReturnType<typeof readMissingBics> | null = null;
  try {
    bics = readMissingBics(week);
  } catch {
    // Illisible, la règle des BIC introuvables n'est simplement pas appliquée, comme sur la page.
  }
  const result = recordAnswer(key, answer, week, bics, now);
  if (!result.ok) return c.json({ error: result.error }, 404);
  return c.json(result);
});

// ─── Priorité 05 : le registre des coûts ────────────────────────────────────

/**
 * Un coût lu sur une facture, un relevé d'usage ou une estimation :
 * `{ item, from, to, amount_minor, currency, nature, note? }`, la période allant de
 * `from` inclus à `to` exclu (dates civiles suisses). La même période du même poste
 * remplace la saisie précédente ; une période qui en chevauche une autre est refusée (409).
 */
adminBulletin.post('/v1/admin/bulletin/costs', async (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const result = saveCost(await jsonBody(c));
  if (!result.ok) return c.json({ error: result.error }, result.error === 'overlap' ? 409 : 400);
  return c.json(result, result.replaced ? 200 : 201);
});

adminBulletin.get('/v1/admin/bulletin/costs', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ costs: listCosts() });
});

/** Retire une saisie faite par erreur, par son identifiant. */
adminBulletin.delete('/v1/admin/bulletin/costs/:id', (c) => {
  c.header('Cache-Control', 'private, no-store');
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id) || id < 1) return c.json({ error: 'invalid_id' }, 400);
  return deleteCost(id) ? c.json({ ok: true }) : c.json({ error: 'not_found' }, 404);
});
