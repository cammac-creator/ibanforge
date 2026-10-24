/**
 * Preuve de propriété du domaine pour le répertoire d'applications de ChatGPT.
 *
 * Le portail d'OpenAI demande de servir un jeton, en texte brut, à une adresse
 * qu'il affiche lui-même :
 *
 *     GET https://api.ibanforge.com/.well-known/openai-apps-challenge
 *
 * Il lit le corps, le compare au jeton qu'il a généré, puis marque le domaine
 * « vérifié ». Cette route ne sert que cela.
 *
 * Le jeton vit dans la variable d'environnement `OPENAI_APPS_CHALLENGE` (posée
 * sur l'hébergeur par l'exploitant) et nulle part dans ce dépôt, qui est public.
 * Il est lu À CHAQUE REQUÊTE, pas à l'import : poser, changer ou retirer la
 * variable suffit à changer la réponse, et un test peut la fixer sans
 * recharger le module.
 *
 *  - variable absente ou vide : 404, comme si la route n'existait pas ;
 *  - variable présente : 200, `text/plain; charset=utf-8`, le jeton octet pour
 *    octet. Rien n'est ajouté, pas même un saut de ligne, et rien n'est retiré :
 *    une valeur collée avec une espace en trop est une valeur à corriger chez
 *    l'hébergeur, pas ici, sinon l'égalité que le portail contrôle serait
 *    silencieusement fausse d'un côté ou de l'autre.
 *
 * `Cache-Control: no-store` sur les DEUX réponses : un « absent » gardé en
 * cache par un intermédiaire survivrait à la pose de la variable, et le portail
 * continuerait de lire un 404 le jour où le jeton est enfin servi.
 *
 * Aucune base, aucun quota, aucun compte : la route ne lit que l'environnement.
 * Elle n'entre pas dans les statistiques (`SKIP_TRACKING`, src/app.ts) et ne
 * journalise jamais la valeur. Le jeton est fait pour être lu par n'importe qui
 * à cette seule adresse ; aucune autre variable, aucun en-tête privé ne sort
 * d'ici.
 *
 * `HEAD` est servi par le gestionnaire du `GET` (Hono le route ainsi, sans
 * corps) : le `Content-Length` est donc posé à la main pour que les deux
 * verbes annoncent la même taille.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';

/** L'adresse que le portail d'OpenAI contrôle, relative à l'hôte de l'API. */
export const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

/** Le nom de la variable d'environnement qui porte le jeton. */
export const OPENAI_APPS_CHALLENGE_ENV = 'OPENAI_APPS_CHALLENGE';

/**
 * Le jeton à servir, tel que posé, ou `null` s'il n'y en a pas. Une valeur
 * faite uniquement d'espaces compte comme absente : elle ne peut pas être un
 * jeton, et la servir ferait croire à une preuve qui n'existe pas.
 */
function configuredToken(): string | null {
  const raw = process.env[OPENAI_APPS_CHALLENGE_ENV];
  if (raw === undefined || raw.trim() === '') return null;
  return raw;
}

export const openaiDomain = new Hono<HonoEnv>();

openaiDomain.get(OPENAI_APPS_CHALLENGE_PATH, (c) => {
  const token = configuredToken();
  if (token === null) {
    c.header('Cache-Control', 'no-store');
    return c.notFound();
  }
  return c.body(token, 200, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(token, 'utf8')),
  });
});

// Toute autre méthode : jamais une écriture acceptée, jamais le jeton renvoyé.
// Variable absente, la route n'existe pas (404) ; présente, c'est un 405 qui
// dit ce qui est permis. `OPTIONS` ne passe jamais ici : le CORS global le
// répond avant le routeur.
openaiDomain.all(OPENAI_APPS_CHALLENGE_PATH, (c) => {
  c.header('Cache-Control', 'no-store');
  if (configuredToken() === null) return c.notFound();
  c.header('Allow', 'GET, HEAD');
  return c.json({ error: 'method_not_allowed', allow: ['GET', 'HEAD'] }, 405);
});
