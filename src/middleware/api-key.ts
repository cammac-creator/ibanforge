import type { MiddlewareHandler } from 'hono';
import type { HonoEnv } from '../types.js';
import {
  validateApiKey,
  checkAndIncrementQuota,
  chargeAllowanceThenCredits,
  decrementQuota,
  decrementCredits,
  refundCredit,
  refundMixed,
  recordMonthlyObservation,
  FREE_TIER_MONTHLY_LIMIT,
} from '../lib/api-keys.js';
import { getIbansArray } from '../lib/request-helpers.js';
import { CARD_CHECKOUT_HINT, topupHint, topupLink } from '../lib/payment-links.js';
import { ensureTopupRef } from '../lib/key-purchases.js';
import type { KeyTier } from '../lib/tiers.js';
import {
  crossesCreditsNotice,
  maybeSendCreditsWarning,
  maybeSendQuotaWarning,
} from '../lib/quota-notice.js';
import { burstRevocationFor } from '../lib/key-revocations.js';
import { CLAIM_MIN_PAID_USD } from '../lib/tiers.js';

/**
 * Ce que lit un agent dont la clé anonyme a été coupée par le radar de cohortes.
 *
 * 🚨 DEUX RÈGLES ONT ÉCRIT CE TEXTE, et elles valent pour toute retouche future.
 *
 * 1. Il ne dit RIEN de la facturation. Une version antérieure écrivait
 *    « Nothing was charged and nothing was kept ». Ce module ne sait pas ce qui
 *    a été facturé : le crochet de réclamation x402 avale son erreur par
 *    doctrine (un écrit de télémétrie ne doit jamais transformer un 200 payé en
 *    500), donc une clé qui a réellement réglé peut se retrouver sans
 *    réclamation enregistrée, être coupée, et lire une phrase fausse. Il dit ce
 *    qui a été fait de la CLÉ, jamais de l'argent. Aucun des mots `charged`,
 *    `refund` ou `billed` n'a sa place ici.
 *
 * 2. Il ne promet que ce qui est livré. La sortie qu'il donne EN PREMIER est la
 *    réclamation, qui rend la clé, parce qu'une version qui disait d'abord
 *    « reprends une clé neuve » envoyait la victime dans une boucle : la clé
 *    neuve meurt à la rafale suivante, qu'un attaquant relance toutes les cinq
 *    minutes. C'est aussi pourquoi la révocation automatique ne s'active pas
 *    tant que `/v1/keys/claim` n'accepte pas une clé coupée pour rafale.
 *
 * Aucun mot ne suppose que le lecteur est coupable, et il donne trois sorties :
 * récupérer sa clé, en prendre une neuve, ou payer à l'appel sans clé du tout.
 */
export const KEY_REVOKED_BURST_DETAIL =
  'This anonymous key was revoked: it was minted inside a burst of automated signups and cut with ' +
  'that burst. If this key was yours, claim it back in two steps: POST /v1/keys/claim with this key ' +
  'and an email address mails a 6-digit code, then the same call with that code returns the key to ' +
  `you, active, at ${FREE_TIER_MONTHLY_LIMIT} requests a month, out of reach of this sweep - even if it ` +
  'never served a call. Or take a fresh key - POST /v1/keys/generate needs no email address - or pay ' +
  'per call with x402, which needs no key at all.';

/**
 * Extract an IBANforge API key from common locations agents use:
 *   1. Authorization: Bearer ifk_xxx       (standard, recommended)
 *   2. X-API-Key: ifk_xxx                  (de-facto standard for many agents/SDKs)
 *   3. ?api_key=ifk_xxx                    (query param — last resort, used by curl/CLI examples)
 */
/**
 * Tell a successful caller where it stands.
 *
 * 🚨 These used to be set ONLY when a request was refused, so a client could
 * not see it approaching the wall — it learned at the moment it hit it. A
 * customer building a "warn me at N% of quota" guard had nothing to read, and
 * the 80% warning e-mail exists precisely because the response carried nothing.
 *
 * Set AFTER the handler runs, and after any 4xx refund, so the figure is the
 * balance the caller actually has left. Setting it before `next()` would
 * publish a slot that gets handed straight back.
 */
function setQuotaHeaders(
  c: Parameters<MiddlewareHandler<HonoEnv>>[0],
  q: { used: number; limit: number; month: string },
): void {
  c.header('X-Quota-Used', String(q.used));
  c.header('X-Quota-Limit', String(q.limit));
  c.header('X-Quota-Remaining', String(Math.max(q.limit - q.used, 0)));
  c.header('X-Quota-Month', q.month);
}

/**
 * Exported since 2026-09-06: the anonymous-trial middleware has to know whether
 * a key was PRESENTED, not whether one was valid — a typo'd key must keep its
 * `invalid_api_key` 402 instead of silently falling into the free trial. A
 * second copy of this reader would be a second place for the three accepted
 * locations to drift apart.
 */
export function extractKey(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): string | null {
  const auth = c.req.header('Authorization');
  if (auth?.startsWith('Bearer ifk_')) return auth.slice(7);
  if (auth?.startsWith('Bearer ')) {
    const v = auth.slice(7);
    if (v.startsWith('ifk_')) return v;
  }
  const xKey = c.req.header('X-API-Key') ?? c.req.header('x-api-key');
  if (xKey?.startsWith('ifk_')) return xKey;
  const queryKey = c.req.query('api_key');
  if (queryKey?.startsWith('ifk_')) return queryKey;
  return null;
}

/**
 * Routes documented as FREE that nevertheless live under `/v1/*`.
 *
 * They are mounted after this middleware, so presenting a key on one of them
 * used to debit the monthly allowance: six calls to `/v1/iban/format`,
 * `/v1/iban/structure`, `/v1/demo` and `/v1/ops/recent` with a fresh key took
 * `X-Quota-Used` from 0 to 6, while `/llms.txt` and `/v1` advertise all of them
 * as free (SEC-04, audit 2026-09-01). A developer who sets their key globally
 * in an HTTP client — the normal thing to do — was paying for the free tour.
 *
 * The exemption lives here rather than in the mount order on purpose: mounting
 * them before this middleware would also drop `apiKeyPrefix`, so the calls would
 * stop being attributed to their customer in the telemetry. Billing zero keeps
 * the attribution and removes the charge.
 */
const FREE_ROUTE_PREFIXES = [
  '/v1/iban/format',
  '/v1/iban/structure',
  '/v1/demo',
  '/v1/ops/recent',
  '/v1/reference/validate',
  '/v1/address/check',
  '/v1/test-iban',
  '/v1/audit',
  '/v1/ch/qr-bill',
  // Acheter un pack en présentant sa clé (lot B1, 25.09.2026) : la présenter
  // désigne la clé à recharger, elle ne doit pas coûter une unité. La garde du
  // rail x402 (`isSellingRoute`) exige toujours le paiement sur cette route :
  // une clé ne sert jamais à acquérir une allocation.
  '/v1/credits/buy',
];

function isFreeRoute(path: string): boolean {
  return FREE_ROUTE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * How many quota slots / credits this request bills.
 *
 * Batch validation bills 1 unit per IBAN — pricing parity with the x402
 * per-IBAN price ($0.002 × N). Before 2026-07-11 a whole batch billed a
 * single unit, so a 100-IBAN batch cost the same as one validation: a ~100×
 * underbilling on prepaid packs and the free tier. Every other endpoint
 * bills 1 unit per request — except the free ones, which bill zero.
 *
 * Reading the body here is safe — Hono caches parsed bodies, the downstream
 * handler re-reads it freely. Capped at the batch size limit (100): larger
 * batches are rejected 400 by the handler (and refunded); the cap only keeps
 * a 402 from quoting a shortfall no valid request could ever bill.
 */
async function billableUnits(c: Parameters<MiddlewareHandler<HonoEnv>>[0]): Promise<number> {
  // Zero units survives both ceilings by construction: the monthly check is
  // `measured + units > limit` and the credit debit is `credits_remaining >=
  // units`, so an exhausted key still gets served on a free route.
  if (isFreeRoute(c.req.path)) return 0;
  if (c.req.method !== 'POST' || c.req.path !== '/v1/iban/batch') return 1;
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const ibans = getIbansArray(body);
  if (!Array.isArray(ibans) || ibans.length === 0) return 1;
  return Math.min(ibans.length, 100);
}

type Ctx = Parameters<MiddlewareHandler<HonoEnv>>[0];

/**
 * Les sorties d'une clé VALIDE arrêtée par le mur (lot B1, règle A) : recharger
 * CETTE clé, par carte avec sa référence, ou en USDC en la présentant.
 *
 * Sans référence (base qui refuse l'écriture : `ensureTopupRef` rend null), on
 * retombe sur l'offre d'avant ce lot, qui frappe une clé neuve : un texte moins
 * bon, jamais un 500.
 */
function payOptions(ref: string | null): string {
  return ref
    ? `${topupHint(ref)}. Or pay per call via x402.`
    : `${CARD_CHECKOUT_HINT}. Prefer USDC? POST /v1/credits/buy/1k|5k|25k, or pay per call via x402.`;
}

/** Ce que l'en-tête `X-Credits-Topup-Hint` dit, selon qu'une référence existe. */
function topupHintHeader(ref: string | null): string {
  return ref
    ? 'POST /v1/credits/buy/1k with this key presented: the credits land on this key'
    : 'POST /v1/credits/buy/1k for a fresh 1,000-credit bundle';
}

/**
 * Les en-têtes de recharge d'un refus, sur une clé valide. `X-Credits-Topup-Url`
 * est le lien du pack d'entrée porteur de la référence : un client qui ne lit
 * que les en-têtes a un lien à ouvrir, pas une phrase à analyser.
 */
function setTopupHeaders(c: Ctx, ref: string | null): void {
  c.header('X-Credits-Topup-Hint', topupHintHeader(ref));
  if (ref) c.header('X-Credits-Topup-Url', topupLink('1k', ref));
}

/**
 * Le chemin des crédits seuls : une clé sans allocation propre (née d'un
 * achat, ou anonyme passée au palier payant). Inchangé pour une clé qui a des
 * crédits, sauf les textes du refus, qui proposent de recharger CETTE clé.
 */
async function serveFromCredits(c: Ctx, next: () => Promise<void>, k: KeyContext): Promise<void> {
  const { keyHash, units, creditsTotal } = k;
  const hasBalance = typeof k.creditsRemaining === 'number';

  // Une route gratuite ne coûte rien et ne refuse jamais, même à une clé vide
  // ou sans solde du tout (`0 + 0 > 0` est faux, et une clé sans colonne de
  // solde ne doit pas tomber dans le refus de la règle A pour un format).
  if (units === 0) {
    c.set('apiKeyAuthenticated', true);
    if (hasBalance) c.header('X-Credits-Total', String(creditsTotal ?? 0));
    await next();
    if (hasBalance) c.header('X-Credits-Remaining', String(k.creditsRemaining));
    return;
  }

  const { ok, remaining } = hasBalance
    ? decrementCredits(keyHash, units)
    : { ok: false, remaining: 0 };
  if (!ok) {
    // remaining > 0 : le solde existe mais ne couvre pas ce lot (tout ou rien,
    // rien n'a été débité). remaining === 0 : l'épuisement classique.
    const shortfall = remaining > 0;
    const ref = ensureTopupRef(keyHash);
    const total = creditsTotal ?? 0;
    c.set('paywallCause', {
      reason: shortfall ? 'credits_insufficient' : 'credits_exhausted',
      detail: shortfall
        ? `This batch of ${units} IBANs needs ${units} credits (1 credit per IBAN) but only ${remaining} remain on this key: nothing was debited. ` +
          `Send a batch of ≤${remaining} IBANs, or top up now. ${payOptions(ref)}`
        : `This key's prepaid credits are used up (${total.toLocaleString('en-US')} credits bought on it so far). ` +
          `The key stays valid: ${payOptions(ref)}`,
      credits: {
        required: units,
        remaining,
        total,
        topup: ref ? topupLink('1k', ref) : 'POST /v1/credits/buy/1k|5k|25k',
      },
    });
    c.header(shortfall ? 'X-Credits-Insufficient' : 'X-Credits-Exhausted', 'true');
    c.header('X-Credits-Required', String(units));
    c.header('X-Credits-Remaining', String(remaining));
    c.header('X-Credits-Total', String(total));
    setTopupHeaders(c, ref);
    await next();
    return;
  }
  c.header('X-Credits-Total', String(creditsTotal ?? 0));
  if (units > 1) c.header('X-Credits-Charged', String(units));
  c.header('X-Charged-From', 'credits');
  c.set('apiKeyAuthenticated', true);
  // Count the call against the month as well — an OBSERVATION, never a
  // ceiling. This branch used to touch credits_remaining and nothing else,
  // so `api_usage` was silent for every prepaid customer and every aggregate
  // reading it (CRM months_by_key, monthly sparkline) understated exactly
  // the customers who pay. No limit is tested here and none ever will be:
  // a credit key is turned away by its balance, above, and by nothing else.
  // Nothing is billed twice either — the debit stays the single
  // decrementCredits call.
  // Guarded, because this write sits BETWEEN the debit and the answer:
  // stats.sqlite has writers outside this process (admin scripts), and a
  // BUSY here would charge the credit and then fail the very call it paid
  // for. A lost observation costs one unit on a chart; it is logged and
  // accepted. The debit above stays unguarded on purpose — money, not
  // telemetry.
  let observedMonth: string | null = null;
  try {
    observedMonth = recordMonthlyObservation(keyHash, units);
  } catch (err) {
    console.error('[stats] monthly observation failed:', err instanceof Error ? err.message : err);
  }
  await next();
  // Refund credits on 4xx client errors (mirror monthly quota behavior).
  // Same reason as the quota headers below: the balance is published after
  // the refund, otherwise it advertises credits that were handed back.
  let left = remaining;
  if (c.res.status >= 400 && c.res.status < 500) {
    refundCredit(keyHash, units);
    // The observation is refunded on the SAME month the increment landed
    // on, for the reason decrementQuota documents: across a month boundary
    // the two differ, and the drift is permanent. Skipped when the
    // increment itself failed above — refunding an observation that never
    // landed would double-shrink the month. Guarded like the increment:
    // the customer's 4xx answer must not become a 500 over telemetry.
    if (observedMonth !== null) {
      try {
        decrementQuota(keyHash, units, observedMonth);
      } catch (err) {
        console.error(
          '[stats] observation refund failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }
    left = remaining + units;
  }
  c.header('X-Credits-Remaining', String(left));
  warnOnCreditsCrossing(k, remaining + units, left);
}

/**
 * L'avertissement des 10 %, sur le solde d'avant et d'après cet appel.
 *
 * L'assiette est le solde juste après la dernière recharge
 * (`credits_notice_base`, à défaut le cumul) : avec des recharges fréquentes,
 * un seuil pris sur le cumul finirait au-dessus du solde maximal, et l'alerte
 * ne partirait plus jamais. Le verrou, lui, reste sur le cumul : une recharge
 * le change, donc réarme l'alerte, et un pack déjà averti garde son verrou.
 *
 * Sans attendre, comme l'avertissement mensuel : l'appel du client n'attend
 * jamais le relais de courrier, et un échec finit dans le journal.
 */
function warnOnCreditsCrossing(k: KeyContext, before: number, after: number): void {
  const base = k.creditsNoticeBase ?? k.creditsTotal ?? 0;
  if (!k.email || !crossesCreditsNotice(before, after, base)) return;
  void maybeSendCreditsWarning({
    keyHash: k.keyHash,
    email: k.email,
    keyPrefix: k.keyPrefix,
    remaining: after,
    total: k.creditsTotal ?? 0,
    base,
  }).catch((err) =>
    console.error('[credits-notice] warning failed:', err instanceof Error ? err.message : err),
  );
}

/** Ce que les trois chemins savent de la clé présentée. */
interface KeyContext {
  keyHash: string;
  keyPrefix: string;
  email: string | undefined;
  tier: KeyTier | undefined;
  /** L'allocation du mois : Pro ou éditeur, allocation propre sinon, 0 pour une clé née d'un achat. */
  allowance: number;
  noRecredit: boolean;
  creditsRemaining: number | undefined;
  creditsTotal: number | undefined;
  creditsNoticeBase: number | undefined;
  units: number;
}

/**
 * Le chemin de l'allocation seule : une clé sans crédits à dépenser. C'est le
 * comportement d'avant ce lot, texte du refus excepté.
 */
async function serveFromAllowance(c: Ctx, next: () => Promise<void>, k: KeyContext): Promise<void> {
  const { keyHash, units, tier, allowance: monthlyLimit } = k;
  const noRecredit = k.noRecredit;
  const measured = checkAndIncrementQuota(keyHash, monthlyLimit, units, noRecredit);
  // 🚨 Une clé rechargée dont les crédits sont vidés (relecture de sécurité de
  // la PR 259, D4). La règle B écrit dans le même compteur du mois les unités
  // payées par l'allocation ET par les crédits : il dépasse alors l'allocation.
  // Ce qu'on en montre (en-têtes, texte du refus) est plafonné à l'allocation,
  // et une route gratuite, qui ne coûte rien, n'est jamais refusée. Une clé qui
  // n'a jamais eu de crédits garde son affichage d'avant, à l'identique.
  const drained = typeof k.creditsTotal === 'number';
  const quota = drained
    ? {
        ...measured,
        used: Math.min(measured.used, measured.limit),
        allowed: measured.allowed || units === 0,
      }
    : measured;

  if (!quota.allowed) {
    // Quota exhausted — or too small for this batch (all-or-nothing, nothing
    // was consumed). Instead of returning a hard 429 (which is a dead-end
    // for autonomous agents), we fall through WITHOUT setting
    // apiKeyAuthenticated. The x402 middleware will then advertise
    // payment requirements and the agent can pay-per-call seamlessly until
    // their quota resets next month.
    // Hint headers tell the agent what happened so it can log + decide.
    const shortfall = quota.remaining > 0;
    // 🚨 L'assiette du plafond n'est pas toujours le mois, et trois phrases
    // le disaient sans regarder.
    //
    // `no_recredit = 1` fait mesurer le plafond sur la SOMME de tous les mois
    // (`checkAndIncrementQuota`), donc rien ne repart le 1er : c'est le cas
    // d'une clé née sous alerte du disjoncteur et d'une clé promue contre un
    // paiement (« 200 une fois, pas 200 par mois »). Servir « it resets on
    // the 1st » à ces deux populations, et leur attribuer `used`/`limit` au
    // mois courant, c'est promettre un retour d'allocation qui n'arrivera
    // jamais — et le site comme le `notice` du 201 disent l'inverse.
    const lifetime = noRecredit === true;
    // « for 2026-09 » est faux sur une assiette de vie : les deux nombres
    // sont alors la somme de tous les mois.
    const spentOn = lifetime ? 'in total on this key' : `for ${quota.month}`;
    // Une clé ANONYME à `no_recredit` ne peut être qu'une clé née sous
    // alerte : un paiement l'aurait fait sortir du palier anonyme. Test sur
    // le PALIER et non sur le plafond (une clé bouclier porte 5, pas 25).
    const shield = lifetime && tier === 'anonymous';
    // La référence de recharge de CETTE clé (lot B1), prise seulement ici, sur
    // le chemin du refus : jamais une écriture sur le chemin chaud d'un appel
    // servi.
    const ref = ensureTopupRef(keyHash);

    // ⚠️ Aucune de ces phrases ne renvoie vers l'essai sans clé, plus
    // généreux en validations : y renvoyer apprendrait à un client à JETER sa
    // clé pour retrouver du quota, ce qui détruit la seule identité stable
    // qu'on ait de lui et le remet en concurrence avec tout son réseau.
    //
    // 🚨 Et le rail de réclamation passe EN PREMIER sur les deux populations
    // anonymes : c'est la seule sortie gratuite, et elle relève la clé en
    // main au lieu d'en frapper une seconde.
    const anonymousExhausted =
      `This key's anonymous allowance is spent for ${quota.month} (${quota.used}/${quota.limit} requests) — ` +
      'it resets on the 1st. Free way out now: claim this key at POST /v1/keys/claim with a mailbox you can ' +
      `read, for ${FREE_TIER_MONTHLY_LIMIT} a month on the same key — same secret, same prefix, same history. ` +
      `Or pay per call via x402; $${CLAIM_MIN_PAID_USD} settled on this key raises it to ` +
      `${FREE_TIER_MONTHLY_LIMIT}, once.`;

    const shieldExhausted =
      `This key was issued with a reduced allowance and it is spent (${quota.used}/${quota.limit} requests ` +
      'counted over the whole life of the key: a reduced allowance does not start over on the 1st). ' +
      'It goes back up on its own within a few hours. To lift it to ' +
      `${FREE_TIER_MONTHLY_LIMIT} a month right away, claim this key: POST /v1/keys/claim with a mailbox you ` +
      'can read. Or pay per call via x402, which needs no key at all.';

    // 🚨 Cette phrase ne propose PAS le code par mail : une clé déjà sortie
    // du palier anonyme se voit répondre 409 `already_claimed`. Promettre
    // une sortie gratuite que la route refuse serait pire que se taire.
    const paidOnceExhausted =
      `This key's allowance is spent: ${quota.used}/${quota.limit} requests counted over the whole life of ` +
      'the key, because it was granted against a payment — once, not every month, so nothing starts over on ' +
      `the 1st. To keep going now: ${payOptions(ref)}`;

    const monthlyExhausted =
      `Your free tier is exhausted for ${quota.month} (${quota.used}/${quota.limit} requests used) — ` +
      `it resets on the 1st of next month. To keep going now: ${payOptions(ref)}`;

    const exhausted = shield
      ? shieldExhausted
      : lifetime
        ? paidOnceExhausted
        : tier === 'anonymous'
          ? anonymousExhausted
          : monthlyExhausted;

    const resets = shield
      ? 'not monthly — it goes back up within a few hours, or at once if this key is claimed'
      : lifetime
        ? 'never — this allowance was granted once, not monthly'
        : '1st of month';

    c.set('paywallCause', {
      reason: shortfall ? 'monthly_quota_insufficient' : 'monthly_quota_exhausted',
      tier,
      detail: shortfall
        ? `This batch of ${units} IBANs needs ${units} requests from this key's allowance (1 per IBAN) but only ${quota.remaining} remain ${spentOn} ` +
          `(${quota.used}/${quota.limit} used) — nothing was consumed. Send a batch of ≤${quota.remaining} IBANs, ` +
          `or lift the limit now. ${payOptions(ref)}`
        : exhausted,
      quota: {
        used: quota.used,
        limit: quota.limit,
        month: quota.month,
        resets,
        required: units,
        remaining: quota.remaining,
      },
    });
    c.header(shortfall ? 'X-Quota-Insufficient' : 'X-Quota-Exhausted', 'true');
    c.header('X-Quota-Required', String(units));
    c.header('X-Quota-Remaining', String(quota.remaining));
    c.header('X-Quota-Used', String(quota.used));
    c.header('X-Quota-Limit', String(quota.limit));
    c.header('X-Quota-Month', quota.month);
    // 🚨 La moitié lisible par une machine du correctif ci-dessus : sur une
    // assiette de vie, `X-Quota-Month` dit dans quel mois la consommation a
    // été ÉCRITE, pas sur quoi le plafond est mesuré. Sans cet en-tête, un
    // client qui ne lit que les en-têtes programmerait une reprise le 1er.
    c.header('X-Quota-Basis', lifetime ? 'lifetime' : 'month');
    c.header(
      'X-Quota-Reset-Hint',
      shield
        ? 'no monthly reset; lifted when the alert clears, or at once by a claim'
        : lifetime
          ? 'no monthly reset; this allowance was granted once'
          : 'monthly, 1st of month',
    );
    // Les sorties payantes de CETTE clé, pour un client qui ne lit que les
    // en-têtes. Une clé anonyme les reçoit aussi : le corps du 402 lui dit
    // qu'un achat la fait sortir du palier anonyme (enrich-402).
    if (typeof k.creditsTotal === 'number') {
      c.header('X-Credits-Remaining', String(Math.max(0, k.creditsRemaining ?? 0)));
      c.header('X-Credits-Total', String(k.creditsTotal));
    }
    setTopupHeaders(c, ref);
    await next();
    return;
  }

  if (units > 1) c.header('X-Quota-Charged', String(units));
  if (units > 0) c.header('X-Charged-From', 'allowance');

  // Upsell on the trajectory, not on the wall. A daily job cannot catch a
  // client that burns nearly its whole monthly allowance in a matter of
  // minutes (a real, measured case), so the warning is triggered by the very
  // call that crosses 80%.
  // Fire-and-forget: the customer's request must never wait on SMTP. The
  // notice bookkeeping touches the DB, so a lock or an in-flight shutdown
  // can reject — that must land in the log, never as an unhandled rejection.
  //
  // 🚨 Branche ENTIÈRE sautée sur le palier anonyme, en-tête compris. Le
  // seuil est un RATIO (0,8), pas un nombre : à 200 il vaut 160, à 25 il
  // vaut 20, donc le franchissement arrive huit fois plus tôt. Et la garde
  // `&& email` ne protège rien ici, puisque `email` vaut la sentinelle, qui
  // est vraie. Sans cette exclusion, une clé anonyme annonce à 20 unités un
  // avertissement par mail qui n'existera jamais : la sentinelle n'a pas
  // d'arobase, donc quota-notice rend `no_contact`. L'appelant ne perd aucun
  // signal, les quatre en-têtes X-Quota-* disent déjà tout.
  if (quota.crossedNoticeThreshold && k.email && tier !== 'anonymous') {
    c.header('X-Quota-Notice', 'threshold-crossed');
    void maybeSendQuotaWarning({
      keyHash,
      email: k.email,
      keyPrefix: k.keyPrefix,
      used: quota.used,
      limit: quota.limit,
      month: quota.month,
    }).catch((err) =>
      console.error('[quota-notice] warning failed:', err instanceof Error ? err.message : err),
    );
  }

  // The free tier carries its credit: a key at or under the free allowance
  // gets the attribution block on every paid-endpoint response. Prepaid,
  // Pro and OEM keys take the other branch or a higher limit, and never do.
  // `> 0` depuis le lot B1 : une allocation écrite à 0 n'est pas le gratuit.
  c.set('freeTier', monthlyLimit > 0 && monthlyLimit <= FREE_TIER_MONTHLY_LIMIT);
  c.set('apiKeyAuthenticated', true);
  await next();

  // Refund the quota slots if the downstream handler rejected the request
  // with a 4xx client error (bad input, validation failure). Otherwise an
  // attacker could burn a key's monthly quota for free by spamming invalid
  // payloads. 5xx is NOT refunded — we charge for server-side failures to
  // avoid hiding infrastructure problems.
  let used = quota.used;
  if (c.res.status >= 400 && c.res.status < 500) {
    // Refund onto the month the increment was billed to, not the wall-clock
    // month now — they differ across a month boundary and the mismatch is
    // permanent for a key on the lifetime basis.
    decrementQuota(keyHash, units, quota.month);
    used = Math.max(quota.used - units, 0);
  }
  setQuotaHeaders(c, { used, limit: quota.limit, month: quota.month });
  // Une clé rechargée puis vidée garde son cumul : le montrer à côté du quota
  // dit au porteur où il en est des deux compteurs.
  if (typeof k.creditsTotal === 'number') {
    c.header('X-Credits-Remaining', String(Math.max(0, k.creditsRemaining ?? 0)));
    c.header('X-Credits-Total', String(k.creditsTotal));
  }
}

/**
 * Le chemin mixte (règle B) : une clé qui a une allocation ET des crédits.
 * L'allocation du mois passe d'abord, puis les crédits ; un lot qui déborde
 * est découpé, dans une seule transaction (`chargeAllowanceThenCredits`).
 */
async function serveMixed(c: Ctx, next: () => Promise<void>, k: KeyContext): Promise<void> {
  const { keyHash, units, allowance } = k;
  const charge = chargeAllowanceThenCredits(keyHash, allowance, units, k.noRecredit);
  const total = k.creditsTotal ?? 0;
  const month = charge.month;

  if (!charge.allowed) {
    const left = Math.max(0, allowance - charge.measured);
    const credits = charge.creditsAfter;
    const shortfall = credits > 0;
    const ref = ensureTopupRef(keyHash);
    c.set('paywallCause', {
      reason: shortfall ? 'credits_insufficient' : 'credits_exhausted',
      tier: k.tier,
      detail:
        `This batch of ${units} IBANs needs ${units} units but this key has ${left} left on its allowance ` +
        `and ${credits} prepaid credits: nothing was consumed. Send a batch of ≤${left + credits} IBANs, or top up now. ` +
        payOptions(ref),
      quota: {
        used: Math.min(charge.measured, allowance),
        limit: allowance,
        month,
        resets: k.noRecredit
          ? 'never — this allowance was granted once, not monthly'
          : '1st of month',
        required: units,
        remaining: left,
      },
      credits: {
        required: units - left,
        remaining: credits,
        total,
        topup: ref ? topupLink('1k', ref) : 'POST /v1/credits/buy/1k|5k|25k',
      },
    });
    c.header(shortfall ? 'X-Credits-Insufficient' : 'X-Credits-Exhausted', 'true');
    c.header('X-Credits-Required', String(units - left));
    c.header('X-Credits-Remaining', String(credits));
    c.header('X-Credits-Total', String(total));
    c.header('X-Quota-Used', String(Math.min(charge.measured, allowance)));
    c.header('X-Quota-Limit', String(allowance));
    c.header('X-Quota-Remaining', String(left));
    c.header('X-Quota-Month', month);
    setTopupHeaders(c, ref);
    await next();
    return;
  }

  if (units > 0) {
    c.header(
      'X-Charged-From',
      charge.fromCredits === 0
        ? 'allowance'
        : charge.fromAllowance === 0
          ? 'credits'
          : 'allowance+credits',
    );
  }
  if (units > 1 && charge.fromAllowance > 0) {
    c.header('X-Quota-Charged', String(charge.fromAllowance));
  }
  if (units > 1 && charge.fromCredits > 0) {
    c.header('X-Credits-Charged', String(charge.fromCredits));
  }
  c.header('X-Credits-Total', String(total));

  // L'alerte des 80 % porte sur la part d'allocation, et sa variante dit que
  // les crédits prennent le relais : « calls stop until the 1st » serait faux.
  if (charge.crossedNoticeThreshold && k.email && k.tier !== 'anonymous') {
    c.header('X-Quota-Notice', 'threshold-crossed');
    void maybeSendQuotaWarning({
      keyHash,
      email: k.email,
      keyPrefix: k.keyPrefix,
      used: charge.measured + charge.fromAllowance,
      limit: allowance,
      month,
      creditsRemaining: charge.creditsAfter,
    }).catch((err) =>
      console.error('[quota-notice] warning failed:', err instanceof Error ? err.message : err),
    );
  }

  // L'attribution due sur le gratuit reste exactement où elle était : un appel
  // payé, même en partie, par des crédits n'en porte pas, et une allocation
  // relevée (pilote, Pro) non plus.
  c.set(
    'freeTier',
    charge.fromCredits === 0 && allowance > 0 && allowance <= FREE_TIER_MONTHLY_LIMIT,
  );
  c.set('apiKeyAuthenticated', true);
  await next();

  let usedAfter = charge.measured + units;
  let creditsAfter = charge.creditsAfter;
  if (c.res.status >= 400 && c.res.status < 500) {
    // Les deux compteurs, sur le mois FACTURÉ, comme les deux autres chemins.
    refundMixed(keyHash, charge);
    usedAfter = charge.measured;
    creditsAfter = charge.creditsAfter + charge.fromCredits;
  }
  // `count` peut dépasser l'allocation (il compte aussi les appels payés en
  // crédits) : `Used` est plafonné à l'allocation, sans quoi un porteur lirait
  // un dépassement de plafond qui n'existe pas.
  setQuotaHeaders(c, { used: Math.min(usedAfter, allowance), limit: allowance, month });
  c.header('X-Credits-Remaining', String(creditsAfter));
  if (charge.fromCredits > 0) {
    warnOnCreditsCrossing(k, charge.creditsAfter + charge.fromCredits, creditsAfter);
  }
}

export function apiKeyMiddleware(): MiddlewareHandler<HonoEnv> {
  return async (c, next) => {
    const key = extractKey(c);
    if (!key) {
      await next();
      return;
    }

    const {
      valid,
      keyHash,
      email,
      tier,
      monthlyLimit,
      creditsRemaining,
      creditsTotal,
      noRecredit,
      creditsNoticeBase,
    } = validateApiKey(key);

    if (!valid) {
      // A key WAS supplied but doesn't validate (typo, truncation, revoked).
      // Without this marker the request is indistinguishable from anonymous
      // traffic and the client is never told its key is broken.
      //
      // Depuis le lot 6, une clé coupée POUR RAFALE par le radar de cohortes a
      // son propre message. L'ancien envoie le lecteur chercher une faute de
      // frappe qui n'existe pas : c'est faux, et c'est démoralisant pour un
      // agent honnête pris dans un rayon de souffle. Une clé révoquée par son
      // porteur, ou par un abonnement clos, garde le message historique.
      //
      // 🚨 La requête supplémentaire est UNIQUEMENT sur le chemin d'échec, donc
      // jamais sur le chemin chaud d'un client valide, et l'index
      // (key_hash, restored_at) est là pour elle.
      //
      // 🚨 `X-API-Key-Invalid: true` reste posé dans les DEUX cas. Le middleware
      // d'essai sans clé s'appuie sur le fait qu'une clé a été PRÉSENTÉE pour ne
      // pas faire retomber l'appel dans l'essai gratuit ; le retirer ferait
      // d'une clé révoquée un billet gratuit vers l'essai par adresse, c'est-à
      // -dire l'inverse du but.
      //
      // 🚨 Et le statut final reste 402, pas 403 : ce middleware ne rend jamais
      // de statut, il pose la cause et laisse passer, et c'est le rail x402 qui
      // répond avec elle. Un 403 sec serait un cul-de-sac exactement là où
      // l'agent honnête doit pouvoir agir — reprendre sa clé, ou payer.
      const burst = keyHash ? burstRevocationFor(keyHash) : null;
      if (burst) {
        c.set('paywallCause', { reason: 'key_revoked_burst', detail: KEY_REVOKED_BURST_DETAIL });
        c.header('X-API-Key-Revoked', 'burst');
      } else {
        c.set('paywallCause', {
          reason: 'invalid_api_key',
          detail:
            'An API key was provided (ifk_…) but it is invalid or revoked. ' +
            'Check for typos or truncation, or take a new one in one call and without an e-mail: ' +
            'POST /v1/keys/generate with no body at all.',
        });
      }
      c.header('X-API-Key-Invalid', 'true');
      await next();
      return;
    }

    // Attribute the request to this key for per-client telemetry (CRM usage
    // charts) on EVERY valid-key path — including quota/credit exhaustion
    // fall-throughs, where the request still belongs to this customer.
    c.set('apiKeyPrefix', key.slice(0, 12));
    // Le hash à côté du préfixe, sur le même chemin et pour la même raison
    // d'attribution — mais c'est lui que lisent les deux écrivains qui doivent
    // désigner la clé présentée : le crochet de règlement x402 et la vente de
    // paquets. Posé ICI, donc aussi quand le quota est épuisé, qui est
    // exactement le cas où un règlement x402 arrive avec une clé.
    c.set('apiKeyHash', keyHash);

    // Billable units for this request: 1 everywhere except batch validation,
    // which bills 1 per IBAN (same rule as the x402 per-IBAN price), and 0 on
    // the free routes — acheter un pack compris, depuis le lot B1.
    const k: KeyContext = {
      keyHash,
      keyPrefix: key.slice(0, 12),
      email,
      tier,
      allowance: monthlyLimit,
      noRecredit: noRecredit === true,
      creditsRemaining,
      creditsTotal,
      creditsNoticeBase,
      units: await billableUnits(c),
    };

    // Le choix du chemin (spec du lot B1, §6.1). L'allocation du mois vaut
    // `monthly_limit` : Pro pendant l'abonnement, allocation propre sinon, et 0
    // pour une clé née d'un achat, qui n'a donc jamais « 200 par mois ».
    //   - allocation 0 : les crédits seuls, comme une clé de pack l'a toujours
    //     été ; à zéro, le refus de la règle A, avec les liens de CETTE clé ;
    //   - pas de crédits à dépenser : l'allocation seule, comme avant ;
    //   - les deux : l'allocation d'abord, puis les crédits (règle B).
    if (k.allowance <= 0) {
      await serveFromCredits(c, next, k);
      return;
    }
    if (typeof k.creditsRemaining !== 'number' || k.creditsRemaining <= 0) {
      await serveFromAllowance(c, next, k);
      return;
    }
    await serveMixed(c, next, k);
  };
}
