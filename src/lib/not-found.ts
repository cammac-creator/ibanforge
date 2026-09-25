/**
 * Le corps du 404 de l'API — la seule réponse qu'un agent perdu va lire.
 *
 * 1 439 requêtes en 30 jours recevaient `Route POST / not found`, et rien
 * d'autre. Un agent qui lit ça ne réessaie pas différemment : il déclare l'API
 * cassée à son utilisateur, alors qu'il était à un chemin près. Un 404 doit
 * donc dire quoi appeler à la place, avec la forme exacte du corps attendu.
 *
 * Pourquoi un module et pas du code inline dans src/index.ts : `serve()` y est
 * appelé à l'import et aucune `app` n'y est exportée — le fichier est
 * inimportable depuis un test. Inline, ce handler n'aurait aucune couverture
 * automatisée. Ici, `notFoundHandler` est monté tel quel dans le test et
 * src/index.ts se réduit à `app.notFound(notFoundHandler)`.
 *
 * ⚠️ DPA : le corps peut nommer le CHEMIN, jamais la charge utile soumise.
 * `message` reprend le pathname — comportement inchangé, au caractère près,
 * depuis avant cette instrumentation — et aucun champ ne relit le JSON envoyé.
 */

import type { NotFoundHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from './tiers.js';

/**
 * Les seules confusions réellement observées en production. On ne devine que
 * ce qui a été mesuré : une piste inventée qui tombe à côté coûte plus cher
 * que pas de piste du tout, puisque l'agent la suivra.
 */
const ENDPOINT_HINTS: Array<{ when: (method: string, path: string) => boolean; hint: string }> = [
  {
    when: (m, p) => m === 'POST' && p === '/',
    hint: 'POST /v1/iban/validate with body {"iban":"CH93..."}',
  },
  {
    when: (m, p) => m === 'POST' && /^\/v1\/bic/.test(p),
    hint: 'GET /v1/bic/UBSWCHZH (BIC lookup is a GET)',
  },
  {
    when: (m, p) => m === 'GET' && /^\/v1\/iban\/(validate|compliance|batch)/.test(p),
    hint: 'POST the same path with body {"iban":"CH93..."} (these are POST endpoints)',
  },
];

/** Catalogue servi à chaque 404 : le chemin ET la forme du corps, sinon l'agent devine. */
const ENDPOINTS = {
  validate_iban: 'POST /v1/iban/validate  {"iban":"CH93..."}',
  compliance: 'POST /v1/iban/compliance  {"iban":"CH93..."}',
  batch: 'POST /v1/iban/batch  {"ibans":["CH93...","DE89..."]}',
  bic_lookup: 'GET /v1/bic/UBSWCHZH',
  ch_clearing: 'GET /v1/ch/clearing/230',
  free_format_check: 'GET /v1/iban/format?iban=CH93...',
  // 24/09/2026: the one free page of real, full answers, which an assistant
  // that can only read pages never found from here.
  free_demo: 'GET https://api.ibanforge.com/v1/demo',
} as const;

export interface NotFoundBody {
  error: 'not_found';
  message: string;
  /** Absent quand aucune piste mesurée ne colle — on ne remplit pas au hasard. */
  did_you_mean?: string;
  endpoints: typeof ENDPOINTS;
  schema: string;
  mcp: string;
}

/** Fonction pure : (méthode, pathname) → corps du 404. Aucun accès au contexte. */
export function notFoundBody(method: string, path: string): NotFoundBody {
  const match = ENDPOINT_HINTS.find((h) => h.when(method, path));
  return {
    error: 'not_found',
    message: `Route ${method} ${path} not found`,
    ...(match ? { did_you_mean: match.hint } : {}),
    endpoints: ENDPOINTS,
    schema: 'https://api.ibanforge.com/openapi.json',
    mcp: 'https://api.ibanforge.com/mcp',
  };
}

/**
 * Les routes réelles et les méthodes qu'elles acceptent.
 *
 * Un 404 dit à une machine « ce point d'entrée n'existe pas » et elle s'arrête.
 * Un 405 avec un en-tête `Allow` lui dit « bon chemin, mauvais verbe » dans un
 * champ qu'elle sait exploiter sans lire la prose du corps.
 *
 * Mesuré dans `request_log` le 29/07/2026 — IP distinctes ayant appelé une
 * route existante avec la mauvaise méthode et s'étant entendu répondre qu'elle
 * n'existait pas : 93 sur `/v1/iban/validate`, 64 sur `/v1/iban/batch`, 25 sur
 * `/v1/iban/compliance`, 24 sur `/v1/keys/generate`.
 */
const ROUTE_METHODS: Array<{ match: RegExp; allow: readonly string[] }> = [
  { match: /^\/v1\/iban\/(validate|batch|compliance)\/?$/, allow: ['POST'] },
  { match: /^\/v1\/keys\/generate\/?$/, allow: ['POST'] },
  { match: /^\/v1\/bic\/[^/]+\/?$/, allow: ['GET'] },
  { match: /^\/v1\/ch\/clearing\/[^/]+\/?$/, allow: ['GET'] },
];

/**
 * `null` si le chemin est inconnu OU si la méthode est la bonne. Sinon les
 * méthodes acceptées, pour l'en-tête `Allow`.
 *
 * On ne répond 405 que sur des chemins réellement montés : prétendre « bon
 * chemin, mauvais verbe » sur une route inexistante enverrait l'agent réessayer
 * indéfiniment, ce qui est pire qu'un 404 honnête.
 */
export function methodMismatch(method: string, path: string): { allow: readonly string[] } | null {
  const route = ROUTE_METHODS.find((r) => r.match.test(path));
  if (!route) return null;
  if (route.allow.includes(method)) return null;
  return { allow: route.allow };
}

/**
 * Ce qu'un appelant qui ne sait envoyer que des GET peut lire à la place.
 *
 * Joint au 405 d'une route POST (24/09/2026) : un outil de lecture d'assistant
 * (DeepSeek, ChatGPT gratuit, Gemini) n'envoie pas de POST, et tout ce que ce
 * 405 lui disait menait vers un POST. Deux routes GET gratuites, avec ce que
 * chacune établit, pour qu'aucune ne soit prise pour l'autre : la démo montre
 * la validation complète sur des exemples fixes ; la route format ne juge que
 * l'écriture de l'IBAN, jamais la banque.
 */
export const WITHOUT_POST = [
  'GET https://api.ibanforge.com/v1/demo: real answers of the full validation (bank-code verdict of the national register, BIC with its source), computed on the request and dated by served_at, on fixed example IBANs.',
  "GET https://api.ibanforge.com/v1/iban/format?iban=...: your IBAN's structure and mod-97 only; valid: true there says nothing about the bank.",
] as const;

/**
 * La clé sans e-mail, dite au 405 de `GET /v1/keys/generate` (24/09/2026).
 *
 * Mesuré (voir `ROUTE_METHODS`) : des appelants distincts arrivent sur cette
 * route en GET. Le corps ne leur disait pas que la route répond à un POST SANS
 * corps. Deux règles :
 *   - ce n'est PAS `TRIAL_FREE_KEY_HINT` (src/lib/trial.ts) : celle-ci porte le
 *     jeton `api-trial`, qui compte les clés nées de l'essai sans clé, et une
 *     clé prise ici n'en vient pas ;
 *   - les chiffres viennent de `tiers.ts`, et le plafond de l'essai n'y est pas :
 *     les deux 25 ne partagent jamais une phrase.
 */
export const KEY_WITHOUT_EMAIL =
  'POST https://api.ibanforge.com/v1/keys/generate with no body at all returns an ifk_ key on the spot: ' +
  'no e-mail, no card, nothing to confirm; an optional body {"source":"..."} (lower-case letters, digits, - and _) ' +
  'says where you found us. ' +
  `The key works on every endpoint, starts at ${ANONYMOUS_MONTHLY_LIMIT} requests a month, and reaches ` +
  `${FREE_TIER_MONTHLY_LIMIT} a month once claimed at POST /v1/keys/claim.`;

/** Les champs ajoutés au corps d'un 405, selon la route. Fonction pure. */
export function methodMismatchExtras(
  method: string,
  path: string,
  allow: readonly string[],
): { without_post?: readonly string[]; key_without_email?: string } {
  const extras: { without_post?: readonly string[]; key_without_email?: string } = {};
  if (allow.includes('POST') && method !== 'POST') extras.without_post = WITHOUT_POST;
  if (/^\/v1\/keys\/generate\/?$/.test(path)) extras.key_without_email = KEY_WITHOUT_EMAIL;
  return extras;
}

/** Monté par `app.notFound(...)` dans src/index.ts. */
export const notFoundHandler: NotFoundHandler<HonoEnv> = (c) => {
  const path = new URL(c.req.url).pathname;
  const method = c.req.method;
  const body = notFoundBody(method, path);

  const mismatch = methodMismatch(method, path);
  if (mismatch) {
    c.header('Allow', mismatch.allow.join(', '));
    return c.json(
      {
        ...body,
        error: 'method_not_allowed',
        allow: mismatch.allow,
        ...methodMismatchExtras(method, path, mismatch.allow),
      },
      405,
    );
  }

  return c.json(body, 404);
};
