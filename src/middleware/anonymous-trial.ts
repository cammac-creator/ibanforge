import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { extractKey } from './api-key.js';
import { isSellingRoute } from './x402.js';
import { getIban } from '../lib/request-helpers.js';
import { countDailyUnits, refundDailyUnits } from '../lib/daily-ip-ledger.js';
import { extractClientIp } from '../lib/stats.js';
import { recordServerEvent } from '../lib/web-events.js';
import { recordSafely } from '../lib/record-safely.js';
import { REST_TRIAL_DAILY_LIMIT, TRIAL_FREE_KEY_HINT, TRIAL_RESET } from '../lib/trial.js';

/**
 * Ten keyless validations a day, per address, on POST /v1/iban/validate.
 *
 * Decided 06/09/2026. The HTTP MCP transport has served a taster since July —
 * ten tool calls a day per address, no key, no wallet — and it converts, while
 * the REST door had no equivalent: a developer's first contact with IBANforge
 * is a terminal, they paste the curl from the docs, and they met a 402 before
 * ever seeing a response body. Parity between the human and the agent: the
 * same allowance, the same ceiling, the same invitation in the answer.
 *
 * It is a taster, not a tier — the same doctrine `MCP_DAILY_LIMIT` carries. Ten
 * calls is enough to decide whether the enrichment is worth a key and far too
 * few to run anything on, and the response says so on every single call.
 *
 * ── What it must NOT do ─────────────────────────────────────────────────────
 *
 * 🚨 A body-less POST keeps its 402. The x402 scanners (x402scan, Decixa,
 * Bazaar) probe paid routes with `{}` and read the discovery envelope; the /v1
 * text promises them so in writing ("Pass {} as body on POSTs — it WILL return
 * 402, not 400"), and an indexer that gets anything else marks the endpoint
 * `non_402_response` and drops the listing. So the trial is granted only when
 * the body carries a real `iban` — which is also exactly the request a human
 * evaluating the service sends, and never the one a scanner sends.
 *
 * A PRESENTED key — valid or not — also skips the trial. A typo'd `ifk_…` must
 * keep the `invalid_api_key` 402 the api-key middleware set for it, or the
 * developer whose key is truncated gets ten mysterious successes and then a
 * wall, with nothing anywhere saying their key was never read.
 *
 * The figures and the wording it quotes live in src/lib/trial.ts, so the /v1
 * text, the rate-limits artifact and the docs read the same numbers this
 * enforces rather than a retyped copy of them.
 */

/** The one route the trial opens. Kept to a literal on purpose: widening it is a pricing decision. */
const TRIAL_METHOD = 'POST';
const TRIAL_PATH = '/v1/iban/validate';

/**
 * The ledger key for one address's REST allowance.
 *
 * Namespaced away from the MCP entries (`<ip>` for tool calls, `init:<ip>` for
 * sessions) so an agent that used its ten MCP calls still gets its ten REST
 * ones: they are two doors onto the same product and a developer comparing
 * them must not find the second one already shut.
 */
function ledgerKey(ip: string): string {
  return `rest:${ip}`;
}

/**
 * The address, or one shared bucket for everyone we cannot place.
 *
 * `extractClientIp` reads the LAST X-Forwarded-For segment (the one the trusted
 * proxy appends), never the first, which the caller chooses — otherwise the
 * allowance is bypassed by rotating a header. When there is no address at all
 * we fail CLOSED onto a single `unknown` bucket: the deliberate opposite of the
 * signup guard in api-keys.ts, which fails open. Refusing a signup costs a
 * customer; refusing an eleventh free validation costs a curl that gets the
 * same 402 it got last week.
 */
function trialIp(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string {
  return (
    extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
      'x-real-ip': c.req.header('x-real-ip') ?? null,
    }) ?? 'unknown'
  );
}

export function anonymousTrialMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (c.req.method !== TRIAL_METHOD || path !== TRIAL_PATH) {
      await next();
      return;
    }

    // Defence in depth. The route above sells nothing today, so this can never
    // fire; it stays because the security audit of 25/07/2026 (finding 1) was
    // about exactly this shape — an allowance that becomes a way to ACQUIRE an
    // allowance — and the guard has to be in the code that grants, not in the
    // memory of whoever last edited the route table.
    if (isSellingRoute(c.req.method, path)) {
      await next();
      return;
    }

    // A key was presented: valid → already authenticated upstream, invalid →
    // owed its own 402. Either way this middleware has no business here.
    if (extractKey(c) !== null) {
      await next();
      return;
    }

    // A payer is a payer. Both dialects: `x-payment` is v1, `payment-signature`
    // is v2 and is what every current client sends.
    if (c.req.header('payment-signature') ?? c.req.header('x-payment')) {
      await next();
      return;
    }

    // The scanner gate. Hono caches the parsed body, so reading it here costs
    // the handler nothing — `billableUnits` in api-key.ts does the same.
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    const iban = getIban(body);
    if (typeof iban !== 'string' || iban.trim() === '') {
      await next();
      return;
    }

    const ip = trialIp(c);
    const key = ledgerKey(ip);
    const spent = countDailyUnits(key, 1, REST_TRIAL_DAILY_LIMIT);

    if (!spent.allowed) {
      // Fall THROUGH to x402 rather than answering here: the 402 an agent gets
      // must stay the machine-readable payment envelope, with the reason
      // travelling inside it (enrich-402 reads `paywallCause`). Answering a
      // bespoke 429 would break every x402 client on the one route they use
      // most.
      c.set('paywallCause', {
        reason: 'trial_exhausted',
        detail:
          `You used the ${REST_TRIAL_DAILY_LIMIT} keyless validations this address gets today ` +
          `(${spent.used} calls served); the allowance resets at ${TRIAL_RESET}. ` +
          `To keep going now, take a free key: ${TRIAL_FREE_KEY_HINT}. ` +
          'Prefer to pay per call? Settle this 402 with x402 — no account needed.',
        quota: {
          used: spent.used,
          limit: REST_TRIAL_DAILY_LIMIT,
          month: 'day',
          resets: TRIAL_RESET,
          required: 1,
          remaining: 0,
        },
      });
      // "A developer hit the ceiling", once per address per day. The second
      // refusal of the same day says nothing the first did not.
      if (countDailyUnits(`evt:trial-exhausted:${ip}`, 1, 1).allowed) {
        recordSafely(() => recordServerEvent('api:trial-exhausted'), 'web_event');
      }
      await next();
      return;
    }

    c.set('anonymousTrial', {
      used: spent.used,
      limit: REST_TRIAL_DAILY_LIMIT,
      remaining: spent.remaining,
    });
    // The attribution block the free tier carries applies here for the same
    // reason it applies to a free key: the results are being shown to someone,
    // and this caller has agreed to nothing at all.
    c.set('freeTier', true);

    // "A developer tried without a key", once per address per day — an
    // address-day, which is the unit the doors card counts and the only one
    // that cannot be inflated by a loop. The conversion is measured on the
    // other side: keys born with `source = 'api-trial'`.
    if (countDailyUnits(`evt:trial:${ip}`, 1, 1).allowed) {
      recordSafely(() => recordServerEvent('api:trial'), 'web_event');
    }

    await next();

    // Refund on a 4xx from the handler, the rule api-key.ts applies to a quota
    // slot: an allowance the caller got no answer out of is an allowance nobody
    // spent. 5xx is NOT refunded — a server fault must stay visible in the
    // counters rather than being papered over.
    //
    // Worth naming: an IBAN that parses but fails mod-97 comes back 200 with
    // `valid: false`, and DOES spend a call. That is the product working, and
    // it is the answer the caller asked for.
    let used = spent.used;
    if (c.res.status >= 400 && c.res.status < 500) {
      refundDailyUnits(key, 1);
      used = Math.max(spent.used - 1, 0);
    }

    // Set after the refund, for the reason `setQuotaHeaders` documents: a
    // header published before it would advertise a slot that was handed back.
    // The `trial` block in the body is built by the handler and therefore
    // pre-refund; on a 4xx there is no such block to disagree with, because the
    // handler that would have written it is the one that refused.
    c.header('X-Trial-Used', String(used));
    c.header('X-Trial-Limit', String(REST_TRIAL_DAILY_LIMIT));
    c.header('X-Trial-Remaining', String(Math.max(REST_TRIAL_DAILY_LIMIT - used, 0)));
    c.header('X-Trial-Reset', TRIAL_RESET);
  };
}
