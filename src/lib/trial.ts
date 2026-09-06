/**
 * The keyless REST trial, in figures and in words. Decided 06/09/2026.
 *
 * Ten validations a day per address on POST /v1/iban/validate, no key, no
 * wallet — the exact parity of the MCP taster (`MCP_DAILY_LIMIT`), because a
 * developer's first contact is a terminal and an agent's first contact is a
 * tool call, and only one of the two used to get an answer. The middleware that
 * enforces it is src/middleware/anonymous-trial.ts.
 *
 * A LEAF module on purpose: the /v1 text, the `.well-known/rate-limits.yml`
 * artifact and the validate handler all quote these, and none of them should
 * have to import the payment middleware to read a number. Same reason
 * `payment-links.ts` exists.
 */

/** Calls served per address per UTC day. A taster, not a tier. */
export const REST_TRIAL_DAILY_LIMIT = 10;

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
 * 🚨 `you@company.com`, never `you@example.com`: `example.com` is on our own
 * disposable blocklist, so the address we would be telling the reader to send
 * is the one the signup route answers `400 disposable_email` to. That exact
 * mistake shipped on eight surfaces at once in August 2026;
 * src/routes/example-emails.test.ts now drives the real route with every
 * address published anywhere in the repository.
 */
export const TRIAL_FREE_KEY_HINT =
  `POST https://api.ibanforge.com/v1/keys/generate with {"email":"you@company.com","source":"${TRIAL_SIGNUP_SOURCE}"}` +
  ' — 200 requests a month, no card';

/** Where the free key is explained. The page is content/<lang>/docs/api-keys.mdx. */
export const TRIAL_DOCS_URL = `https://ibanforge.com/docs/api-keys?src=${TRIAL_SIGNUP_SOURCE}`;
