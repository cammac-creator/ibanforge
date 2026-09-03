import { opsFail } from '../lib/ops-alert.js';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { timingSafeEqual, createHash } from 'node:crypto';
import {
  generateApiKey,
  validateApiKey,
  getUsage,
  revokeApiKey,
  rotateApiKey,
  PRO_MONTHLY_LIMIT,
} from '../lib/api-keys.js';
import { PRO_PAYMENT_LINK, PRO_PRICE_USD } from '../lib/payment-links.js';
import { getStatsDB } from '../lib/db.js';
import { getKeyReport } from '../lib/key-report.js';
import { exportPaidState } from '../lib/backup.js';
import { getClientProfiles, getBotProfiles, extractClientIp } from '../lib/stats.js';
import { isDisposableDomain } from '../lib/disposable-domains.js';
import {
  DAILY_KEY_CREATION_LIMIT,
  VERIFY_WINDOW_DAYS,
  keyCreationSource,
  countKeyCreations,
  recordKeyCreation,
  createVerificationChallenge,
  checkVerificationCode,
  challengeSendAllowed,
  recordVerificationSend,
  markVerificationOutcome,
} from '../lib/key-creation-guard.js';
import { getActivation } from '../lib/activation.js';
import { recordEvent } from '../lib/events.js';
import { getVisibility, recordVisibility, isVisibilityState } from '../lib/visibility.js';
import {
  getOrphans,
  recordOrphan,
  resolveOrphan,
  countPendingOrphans,
  isOrphanKind,
  setOrphanGist,
} from '../lib/orphan-mail.js';
import { addAlias, listAliases, loadAliasMap, toCanonical } from '../lib/email-aliases.js';
import {
  listNoReplySenders,
  loadNoReplySenders,
  isRuleEligibleSender,
  normalizeSenderAddress,
  setNoReplySender,
} from '../lib/no-reply-senders.js';
import {
  deleteInstitutionalContact,
  listInstitutionalContacts,
  upsertInstitutionalContact,
  type InstitutionalContactInput,
} from '../lib/institutional-contacts.js';
import { getWeeklyFacts, saveWeeklyDigest, getWeeklyDigests } from '../lib/weekly-facts.js';
import { notifyPurchaseTelegram } from '../lib/notify.js';
import {
  isProspectBackfillRunning,
  lastProspectBackfillReport,
  runProspectBackfill,
} from '../lib/prospect-radar-server.js';
import {
  isCohortScanRunning,
  lastCohortReport,
  runCohortScan,
  getCohortRelabels,
} from '../lib/cohort-radar-server.js';
import {
  getNudgeLedger,
  isActivationPassRunning,
  isNudgeDisabled,
  lastActivationReport,
  runActivationPass,
} from '../lib/activation-nudge-server.js';
import {
  getCompanyProfiles,
  upsertCompanyProfile,
  type ProfileSource,
} from '../lib/company-profiles.js';
import { parseAttribution, recordSignupAttribution } from '../lib/signup-attribution.js';
import { domainAcceptsMail, domainOf } from '../lib/mail-domain.js';
import {
  sendApiKeyEmail,
  sendFreeKeyEmail,
  deliverKeyVerificationEmail,
  isEmailConfigured,
  alertKeyDeliveryFailure,
} from '../lib/email.js';

// Bundle credits — prepaid pools sized for the 3 typical agent stacks.
// Pricing keeps a fair per-call rate (cheaper than retail x402) so agents
// have a reason to buy in bulk vs paying per call.
//
//   Bundle 1k:   5 USDC   = 0.005  USDC/credit (same as retail validate_iban)
//   Bundle 5k:  20 USDC   = 0.004  USDC/credit (-20%)
//   Bundle 25k: 80 USDC   = 0.0032 USDC/credit (-36%)
//
// Pricing is enforced by the x402 middleware on /v1/credits/buy/:bundle.
// If the agent paid → x402 lets the request through → handler creates
// a fresh credit key with `credits` credits and returns it.
// Exported so the business summary's own price table can be tested against
// this one. A pack price that drifts here without drifting there would make
// the weekly revenue line quietly wrong.
export const BUNDLES: Record<string, { credits: number; price_usdc: number }> = {
  '1k': { credits: 1000, price_usdc: 5 },
  '5k': { credits: 5000, price_usdc: 20 },
  '25k': { credits: 25000, price_usdc: 80 },
};

const apiKeys = new Hono();

/**
 * Constant-time admin auth. Returns true only if ADMIN_SECRET is set AND
 * the provided header matches exactly. Length-normalized before timing-safe
 * compare so comparison cost does not leak the secret's length.
 */
// Exported since 01/09/2026: new admin surfaces (demand-gaps, feedback) live
// in their own route files, and a second copy of a timing-safe comparison is
// a second place to get it subtly wrong.
export function isAdminAuthorized(provided: string | undefined): boolean {
  const expected = process.env.ADMIN_SECRET;
  if (!expected || !provided) return false;
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(provided, 'utf8');
  // Pad provided to the same length (compare a dummy if mismatched) to make
  // the decision branch-free from attacker's POV.
  if (expectedBuf.length !== providedBuf.length) {
    // Still do a dummy compare to equalize timing.
    timingSafeEqual(expectedBuf, expectedBuf);
    return false;
  }
  return timingSafeEqual(expectedBuf, providedBuf);
}

// Domains we refuse for free-tier signups to keep the stats funnel honest.
// They get re-allowed when IBANFORGE_ADMIN_TEST_KEYS=true (CI/automation only).
const BLOCKED_EMAIL_DOMAINS =
  /@(example|test|invalid|localhost|mailinator|tempmail|guerrillamail|10minutemail|throwaway|dispostable|trashmail|fakeinbox|getnada|maildrop|sharklasers|yopmail)\.(com|org|net|io|me|fr|ch|de)$/i;

apiKeys.post('/v1/keys/generate', async (c) => {
  let body: { email?: unknown; source?: unknown; attribution?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; source?: unknown; attribution?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }

  const email = body.email;
  if (!email || typeof email !== 'string' || !email.includes('@') || email.length > 255) {
    return c.json({ error: 'invalid_email', message: 'A valid email address is required' }, 400);
  }

  // Stricter shape check: local-part@domain.tld (avoids "test@" or "foo@bar")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return c.json(
      { error: 'invalid_email', message: 'Email must be a valid address (e.g. you@company.com)' },
      400,
    );
  }

  // Block disposable / fictional domains unless explicitly allowed (CI tests).
  // Two layers: the historical exact-TLD regex, plus the curated suffix +
  // brand-substring library — the 2026-08-17 signup wave used
  // tempmail.edu.ge, a suffix the regex could not carry.
  if (
    process.env.IBANFORGE_ADMIN_TEST_KEYS !== 'true' &&
    (BLOCKED_EMAIL_DOMAINS.test(email) || isDisposableDomain(email))
  ) {
    return c.json(
      {
        error: 'disposable_email',
        message:
          'Free tier requires a real email address. example.com, mailinator and other disposable domains are blocked.',
      },
      400,
    );
  }

  // A domain with no mail server cannot receive the key, the code or anything
  // else, and every send to one costs the mailbox's reputation at the provider
  // (02/09/2026: blocked for "spam" after days of exactly that). Refused here,
  // before a key exists. Skipped under vitest: the suite's fixture domains are
  // documentation names, and a test must not depend on a resolver.
  if (!process.env.VITEST && !(await domainAcceptsMail(domainOf(email)))) {
    return c.json(
      {
        error: 'undeliverable_email',
        message:
          'The domain of this address has no mail server, so no key or verification code could reach it. ' +
          'Check the address, or use another mailbox you can read.',
      },
      400,
    );
  }

  // Per-NETWORK creation guard. The per-email one-per-day rule below is
  // useless against invented addresses (41 keys in 19 s, each with a fresh
  // random gmail, 2026-08-17) — so the network is the unit that pays:
  //   - first key in a week: instant, unchanged ("one step" is the bet);
  //   - second key onwards: prove you can read the mailbox (6-digit code);
  //   - more than DAILY_KEY_CREATION_LIMIT in 24h: come back tomorrow.
  // Fail-open when the IP is unknown: bricking signups on a header change
  // would cost more than a farm does. The burst still shows on the radar.
  const clientIp = extractClientIp({
    'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
    'x-real-ip': c.req.header('x-real-ip') ?? null,
  });
  const creationSource = keyCreationSource(clientIp);
  if (creationSource && process.env.IBANFORGE_ADMIN_TEST_KEYS !== 'true') {
    if (countKeyCreations(creationSource, 24) >= DAILY_KEY_CREATION_LIMIT) {
      return c.json(
        {
          error: 'key_creation_limit',
          message:
            `At most ${DAILY_KEY_CREATION_LIMIT} free keys per network per day — existing keys keep working. ` +
            'Need more capacity today? Prepaid credits are instant ($5 per 1,000, POST /v1/credits/buy/1k) ' +
            'and x402 pay-per-call needs no key at all.',
        },
        429,
      );
    }
    if (countKeyCreations(creationSource, 24 * VERIFY_WINDOW_DAYS) >= 1) {
      const code =
        typeof (body as { code?: unknown }).code === 'string'
          ? String((body as { code?: unknown }).code).trim()
          : '';
      if (!code) {
        // Bound the code SEND before issuing/mailing it. The daily creation cap
        // above counts successes only, so without this a caller with one key on
        // the network could loop generate with fresh addresses and mail a code
        // to an arbitrary third party on every call (bounded only by the global
        // 100/min). Cap per recipient (anti-bombing) and per source.
        const sendCheck = challengeSendAllowed(creationSource, email.trim().toLowerCase());
        if (!sendCheck.ok) {
          return c.json(
            {
              error: 'verification_rate_limited',
              message:
                sendCheck.reason === 'recipient'
                  ? 'Too many verification codes were requested for this address today. Try again tomorrow, or use the most recent code you already received.'
                  : 'Too many verification codes were requested from this network today. Existing keys keep working; prepaid credits are instant (POST /v1/credits/buy/1k) and x402 needs no key.',
            },
            429,
          );
        }
        const sendId = recordVerificationSend(creationSource, email.trim().toLowerCase());
        const challenge = createVerificationChallenge(email.trim().toLowerCase(), creationSource);
        const outcome = await deliverKeyVerificationEmail({
          to: email.trim().toLowerCase(),
          code: challenge,
        });
        const sent = outcome === 'sent';
        // The outcome is written whichever way it went: a refusal that leaves
        // no trace is exactly how this channel failed unnoticed for three days.
        markVerificationOutcome(sendId, sent);
        if (outcome === 'undeliverable') {
          // The mail server for that domain refused the address. No retry and
          // no alert can fix it, and "try again in a few minutes" would have
          // been a lie: it is the caller's address to fix.
          return c.json(
            {
              error: 'undeliverable_email',
              message:
                'The mail server for this address refused it, so no verification code could be delivered. ' +
                'Check the address, or use another mailbox you can read.',
            },
            400,
          );
        }
        if (!sent) {
          // A month of 503s here turned out to be one script feeding addresses
          // that cannot exist, with the relay healthy throughout (02/09/2026):
          // those now answer 400 above. What remains is ours: the relay down,
          // its mailbox unconfigured, or a shared secret that no longer
          // matches. Threshold 3: one hiccup does not wake anyone, a run does.
          void opsFail(
            'mail:verification',
            'Verification codes are not leaving: the free-key signup answers 503 while the relay refuses or cannot be reached.',
            3,
          );
          return c.json(
            {
              error: 'verification_unavailable',
              message:
                'A verification mail could not be sent right now. Try again in a few minutes.',
            },
            503,
          );
        }
        return c.json(
          {
            error: 'verification_required',
            message:
              'A key was already issued from this network recently, so this one needs a verified mailbox: ' +
              `we sent a 6-digit code to ${email.trim().toLowerCase()}. ` +
              'Repeat this request within 15 minutes as {"email": "...", "code": "123456"}.',
          },
          403,
        );
      }
      const check = checkVerificationCode(email.trim().toLowerCase(), code);
      if (!check.ok) {
        return c.json(
          {
            error: 'verification_failed',
            reason: check.reason,
            message:
              check.reason === 'expired' || check.reason === 'no_challenge'
                ? 'This code is no longer valid — request a key again without a code to receive a fresh one.'
                : 'Wrong code. Check the most recent mail; the challenge locks after 5 attempts.',
          },
          403,
        );
      }
    }
  }

  // Acquisition channel, carried by our own outbound links (?src=npm, the n8n
  // node, directory listings…). Best-effort by design: an absent or malformed
  // value silently becomes NULL — attribution must never block a key.
  const source =
    typeof body.source === 'string' && /^[a-z0-9_-]{1,40}$/i.test(body.source.trim())
      ? body.source.trim().toLowerCase()
      : undefined;

  const result = generateApiKey(email.trim().toLowerCase(), undefined, source);

  if (!result) {
    return c.json(
      {
        error: 'rate_limited',
        message: 'Only one API key can be generated per email per day. Try again tomorrow.',
      },
      429,
    );
  }

  if (creationSource)
    recordKeyCreation(creationSource, c.req.header('user-agent') ?? null, result.key_prefix);

  // Where this signup came from: the landing page, the referring site and the
  // campaign labels the dialog captured on arrival. Telemetry, never a gate.
  try {
    recordSignupAttribution(result.key_prefix, source, parseAttribution(body.attribution));
  } catch {
    // The stats database refusing a write must not cost anyone their key.
  }

  // Deliver the key to the mailbox too, with the command that proves it works.
  //
  // Until 2026-08-29 a free signup produced no mail at all: the key lived only
  // in this response, and the reader who did not catch it had nothing. Most
  // keys never carry a single call, so the mail is not a courtesy here, it is
  // the second chance at a first call.
  //
  // NOT awaited, exactly like the Stripe rail: a relay that hangs must never
  // hold a signup open (the transport caps itself at 6s, the caller waits 0).
  //
  // Skipped under vitest because example-emails.test.ts drives this very route
  // with every example address published in the repo; with a relay configured
  // in the shell, `npm run check` would mail real people documentation samples.
  if (!process.env.VITEST) {
    // QUA-13 (2026-09-01): a free key that never reaches its mailbox is the
    // cheapest possible explanation for "this key never made a call", and until
    // now it produced nothing at all. The relay's own refusal alerts from inside
    // src/lib/email.ts; a throw before it answers alerts from here. No address
    // in the text: Telegram is not a declared processor.
    void sendFreeKeyEmail({
      to: email.trim().toLowerCase(),
      rawKey: result.api_key,
      monthlyLimit: 200,
    }).catch(() => {
      alertKeyDeliveryFailure('free key delivery threw before the relay answered');
    });
  }

  return c.json(
    {
      api_key: result.api_key,
      key_prefix: result.key_prefix,
      email: email.trim().toLowerCase(),
      monthly_limit: 200,
      message: 'Save this key — it will not be shown again.',
      terms_url: 'https://ibanforge.com/legal/terms',
    },
    201,
  );
});

/**
 * Bundle credits endpoint — agents (or humans) pay once via x402, get a key
 * with N prepaid credits. The endpoint is gated by the x402 middleware in
 * src/middleware/x402.ts at the configured price for each bundle. When the
 * payment clears, the handler runs and we mint a fresh credit-based key.
 *
 * GET /v1/credits/bundles  — public, lists the 3 bundles + prices
 * POST /v1/credits/buy/:bundle  — gated 5/20/80 USDC, returns the key on success
 * GET /v1/credits/balance  — auth-gated by the API key middleware
 */
apiKeys.get('/v1/credits/bundles', (c) => {
  return c.json({
    bundles: Object.entries(BUNDLES).map(([slug, b]) => ({
      slug,
      credits: b.credits,
      price_usdc: b.price_usdc,
      price_per_call_usdc: Math.round((b.price_usdc / b.credits) * 1_000_000) / 1_000_000,
      buy_endpoint: `POST /v1/credits/buy/${slug}`,
    })),
    payment_method: 'x402 USDC on Base mainnet',
    documentation: 'https://ibanforge.com/agents#credits',
    // The recurring alternative, for a client that would rather budget a flat
    // monthly amount than top up packs (2026-09-02). Card only: a subscription
    // has no x402 rail.
    subscription: {
      plan: 'pro',
      monthly_requests: PRO_MONTHLY_LIMIT,
      price_usd_per_month: PRO_PRICE_USD,
      checkout: PRO_PAYMENT_LINK,
      payment_method: 'card (Stripe)',
    },
  });
});

// NOTE: POST /v1/credits/buy/:bundle lives in src/routes/credits-buy.ts
// because it must be mounted AFTER the x402 middleware to be payment-gated.
// `apiKeys` here is mounted before x402 (free routes only).

apiKeys.get('/v1/credits/balance', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json(
      { error: 'missing_key', message: 'Provide your API key via Authorization: Bearer ifk_xxx' },
      401,
    );
  }
  const key = authHeader.slice(7);
  const v = validateApiKey(key);
  if (!v.valid) {
    return c.json({ error: 'invalid_key', message: 'API key not found or inactive' }, 401);
  }
  if (typeof v.creditsRemaining !== 'number') {
    return c.json({
      type: 'subscription',
      key_prefix: key.slice(0, 12),
      message:
        'This is a monthly subscription key, not a credit bundle. Use GET /v1/keys/usage for monthly stats.',
    });
  }
  return c.json({
    type: 'credit_bundle',
    key_prefix: key.slice(0, 12),
    credits_remaining: v.creditsRemaining,
    credits_total: v.creditsTotal ?? 0,
    credits_used: (v.creditsTotal ?? 0) - v.creditsRemaining,
    topup_endpoints: Object.keys(BUNDLES).map((s) => `POST /v1/credits/buy/${s}`),
  });
});

/**
 * The monthly block a key holder is served, on every surface that serves one.
 *
 * A credit key's monthly row is an OBSERVATION (see recordMonthlyObservation),
 * and `limit` is the default nothing is enforced against for it. The three
 * numeric fields stay in place for contract stability — the published SDK types
 * them as numbers — but the truth travels with them: `basis` names which ceiling
 * actually governs, and the balance that governs it is served alongside.
 * Without this, the day the observation counter landed, any pack holder past the
 * free-tier allowance began reading a NEGATIVE `remaining` — a shortfall against
 * a ceiling nothing was ever going to enforce.
 *
 * One helper, and not a block copied into each route, precisely because there
 * are two: /v1/keys/usage and /v1/keys/report both answer the holder's own key,
 * and a holder must not read one figure on one and another on the other.
 */
function usageBlock(v: ReturnType<typeof validateApiKey>): Record<string, unknown> {
  const usage = getUsage(v.keyHash, v.monthlyLimit);
  const isCreditKey = typeof v.creditsRemaining === 'number';
  return {
    ...usage,
    basis: isCreditKey ? 'credits' : 'monthly',
    ...(isCreditKey
      ? {
          credits_remaining: v.creditsRemaining,
          credits_total: v.creditsTotal ?? 0,
          note:
            'This key draws on a prepaid credit bundle. `used` counts the calls billed this month, for information only — ' +
            'nothing is enforced against `limit`/`remaining`. What can turn a call away is credits_remaining. ' +
            'Full balance: GET /v1/credits/balance.',
        }
      : {}),
  };
}

/**
 * The three places a caller may present its key, on the two self-service read
 * endpoints.
 *
 * Deliberately identical to `extractKey` in src/middleware/api-key.ts, which is
 * what every billed route already accepts and what the docs advertise. These two
 * routes took `Authorization: Bearer` only, so a client following the documented
 * `X-API-Key` dialect got a 401 that reads exactly like "your key is invalid"
 * while trying to read its own usage report. That is a self-inflicted cause of
 * silence after a purchase (security audit, improvement 1, 2026-09-01).
 *
 * NOT imported from the middleware: `extractKey` is not exported there, and that
 * file belongs to another change in flight. Reproduced here rather than
 * exported, so this stays a read-only fix; the two copies must stay identical,
 * and a new dialect belongs in both or in neither.
 */
function presentedKey(c: Context): string | null {
  const auth = c.req.header('Authorization');
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

const MISSING_KEY_MESSAGE =
  'Provide your API key via Authorization: Bearer ifk_xxx, X-API-Key: ifk_xxx or ?api_key=ifk_xxx';

apiKeys.get('/v1/keys/usage', (c) => {
  const key = presentedKey(c);
  if (!key) {
    return c.json({ error: 'missing_key', message: MISSING_KEY_MESSAGE }, 401);
  }

  const validation = validateApiKey(key);

  if (!validation.valid) {
    return c.json({ error: 'invalid_key', message: 'API key not found or inactive' }, 401);
  }

  return c.json({ ...usageBlock(validation), key_prefix: key.slice(0, 12) });
});

/**
 * The customer's own report: their traffic, their failures, their footprint.
 *
 * Same auth as `/v1/keys/usage` — the key itself — and the prefix is derived
 * from the presented key rather than read from the request, so a caller can
 * only ever obtain their own rows.
 *
 * Why this exists: a key holder could see four numbers and nothing that
 * explained a failure. Every "why did my call fail" had to become an email, so
 * the ones who did not write stayed stuck in silence. The heavy lifting is in
 * `getKeyReport`; this route is auth plus a window clamp.
 */
/**
 * A dump of what customers paid for.
 *
 * There is no backup of `stats.sqlite` at all: it lives on one Railway volume,
 * and it holds the keys, the quotas and the prepaid balances. Losing that
 * volume means every customer loses access they already paid for, with no way
 * to give it back or even to know who was owed what.
 *
 * 🚨 The response is customer data — addresses and key hashes. Admin secret
 * only, and a dump must never be committed, attached to a public page, or
 * written anywhere inside the repository.
 *
 * Restoring is deliberately NOT an endpoint. A restore is destructive-adjacent
 * and rare; it belongs in someone's hands with the file in front of them, not
 * behind an HTTP route that a leaked secret could reach.
 */
apiKeys.get('/v1/admin/backup', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const payload = exportPaidState(new Date().toISOString());
  return c.json(payload, 200, {
    // Named so a file on disk says what it is and when it was taken.
    'Content-Disposition': `attachment; filename="ibanforge-paid-state-${payload.taken_at.slice(0, 10)}.json"`,
  });
});

apiKeys.get('/v1/keys/report', (c) => {
  const key = presentedKey(c);
  if (!key) {
    return c.json({ error: 'missing_key', message: MISSING_KEY_MESSAGE }, 401);
  }

  const validation = validateApiKey(key);

  if (!validation.valid) {
    return c.json({ error: 'invalid_key', message: 'API key not found or inactive' }, 401);
  }

  // Clamped, not trusted: an unbounded window is a full-table scan any holder
  // could ask for repeatedly.
  const requested = Number(c.req.query('days') ?? 30);
  const windowDays = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), 365)
    : 30;

  return c.json({
    key_prefix: key.slice(0, 12),
    // The same block /v1/keys/usage serves, helper and all: this endpoint is
    // that one's successor surface, not a lesser one, and a credit holder must
    // not read a negative allowance here after it was closed there.
    usage: usageBlock(validation),
    report: getKeyReport(key.slice(0, 12), windowDays),
  });
});

/**
 * Self-service revocation. Auth is the key itself (Authorization: Bearer ifk_*)
 * — if you hold the key, you may kill it. Lets a holder disable a leaked key
 * immediately without contacting support.
 */
apiKeys.post('/v1/keys/revoke', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json(
      {
        error: 'missing_key',
        message: 'Provide the key to revoke via Authorization: Bearer ifk_xxx',
      },
      401,
    );
  }
  const key = authHeader.slice(7);
  const revoked = revokeApiKey(key);
  if (!revoked) {
    return c.json({ error: 'invalid_key', message: 'Key not found or already revoked.' }, 404);
  }
  return c.json({
    revoked: true,
    key_prefix: key.slice(0, 12),
    message: 'Key permanently deactivated. Rotate to get a fresh one.',
  });
});

/**
 * Self-service rotation. Auth is the (still valid) key itself. Mints a fresh key
 * inheriting the same plan + remaining credits and revokes the old one atomically.
 */
apiKeys.post('/v1/keys/rotate', (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ifk_')) {
    return c.json(
      {
        error: 'missing_key',
        message: 'Provide the key to rotate via Authorization: Bearer ifk_xxx',
      },
      401,
    );
  }
  const key = authHeader.slice(7);
  const rotated = rotateApiKey(key);
  if (!rotated) {
    return c.json({ error: 'invalid_key', message: 'Key not found or inactive.' }, 404);
  }
  return c.json(
    {
      api_key: rotated.api_key,
      key_prefix: rotated.key_prefix,
      monthly_limit: rotated.monthly_limit ?? 200,
      credits_remaining: rotated.credits_remaining,
      message: 'New key issued and the old one revoked. Save this — it will not be shown again.',
    },
    201,
  );
});

apiKeys.post('/v1/admin/keys', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: { email?: unknown; monthly_limit?: unknown; issued_by_us?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; monthly_limit?: unknown; issued_by_us?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const email = body.email;
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return c.json({ error: 'invalid_email' }, 400);
  }

  const monthlyLimit = typeof body.monthly_limit === 'number' ? body.monthly_limit : undefined;
  // Optional, and false unless the caller says otherwise: a key minted here is
  // usually one WE hand over (a pilot, a demo, a key for someone who asked by
  // mail), but this endpoint is also how a key gets created on a customer's
  // behalf during a support exchange. Only the operator knows which, so it is
  // declared rather than inferred from the route.
  const issuedByUs = body.issued_by_us === true;
  const result = generateApiKey(email.trim().toLowerCase(), monthlyLimit, undefined, issuedByUs);
  if (!result) {
    return c.json({ error: 'rate_limited' }, 429);
  }

  return c.json(
    {
      api_key: result.api_key,
      key_prefix: result.key_prefix,
      email: email.trim().toLowerCase(),
      monthly_limit: monthlyLimit ?? 200,
      issued_by_us: issuedByUs,
    },
    201,
  );
});

apiKeys.post('/v1/admin/keys/import', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  let body: { api_key?: unknown; email?: unknown; monthly_limit?: unknown };
  try {
    body = await c.req.json<{ api_key?: unknown; email?: unknown; monthly_limit?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const apiKey = body.api_key;
  const email = body.email;
  if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('ifk_')) {
    return c.json({ error: 'invalid_key', message: 'api_key must start with ifk_' }, 400);
  }
  if (!email || typeof email !== 'string' || !email.includes('@')) {
    return c.json({ error: 'invalid_email' }, 400);
  }

  const { createHash } = await import('node:crypto');
  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const keyPrefix = apiKey.slice(0, 12);
  const monthlyLimit = typeof body.monthly_limit === 'number' ? body.monthly_limit : null;

  const db = getStatsDB();
  const existing = db.prepare('SELECT id FROM api_keys WHERE key_hash = ?').get(keyHash);
  if (existing) {
    return c.json({ error: 'key_exists', key_prefix: keyPrefix }, 409);
  }

  db.prepare(
    'INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit) VALUES (?, ?, ?, ?)',
  ).run(keyHash, keyPrefix, email.trim().toLowerCase(), monthlyLimit);

  return c.json(
    {
      imported: true,
      key_prefix: keyPrefix,
      email: email.trim().toLowerCase(),
      monthly_limit: monthlyLimit ?? 200,
    },
    201,
  );
});

/**
 * Regroup a set of keys under one synthetic contact address.
 *
 * The CRM builds one dossier per address, so relabeling N abuse keys to a
 * single cohort contact collapses N fake "customers" into one named row —
 * without deleting anything: usage history, quotas and key hashes stay
 * untouched, only the display identity changes.
 *
 * Conventions for the cohort address:
 *  - use an UNROUTABLE TLD (e.g. cohort-name@cohorte.invalid) so no automated
 *    mail can ever target the cohort (quota-notice refuses those outright);
 *  - 'cohorte.invalid' is also on the lifecycle radar's internal list, so a
 *    regrouped key can never resurface as a commercial lead.
 *
 * Reversibility: the response returns the previous (key_prefix, email) pairs.
 * The caller stores that mapping BEFORE relying on the new labels.
 */
apiKeys.post('/v1/admin/keys/relabel', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const body = (await c.req.json().catch(() => null)) as {
    key_prefixes?: unknown;
    email?: unknown;
    no_recredit?: unknown;
  } | null;
  const prefixes = Array.isArray(body?.key_prefixes)
    ? body.key_prefixes.filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  // Optional and tri-state: absent leaves the flag untouched (a relabel must
  // not silently change quota behaviour), true opts the keys out of the monthly
  // reset, false puts them back on it — which is what makes this reversible.
  const noRecredit = typeof body?.no_recredit === 'boolean' ? body.no_recredit : null;

  if (prefixes.length === 0 || prefixes.length > 200) {
    return c.json({ error: 'key_prefixes must be a non-empty array (max 200)' }, 400);
  }
  if (!email.includes('@')) {
    return c.json({ error: 'email must contain @' }, 400);
  }

  const db = getStatsDB();
  // no_recredit travels in `previous` too: restoring the mapping restores the
  // quota behaviour along with the address, so the whole call stays undoable.
  const read = db.prepare(
    'SELECT key_prefix, email, no_recredit FROM api_keys WHERE key_prefix = ?',
  );
  const write = db.prepare('UPDATE api_keys SET email = ? WHERE key_prefix = ?');
  const writeFlag = db.prepare('UPDATE api_keys SET no_recredit = ? WHERE key_prefix = ?');

  const previous: Array<{ key_prefix: string; email: string; no_recredit: number }> = [];
  const notFound: string[] = [];
  for (const prefix of prefixes) {
    const rows = read.all(prefix) as Array<{
      key_prefix: string;
      email: string;
      no_recredit: number | null;
    }>;
    if (rows.length === 0) {
      notFound.push(prefix);
      continue;
    }
    previous.push(...rows.map((r) => ({ ...r, no_recredit: r.no_recredit ?? 0 })));
    write.run(email, prefix);
    if (noRecredit !== null) writeFlag.run(noRecredit ? 1 : 0, prefix);
  }

  return c.json({
    relabeled: previous.length,
    email,
    no_recredit: noRecredit,
    not_found: notFound,
    previous,
  });
});

apiKeys.get('/v1/admin/keys', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const db = getStatsDB();
  const now = new Date();
  const month = now.toISOString().slice(0, 7);
  // Previous calendar month (UTC, year-boundary safe) for the usage trend.
  const prevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    .toISOString()
    .slice(0, 7);
  // Rich per-customer payload for the CRM tab. credits_total/credits_remaining
  // and `paid` are what actually separate a paying customer (Stripe/x402 credit
  // pack) from a free key — the previous SELECT exposed neither, so the two were
  // indistinguishable. used_all_time / last_active_month / used_prev power the
  // activation, recency and trend indicators. All read-only.
  //
  // TWO LEDGERS, AND ONLY ONE WAS READ
  //
  // api_usage is the MONTHLY ledger. A credit key used to take the other branch
  // in the middleware — decrementCredits — which touched credits_remaining and
  // nothing else. So every prepaid customer read as `used_all_time: 0`, and the
  // dashboard showed a customer who had just spent thousands of units as one who
  // had never called.
  //
  // 🚨 UPDATED: the credits branch now ALSO writes api_usage, as an observation
  // counter with no ceiling attached (see recordMonthlyObservation). That fixes
  // the per-MONTH blindness this read-side patch could never reach — a lifetime
  // figure cannot say what a customer consumed in July.
  //
  // Which makes the old sum a DOUBLE COUNT: `t.total` now carries the very units
  // `credits_total - credits_remaining` already measures. Hence the CASE. The
  // credits delta stays the source for a credit key rather than the api_usage
  // sum, because it is complete: it covers the months that predate the
  // observation counter, which api_usage will never hold.
  //
  // AND `source`, WHICH NOBODY COULD READ
  //
  // The attribution column has existed since the 06/08/2026 campaign: db.ts adds
  // it, the key-generation route writes it from the `?src=` the signup dialog
  // forwards. It was never in this SELECT, so no surface could read it, and the
  // only question the whole campaign existed to answer — which surface produces
  // the arrivals — had no instrument, for twenty-four days, while the data
  // accumulated in the table. An instrument that is built and never wired up
  // reads exactly like one that was never built: silence.
  const rows = db
    .prepare(
      `SELECT k.key_hash, k.key_prefix, k.email, k.monthly_limit, k.active, k.created_at,
            k.credits_total, k.credits_remaining, k.amount_paid_minor, k.amount_paid_currency, k.issued_by_us, k.source,
            CASE WHEN k.stripe_session_id IS NOT NULL THEN 1 ELSE 0 END AS paid,
            COALESCE(u.count, 0) AS used,
            COALESCE(p.count, 0) AS used_prev,
            CASE WHEN k.credits_remaining IS NOT NULL
                 THEN MAX(COALESCE(k.credits_total, 0) - COALESCE(k.credits_remaining, 0), 0)
                 ELSE COALESCE(t.total, 0)
            END AS used_all_time,
            MAX(COALESCE(k.credits_total, 0) - COALESCE(k.credits_remaining, 0), 0) AS credits_used,
            lam.last_active_month AS last_active_month,
            COALESCE(es.mail_count, 0) AS mail_count,
            COALESCE(es.received, 0) AS mail_received,
            es.last_date AS mail_last_date,
            es.last_subject AS mail_last_subject
     FROM api_keys k
     LEFT JOIN api_usage u ON u.key_hash = k.key_hash AND u.month = ?
     LEFT JOIN api_usage p ON p.key_hash = k.key_hash AND p.month = ?
     LEFT JOIN (SELECT key_hash, SUM(count) AS total FROM api_usage GROUP BY key_hash) t
            ON t.key_hash = k.key_hash
     LEFT JOIN (SELECT key_hash, MAX(month) AS last_active_month FROM api_usage GROUP BY key_hash) lam
            ON lam.key_hash = k.key_hash
     LEFT JOIN email_summaries es ON es.email = k.email
     ORDER BY k.created_at DESC`,
    )
    .all(month, prevMonth) as Array<Record<string, unknown> & { key_hash: string }>;

  // Per-customer monthly usage series (last 6 months) → CRM sparkline.
  const months: string[] = [];
  for (let i = 5; i >= 0; i--) {
    months.push(
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
    );
  }
  const usage = db
    .prepare('SELECT key_hash, month, count FROM api_usage WHERE month >= ?')
    .all(months[0]) as Array<{ key_hash: string; month: string; count: number }>;
  const byHash = new Map<string, Map<string, number>>();
  for (const u of usage) {
    let m = byHash.get(u.key_hash);
    if (!m) {
      m = new Map();
      byHash.set(u.key_hash, m);
    }
    m.set(u.month, u.count);
  }

  // Same blind spot as used_all_time, one level down: a credit key writes no
  // api_usage row, so its sparkline was a flat zero and last_active_month was
  // null — the CRM read an active customer as dormant.
  //
  // request_log carries key_prefix on every authenticated call and covers both
  // payment modes, so it fills the gap for keys api_usage never saw. It counts
  // CALLS where api_usage counts billed units, and the two differ on batch (one
  // call can bill a hundred). That is why it only fills in where the quota
  // ledger is silent, rather than replacing it: mixing the units inside a single
  // series would make two customers incomparable without saying so.
  const callRows = db
    .prepare(
      `SELECT key_prefix, substr(created_at, 1, 7) AS month, COUNT(*) AS calls
         FROM request_log
        WHERE key_prefix IS NOT NULL AND created_at >= ?
        GROUP BY 1, 2`,
    )
    .all(`${months[0]}-01`) as Array<{ key_prefix: string; month: string; calls: number }>;
  const byPrefix = new Map<string, Map<string, number>>();
  for (const r of callRows) {
    let m = byPrefix.get(r.key_prefix);
    if (!m) {
      m = new Map();
      byPrefix.set(r.key_prefix, m);
    }
    m.set(r.month, r.calls);
  }

  const keys = rows.map((r) => {
    const quota = byHash.get(r.key_hash);
    const calls = byPrefix.get(String(r.key_prefix));
    // The fallback is decided per MONTH, not per key. Since the credits branch
    // began writing an observation row, a prepaid customer active before that
    // change has quota rows for the recent months and none for the older ones —
    // a per-key choice would draw those older months as flat zeros and read as a
    // customer who had stopped.
    const series = months.map((mo) => quota?.get(mo) ?? calls?.get(mo) ?? 0);
    const fromQuota = months.some((mo) => quota?.get(mo) !== undefined);
    const fromCalls = months.some(
      (mo) => quota?.get(mo) === undefined && calls?.get(mo) !== undefined,
    );
    const out: Record<string, unknown> = {
      ...r,
      series,
      // Says which ledger the series came from, so a reader never has to guess
      // whether a number is billed units or HTTP calls — the two differ on
      // batch, where one call bills a hundred. 'mixed' is what the per-month
      // fallback can now produce, and naming it is the whole point: mixing the
      // units silently is what would make two customers incomparable.
      series_unit: fromQuota && fromCalls ? 'mixed' : fromCalls ? 'calls' : 'units',
    };
    // Only when the quota ledger has nothing to say, so a monthly key keeps its
    // own answer.
    if (!r.last_active_month && calls?.size) {
      out.last_active_month = [...calls.keys()].sort().pop();
    }
    delete out.key_hash; // internal join key, never exposed
    return out;
  });
  return c.json({ month, prev_month: prevMonth, months, keys });
});

interface EmailSummaryInput {
  email?: unknown;
  mail_count?: unknown;
  received?: unknown;
  sent?: unknown;
  last_date?: unknown;
  last_subject?: unknown;
  last_snippet?: unknown;
}

/**
 * Ingest per-customer email-exchange summaries synced from the tabornio mail DB
 * (separate VPS). Body: { summaries: [{ email, mail_count, received, sent,
 * last_date, last_subject, last_snippet }] }. Upserts by email; the CRM reads
 * them back via the LEFT JOIN in GET /v1/admin/keys.
 */
apiKeys.post('/v1/admin/email-summary', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { summaries?: unknown };
  try {
    body = await c.req.json<{ summaries?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (!Array.isArray(body.summaries)) {
    return c.json({ error: 'invalid_body', message: 'Expected { summaries: [...] }' }, 400);
  }

  const db = getStatsDB();
  const upsert = db.prepare(
    `INSERT INTO email_summaries (email, mail_count, received, sent, last_date, last_subject, last_snippet, updated_at)
     VALUES (@email, @mail_count, @received, @sent, @last_date, @last_subject, @last_snippet, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET
       mail_count = excluded.mail_count, received = excluded.received, sent = excluded.sent,
       last_date = excluded.last_date, last_subject = excluded.last_subject,
       last_snippet = excluded.last_snippet, updated_at = datetime('now')`,
  );
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.length ? v.slice(0, 500) : null;
  const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);

  // Safety net: a caller that forgot the alias table still lands the row on
  // the canonical address (the VPS sync merges alias rows BEFORE posting; this
  // catches any other path so an alias can never split a customer in two).
  const aliasMap = loadAliasMap();
  const tx = db.transaction((rows: EmailSummaryInput[]) => {
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r.email !== 'string' || !r.email.includes('@')) continue;
      upsert.run({
        email: toCanonical(r.email, aliasMap),
        mail_count: num(r.mail_count),
        received: num(r.received),
        sent: num(r.sent),
        last_date: str(r.last_date),
        last_subject: str(r.last_subject),
        last_snippet: str(r.last_snippet),
      });
      n++;
    }
    return n;
  });
  const upserted = tx(body.summaries as EmailSummaryInput[]);
  return c.json({ upserted });
});

interface EmailMessageInput {
  id?: unknown;
  customer_email?: unknown;
  direction?: unknown;
  msg_date?: unknown;
  subject?: unknown;
  snippet?: unknown;
  snippet_fr?: unknown;
  lang?: unknown;
  body?: unknown;
  counterparty?: unknown;
}

/**
 * Ingest full per-customer email messages (one row per message) synced from the
 * tabornio mail DB + Sent folders. Upserts by stable id. Powers the CRM
 * conversation cockpit (GET /v1/admin/email-messages).
 */
apiKeys.post('/v1/admin/email-messages', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { messages?: unknown };
  try {
    body = await c.req.json<{ messages?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (!Array.isArray(body.messages)) {
    return c.json({ error: 'invalid_body', message: 'Expected { messages: [...] }' }, 400);
  }

  const db = getStatsDB();
  const clip = (v: unknown, n: number): string | null =>
    typeof v === 'string' && v.length ? v.slice(0, n) : null;
  const upsert = db.prepare(
    `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, snippet_fr, lang, body, counterparty, no_reply_needed)
     VALUES (@id, @customer_email, @direction, @msg_date, @subject, @snippet, @snippet_fr, @lang, @body, @counterparty, @no_reply_needed)
     -- 🚨 no_reply_needed is deliberately ABSENT from the update list below, so
     -- an omitted column keeps its stored value. Ids are stable md5s and the
     -- whole mailbox is re-ingested every night: assigning it here would erase
     -- every hand-placed mark on the next sync, and a sender rule added today
     -- would retroactively bury months of already-answered threads. Placed at
     -- insert, never touched again. COALESCE is no help — 0 is not NULL.
     ON CONFLICT(id) DO UPDATE SET
       customer_email = excluded.customer_email, direction = excluded.direction,
       msg_date = excluded.msg_date, subject = excluded.subject,
       snippet = excluded.snippet,
       -- Preserve an existing FR translation / detected language when a later
       -- re-sync of the same message carries none (translations are set out-of-band
       -- by translate-messages.py; a raw re-sync must not wipe them).
       snippet_fr = COALESCE(excluded.snippet_fr, snippet_fr),
       lang = COALESCE(excluded.lang, lang),
       body = excluded.body, counterparty = excluded.counterparty`,
  );
  // An outgoing message to a prospect's contact_email means it HAS been
  // contacted — flip the stale preparation status so the API reflects reality
  // (the UI already derives contacted/replied from the thread, but scripts and
  // GET /v1/admin/prospects read the raw status). Message ids are stable
  // (md5 of email|dir|date|subject), so re-syncs retroactively backfill this.
  const markContacted = db.prepare(
    `UPDATE prospects SET status = 'contacte', updated_at = datetime('now')
     WHERE lower(contact_email) = ? AND status IN ('a_mailer', 'a_enrichir')`,
  );
  const aliasMap = loadAliasMap();
  // The "always, for this correspondent" rule, read once for the whole batch
  // like the alias map beside it. Whole addresses, lowercased on both sides;
  // see the table's comment in db.ts for why a fragment is out of the question.
  const noReplySenders = loadNoReplySenders();
  const tx = db.transaction((rows: EmailMessageInput[]) => {
    let n = 0;
    for (const r of rows) {
      if (
        !r ||
        typeof r.id !== 'string' ||
        typeof r.customer_email !== 'string' ||
        !r.customer_email.includes('@')
      )
        continue;
      // Alias-resolved so a second address can never split a thread in two.
      const email = toCanonical(r.customer_email, aliasMap);
      // 'draft' = a CRM-native draft awaiting review in the dashboard. It lives
      // in the same table so the thread UI can show it in place, but it must
      // never count as real correspondence (no prospect status flip below).
      const direction = r.direction === 'out' ? 'out' : r.direction === 'draft' ? 'draft' : 'in';
      // Only an INBOUND message can be "nothing to answer": our own mail never
      // put the ball in our court, and a draft is not correspondence at all.
      //
      // Matched on BOTH the address as sent and its canonical form: the operator
      // clicks the rule on the address he sees, and an alias registered later
      // would otherwise make the rule silently stop firing — the failure mode
      // nobody would ever report, because its symptom is mail reappearing.
      // no_reply_needed is NOT part of EmailMessageInput on purpose: it is
      // computed here, so no ingester can mark a message by asking.
      const raw = r.customer_email.trim().toLowerCase();
      // `counterparty` is the address the message actually CAME FROM, and it is
      // the one the operator sets a rule on — an acknowledgement arrives from
      // no-reply@authority while the thread is filed under the desk we write
      // to, so the two differ in precisely the case this rule exists for.
      // Comparing only the thread key made the intended case never fire while
      // the dangerous one (an ordinary human correspondent) always did; the
      // 30/08/2026 review reproduced both halves. The thread key stays in the
      // comparison for a direct correspondent, where the two are the same
      // string. `direction === 'in'` is load-bearing here, not tidiness: the
      // CRM writes OUR OWN sending mailbox into counterparty on outbound rows,
      // and without the guard a rule could match our own address.
      const from = normalizeSenderAddress(String(r.counterparty ?? ''));
      const noReply =
        direction === 'in' &&
        (noReplySenders.has(email) ||
          noReplySenders.has(raw) ||
          (from !== '' && noReplySenders.has(from)))
          ? 1
          : 0;
      upsert.run({
        id: r.id.slice(0, 200),
        customer_email: email,
        direction,
        msg_date: clip(r.msg_date, 40),
        subject: clip(r.subject, 500),
        snippet: clip(r.snippet, 300),
        snippet_fr: clip(r.snippet_fr, 8000),
        lang: clip(r.lang, 8),
        // 50 000, aligned with the send route and the draft store (dashboard
        // audit 2026-09-01, TABS-10): the 8 000 clip here silently amputated the
        // longest mails after the frontend limit had already been lifted.
        body: clip(r.body, 50_000),
        counterparty: clip(r.counterparty, 255),
        no_reply_needed: noReply,
      });
      if (direction === 'out') markContacted.run(email);
      n++;
    }
    return n;
  });
  const upserted = tx(body.messages as EmailMessageInput[]);
  return c.json({ upserted });
});

/**
 * The whole mailbox, or a lighter cut of it.
 *
 * Two OPTIONAL query parameters, added 2026-09-01 for the dashboard audit
 * findings TABS-12 and TABS-03. Both default to the answer this endpoint has
 * always given, because the CRM pages and this API ship from two platforms:
 * between the two pushes, an older caller must keep receiving exactly what it
 * received before.
 *
 *  - `fields=summary` drops `body`. Bodies are the bulk of this payload by a
 *    wide margin, and every list view re-downloads all of them to render the
 *    snippets it already has. The open thread asks again without the parameter.
 *  - `since=YYYY-MM-DD` keeps the rows dated on or after that day. Compared as
 *    text on purpose: msg_date is free-form TEXT, so a row we cannot place in
 *    time simply falls out, which is what every reader of this column already
 *    does with it. Anything that is not a plain ISO day is ignored rather than
 *    guessed at, so a malformed parameter widens to the full list instead of
 *    silently emptying it.
 */
apiKeys.get('/v1/admin/email-messages', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const summaryOnly = c.req.query('fields') === 'summary';
  const sinceRaw = c.req.query('since') ?? '';
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) ? sinceRaw : null;
  const columns = summaryOnly
    ? `id, customer_email, direction, msg_date, subject, snippet, snippet_fr, lang, counterparty, no_reply_needed`
    : `id, customer_email, direction, msg_date, subject, snippet, snippet_fr, lang, body, counterparty, no_reply_needed`;
  const rows = since
    ? db
        .prepare(`SELECT ${columns} FROM email_messages WHERE msg_date >= ? ORDER BY msg_date ASC`)
        .all(since)
    : db.prepare(`SELECT ${columns} FROM email_messages ORDER BY msg_date ASC`).all();
  return c.json({ messages: rows });
});

/**
 * Delete a CRM draft — and ONLY a draft. Sent/received history is immutable
 * through this endpoint by design: the WHERE clause refuses anything whose
 * direction isn't 'draft'. Used by the dashboard when a draft is sent (the
 * instant recordSent 'out' row replaces it) or discarded.
 */
apiKeys.post('/v1/admin/email-messages/delete', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { id?: unknown };
  try {
    body = await c.req.json<{ id?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (typeof body.id !== 'string' || !body.id) {
    return c.json({ error: 'invalid_body', message: 'Expected { id: "…" }' }, 400);
  }
  const db = getStatsDB();
  const res = db
    .prepare(`DELETE FROM email_messages WHERE id = ? AND direction = 'draft'`)
    .run(body.id);
  return c.json({ deleted: res.changes });
});

/**
 * « Rien à répondre » — mark ONE inbound message as needing no answer.
 *
 * The mark lives on the message rather than on the contact, and that is the
 * whole point: a thread leaves « À répondre » while its last datable inbound
 * carries the mark, and comes back by itself the day a new unmarked inbound
 * arrives. Nothing to expire, nothing to reopen, and it works for contacts who
 * have no prospect row at all — self-service customers, institutional
 * correspondence — which the prospect `outcome` values could never reach.
 *
 * Only direction = 'in' can be marked, the same way /delete only accepts a
 * draft: our own outbound never put the ball in our court, and a draft is not
 * correspondence. An unknown id, an outbound or a draft answers
 * { updated: 0 } with a 200 — the operation is idempotent, and refusing it
 * loudly would only teach the UI to treat a no-op as a failure.
 *
 * Body: { id, value }. Re-clicking with value:false takes the mark back, which
 * is how a misplaced one is undone.
 */
apiKeys.post('/v1/admin/email-messages/no-reply', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { id?: unknown; value?: unknown };
  try {
    body = await c.req.json<{ id?: unknown; value?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (typeof body.id !== 'string' || !body.id) {
    return c.json(
      { error: 'invalid_body', message: 'Expected { id: "…", value: true|false }' },
      400,
    );
  }
  // Strictly boolean, never coerced: a body whose `value` arrived as the string
  // "false" or as undefined would otherwise quietly UNMARK a message the
  // operator meant to mark, and a silent wrong write is the one outcome this
  // endpoint has no way to show him.
  if (typeof body.value !== 'boolean') {
    return c.json({ error: 'invalid_body', message: 'value must be a boolean' }, 400);
  }
  const db = getStatsDB();
  const res = db
    .prepare(`UPDATE email_messages SET no_reply_needed = ? WHERE id = ? AND direction = 'in'`)
    .run(body.value ? 1 : 0, body.id);
  return c.json({ updated: res.changes });
});

/**
 * The standing version of the same judgement: every FUTURE inbound message
 * from this address arrives already marked (applied by
 * POST /v1/admin/email-messages at insert time).
 *
 * Never set as a side effect of marking one message — the UI must ask a second
 * time. A rule posted silently would bury an authority's next mail, and the
 * only way to notice would be that nothing ever arrived.
 *
 * Removing an address stops the stamping and deliberately leaves already-marked
 * messages alone: each of those was a judgement about a message that was
 * true when it was made, and rewriting history here would resurrect threads
 * that were legitimately settled.
 */
apiKeys.get('/v1/admin/no-reply-senders', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ senders: listNoReplySenders() });
});

apiKeys.post('/v1/admin/no-reply-senders', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { address?: unknown; value?: unknown };
  try {
    body = await c.req.json<{ address?: unknown; value?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  // A whole address or nothing: an entry without '@' could only be a fragment,
  // and a fragment is precisely what must never enter this table.
  const address = typeof body.address === 'string' ? normalizeSenderAddress(body.address) : '';
  if (!address.includes('@')) {
    return c.json(
      { error: 'invalid_body', message: 'Expected { address: "…@…", value: true|false }' },
      400,
    );
  }
  if (typeof body.value !== 'boolean') {
    return c.json({ error: 'invalid_body', message: 'value must be a boolean' }, 400);
  }
  // Setting a rule is refused on any address a person could write from; see
  // isRuleEligibleSender for the case that closed this door. Removing one is
  // always allowed — an address that slipped in before this guard, or one whose
  // shape we read wrong, must never be un-removable.
  if (body.value && !isRuleEligibleSender(address)) {
    return c.json(
      {
        error: 'sender_not_eligible',
        message:
          'A standing rule marks mail nobody has read yet, so it is only accepted on addresses that are never a person (no-reply@, notifications@, mailer-daemon@ and the like). Mark this correspondent message by message instead.',
      },
      422,
    );
  }
  setNoReplySender(address, body.value);
  return c.json({ address, value: body.value });
});

/**
 * Per-customer API activity for the CRM: which endpoints each key calls + the
 * per-day activity over the last 30 days. Keyed by key_prefix. Populated
 * forward-only since request_log.key_prefix was added (historical rows NULL).
 */
apiKeys.get('/v1/admin/client-activity', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const endpoints = db
    .prepare(
      `SELECT key_prefix, path, COUNT(*) AS count
       FROM request_log
       WHERE key_prefix IS NOT NULL AND status < 400
       GROUP BY key_prefix, path
       ORDER BY key_prefix, count DESC`,
    )
    .all() as Array<{ key_prefix: string; path: string; count: number }>;
  const days = db
    .prepare(
      `SELECT key_prefix, date(created_at) AS day, COUNT(*) AS count
       FROM request_log
       WHERE key_prefix IS NOT NULL AND created_at >= date('now', '-30 days')
       GROUP BY key_prefix, day
       ORDER BY key_prefix, day`,
    )
    .all() as Array<{ key_prefix: string; day: string; count: number }>;

  type Activity = {
    endpoints: Array<{ path: string; count: number }>;
    days: Array<{ day: string; count: number }>;
  };
  const byKey: Record<string, Activity> = {};
  const ensure = (k: string): Activity => (byKey[k] ??= { endpoints: [], days: [] });
  for (const e of endpoints) ensure(e.key_prefix).endpoints.push({ path: e.path, count: e.count });
  for (const d of days) ensure(d.key_prefix).days.push({ day: d.day, count: d.count });
  return c.json({ by_key: byKey });
});

/**
 * Raise the monthly limit of one key — the missing gesture behind the CRM's
 * "blocked" banner. Bounded on purpose (never unlimited: this is a relief
 * valve, not a tap), journaled in `events`, effective on the customer's very
 * next request because validateApiKey re-reads monthly_limit each call.
 */
apiKeys.post('/v1/admin/keys/raise-limit', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { key_prefix?: unknown; monthly_limit?: unknown };
  try {
    body = await c.req.json<{ key_prefix?: unknown; monthly_limit?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const keyPrefix = typeof body.key_prefix === 'string' ? body.key_prefix.trim() : '';
  const limit = typeof body.monthly_limit === 'number' ? Math.floor(body.monthly_limit) : NaN;
  if (!/^ifk_[a-f0-9]{8}$/.test(keyPrefix)) {
    return c.json({ error: 'invalid_input', message: 'key_prefix attendu (ifk_xxxxxxxx)' }, 400);
  }
  if (!Number.isFinite(limit) || limit < 100 || limit > 20_000) {
    return c.json({ error: 'invalid_input', message: 'monthly_limit borné à [100, 20000]' }, 400);
  }
  const db = getStatsDB();
  const before = db
    .prepare('SELECT monthly_limit, email FROM api_keys WHERE key_prefix = ?')
    .get(keyPrefix) as { monthly_limit: number | null; email: string } | undefined;
  if (!before) return c.json({ error: 'not_found' }, 404);
  db.prepare('UPDATE api_keys SET monthly_limit = ? WHERE key_prefix = ?').run(limit, keyPrefix);
  db.prepare(`INSERT INTO events (kind, label) VALUES ('manual', ?)`).run(
    `quota relevé via CRM : ${keyPrefix} ${before.monthly_limit ?? 200} → ${limit}/mois`,
  );
  console.log(`[admin] raise-limit ${keyPrefix}: ${before.monthly_limit ?? 200} -> ${limit}`);
  return c.json({
    key_prefix: keyPrefix,
    previous_limit: before.monthly_limit ?? 200,
    monthly_limit: limit,
  });
});

/**
 * Hour-by-hour activity of ONE customer over the last 24 h, all their keys
 * combined — the finest scale of the Clients activity chart. Buckets are UTC
 * (SQLite stores UTC); the client renders them in local time. Fetched lazily
 * when the operator picks the 24 h scale, so it stays out of the page load.
 */
apiKeys.get('/v1/admin/client-hours', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const email = (c.req.query('email') ?? '').trim().toLowerCase();
  if (!email) return c.json({ error: 'invalid_input', message: 'email requis' }, 400);
  const rows = getStatsDB()
    .prepare(
      `SELECT strftime('%Y-%m-%dT%H:00', r.created_at) AS hour,
              COUNT(*) AS count,
              SUM(CASE WHEN r.status >= 400 THEN 1 ELSE 0 END) AS bad
       FROM request_log r
       WHERE r.created_at >= datetime('now', '-24 hours')
         AND r.key_prefix IN (SELECT key_prefix FROM api_keys WHERE LOWER(email) = ?)
       GROUP BY hour
       ORDER BY hour`,
    )
    .all(email) as Array<{ hour: string; count: number; bad: number }>;
  return c.json({ email, hours: rows });
});

/**
 * Everything the Clients tab needs about each customer's API use, in one call:
 * volume and verdict mix, endpoints, countries checked, latency they actually
 * experience, the shape of their day, their stack, and how many machines call.
 *
 * Separate from /v1/admin/client-activity, which stays as-is: that one feeds the
 * sparkline on the Contacts page and is fetched on every render of it.
 */
apiKeys.get('/v1/admin/client-profiles', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const daysParam = parseInt(c.req.query('days') ?? '90', 10);
  const days = Number.isNaN(daysParam) ? 90 : Math.max(1, Math.min(365, daysParam));
  const db = getStatsDB();
  // Monthly consumption per key, so the panel can show the trend rather than
  // only the current month. api_usage is keyed by hash; the CRM knows prefixes.
  const usage = db
    .prepare(
      `SELECT k.key_prefix, u.month, u.count
       FROM api_usage u JOIN api_keys k ON k.key_hash = u.key_hash
       ORDER BY k.key_prefix, u.month`,
    )
    .all() as Array<{ key_prefix: string; month: string; count: number }>;
  const monthsByKey: Record<string, Array<{ month: string; count: number }>> = {};
  for (const r of usage)
    (monthsByKey[r.key_prefix] ??= []).push({ month: r.month, count: r.count });
  // Which keys we have already warned about their quota, so the panel does not
  // suggest sending a notice twice.
  const warned = db
    .prepare(
      `SELECT k.key_prefix, q.month FROM quota_notices q JOIN api_keys k ON k.key_hash = q.key_hash`,
    )
    .all() as Array<{ key_prefix: string; month: string }>;
  const warnedByKey: Record<string, string[]> = {};
  for (const r of warned) (warnedByKey[r.key_prefix] ??= []).push(r.month);

  return c.json({
    period_days: days,
    profiles: getClientProfiles(days),
    months_by_key: monthsByKey,
    quota_warned_by_key: warnedByKey,
  });
});

/**
 * The activation picture the dashboard's Clients view reads: everything
 * aggregated per EMAIL (a buyer's pack lives on a separate key whose monthly
 * counter stays at zero — any per-key reading shows a paying customer as
 * unused). Two periods only: the dashboard's own selector offers 30 and 90.
 */
apiKeys.get('/v1/admin/activation', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const daysParam = parseInt(c.req.query('days') ?? '30', 10);
  const days = daysParam === 90 ? 90 : 30;
  return c.json(getActivation(days));
});

/**
 * Manual chart annotation — "rotation du secret", "campagne annuaire",
 * "mention presse". One line on the dashboard charts is what turns a traffic
 * move from a mystery into a caption.
 */
apiKeys.post('/v1/admin/events', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { label?: unknown };
  try {
    body = await c.req.json<{ label?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) {
    return c.json({ error: 'label_required', message: 'A non-empty label is required.' }, 400);
  }
  recordEvent('manual', label);
  return c.json({ recorded: true }, 201);
});

/**
 * The listing watch. A VPS probe walks the directories daily and posts what it
 * saw; the overview reads it back. Getting listed is a one-off effort, staying
 * listed is nobody's job, and a purge is silent.
 */
apiKeys.get('/v1/admin/visibility', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ surfaces: getVisibility() });
});

apiKeys.post('/v1/admin/visibility', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { checks?: unknown };
  try {
    body = await c.req.json<{ checks?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!Array.isArray(body.checks) || body.checks.length === 0) {
    return c.json(
      { error: 'invalid_body', message: 'Expected { checks: [{surface, state}] }' },
      400,
    );
  }
  let saved = 0;
  for (const raw of body.checks) {
    const c2 = raw as { surface?: unknown; state?: unknown; detail?: unknown; url?: unknown };
    if (typeof c2.surface !== 'string' || !isVisibilityState(c2.state)) continue;
    recordVisibility({
      surface: c2.surface,
      state: c2.state,
      detail: typeof c2.detail === 'string' ? c2.detail : null,
      url: typeof c2.url === 'string' ? c2.url : null,
    });
    saved += 1;
  }
  return c.json({ saved }, 201);
});

// ──────────────────────────────────────────────────────────────────────────────
// Mail the CRM cannot attach to anyone.
//
// The sync fetches threads for known addresses only, so a customer answering
// from an address other than the one his key is registered under disappears.
// These routes carry the set-aside messages to a place they will be seen; the
// attaching itself stays a human decision.
// ──────────────────────────────────────────────────────────────────────────────
apiKeys.get('/v1/admin/orphan-mail', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const includeResolved = c.req.query('all') === '1';
  return c.json({ orphans: getOrphans(includeResolved), pending: countPendingOrphans() });
});

apiKeys.post('/v1/admin/orphan-mail', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { messages?: unknown };
  try {
    body = await c.req.json<{ messages?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!Array.isArray(body.messages)) {
    return c.json(
      { error: 'invalid_body', message: 'Expected { messages: [{id, sender, msg_date, kind}] }' },
      400,
    );
  }
  let saved = 0;
  for (const raw of body.messages) {
    const m = raw as Record<string, unknown>;
    // Skipped rather than rejected: one malformed row in a nightly batch must
    // not cost the whole run, and the sync has no way to retry a 400.
    if (typeof m.id !== 'string' || typeof m.sender !== 'string') continue;
    if (typeof m.msg_date !== 'string' || !isOrphanKind(m.kind)) continue;
    recordOrphan({
      id: m.id,
      sender: m.sender,
      subject: typeof m.subject === 'string' ? m.subject : null,
      snippet: typeof m.snippet === 'string' ? m.snippet : null,
      msg_date: m.msg_date,
      kind: m.kind,
    });
    saved += 1;
  }
  return c.json({ saved, pending: countPendingOrphans() }, 201);
});

/**
 * Address aliases (lot B2): the "attach this mail to that customer" gesture.
 * The list is read by the VPS sync at each run to widen its known-address net
 * and merge alias threads into the canonical customer.
 */
apiKeys.get('/v1/admin/email-aliases', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ aliases: listAliases() });
});

apiKeys.post('/v1/admin/email-aliases', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { alias?: unknown; canonical?: unknown };
  try {
    body = await c.req.json<{ alias?: unknown; canonical?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.alias !== 'string' || typeof body.canonical !== 'string') {
    return c.json({ error: 'invalid_body', message: 'Expected { alias, canonical }' }, 400);
  }
  const res = addAlias(body.alias, body.canonical);
  if (!res.ok) return c.json({ error: 'invalid_alias', message: res.reason }, 400);
  return c.json({ aliases: listAliases() });
});

/**
 * Institutional correspondents: the authorities, central banks, payment
 * networks and suppliers we write to for reuse permissions and regulatory
 * questions.
 *
 * They are neither customers nor prospects, so nothing in the CRM knew their
 * addresses, and their answers fell into orphan mail waiting for a human to
 * recognise the sender. This registry ends that: like the alias list two blocks
 * up, it is read by the VPS sync at each run to widen its net of known
 * addresses — same role, other population.
 *
 * Write-side only. The threads stay in email_messages, attached by lowercase
 * address, which is why the registry keys on the lowercase address too.
 */
apiKeys.get('/v1/admin/institutional-contacts', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ contacts: listInstitutionalContacts() });
});

apiKeys.post('/v1/admin/institutional-contacts', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: unknown;
  try {
    body = await c.req.json<unknown>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  // `null` and `[]` are valid JSON: reading a field off them throws, and the
  // caller would get a 500 where the contract promises a 400.
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json(
      {
        error: 'invalid_input',
        message: 'Corps attendu : un contact { email, org, category, ... }',
      },
      400,
    );
  }
  const res = upsertInstitutionalContact(body as InstitutionalContactInput);
  if (!res.ok) return c.json({ error: 'invalid_input', message: res.reason }, 400);
  return c.json({ contacts: listInstitutionalContacts() });
});

apiKeys.post('/v1/admin/institutional-contacts/delete', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email) return c.json({ error: 'invalid_input', message: 'email requis' }, 400);
  // Absence is the 404 above, so `deleted` can only ever be 1 here. It is kept
  // as a count to read like /v1/admin/email-messages/delete.
  if (!deleteInstitutionalContact(email)) return c.json({ error: 'not_found' }, 404);
  return c.json({ deleted: 1, contacts: listInstitutionalContacts() });
});

apiKeys.post('/v1/admin/orphan-mail/resolve', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { id?: unknown; attached_to?: unknown };
  try {
    body = await c.req.json<{ id?: unknown; attached_to?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.id !== 'string') {
    return c.json({ error: 'invalid_body', message: 'Expected { id, attached_to? }' }, 400);
  }
  const ok = resolveOrphan(body.id, typeof body.attached_to === 'string' ? body.attached_to : null);
  if (!ok) return c.json({ error: 'not_found' }, 404);
  return c.json({ resolved: body.id, pending: countPendingOrphans() });
});

/**
 * The French gist of one orphan, written by the dashboard after the VPS writer
 * answered. Idempotent: a second write for the same id is a no-op that still
 * answers 200, so a retried request never overwrites a gist already read.
 */
apiKeys.post('/v1/admin/orphan-mail/gist', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { id?: unknown; gist_fr?: unknown };
  try {
    body = await c.req.json<{ id?: unknown; gist_fr?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const gist = (typeof body.gist_fr === 'string' ? stripEmDashes(body.gist_fr.trim()) : null) ?? '';
  if (typeof body.id !== 'string' || !gist || gist.length > 1200) {
    return c.json(
      { error: 'invalid_body', message: 'Expected { id, gist_fr } (1 to 1200 chars)' },
      400,
    );
  }
  const exists = getOrphans(true, 100000).some((o) => o.id === body.id);
  if (!exists) return c.json({ error: 'not_found' }, 404);
  const written = setOrphanGist(body.id, gist);
  return c.json({ id: body.id, written });
});

/**
 * The Monday digest's raw material: every WoW delta pre-computed in tested
 * TS (lib/weekly-facts.ts). The VPS writer copies these numbers verbatim
 * into French prose — one admin secret on the VPS covers the whole flow.
 */
apiKeys.get('/v1/admin/weekly-facts', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json(getWeeklyFacts());
});

/**
 * Digest storage. POST upserts by ISO week so the cron can re-run safely;
 * GET feeds the dashboard card, newest week first.
 */
apiKeys.post('/v1/admin/digest', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { week?: unknown; body_fr?: unknown; facts_json?: unknown };
  try {
    body = await c.req.json<{ week?: unknown; body_fr?: unknown; facts_json?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const week = typeof body.week === 'string' ? body.week.trim() : '';
  const bodyFr = typeof body.body_fr === 'string' ? body.body_fr.trim() : '';
  if (!/^\d{4}-W\d{2}$/.test(week)) {
    return c.json({ error: 'invalid_week', message: 'week must look like 2026-W32' }, 400);
  }
  if (!bodyFr) {
    return c.json({ error: 'body_required', message: 'body_fr must be non-empty' }, 400);
  }
  const factsJson =
    typeof body.facts_json === 'string' ? body.facts_json : JSON.stringify(body.facts_json ?? null);
  saveWeeklyDigest(week, bodyFr, factsJson);
  return c.json({ saved: true, week }, 201);
});

/**
 * Cached French thread summaries ("où on en est"), one per counterpart
 * address. `key` fingerprints the thread state the summary was written
 * against; a mismatch is a miss, so the frontend regenerates exactly when a
 * message has arrived or left and never on a timer.
 */
apiKeys.get('/v1/admin/thread-summary', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const email = (c.req.query('email') ?? '').trim().toLowerCase();
  const key = (c.req.query('key') ?? '').trim();
  if (!email || !key) {
    return c.json({ error: 'invalid_query', message: 'email and key are required' }, 400);
  }
  const row = getStatsDB()
    .prepare('SELECT thread_key, summary_fr, created_at FROM thread_summaries WHERE email = ?')
    .get(email) as { thread_key: string; summary_fr: string; created_at: string } | undefined;
  return c.json({ summary: row && row.thread_key === key ? row : null });
});

apiKeys.post('/v1/admin/thread-summary', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { email?: unknown; thread_key?: unknown; summary_fr?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; thread_key?: unknown; summary_fr?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const key = typeof body.thread_key === 'string' ? body.thread_key.trim() : '';
  const summary = typeof body.summary_fr === 'string' ? body.summary_fr.trim() : '';
  if (!email || !key || !summary) {
    return c.json(
      { error: 'invalid_body', message: 'email, thread_key and summary_fr are required' },
      400,
    );
  }
  getStatsDB()
    .prepare(
      `INSERT INTO thread_summaries (email, thread_key, summary_fr) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET thread_key = excluded.thread_key, summary_fr = excluded.summary_fr, created_at = datetime('now')`,
    )
    .run(email, key, summary.slice(0, 2000));
  return c.json({ saved: true }, 201);
});

/**
 * The operator's working memory, one dated note at a time. Read back into
 * every AI draft brief: what the operator knows, the writer knows.
 */
apiKeys.get('/v1/admin/contact-notes', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const email = (c.req.query('email') ?? '').trim().toLowerCase();
  if (!email) return c.json({ error: 'invalid_query', message: 'email is required' }, 400);
  const notes = getStatsDB()
    .prepare(
      'SELECT id, note, created_at FROM contact_notes WHERE email = ? ORDER BY id DESC LIMIT 50',
    )
    .all(email);
  return c.json({ notes });
});

apiKeys.post('/v1/admin/contact-notes', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { email?: unknown; note?: unknown };
  try {
    body = await c.req.json<{ email?: unknown; note?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!email || !note) {
    return c.json(
      { error: 'invalid_body', message: 'email and a non-empty note are required' },
      400,
    );
  }
  const r = getStatsDB()
    .prepare('INSERT INTO contact_notes (email, note) VALUES (?, ?)')
    .run(email, note.slice(0, 1000));
  return c.json({ saved: true, id: Number(r.lastInsertRowid) }, 201);
});

apiKeys.delete('/v1/admin/contact-notes', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const id = parseInt(c.req.query('id') ?? '', 10);
  if (Number.isNaN(id)) return c.json({ error: 'invalid_query', message: 'id is required' }, 400);
  const r = getStatsDB().prepare('DELETE FROM contact_notes WHERE id = ?').run(id);
  return c.json({ deleted: r.changes });
});

apiKeys.get('/v1/admin/digest', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const limitParam = parseInt(c.req.query('limit') ?? '8', 10);
  const limit = Number.isNaN(limitParam) ? 8 : limitParam;
  return c.json({ digests: getWeeklyDigests(limit) });
});

/**
 * The other half of the audience: everyone who calls without a key. Crawlers,
 * MCP registries, x402 probes, agent directories and the odd human with curl.
 * Keyed by user agent, which is what survives an IP_HASH_SECRET rotation.
 */
apiKeys.get('/v1/admin/bot-profiles', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const daysParam = parseInt(c.req.query('days') ?? '90', 10);
  const days = Number.isNaN(daysParam) ? 90 : Math.max(1, Math.min(365, daysParam));
  const minParam = parseInt(c.req.query('min') ?? '5', 10);
  const min = Number.isNaN(minParam) ? 5 : Math.max(1, Math.min(1000, minParam));
  return c.json({ period_days: days, min_requests: min, bots: getBotProfiles(days, min) });
});

/**
 * Read-only delivery check for a Stripe purchase. NON-CONSUMING: it only SELECTs
 * (never nulls raw_key_one_time_view), so calling it does not affect the
 * customer's success-page retrieval. `raw_key_still_available: true` means the
 * buyer never opened the success page → they may be stuck without their key.
 * Pass ?reveal=1 to also return the raw key (admin only) for a manual backfill.
 */
apiKeys.get('/v1/admin/stripe/delivery/:session_id', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const sessionId = c.req.param('session_id');
  const reveal = c.req.query('reveal') === '1';
  const db = getStatsDB();
  const row = db
    .prepare(
      'SELECT key_prefix, email, credits_total, credits_remaining, raw_key_one_time_view FROM api_keys WHERE stripe_session_id = ?',
    )
    .get(sessionId) as
    | {
        key_prefix: string;
        email: string;
        credits_total: number | null;
        credits_remaining: number | null;
        raw_key_one_time_view: string | null;
      }
    | undefined;
  if (!row) {
    return c.json({ found: false, session_id: sessionId });
  }
  const stillAvailable = row.raw_key_one_time_view !== null;
  return c.json({
    found: true,
    key_prefix: row.key_prefix,
    email: row.email,
    credits_total: row.credits_total,
    credits_remaining: row.credits_remaining,
    delivered_via_success_page: !stillAvailable,
    raw_key_still_available: stillAvailable,
    ...(reveal && stillAvailable ? { raw_key: row.raw_key_one_time_view } : {}),
  });
});

/**
 * Fire a test Telegram purchase alert — verifies the deployed notify wiring
 * (token/chat env + Telegram reachability) without needing a real Stripe event.
 */
apiKeys.post('/v1/admin/test-notify', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const sent = await notifyPurchaseTelegram({
    amountUsd: 0,
    bundle: 'TEST',
    credits: 0,
    keyPrefix: 'ifk_test0000',
  });
  return c.json({ sent });
});

/**
 * Send a test API-key email (verifies the deployed SMTP wiring once SMTP_* is
 * set on the server). Pass ?to=you@example.com. No-ops + reports if unconfigured.
 */
apiKeys.post('/v1/admin/test-email', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const to = c.req.query('to');
  if (!to || !to.includes('@')) {
    return c.json({ error: 'missing_to', message: 'pass ?to=email@example.com' }, 400);
  }
  const sent = await sendApiKeyEmail({
    to,
    rawKey: 'ifk_test_0000000000000000',
    credits: 0,
    bundle: 'TEST',
  });
  return c.json({ sent, configured: isEmailConfigured() });
});

// ---------------------------------------------------------------------------
// Prospects — outbound list of NOT-yet-customers for the CRM "Prospects" tab.
// Identified by the prospecting campaign; each row carries a pre-written,
// personalized cold email (EN+FR) for review-before-send. Admin-only.
// ---------------------------------------------------------------------------

interface ProspectInput {
  id?: unknown;
  company?: unknown;
  segment?: unknown;
  website?: unknown;
  country?: unknown;
  what_they_do?: unknown;
  fit_reason?: unknown;
  buying_signal?: unknown;
  signal_source_url?: unknown;
  contact_name?: unknown;
  contact_role?: unknown;
  contact_email?: unknown;
  email_source_url?: unknown;
  personalization_hook?: unknown;
  confidence?: unknown;
  status?: unknown;
  mail_subject_en?: unknown;
  mail_body_en?: unknown;
  mail_subject_fr?: unknown;
  mail_body_fr?: unknown;
  recommended_lang?: unknown;
  source?: unknown;
}

/** Stable id from website domain + company, so re-running the campaign upserts. */
function prospectId(r: ProspectInput): string {
  const site = typeof r.website === 'string' ? r.website : '';
  const company = typeof r.company === 'string' ? r.company : '';
  const basis = `${site}|${company}`.toLowerCase().trim();
  return 'p_' + createHash('md5').update(basis).digest('hex').slice(0, 16);
}

/**
 * Em dashes are the most recognisable AI-writing tell, so outreach mail prose
 * is scrubbed on every seed: campaign agents can never reintroduce them into
 * a sendable mail. Context-aware: signature lines get a middot, clause
 * starters a period, everything else a comma. Internal notes are untouched.
 */
function stripEmDashes(text: string | null): string | null {
  if (!text || !text.includes('—')) return text;
  const cleaned = text
    .split('\n')
    .map((line) => {
      if (/ibanforge\.com/i.test(line) || line.trimStart().startsWith('Claude-Alain Martin')) {
        return line.replace(/\s*—\s*/g, ' · ');
      }
      return line
        .replace(/\s*—\s*\(/g, ' (')
        .replace(
          /\s*—\s*(that's|it's|this |these |here's|that is|it is|we |you )/gi,
          (_m, w: string) => `. ${w.charAt(0).toUpperCase()}${w.slice(1)}`,
        )
        .replace(/\s*—\s*/g, ', ');
    })
    .join('\n');
  return cleaned
    .replace(/,\s*,/g, ', ')
    .replace(/[ \t]+,/g, ', ')
    .replace(/,\s*([.;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

apiKeys.get('/v1/admin/prospects', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const rows = db
    .prepare(
      `SELECT id, company, segment, website, country, what_they_do, fit_reason,
              buying_signal, signal_source_url, contact_name, contact_role,
              contact_email, email_source_url, personalization_hook, confidence,
              status, mail_subject_en, mail_body_en, mail_subject_fr, mail_body_fr,
              recommended_lang, source, outcome, outcome_note, wake_up_at, outcome_at,
              created_at, updated_at
       FROM prospects
       ORDER BY
         CASE status WHEN 'a_mailer' THEN 0 WHEN 'a_enrichir' THEN 1 WHEN 'archive' THEN 2 ELSE 3 END,
         company COLLATE NOCASE`,
    )
    .all();
  return c.json({ prospects: rows });
});

/**
 * Upsert a batch of prospects (idempotent by id, derived from website+company
 * when not provided). Body: { prospects: [...] }. Seeds the list from the
 * prospecting campaign; preserves created_at on conflict, refreshes updated_at.
 */
apiKeys.post('/v1/admin/prospects', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { prospects?: unknown };
  try {
    body = await c.req.json<{ prospects?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Request body must be valid JSON' }, 400);
  }
  if (!Array.isArray(body.prospects)) {
    return c.json({ error: 'invalid_body', message: 'Expected { prospects: [...] }' }, 400);
  }

  const db = getStatsDB();
  const clip = (v: unknown, n: number): string | null =>
    typeof v === 'string' && v.length ? v.slice(0, n) : null;
  const upsert = db.prepare(
    `INSERT INTO prospects (id, company, segment, website, country, what_they_do, fit_reason,
        buying_signal, signal_source_url, contact_name, contact_role, contact_email,
        email_source_url, personalization_hook, confidence, status,
        mail_subject_en, mail_body_en, mail_subject_fr, mail_body_fr, recommended_lang, source, updated_at)
     VALUES (@id, @company, @segment, @website, @country, @what_they_do, @fit_reason,
        @buying_signal, @signal_source_url, @contact_name, @contact_role, @contact_email,
        @email_source_url, @personalization_hook, @confidence, @status,
        @mail_subject_en, @mail_body_en, @mail_subject_fr, @mail_body_fr, @recommended_lang, @source, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
        company = excluded.company, segment = excluded.segment, website = excluded.website,
        country = excluded.country, what_they_do = excluded.what_they_do, fit_reason = excluded.fit_reason,
        buying_signal = excluded.buying_signal, signal_source_url = excluded.signal_source_url,
        contact_name = excluded.contact_name, contact_role = excluded.contact_role,
        contact_email = excluded.contact_email, email_source_url = excluded.email_source_url,
        personalization_hook = excluded.personalization_hook, confidence = excluded.confidence,
        status = excluded.status, mail_subject_en = excluded.mail_subject_en, mail_body_en = excluded.mail_body_en,
        mail_subject_fr = excluded.mail_subject_fr, mail_body_fr = excluded.mail_body_fr,
        recommended_lang = excluded.recommended_lang, source = excluded.source, updated_at = datetime('now')`,
  );
  const tx = db.transaction((rows: ProspectInput[]) => {
    let n = 0;
    for (const r of rows) {
      if (!r || typeof r.company !== 'string' || !r.company.trim()) continue;
      upsert.run({
        id: clip(r.id, 200) || prospectId(r),
        company: r.company.slice(0, 200),
        segment: clip(r.segment, 40),
        website: clip(r.website, 300),
        country: clip(r.country, 80),
        what_they_do: clip(r.what_they_do, 1000),
        fit_reason: clip(r.fit_reason, 1000),
        buying_signal: clip(r.buying_signal, 1000),
        signal_source_url: clip(r.signal_source_url, 500),
        contact_name: clip(r.contact_name, 120),
        contact_role: clip(r.contact_role, 120),
        contact_email: clip(r.contact_email, 200),
        email_source_url: clip(r.email_source_url, 500),
        personalization_hook: clip(r.personalization_hook, 1000),
        confidence: clip(r.confidence, 20),
        status: clip(r.status, 20) || 'a_enrichir',
        mail_subject_en: stripEmDashes(clip(r.mail_subject_en, 300)),
        mail_body_en: stripEmDashes(clip(r.mail_body_en, 6000)),
        mail_subject_fr: stripEmDashes(clip(r.mail_subject_fr, 300)),
        mail_body_fr: stripEmDashes(clip(r.mail_body_fr, 6000)),
        recommended_lang: clip(r.recommended_lang, 8),
        source: clip(r.source, 80),
      });
      n++;
    }
    return n;
  });
  const upserted = tx(body.prospects as ProspectInput[]);
  return c.json({ upserted });
});

/**
 * Update one prospect from the UI: its sourcing status, its outcome, or both.
 *
 * Two independent axes, and the endpoint keeps them independent. `status` says
 * where the sourcing got to (address found, mail ready, contacted, set aside,
 * rejected). `outcome` says where the RELATIONSHIP got to, which no value of
 * `status` can express. Sending one never disturbs the other.
 *
 * Body: { id, status? , outcome?, outcomeNote?, wakeUpAt? }. At least one of
 * status or outcome must be present. `outcome: null` clears the outcome, which
 * is how a judgement recorded by mistake is taken back.
 */
apiKeys.post('/v1/admin/prospects/update', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: {
    id?: unknown;
    status?: unknown;
    outcome?: unknown;
    outcomeNote?: unknown;
    wakeUpAt?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.id !== 'string') {
    return c.json({ error: 'invalid_body', message: 'Expected { id, status? , outcome? }' }, 400);
  }

  const hasStatus = body.status !== undefined;
  const hasOutcome = body.outcome !== undefined;
  // A bare wakeUpAt is the list's quick-snooze gesture: "hide this until".
  // It deliberately records NO outcome — a snooze is a scheduling act, not a
  // judgement about the relationship, and reusing pas_maintenant for it would
  // teach the outcome data a lesson nobody meant.
  const hasBareWake = !hasOutcome && body.wakeUpAt !== undefined;
  if (!hasStatus && !hasOutcome && !hasBareWake) {
    return c.json(
      { error: 'invalid_body', message: 'Expected at least one of status, outcome, wakeUpAt' },
      400,
    );
  }

  const sets: string[] = [];
  const args: Array<string | null> = [];

  if (hasBareWake) {
    if (typeof body.wakeUpAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.wakeUpAt)) {
      return c.json({ error: 'invalid_wake_up_at', message: 'wakeUpAt must be YYYY-MM-DD' }, 400);
    }
    sets.push('wake_up_at = ?');
    args.push(body.wakeUpAt);
  }

  if (hasStatus) {
    const allowed = ['a_mailer', 'a_enrichir', 'archive', 'rejete'];
    if (typeof body.status !== 'string' || !allowed.includes(body.status)) {
      return c.json(
        { error: 'invalid_status', message: `status must be one of ${allowed.join(', ')}` },
        400,
      );
    }
    sets.push('status = ?');
    args.push(body.status);
  }

  if (hasOutcome) {
    const allowed = ['en_discussion', 'pas_maintenant', 'pas_interesse', 'mauvaise_personne'];
    if (
      body.outcome !== null &&
      (typeof body.outcome !== 'string' || !allowed.includes(body.outcome))
    ) {
      return c.json(
        {
          error: 'invalid_outcome',
          message: `outcome must be null or one of ${allowed.join(', ')}`,
        },
        400,
      );
    }
    const outcome = body.outcome as string | null;

    // A wake-up date only means something for "not now". Accepting one on any
    // other outcome would let a contact judged dead quietly resurface.
    let wakeUpAt: string | null = null;
    if (outcome === 'pas_maintenant') {
      if (typeof body.wakeUpAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.wakeUpAt)) {
        return c.json(
          {
            error: 'invalid_wake_up_at',
            message: 'pas_maintenant requires wakeUpAt as YYYY-MM-DD',
          },
          400,
        );
      }
      wakeUpAt = body.wakeUpAt;
    }

    const note =
      typeof body.outcomeNote === 'string' && body.outcomeNote.trim()
        ? body.outcomeNote.trim().slice(0, 500)
        : null;

    sets.push('outcome = ?', 'outcome_note = ?', 'wake_up_at = ?', 'outcome_at = ?');
    // Clearing the outcome clears everything that hangs off it, so no orphan
    // wake-up date survives to wake a contact nobody is waiting on any more.
    args.push(
      outcome,
      outcome === null ? null : note,
      wakeUpAt,
      outcome === null ? null : new Date().toISOString(),
    );
  }

  const db = getStatsDB();
  const r = db
    .prepare(`UPDATE prospects SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...args, body.id);
  return c.json({ updated: r.changes });
});

/**
 * Kick the prospect enrichment backfill NOW instead of waiting for its 6 h
 * cadence — fire-and-forget, same posture as POST /v1/admin/forum-scan. The
 * manual limits are wider than the cadence's: this is the catch-up gesture.
 */
apiKeys.post('/v1/admin/prospects/backfill', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (isProspectBackfillRunning()) {
    return c.json({ started: false, reason: 'already_running' });
  }
  void runProspectBackfill({ enrichLimit: 12, draftLimit: 12, clientLimit: 12 }).catch((err) =>
    console.error('[prospect-radar] manual run failed:', err instanceof Error ? err.message : err),
  );
  return c.json({ started: true });
});

apiKeys.get('/v1/admin/prospects/backfill', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ running: isProspectBackfillRunning(), ...lastProspectBackfillReport() });
});

/**
 * Signup cohort radar: run it now rather than waiting for the hourly tick, and
 * read what the last pass did. The scan only ever relabels and changes the quota
 * basis, both reversible via POST /v1/admin/keys/relabel with the saved mapping.
 */
apiKeys.post('/v1/admin/cohort-scan', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (isCohortScanRunning()) {
    return c.json({ started: false, reason: 'already_running' });
  }
  void runCohortScan().catch((err) =>
    console.error('[cohort-radar] manual run failed:', err instanceof Error ? err.message : err),
  );
  return c.json({ started: true });
});

apiKeys.get('/v1/admin/cohort-scan', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ running: isCohortScanRunning(), ...lastCohortReport() });
});

/**
 * The radar's undo trail: (key_prefix, old_email) for every key it regrouped.
 * To reverse a match, feed these back to POST /v1/admin/keys/relabel with the
 * old_email and no_recredit:false. Optional ?address= narrows to one cohort.
 */
apiKeys.get('/v1/admin/cohort-relabels', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ relabels: getCohortRelabels(c.req.query('address')) });
});

/**
 * The first-call machine, read side: what the daily pass sent, to whom, and
 * whether the relay took it.
 *
 * `ledger` is the durable one-nudge-per-address list; `report` is only the last
 * pass. A row with `delivered: 0` is an address whose single nudge was claimed
 * and then not delivered (relay down at that minute). Nothing retries it on its
 * own, on purpose: at-most-once is what keeps this channel credible. To offer
 * one a second chance, delete its row and the next pass picks it up again.
 *
 * ?limit= caps the ledger (default 200, hard ceiling 1000).
 */
apiKeys.get('/v1/admin/activation-nudges', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const limit = Number.parseInt(c.req.query('limit') ?? '200', 10);
  const ledger = getNudgeLedger(Number.isFinite(limit) ? limit : 200);
  return c.json({
    running: isActivationPassRunning(),
    // Both must be true for anything to leave: the kill switch and a relay.
    nudges_enabled: !isNudgeDisabled(),
    mail_configured: isEmailConfigured(),
    kill_switch_env: 'ACTIVATION_NUDGE_DISABLED',
    sent_total: ledger.length,
    not_delivered: ledger.filter((r) => r.delivered === 0).length,
    ledger,
    ...lastActivationReport(),
  });
});

/**
 * Run the daily pass now instead of waiting for the tick. Same guarantees as
 * the scheduled run: at most one nudge per address ever, and a founder draft is
 * written but never sent.
 */
apiKeys.post('/v1/admin/activation-nudges/run', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  if (isActivationPassRunning()) {
    return c.json({ started: false, reason: 'already_running' });
  }
  void runActivationPass().catch((err) =>
    console.error(
      '[activation-nudge] manual run failed:',
      err instanceof Error ? err.message : err,
    ),
  );
  return c.json({ started: true });
});

/**
 * Customer activity profiles (who they are, what they do) — the enrichment
 * radar and the 19/08 audit write here; the Clients/Contacts dossiers read
 * it as the fallback behind prospect rows.
 */
apiKeys.get('/v1/admin/company-profiles', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return c.json({ profiles: getCompanyProfiles() });
});

apiKeys.post('/v1/admin/company-profiles', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { profiles?: unknown };
  try {
    body = await c.req.json<{ profiles?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!Array.isArray(body.profiles)) {
    return c.json({ error: 'invalid_body', message: 'Expected { profiles: [...] }' }, 400);
  }
  const allowedSources: ProfileSource[] = ['site', 'ua', 'audit', 'manual', 'unresolvable'];
  let upserted = 0;
  for (const raw of body.profiles as Array<Record<string, unknown>>) {
    const email = typeof raw.email === 'string' ? raw.email.trim().toLowerCase() : '';
    const source = allowedSources.includes(raw.source as ProfileSource)
      ? (raw.source as ProfileSource)
      : 'manual';
    if (!email || !email.includes('@')) continue;
    upsertCompanyProfile({
      email,
      company: typeof raw.company === 'string' ? raw.company : null,
      website: typeof raw.website === 'string' ? raw.website : null,
      country: typeof raw.country === 'string' ? raw.country : null,
      whatTheyDo: typeof raw.what_they_do === 'string' ? raw.what_they_do : null,
      source,
    });
    upserted++;
  }
  return c.json({ upserted });
});

// ---------------------------------------------------------------------------
// Thread read-state — inbox-style unread markers per counterpart email.
// A thread is unread when it has an inbound message newer than last_read_at.
// ---------------------------------------------------------------------------

apiKeys.get('/v1/admin/thread-reads', (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const db = getStatsDB();
  const rows = db.prepare('SELECT email, last_read_at FROM thread_reads').all() as Array<{
    email: string;
    last_read_at: string | null;
  }>;
  const reads: Record<string, string> = {};
  for (const r of rows) if (r.last_read_at) reads[r.email] = r.last_read_at;
  return c.json({ reads });
});

apiKeys.post('/v1/admin/thread-read', async (c) => {
  if (!isAdminAuthorized(c.req.header('X-Admin-Secret'))) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  let body: { email?: unknown };
  try {
    body = await c.req.json<{ email?: unknown }>();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body.email !== 'string' || !body.email.includes('@')) {
    return c.json({ error: 'invalid_body', message: 'Expected { email }' }, 400);
  }
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO thread_reads (email, last_read_at) VALUES (?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET last_read_at = datetime('now')`,
  ).run(body.email.trim().toLowerCase());
  return c.json({ ok: true });
});

export { apiKeys };
