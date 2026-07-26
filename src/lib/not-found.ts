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

/**
 * Les seules confusions réellement observées en production. On ne devine que
 * ce qui a été mesuré : une piste inventée qui tombe à côté coûte plus cher
 * que pas de piste du tout, puisque l'agent la suivra.
 */
const ENDPOINT_HINTS: Array<{ when: (method: string, path: string) => boolean; hint: string }> = [
  { when: (m, p) => m === 'POST' && p === '/', hint: 'POST /v1/iban/validate with body {"iban":"CH93..."}' },
  { when: (m, p) => m === 'POST' && /^\/v1\/bic/.test(p), hint: 'GET /v1/bic/UBSWCHZH (BIC lookup is a GET)' },
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

/** Monté par `app.notFound(...)` dans src/index.ts — statut 404 inchangé. */
export const notFoundHandler: NotFoundHandler<HonoEnv> = (c) =>
  c.json(notFoundBody(c.req.method, new URL(c.req.url).pathname), 404);
