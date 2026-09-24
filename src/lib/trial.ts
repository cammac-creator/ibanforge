/**
 * The keyless REST trial, in figures and in words. Decided 06/09/2026, raised
 * from ten to twenty-five on 15/09/2026, and counted by the WEEK since
 * 24/09/2026 (Claude-Alain's decision: twenty-five a day was too much).
 *
 * Twenty-five validations a week per SOURCE on POST /v1/iban/validate, no key,
 * no wallet. The week is the ISO calendar week in UTC: it starts on Monday at
 * 00:00 UTC and resets then, for everyone at once. A sliding window would be
 * fairer by a few hours and impossible to state in one line; a caller must be
 * able to read when the allowance comes back. The middleware that enforces it
 * is src/middleware/anonymous-trial.ts, the counter is `trial_weekly`
 * (src/lib/daily-ip-ledger.ts).
 *
 * 🚨 Only this door changed. The key that needs no e-mail stays at its monthly
 * allowance (src/lib/tiers.ts) and the MCP taster at its daily one
 * (src/lib/mcp-limits.ts).
 *
 * 🚨 The figure is no longer the MCP taster's. It used to be, and that parity
 * was the whole justification — the ten had been copied from `MCP_DAILY_LIMIT`
 * because a number was needed, not because anything had been measured. Two
 * reasons to break it, both about price rather than symmetry: this trial opens
 * ONE route at $0.005, while the MCP taster hands out every data tool, up to a
 * $0.02 compliance screening; and the friction is on this side, where a
 * developer pasting the curl examples from the documentation burns several
 * calls before reading a single answer. So REST was 25 and MCP stayed 10 a day.
 * Since 24/09/2026 the REST figure is counted by the week while MCP stays
 * daily: the two doors are not compared by their number any more, and no text
 * should call either one "the smaller".
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

/** Calls served per source per ISO week (Monday 00:00 UTC). A taster, not a tier. */
export const REST_TRIAL_WEEKLY_LIMIT = 25;

/** What the trial is counted by, as served in the `trial` block and the headers. */
export const TRIAL_PERIOD = 'week';

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

/**
 * Hard ceiling of `trial_weekly` rows in the current week, for the same reason
 * and with the same figure as the daily one. The weekly rows all expire at
 * once, on Monday: one tick of the purge (5 000 × 40) must be able to drain a
 * full week, so this ceiling cannot be larger than the daily one.
 */
export const TRIAL_WEEKLY_MAX_ROWS = TRIAL_LEDGER_MAX_ROWS_PER_DAY;

/** When the allowance comes back, in words. UTC because the ledger's week is UTC. */
export const TRIAL_RESET = 'Monday 00:00 UTC';

/**
 * The Monday that opens the ISO week of `now`, as `YYYY-MM-DD`, in UTC.
 *
 * 🚨 `getUTCDay()`, never `getDay()`: the second reads the machine's time zone,
 * and on a Mac in Zurich Sunday 23:30 UTC is already Monday. The week key is a
 * DATE rather than `2026-W39` on purpose: the ISO year differs from the
 * calendar year around 1 January, and a date compares and purges as text.
 */
export function trialWeekStart(now: Date = new Date()): string {
  const sinceMonday = (now.getUTCDay() + 6) % 7;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - sinceMonday),
  );
  return monday.toISOString().slice(0, 10);
}

/** The instant the allowance comes back: next Monday 00:00:00 UTC, as ISO 8601. */
export function trialResetsAt(now: Date = new Date()): string {
  const monday = new Date(`${trialWeekStart(now)}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return monday.toISOString().replace('.000Z', 'Z');
}

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
 * 🚨 Et les deux 25 n'ont RIEN à voir : 25 par semaine pour l'essai, sur cette
 * seule route ; 25 par mois pour la clé, sur tous les endpoints. Jusqu'au
 * 24/09/2026 cette phrase les opposait (« these 25 are a DAY »), et une phrase
 * qui met les deux face à face se lit « la clé vaut moins que pas de clé »
 * (seconde analyse des réponses d'IA). Le plafond de l'essai n'y figure donc
 * plus : il est servi juste à côté, dans `weekly_limit`. La clé s'annonce par sa
 * destination, les 200 une fois réclamée, et le 25 par mois vient ensuite comme
 * point de départ. Réclamer, c'est un code reçu à une adresse lue (ou un
 * paiement x402), pas un simple appel : la phrase le dit.
 *
 * Pas de point final : le middleware de l'essai enchâsse cette phrase dans la
 * sienne et y ajoute le point (`anonymous-trial.ts`), qui sortait doublé.
 */
export const TRIAL_FREE_KEY_HINT =
  `POST https://api.ibanforge.com/v1/keys/generate with {"source":"${TRIAL_SIGNUP_SOURCE}"}` +
  ' — no e-mail, no card, nothing to confirm: it returns an ifk_ key that works on every endpoint, ' +
  `good for ${FREE_TIER_MONTHLY_LIMIT} requests a month once claimed (POST /v1/keys/claim, key in the ` +
  'Authorization header, with a code mailed to an address you read). ' +
  `Unclaimed, the key starts at ${ANONYMOUS_MONTHLY_LIMIT} requests a month`;

/** Where the free key is explained. The page is content/<lang>/docs/api-keys.mdx. */
export const TRIAL_DOCS_URL = `https://ibanforge.com/docs/api-keys?src=${TRIAL_SIGNUP_SOURCE}`;
