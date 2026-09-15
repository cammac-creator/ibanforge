/**
 * The keyless REST trial, in figures and in words. Decided 06/09/2026, raised
 * from ten to twenty-five on 15/09/2026.
 *
 * Twenty-five validations a day per SOURCE on POST /v1/iban/validate, no key,
 * no wallet. The middleware that enforces it is
 * src/middleware/anonymous-trial.ts.
 *
 * 🚨 The figure is no longer the MCP taster's. It used to be, and that parity
 * was the whole justification — the ten had been copied from `MCP_DAILY_LIMIT`
 * because a number was needed, not because anything had been measured. Two
 * reasons to break it, both about price rather than symmetry: this trial opens
 * ONE route at $0.005, while the MCP taster hands out every data tool, up to a
 * $0.02 compliance screening; and the friction is on this side, where a
 * developer pasting the curl examples from the documentation burns several
 * calls before reading a single answer. So REST is 25 and MCP stays 10, and the
 * smaller MCP allowance is the deliberate one.
 *
 * "Per source", not "per address": the ledger bucket is the IPv6 /64 collapsed
 * and then salted-hashed, because an IPv6 subscriber is handed a whole prefix
 * and can pick a fresh address inside it for free.
 *
 * A LEAF module on purpose: the /v1 text, the `.well-known/rate-limits.yml`
 * artifact and the validate handler all quote these, and none of them should
 * have to import the payment middleware to read a number. Same reason
 * `payment-links.ts` exists.
 */

import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from './tiers.js';

/** Calls served per source per UTC day. A taster, not a tier. */
export const REST_TRIAL_DAILY_LIMIT = 25;

/**
 * Hard ceiling of `trial_ledger` rows on the current UTC day. Past it the
 * ledger stops INSERTING new buckets and counts them in memory instead, so the
 * size of the file that holds the API keys stops being the caller's choice.
 *
 * The figure is not arbitrary: the hourly purge deletes at most 5 000 rows per
 * statement and runs at most 40 passes per tick. A ceiling above what one tick
 * can drain would be a table that never empties.
 *
 * ⚠️ This bounds the DISK. The separate question — at what burst of distinct
 * sources the allowance should be temporarily reduced — is not decided here and
 * waits on a measured baseline (`trial_daily.peak_hour_buckets`).
 */
export const TRIAL_LEDGER_MAX_ROWS_PER_DAY = 200_000;

/** When the allowance comes back. UTC because the ledger's day is UTC. */
export const TRIAL_RESET = 'midnight UTC';

/**
 * The `source` a key born of the trial carries into `api_keys.source`.
 *
 * It is the whole conversion measurement: `channelOf`
 * (src/lib/signup-attribution.ts) turns it into the channel `src:api-trial`,
 * which is what the dashboard's doors card counts as "keys born of the trial".
 * ⚠️ `frontend/lib/dashboard-overview.ts` spells that channel out — it cannot
 * import from the API — so the two must move together.
 */
export const TRIAL_SIGNUP_SOURCE = 'api-trial';

/**
 * The one command that ends the trial in the caller's favour, copy-pasteable.
 *
 * Built from the constant above rather than typed out again: the token that
 * ties the two halves of the funnel together must exist once, or the day it
 * changes the hint keeps minting keys under the old label and the card reads
 * zero.
 *
 * 🚨 Plus aucune adresse depuis le 15/09/2026 : la voie sans e-mail existe, et
 * cette phrase est servie à quelqu'un qui n'a donné ni clé ni adresse. Elle
 * garde en revanche `{"source":"…"}`, et c'est la SEULE surface du produit qui
 * publie un corps : ce jeton EST la mesure de conversion (voir
 * `TRIAL_SIGNUP_SOURCE` ci-dessus), et un implémenteur qui « simplifierait »
 * vers le POST sans corps mettrait la carte des portes d'entrée du tableau de
 * bord à zéro pour toujours, sans faire rougir un test. Un garde l'épingle
 * (`src/routes/static-claims.test.ts`).
 *
 * 🚨 Et les deux 25 n'ont RIEN à voir : 25 par jour ici, sur cette seule
 * route ; 25 par mois pour la clé, sur tous les endpoints. Un développeur qui
 * lit les deux dans cet ordre conclut, avec raison sur les validations, que la
 * clé est trente fois pire que pas de clé. La clé n'achète pas du volume, elle
 * achète les endpoints que l'essai ne sert pas et la porte vers le palier
 * complet — donc l'unité et la portée sont écrites, toutes les deux.
 */
export const TRIAL_FREE_KEY_HINT =
  `POST https://api.ibanforge.com/v1/keys/generate with {"source":"${TRIAL_SIGNUP_SOURCE}"}` +
  ` — no e-mail, no card, nothing to confirm: an ifk_ key worth ${ANONYMOUS_MONTHLY_LIMIT} requests a MONTH, ` +
  `on every endpoint (these ${REST_TRIAL_DAILY_LIMIT} are a DAY, on this route only). ` +
  `One call at POST /v1/keys/claim, key in the Authorization header, raises the same key to ${FREE_TIER_MONTHLY_LIMIT} a month.`;

/** Where the free key is explained. The page is content/<lang>/docs/api-keys.mdx. */
export const TRIAL_DOCS_URL = `https://ibanforge.com/docs/api-keys?src=${TRIAL_SIGNUP_SOURCE}`;
