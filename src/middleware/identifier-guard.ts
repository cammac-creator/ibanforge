/**
 * Gardes de format des deux identifiants d'entrée — et le comptage des rejets.
 *
 * Pourquoi ces gardes vivent dans un middleware et pas seulement dans les
 * routes : montées dans src/app.ts, elles répondent 400 sans appeler `next()`.
 * Le handler de route n'est donc jamais atteint pour une entrée rejetée, et les
 * gardes des routes sont, dans l'app montée, du code mort. C'est ici, et nulle
 * part ailleurs, que naissent les 400 de format servis en production.
 *
 * ⚠️ CORRECTION (25/08/2026) — ce commentaire affirmait que les gardes
 * s'exécutent « AVANT le middleware x402 (volontaire — on ne facture pas une
 * entrée malformée) ». C'est FAUX depuis piste A (18/08) : `src/app.ts` les
 * monte APRÈS x402, délibérément, et le dit dans son propre commentaire
 * (lignes ~564-575). Conséquence mesurée sur l'app réelle le 25/08 :
 *
 *   - sonde ANONYME sur `/v1/bic/{code}` ou `%7Bcode%7D` → 402 avec `accepts`,
 *     jamais 400 : elle n'atteint JAMAIS ces gardes ;
 *   - appelant AUTHENTIFIÉ (clé ifk_ ou paiement) → franchit x402, atteint la
 *     garde, reçoit le 400 ci-dessous.
 *
 * Les 400 `placeholder_literal` ne sont donc PAS ce que voient les annuaires —
 * ils ne concernent qu'un appelant déjà passé la porte. Ne pas « corriger » ce
 * fichier pour rendre 402 aux gabarits : c'est déjà le comportement servi, et
 * le faire ici le retirerait au seul appelant à qui le 400 est utile.
 * Contrat verrouillé dans `src/app.test.ts` §3, contre l'app réelle.
 *
 * On ne facture toujours pas une entrée malformée : @x402/hono ne règle jamais
 * un statut >= 400 (settle-after-2xx), donc le 400 rendu ici n'est pas encaissé.
 *
 * D'où l'extraction : ces compteurs sont les seuls qui se déclenchent vraiment,
 * et `recordRejection` avale ses erreurs. Laissés inline dans un index.ts que
 * `serve()` rend inimportable, ils n'avaient aucune couverture automatisée — le
 * mode de panne était : suite verte, deploy propre, zéro ligne après sept
 * jours, découvert au dépouillement.
 *
 * ⚠️ Les routes portent le MÊME comptage (cas où elles sont montées seules).
 * Les deux copies s'excluent mutuellement — si le middleware répond 400, la
 * route n'est pas atteinte ; s'il appelle `next()`, le classifieur rend `null`
 * dans la route et rien n'est enregistré. Un rejet n'est jamais compté deux
 * fois. Toute modification doit préserver cette exclusion.
 *
 * Phase 1 : on compte, on ne change aucun comportement. Les statuts et les
 * corps de réponse ci-dessous sont ceux d'avant l'instrumentation, au caractère
 * près.
 *
 * 📎 `c.get('apiKeyPrefix')` est LISIBLE ici, et c'est un fait d'ordre de
 * montage : `src/app.ts` pose `app.use('/v1/*', apiKeyMiddleware())` AVANT les
 * `app.get` qui montent ces gardes, donc l'attribution de la clé a déjà eu lieu
 * quand une garde répond 400. Déplacer ces gardes au-dessus du middleware de
 * clé rendrait silencieusement tous les rejets anonymes.
 */

import type { MiddlewareHandler } from 'hono';
import { classifyBicInput, classifyIidInput } from '../lib/input-normalize.js';
import { recordRejection } from '../lib/stats.js';
import type { HonoEnv } from '../types.js';

// Les chemins sont dans le TYPE, pas seulement dans src/index.ts : c'est ce qui
// fait que `c.req.param('code')` est un `string` et non `string | undefined`
// (Hono déduit le paramètre du motif).
//
// ⚠️ Ce type ne protège PAS du montage sur un mauvais chemin : vérifié par
// compilation hors-arbre, `app.get('/v1/wrong/:other', bicGuardMiddleware())`
// compile sans erreur — la surcharge permissive de `get` avale l'écart de
// chemin. Le seul garant que la garde tourne au bon endroit est son montage
// dans src/index.ts. Ne pas lire ce type comme un filet de sécurité.
type BIC_PATH = '/v1/bic/:code';
type IID_PATH = '/v1/ch/clearing/:iid';

/**
 * Garde de `GET /v1/bic/:code` — 8 ou 11 alphanumériques.
 *
 * `classifyBicInput` rend `null` EXACTEMENT sur l'ensemble que l'ancienne
 * regex acceptait : la substitution ne déplace pas la frontière du 400.
 */
export function bicGuardMiddleware(): MiddlewareHandler<HonoEnv, BIC_PATH> {
  return async (c, next) => {
    const code = c.req.param('code');
    const rejection = classifyBicInput(code);

    // Agents sometimes call the OpenAPI template path literally (e.g.
    // `/v1/bic/{code}` decoded to `{code}`). Catch this with a dedicated
    // message instead of the generic format error, so the agent can
    // self-correct.
    if (rejection === 'placeholder_literal') {
      recordRejection('bic_lookup', rejection, c.get('apiKeyPrefix'));
      return c.json(
        {
          error: 'placeholder_literal',
          message:
            "You sent the literal OpenAPI placeholder '" +
            code +
            "'. Substitute it with a real BIC.",
          example: 'GET /v1/bic/UBSWCHZH',
          schema: 'https://api.ibanforge.com/openapi.json',
        },
        400,
      );
    }

    if (rejection !== null) {
      recordRejection('bic_lookup', rejection, c.get('apiKeyPrefix'));
      return c.json(
        {
          error: 'invalid_bic_format',
          message: 'BIC code must be 8 or 11 alphanumeric characters',
        },
        400,
      );
    }

    await next();
  };
}

/** Garde de `GET /v1/ch/clearing/:iid` — 1 à 5 chiffres. Même contrat. */
export function iidGuardMiddleware(): MiddlewareHandler<HonoEnv, IID_PATH> {
  return async (c, next) => {
    const iid = c.req.param('iid');
    const rejection = classifyIidInput(iid);

    if (rejection === 'placeholder_literal') {
      recordRejection('ch_clearing_lookup', rejection, c.get('apiKeyPrefix'));
      return c.json(
        {
          error: 'placeholder_literal',
          message:
            "You sent the literal OpenAPI placeholder '" +
            iid +
            "'. Substitute it with a real Swiss IID.",
          example: 'GET /v1/ch/clearing/230',
          schema: 'https://api.ibanforge.com/openapi.json',
        },
        400,
      );
    }

    if (rejection !== null) {
      recordRejection('ch_clearing_lookup', rejection, c.get('apiKeyPrefix'));
      return c.json(
        { error: 'invalid_iid_format', message: 'IID must be a 1-5 digit number.' },
        400,
      );
    }

    await next();
  };
}
