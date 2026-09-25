import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import { extractKey } from './api-key.js';
import { isSellingRoute } from './x402.js';
import { getIban } from '../lib/request-helpers.js';
import {
  countDailyUnits,
  countWeeklyTrialUnits,
  refundWeeklyTrialUnits,
} from '../lib/daily-ip-ledger.js';
import { extractClientIp } from '../lib/stats.js';
import { ledgerBucket } from '../lib/ledger-bucket.js';
import { recordServerEvent } from '../lib/web-events.js';
import { recordSafely } from '../lib/record-safely.js';
import {
  REST_TRIAL_WEEKLY_LIMIT,
  TRIAL_FREE_KEY_HINT,
  TRIAL_PERIOD,
  TRIAL_RESET,
  trialResetsAt,
} from '../lib/trial.js';

/**
 * Twenty-five keyless validations a WEEK, per SOURCE, on POST /v1/iban/validate.
 *
 * Decided 06/09/2026 at ten a day, raised to twenty-five a day on 15/09/2026,
 * and counted by the ISO week in UTC since 24/09/2026 (Claude-Alain: twenty-five
 * a day was too much). The week opens on Monday at 00:00 UTC. The HTTP MCP
 * transport has served a taster since July — no key, no wallet — and it
 * converts, while the REST door had no equivalent: a developer's first contact
 * with IBANforge is a terminal, they paste the curl from the docs, and they met
 * a 402 before ever seeing a response body.
 *
 * 🚨 Parity is in the INVITATION, not in the figure: this door opens one route
 * at $0.005, the MCP taster opens every data tool up to a $0.02 compliance
 * screening. The ten here had once been copied from the MCP allowance because a
 * number was needed. Since the evening of 24/09/2026 both doors are 25 a week
 * per source, by decision, and they remain two separate allowances.
 *
 * It is a taster, not a tier. Twenty-five calls a week is enough to decide
 * whether the enrichment is worth a key and far too few to run anything on, and
 * the response says so on every single call.
 *
 * The count is kept in the service database, so it survives a redeploy, and the
 * bucket is a normalised, hashed SOURCE — never an address.
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
 * The ledger key for one SOURCE's REST allowance.
 *
 * Namespaced away from the MCP entries (`<h>` for tool calls, `init:<h>` for
 * sessions) so an agent that used its MCP allowance still gets its REST one:
 * they are two doors onto the same product and a developer comparing them must
 * not find the second one already shut.
 *
 * The bucket itself — /64 collapse, then salted hash, with the `unknown`
 * fallback — lives in `src/lib/ledger-bucket.ts`, shared with the MCP door.
 * One implementation, because leaving one of the two doors unguarded is enough
 * to reopen the hole.
 */
function ledgerKey(ip: string): string {
  return ledgerBucket(ip, 'rest:');
}

/**
 * An IPv6 in text is at most 45 characters; past that it is not an address.
 *
 * ⚠️ This is not the protection — the protection is the hashing plus the row
 * ceiling in the ledger. Since every bucket is hashed, an absurd header can no
 * longer become an arbitrary durable primary key; all this motif still buys is
 * that such a header does not consume a row. A rejected shape falls back onto
 * the shared `unknown` bucket, which stays in memory.
 */
const IP_SHAPE = /^[0-9a-fA-F:.%[\]]{3,45}$/;

/**
 * The address, or one shared bucket for everyone we cannot place.
 *
 * `extractClientIp` reads the LAST X-Forwarded-For segment (the one the trusted
 * proxy appends), never the first, which the caller chooses — otherwise the
 * allowance is bypassed by rotating a header. When there is no address at all
 * we fail CLOSED onto a single `unknown` bucket: the deliberate opposite of the
 * signup guard in api-keys.ts, which fails open. Refusing a signup costs a
 * customer; refusing a twenty-sixth free validation costs a curl that gets the
 * same 402 it got last week.
 *
 * The raw address is returned here, not the bucket: the telemetry dedup keys
 * (`evt:*`) are memory-only and keep the address in clear on purpose — hashing
 * them would cost a SHA-256 per request for nothing. The /64 collapse and the
 * hashing happen in `ledgerKey`.
 */
function trialIp(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string {
  const ip = extractClientIp({
    'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
    'x-real-ip': c.req.header('x-real-ip') ?? null,
  });
  if (!ip || !IP_SHAPE.test(ip)) return 'unknown';
  return ip;
}

/**
 * The ceiling actually applied to this call.
 *
 * 🚨 Point d'accroche du lot 5, et il est nommé exprès. Tant que le disjoncteur
 * n'existe pas, la limite effective EST la limite documentée. Le lot 5 branche
 * ici, et ici seulement, la réduction temporaire sous alerte — à trois
 * conditions déjà écrites : la lecture de l'état d'alerte se fait dans ce
 * middleware et jamais dans le registre (qui reste un compteur pur), le
 * prédicat est l'alerte DÉCLENCHÉE PAR L'ESSAI et jamais une alerte de créations
 * de clés (sinon n'importe qui éteint la vitrine sans y gagner une unité), et
 * tout ce qui est publié — `quota.limit`, `X-Trial-Limit`, le bloc `trial` —
 * cite la limite effective et non la documentée.
 */
function effectiveTrialLimit(): number {
  return REST_TRIAL_WEEKLY_LIMIT;
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
    const limit = effectiveTrialLimit();
    // One instant for the whole call: the week that counts it and the reset it
    // announces must be the same week, even on Sunday at 23:59:59.
    const now = new Date();
    const resetsAt = trialResetsAt(now);
    const spent = countWeeklyTrialUnits(key, 1, limit, now);

    if (spent.degraded) {
      // La base du service ne répond pas. Le plafond n'est pas atteint : il
      // n'est pas mesurable. Dire « vous avez épuisé vos 25 appels » avec un
      // compte fabriqué ferait mentir la réponse et rendrait l'incident
      // illisible dans les journaux, alors que la documentation continue
      // d'annoncer les 25 premiers appels servis. On pose donc une cause
      // distincte et on laisse passer vers le 402 x402 standard : aucun
      // message ne mente, aucun 500, et l'incident se lit de l'extérieur.
      //
      // Pas de bloc `quota` (il n'y a aucun compte à citer) et pas d'en-tête
      // `X-Trial-*` : on sort avant de les poser.
      c.set('paywallCause', {
        reason: 'trial_unavailable',
        detail:
          'The keyless allowance is temporarily unavailable, so this call falls back to payment. ' +
          `Nothing is wrong with your request. A free key still works: ${TRIAL_FREE_KEY_HINT}. ` +
          'Or settle this 402 with x402 — no account needed.',
      });
      await next();
      return;
    }

    if (!spent.allowed) {
      // Fall THROUGH to x402 rather than answering here: the 402 an agent gets
      // must stay the machine-readable payment envelope, with the reason
      // travelling inside it (enrich-402 reads `paywallCause`). Answering a
      // bespoke 429 would break every x402 client on the one route they use
      // most.
      // ⚠️ « this address gets this week », jamais « you have used » : depuis le
      // portage, un redéploiement ne remet plus le compteur à zéro, un pool
      // résidentiel peut pré-brûler le seau d'un développeur honnête, et le
      // seau est désormais un PRÉFIXE, donc plusieurs abonnés d'un même /64
      // partagent une franchise. Le message ne suppose jamais que l'appelant
      // est celui qui a dépensé. Ne pas remplacer par « your network », qui
      // inviterait à débattre du périmètre.
      c.set('paywallCause', {
        reason: 'trial_exhausted',
        detail:
          `This address has used the ${limit} keyless validations it gets this week ` +
          `(${spent.used} calls served); the allowance comes back on ${TRIAL_RESET} (${resetsAt}). ` +
          `To keep going now, take a free key: ${TRIAL_FREE_KEY_HINT}. ` +
          'Prefer to pay per call? Settle this 402 with x402 — no account needed.',
        quota: {
          used: spent.used,
          limit,
          month: TRIAL_PERIOD,
          resets: `${TRIAL_RESET} (${resetsAt})`,
          required: 1,
          remaining: 0,
        },
      });
      // "A source hit the ceiling", once per source and per WEEK: written on the
      // call that crosses it, and on no other.
      //
      // 🚨 Until 24/09/2026 this was deduplicated per address and per DAY, which
      // was right while the allowance was daily. Once the refusal lasts until
      // Monday, a source that comes back every day would have written one
      // "exhausted" a day with no "tried" beside it (a refused call is not
      // served), and the doors card would show more sources that ran out than
      // sources that tried. `spent.used` is the week's count, including this
      // call: it equals limit + 1 exactly once per source and per week. It keeps
      // growing in memory on the refusals that follow, and after a redeploy the
      // next write in the database lands at limit + 2, so the event is not
      // written again.
      //
      // ⚠️ Reserve for lot 5: if the effective limit is lowered during a week, a
      // source already above the new limit will not cross it and writes no
      // event. Decide it when the breaker is wired, not here.
      //
      // ⚠️ Reserve on the memory path: a source counted in memory rather than
      // in `trial_weekly` (the shared `unknown` bucket, or a new source while
      // the week's table is full) starts again from zero after a restart. It is
      // served 25 more calls, and crosses the ceiling, and writes this event,
      // once more. Only the database path is restart-proof.
      if (spent.used === limit + 1) {
        recordSafely(() => recordServerEvent('api:trial-exhausted'), 'web_event');
      }
      await next();
      return;
    }

    c.set('anonymousTrial', {
      used: spent.used,
      limit,
      remaining: spent.remaining,
      resetsAt,
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
      refundWeeklyTrialUnits(key, 1);
      used = Math.max(spent.used - 1, 0);
    }

    // Set after the refund, for the reason `setQuotaHeaders` documents: a
    // header published before it would advertise a slot that was handed back.
    // The `trial` block in the body is built by the handler and therefore
    // pre-refund; on a 4xx there is no such block to disagree with, because the
    // handler that would have written it is the one that refused.
    // Counts of the WEEK, and the instant it resets (ISO 8601, next Monday
    // 00:00 UTC): a header that said "midnight UTC" would send a script to
    // retry the next day into the same refusal.
    c.header('X-Trial-Used', String(used));
    c.header('X-Trial-Limit', String(limit));
    c.header('X-Trial-Remaining', String(Math.max(limit - used, 0)));
    c.header('X-Trial-Period', TRIAL_PERIOD);
    c.header('X-Trial-Reset', resetsAt);
  };
}
