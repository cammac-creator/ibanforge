/**
 * Les trois routes d'administration du disjoncteur (lot 5).
 *
 * 🚨 Ce fichier existe pour une raison précise : les trois routes rendent 404
 * aujourd'hui en production, et le critère d'acceptation du lot est qu'elles
 * répondent, DÉSARMÉES, avec les réglages en vigueur et deux journaux vides.
 * Un montage oublié dans `src/app.ts` produit un 404 qu'on prend pour un
 * problème de secret ; un nom de champ qui dérive produit une sortie qu'on
 * prend pour une route cassée. Les deux se lisent ici.
 *
 * 🚨 PATRON DES GARDES D'ENVIRONNEMENT : sauvegarder, poser, restaurer DANS LE
 * TEST, jamais dans un `setupFiles`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { randomBytes, createHash } from 'node:crypto';
import { adminBreaker } from './admin-breaker.js';
import { getStatsDB } from '../lib/db.js';
import { kvGet } from '../lib/forum-radar-server.js';
import {
  evaluateBreakerOnCreation,
  BREAKER_THRESHOLD,
  BREAKER_EPISODE_MAX_HOURS,
} from '../lib/creation-breaker.js';
import { KV_SHIELD_ARMED } from '../lib/shield-state.js';
import {
  BREAKER_MIN_DISTINCT_SOURCES,
  BREAKER_WINDOW_MINUTES,
  toSqliteUtc,
} from '../lib/cohort-radar.js';
import { ANONYMOUS_MONTHLY_LIMIT, SHIELD_MONTHLY_LIMIT } from '../lib/tiers.js';

const SECRET = 'correct-horse-battery-staple';
const RUN = String(Date.now());

function app(): Hono {
  const a = new Hono();
  a.route('/', adminBreaker);
  return a;
}

function auth(extra: Record<string, string> = {}): Record<string, string> {
  return { 'X-Admin-Secret': SECRET, ...extra };
}

/** La forme d'une rafale : assez de volume, assez de réseaux, dans la fenêtre. */
function armNow(): string {
  const keys = BREAKER_THRESHOLD * 4;
  const sources = BREAKER_MIN_DISTINCT_SOURCES * 2;
  for (let i = 0; i < keys; i++) {
    getStatsDB()
      .prepare(
        'INSERT INTO key_creations (ip_hash, user_agent, key_prefix, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(
        `net-${RUN}-${i % sources}`,
        'demo-http-client/1.0',
        `ifk_${randomBytes(4).toString('hex')}`,
        toSqliteUtc(Date.now() - 60_000),
      );
  }
  const st = evaluateBreakerOnCreation();
  expect(st.armed).toBe(true);
  return st.episode_id as string;
}

let envSecret: string | undefined;
let envBreaker: string | undefined;

beforeEach(() => {
  envSecret = process.env.ADMIN_SECRET;
  envBreaker = process.env.IBANFORGE_BREAKER_DISABLED;
  process.env.ADMIN_SECRET = SECRET;
  delete process.env.IBANFORGE_BREAKER_DISABLED;
  const db = getStatsDB();
  kvGet(KV_SHIELD_ARMED); // `kv_state` est créée paresseusement.
  db.prepare('DELETE FROM key_creations').run();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM breaker_transitions').run();
  db.prepare("DELETE FROM kv_state WHERE key LIKE 'creation_breaker:%'").run();
});

afterEach(() => {
  if (envSecret === undefined) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = envSecret;
  if (envBreaker === undefined) delete process.env.IBANFORGE_BREAKER_DISABLED;
  else process.env.IBANFORGE_BREAKER_DISABLED = envBreaker;
});

describe('la garde d’administration', () => {
  it.each([
    ['/v1/admin/breaker', 'GET'],
    ['/v1/admin/breaker/transitions', 'GET'],
    ['/v1/admin/breaker/undegrade', 'POST'],
  ])('%s sans secret : 401, jamais 404', async (path, method) => {
    const res = await app().request(path, { method });
    // 401 et non 404 : le 404 est la signature d'un montage oublié, et on l'a
    // déjà pris pour un problème de secret dans ce dépôt.
    expect(res.status).toBe(401);
  });
});

describe('GET /v1/admin/breaker', () => {
  it('au repos : désarmé, révocation éteinte, et les réglages en vigueur', async () => {
    const res = await app().request('/v1/admin/breaker', { headers: auth() });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.armed).toBe(false);
    expect(json.creations_in_window).toBe(0);
    expect(json.distinct_sources_in_window).toBe(0);
    expect(json.threshold).toBe(BREAKER_THRESHOLD);
    expect(json.min_distinct_sources).toBe(BREAKER_MIN_DISTINCT_SOURCES);
    expect(json.window_minutes).toBe(BREAKER_WINDOW_MINUTES);
    expect(json.episode_max_hours).toBe(BREAKER_EPISODE_MAX_HOURS);
    // A5 : ce qui protège part armé, ce qui COUPE part éteint.
    expect(json.revocation_enabled).toBe(false);
    expect(json.episode).toBe(null);
  });

  it('sous alerte : l’épisode, et le nombre de clés qu’il porte', async () => {
    const episode = armNow();
    getStatsDB()
      .prepare(
        `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, tier, shield_episode, no_recredit)
         VALUES (?, ?, 'anonymous', ?, 'anonymous', ?, 1)`,
      )
      .run(
        createHash('sha256').update(`k-${RUN}`).digest('hex'),
        `ifk_${randomBytes(4).toString('hex')}`,
        SHIELD_MONTHLY_LIMIT,
        episode,
      );
    const res = await app().request('/v1/admin/breaker', { headers: auth() });
    const json = (await res.json()) as {
      armed: boolean;
      creations_in_window: number;
      distinct_sources_in_window: number;
      episode: { episode_id: string; armed_at: string; keys_born: number };
    };
    expect(json.armed).toBe(true);
    expect(json.creations_in_window).toBe(BREAKER_THRESHOLD * 4);
    expect(json.distinct_sources_in_window).toBe(BREAKER_MIN_DISTINCT_SOURCES * 2);
    expect(json.episode.episode_id).toBe(episode);
    expect(json.episode.keys_born).toBe(1);
  });

  it('distingue le calme de l’interrupteur de crise', async () => {
    // 🚨 `armed: false` seul laisse trois causes possibles : le calme,
    // l'interrupteur, ou un compteur muet. Sans ces deux champs, un opérateur
    // ne peut pas savoir laquelle il regarde.
    process.env.IBANFORGE_BREAKER_DISABLED = '1';
    const res = await app().request('/v1/admin/breaker', { headers: auth() });
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.armed).toBe(false);
    expect(json.breaker_disabled).toBe(true);
    expect(json.blind_streak).toBe(0);
  });
});

describe('GET /v1/admin/breaker/transitions', () => {
  it('journal vide au premier déploiement', async () => {
    const res = await app().request('/v1/admin/breaker/transitions', { headers: auth() });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('la bascule d’armement y figure, avec ses réglages du moment', async () => {
    const episode = armNow();
    const res = await app().request('/v1/admin/breaker/transitions', { headers: auth() });
    const rows = (await res.json()) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0].episode_id).toBe(episode);
    expect(rows[0].direction).toBe('armed');
    expect(rows[0].reason).toBe('threshold');
    expect(rows[0].trigger).toBe('creations');
    expect(rows[0].threshold).toBe(BREAKER_THRESHOLD);
    expect(rows[0].window_minutes).toBe(BREAKER_WINDOW_MINUTES);
  });
});

describe('POST /v1/admin/breaker/undegrade', () => {
  it('sans episode_id : 400, et rien n’est touché', async () => {
    const res = await app().request('/v1/admin/breaker/undegrade', {
      method: 'POST',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: '{}',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('episode_id_required');
  });

  it('remonte le lot de l’épisode, et le dit', async () => {
    // 🚨 C'est LA route à lancer avant un `git revert` de ce lot : le code
    // revient, le schéma reste, mais une clé déjà dégradée reste à son plafond
    // réduit parce que plus rien ne tourne pour la remonter.
    const episode = '2026-09-15T12:00:00.000Z';
    const hash = createHash('sha256').update(`u-${RUN}`).digest('hex');
    getStatsDB()
      .prepare(
        `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, tier, shield_episode, no_recredit)
         VALUES (?, ?, 'anonymous', ?, 'anonymous', ?, 1)`,
      )
      .run(hash, `ifk_${randomBytes(4).toString('hex')}`, SHIELD_MONTHLY_LIMIT, episode);

    const res = await app().request('/v1/admin/breaker/undegrade', {
      method: 'POST',
      headers: auth({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ episode_id: episode }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      episode_id: episode,
      all: false,
      undegraded: 1,
      remaining: 0,
    });
    const row = getStatsDB()
      .prepare('SELECT monthly_limit, no_recredit FROM api_keys WHERE key_hash = ?')
      .get(hash) as { monthly_limit: number; no_recredit: number };
    expect(row.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(row.no_recredit).toBe(0);
  });
});
