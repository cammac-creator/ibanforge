/**
 * Ce que l'API répond quand un gestionnaire lève une exception imprévue
 * (ARCH-09#1, audit du 10.11.2026).
 *
 * Tout le contrat de l'API est en JSON, refus compris : un agent lit `error`,
 * jeton stable, et branche dessus. Le gestionnaire par défaut de Hono rendait,
 * lui, le texte brut `Internal Server Error` : un client qui fait `res.json()`
 * sur chaque réponse levait à son tour, sur un 500 qui n'était pas sa faute.
 * Désormais le 500 a la même enveloppe qu'un refus, sans jamais répéter la
 * requête ni la cause.
 *
 * Deux choses ne changent pas, et c'est voulu :
 *
 *  - le STATUT. Hono attrape l'exception au niveau du gestionnaire qui l'a levée
 *    (compose) et pose la réponse sur le contexte : les middlewares qui
 *    entourent la route voient un 500 après `await next()`, exactement comme
 *    avec le gestionnaire par défaut. Le remboursement des 4xx du middleware de
 *    clé (`src/middleware/api-key.ts`) lit ce statut : un 500 n'y est pas
 *    remboursé, par choix, et un 4xx l'est toujours ;
 *  - une `HTTPException` garde SA réponse, comme dans le gestionnaire par
 *    défaut (`authorizeAdmin` en lève une, 403, avec un corps JSON) : la rendre
 *    en 500 ferait d'un refus un échec, et retirerait son remboursement.
 *
 * Pourquoi un module et pas une fermeture dans `buildApp()` : comme
 * `not-found.ts`, pour être monté tel quel dans un test.
 *
 * ⚠️ Le journal ne garde que la méthode, le chemin normalisé (aucun identifiant
 * soumis, aucun porteur : `normalizeRequestPath`) et la pile, passée par la
 * même règle IBAN que les deux journaux de requêtes, puis, depuis le 11.11.2026,
 * par `redactStackValues` : une exception peut citer dans son message une
 * adresse e-mail, une clé d'API ou une adresse IP, et la console est gardée
 * par l'hébergeur.
 */
import type { ErrorHandler } from 'hono';
import { normalizeRequestPath, redactIbanShapedValues } from './stats.js';

/** Ce qui a la forme d'une adresse e-mail, d'une clé d'API (`ifk_…`) ou d'une adresse IP. */
const STACK_VALUE_SHAPES: readonly RegExp[] = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g,
  /\bifk_[A-Za-z0-9]+/g,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
  // IPv6, forme courte comprise. Jamais collée à un nom ou à un deux-points, pour
  // laisser intacts les `fichier.js:12:34` d'une pile.
  /(?<![0-9A-Za-z:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![0-9A-Za-z:])/g,
];

/**
 * La pile telle qu'elle peut partir en console : la règle IBAN des journaux de
 * requêtes, puis chaque forme d'adresse ou de clé remplacée par `***`.
 */
export function redactStackValues(stack: string): string {
  let out = redactIbanShapedValues(stack, '***');
  for (const shape of STACK_VALUE_SHAPES) out = out.replace(shape, '***');
  return out;
}

/** Le jeton stable d'un 500 imprévu, publié dans error-semantics. */
export const INTERNAL_ERROR = 'internal_error';

export const INTERNAL_ERROR_MESSAGE =
  'Unexpected error on our side, not caused by your request. Safe to retry; if it persists, ' +
  'write to support@ibanforge.com with the endpoint and the time of the call (UTC).';

export const apiErrorHandler: ErrorHandler = (err, c) => {
  // Le gestionnaire par défaut de Hono, à l'identique, pour une HTTPException.
  if ('getResponse' in err && typeof err.getResponse === 'function') {
    const res = (err as { getResponse: () => Response }).getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(
    `[api] unhandled error on ${c.req.method} ${normalizeRequestPath(c.req.path)}:`,
    redactStackValues(err.stack ?? String(err)),
  );
  return c.json({ error: INTERNAL_ERROR, message: INTERNAL_ERROR_MESSAGE }, 500);
};
