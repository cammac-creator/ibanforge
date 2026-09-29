/**
 * The call to action under the API's answer on the bank-code pages (29/09/2026).
 *
 * Most readers of /blz, /iid, /it and /sk are people looking up one code; a few
 * are developers or companies who would rather get that answer from their own
 * software. The page already printed the API's answer and then said nothing
 * about how to get it. The block (components/register-api-cta.tsx) names the two
 * doors that exist, as they exist: the keyless trial, shown as the exact command
 * with the page's own example IBAN, and the key, opened in the existing dialog.
 *
 * Its words live in `messages/*.json` under `registerCta`, so the guards that
 * read every text of the site (two 25s never in one sentence, no stale promise
 * beside the 200) read these too. The figures are the constants of the API,
 * checked by `register-cta.test.ts`.
 *
 * The key taken from this block is attributed to the door `site-register` by the
 * page path (lib/key-origin.ts): the dialog itself is not touched.
 *
 * Not on /at, /be or /sm: those registers may be served but not redistributed,
 * and their pages gain nothing new.
 */

/** The public API, as the documentation writes it: a command a reader copies must name the real host. */
export const PUBLIC_API = 'https://api.ibanforge.com';

/**
 * The click event, shared with the Austrian pilot of 15/09/2026: one series for
 * "try the API from a register page", the page path telling the pages apart.
 * Must match `^(nav|cta|film):[a-z0-9][a-z0-9-]{0,31}$` (src/lib/web-events.ts).
 */
export const REGISTER_CTA_EVENT = 'cta:try-api-register';

/** Where the two doors are explained in full. */
export const REGISTER_CTA_DOCS_PATH = '/docs/api-keys';

/**
 * The keyless trial, as a command: the only request the trial serves
 * (`POST /v1/iban/validate` with a real `iban` in the body; a body-less POST
 * keeps its 402), with the page's example IBAN. The IBAN is written compact, as
 * the page's API answer was produced from it.
 */
export function trialCurl(exampleIban: string): string {
  const iban = exampleIban.replace(/\s+/g, '').toUpperCase();
  return [
    `curl -X POST ${PUBLIC_API}/v1/iban/validate \\`,
    '  -H "Content-Type: application/json" \\',
    `  -d '{"iban":"${iban}"}'`,
  ].join('\n');
}
