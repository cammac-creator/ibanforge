/**
 * The first successful call, written once and pasted everywhere a key arrives.
 *
 * WHY THIS MODULE EXISTS (funnel audit, 2026-08-29): the wall is neither price
 * nor technique. Most keys never carry a single call, and paying accounts are
 * drawn from those that had already succeeded at a call BEFORE paying. So the
 * moment a key is handed over is the moment to hand over the working command
 * with it, not a link to a documentation page where the reader still has to
 * assemble one.
 *
 * Everything here is pure so the wording can be asserted under `npm run check`
 * (the precedent is buildQuotaWarningEmail in ./email.ts). Delivery lives in
 * ./email.ts and goes through the single existing channel, the HTTPS relay in
 * ./mail-transport.ts.
 *
 * Two typographic rules apply to every string below and are covered by tests:
 * no em or en dash (they render as mojibake in several mail clients and read as
 * marketing polish), and the curl must stay copy-pasteable as one shell command.
 */

/**
 * A German IBAN that is valid, famous, and resolvable in our own database (its
 * BIC is COBADEFFXXX). Using a live-resolving IBAN matters: the reader's first
 * response then contains real enrichment, not just `"valid": true`, which is
 * what makes the 30 seconds feel worth it.
 */
export const FIRST_CALL_IBAN = 'DE89370400440532013000';

export const FIRST_CALL_ENDPOINT = 'https://api.ibanforge.com/v1/iban/validate';

export const ACCOUNT_PAGE = 'https://ibanforge.com/en/account';

/**
 * What we print in the Authorization header when we do NOT hold the raw key.
 *
 * Free keys are stored hashed and nothing else (see generateApiKey in
 * ./api-keys.ts): only the Stripe and x402 rails keep a raw key, and only until
 * it is fetched once. So a message sent days after a signup can identify the
 * key by its prefix but can never reprint it, and saying so plainly beats
 * printing something that looks like a key and is not.
 */
export const KEY_PLACEHOLDER = 'YOUR_API_KEY';

export interface FirstCallBlock {
  /** Raw key when we hold it, KEY_PLACEHOLDER when we do not. */
  bearer: string;
  /**
   * Set only when `bearer` is the placeholder: the 12-character prefix that
   * lets the reader recognise which of their keys we mean.
   */
  keyPrefix?: string;
}

/** The command itself, as one copy-pasteable shell block. */
export function buildFirstCallCurl(bearer: string): string {
  return (
    `curl -X POST ${FIRST_CALL_ENDPOINT} \\\n` +
    `  -H "Authorization: Bearer ${bearer}" \\\n` +
    `  -H "content-type: application/json" \\\n` +
    `  -d '{"iban":"${FIRST_CALL_IBAN}"}'`
  );
}

/**
 * The expected answer, deliberately two lines: enough to tell success from
 * failure at a glance, short enough that nobody skips it. The keys named here
 * are asserted by the route's own test suite (`valid`, `country.code`), so this
 * promise cannot drift away from the response without a test turning red.
 */
export const FIRST_CALL_EXPECTED_LINE_1 =
  'Expected: HTTP 200 with "valid": true, "country": {"code": "DE"} and the bank behind that IBAN.';
// Wording kept medium-neutral on purpose: this exact line is also printed on
// the Stripe success page, where "reply to this mail" would make no sense.
export const FIRST_CALL_EXPECTED_LINE_2 =
  'Anything else means the key or a header did not arrive as sent, and support@ibanforge.com will look at it with you.';

/** Plain-text block, for the text/plain part of every message. */
export function buildFirstCallText(block: FirstCallBlock): string {
  const hint =
    block.bearer === KEY_PLACEHOLDER && block.keyPrefix
      ? `${KEY_PLACEHOLDER} is the key that starts with ${block.keyPrefix}. ` +
        'We store only its hash, so we cannot print it back to you. Lost it? Reply and we reissue one.\n\n'
      : '';
  return (
    `Your first successful call in 30 seconds\n\n` +
    `${buildFirstCallCurl(block.bearer)
      .split('\n')
      .map((l) => `  ${l}`)
      .join('\n')}\n\n` +
    hint +
    `${FIRST_CALL_EXPECTED_LINE_1}\n` +
    `${FIRST_CALL_EXPECTED_LINE_2}\n\n` +
    `Everything this key does, on one page: ${ACCOUNT_PAGE}\n`
  );
}

/** Escapes the five characters that would break out of an HTML text node. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** HTML block, styled like the rest of the transactional mail. */
export function buildFirstCallHtml(block: FirstCallBlock): string {
  const hint =
    block.bearer === KEY_PLACEHOLDER && block.keyPrefix
      ? `<p style="color:#71717a;font-size:12px;margin:0 0 14px">${escapeHtml(KEY_PLACEHOLDER)} is the key that starts with <code style="color:#fafafa">${escapeHtml(block.keyPrefix)}</code>. We store only its hash, so we cannot print it back to you. Lost it? Reply and we reissue one.</p>`
      : '';
  return (
    `<div style="font-size:13px;color:#a1a1aa;margin:0 0 6px">Your first successful call in 30 seconds</div>` +
    `<pre style="background:#09090b;border:1px solid #1c1c22;border-radius:10px;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#d6d3cc;white-space:pre-wrap;overflow-x:auto;margin:0 0 12px">${escapeHtml(buildFirstCallCurl(block.bearer))}</pre>` +
    hint +
    `<p style="color:#a1a1aa;font-size:13px;margin:0 0 4px">${escapeHtml(FIRST_CALL_EXPECTED_LINE_1)}</p>` +
    `<p style="color:#71717a;font-size:12px;margin:0 0 18px">${escapeHtml(FIRST_CALL_EXPECTED_LINE_2)}</p>` +
    `<p style="font-size:14px;margin:0 0 22px"><a href="${ACCOUNT_PAGE}" style="color:#fbbf24;text-decoration:none">Everything this key does, on one page &rarr;</a></p>`
  );
}
