import { PAYMENT_LINKS, PRICING_PAGE } from './payment-links.js';
import { sendViaRelay, deliverViaRelay, isRelayConfigured, type RelayOutcome } from './mail-transport.js';
import { opsFail } from './ops-alert.js';
import {
  ACCOUNT_PAGE,
  KEY_PLACEHOLDER,
  buildFirstCallHtml,
  buildFirstCallText,
} from './first-call.js';

/**
 * Transactional email for IBANforge — delivers the API key after a Stripe
 * purchase, sent from an @ibanforge.com mailbox via Infomaniak SMTP.
 *
 * Delivery goes over HTTPS through the tabornio relay, NOT SMTP: Railway blocks
 * outbound SMTP below its Pro plan (measured 2026-07-25 — ports 25/465/587 all
 * ETIMEDOUT from this container, HTTPS/443 fine), so every nodemailer send this
 * service ever attempted was dead on arrival. See ./mail-transport.ts.
 *
 * DELIBERATELY separate from openswissdata: IBANforge email must NOT go through
 * openswissdata infrastructure (owner's explicit instruction). The relay uses an
 * @ibanforge.com mailbox on Infomaniak, keeping the published DPA accurate.
 *
 * Fail-soft: an unconfigured or unreachable relay returns false, never throws —
 * the success page and the Telegram alert stay the primary paths, this is the
 * safety net.
 *
 * Env: MAIL_RELAY_URL, MAIL_RELAY_SECRET.
 */
export function isEmailConfigured(): boolean {
  return isRelayConfigured();
}

/**
 * The recipient's domain, and nothing else.
 *
 * SEC-08 (2026-09-01): every failed send used to print the full address into
 * stdout, which Railway keeps. Same class as the query-value leak corrected on
 * 2026-07-25. The domain is what makes the log actionable ("our relay is down"
 * reads differently from "one mailbox refuses us") and it is not the customer.
 *
 * Exported so the rule is asserted rather than trusted.
 */
export function recipientDomain(address: string): string {
  const at = address.lastIndexOf('@');
  if (at === -1 || at === address.length - 1) return 'unknown';
  return address.slice(at + 1).toLowerCase();
}

/**
 * One failed delivery, said twice: once in the log for whoever is reading it,
 * once on the owner's phone for the deliveries that carry a key.
 *
 * QUA-13 (2026-09-01): a key that was paid for and never arrived produced a
 * `console.error` and nothing else, while disk volume, 5xx rate and sanctions
 * age all raise ops alerts. That failure is indistinguishable, from every
 * dashboard we own, from a customer who simply never called, which is the exact
 * question the 30/08 funnel measurement left open. Threshold 1: there is no
 * such thing as an acceptable number of undelivered keys.
 *
 * 🚨 Muted under vitest, and this is not cosmetic. The Stripe webhook delivers
 * without a `VITEST` guard (unlike the free and USDC rails), the suite drives it
 * with the example addresses published in this repo, and no relay is configured
 * there, so EVERY `npm run check` would reach this line. On a shell that has
 * TELEGRAM_BOT_TOKEN set that is a real alert, on the owner's phone, several
 * times per run. An alert that cries wolf on every test run is an alert nobody
 * reads at 3am, which is the one moment it exists for.
 *
 * 🚨 The message itself carries no address and no domain: `./ops-alert.ts` rule 3
 * is stricter than a privacy default, because Telegram is not a declared
 * processor and a corporate domain names a customer nearly as well as their
 * address does. The domain goes to the log, where it makes the line actionable.
 */
export function alertKeyDeliveryFailure(what: string): void {
  if (process.env.VITEST) return;
  void opsFail('mail:key-delivery', `${what}: the relay refused the message or could not be reached.`, 1);
}

/**
 * `alert` is false for the messages that carry no key (quota warning, activation
 * nudge, verification code): losing one of those is a missed nudge, not a lost
 * purchase, and alerting on all of them would drown the one that matters.
 */
function reportUndelivered(what: string, to: string, alert: boolean): void {
  console.error(`[email] ${what} not delivered, recipient domain:`, recipientDomain(to));
  if (alert) alertKeyDeliveryFailure(what);
}

export interface ApiKeyEmailInput {
  rawKey: string;
  credits: number;
  bundle: string;
}

/**
 * Composes the post-purchase key delivery. Pure, so the presence of the raw key
 * and the shape of the first-call block are asserted in tests.
 *
 * The buyer has just paid and is at their most willing minute: this message
 * therefore leads with the command that works, before balance, docs or terms.
 * It used to open on a generic "use it as a Bearer token" snippet against a
 * Swiss IBAN with no expected answer, which told a reader nothing about whether
 * their call had succeeded.
 */
export function buildApiKeyEmail(p: ApiKeyEmailInput): { subject: string; text: string; html: string } {
  const credits = p.credits.toLocaleString('en-US');

  const text =
    `Thanks for your purchase. Your IBANforge API key is ready.\n\n` +
    `API key: ${p.rawKey}\n` +
    `Credits: ${credits} (pack ${p.bundle})\n\n` +
    buildFirstCallText({ bearer: p.rawKey }) +
    `\nCheck your balance any time:\n` +
    `  curl -H "Authorization: Bearer ${p.rawKey}" https://api.ibanforge.com/v1/credits/balance\n\n` +
    `Docs: https://ibanforge.com/docs\n` +
    `Terms: https://ibanforge.com/legal/terms (unused card-paid packs: 14-day refund)\n` +
    `Keep this key safe. It will not be shown again.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your API key is ready</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Thanks for your purchase: <b style="color:#fafafa">${credits} credits</b> (pack ${p.bundle}).</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin:0 0 8px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Your API key</div>
      <code style="font-family:'JetBrains Mono',monospace;font-size:14px;color:#f59e0b;word-break:break-all">${p.rawKey}</code>
    </div>
    <p style="color:#71717a;font-size:12px;margin:0 0 22px">Keep it safe. It will not be shown again.</p>
    ${buildFirstCallHtml({ bearer: p.rawKey })}
    <p style="font-size:14px;margin:0"><a href="https://ibanforge.com/docs" style="color:#fbbf24;text-decoration:none">Read the docs</a> &nbsp;&middot;&nbsp; <a href="https://ibanforge.com/legal/terms" style="color:#fbbf24;text-decoration:none">Terms</a></p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <!-- BIZ-05 (2026-09-01), third surface: the machine-facing copy still said
         "pre-payout screening for AI agents" while the landing had already
         moved. Who actually pays is someone holding a file of IBANs who needs
         to know what is behind them, and zero autonomous agents. The two
         llms.txt carry the same line. -->
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge &middot; know the bank behind any IBAN &middot; <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a> &middot; governed by the <a href="https://ibanforge.com/legal/terms" style="color:#71717a">Terms of Service</a></p>
  </div></body></html>`;

  return { subject: `Your IBANforge API key, ${credits} credits`, text, html };
}

export async function sendApiKeyEmail(p: ApiKeyEmailInput & { to: string }): Promise<boolean> {
  const { subject, text, html } = buildApiKeyEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject, text, html });
  if (!ok) reportUndelivered('purchase key delivery', p.to, true);
  return ok;
}

export interface FreeKeyEmailInput {
  rawKey: string;
  monthlyLimit: number;
}

/**
 * Composes the free-tier key delivery, sent at POST /v1/keys/generate.
 *
 * Until 2026-08-29 this signup produced no mail at all: the key existed only in
 * the HTTP response the caller had to catch and keep. That is the exact moment
 * the funnel loses people, so the key now also arrives in the mailbox with the
 * one command that proves it works.
 *
 * No pricing, no pack links: someone who has not made a first call has nothing
 * to buy yet, and a purchase prompt here is what makes the whole message read
 * as a sequence rather than a delivery.
 */
export function buildFreeKeyEmail(p: FreeKeyEmailInput): { subject: string; text: string; html: string } {
  const limit = p.monthlyLimit.toLocaleString('en-US');

  const text =
    `Your IBANforge API key is ready.\n\n` +
    `API key: ${p.rawKey}\n` +
    `Free tier: ${limit} requests per month, reset on the 1st.\n\n` +
    buildFirstCallText({ bearer: p.rawKey }) +
    `\nDocs: https://ibanforge.com/docs\n` +
    `Terms: https://ibanforge.com/legal/terms\n` +
    `Keep this key safe. It will not be shown again, and we store only its hash.\n\n` +
    `Something does not work on the first try? Reply to this mail and we look at it with you.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your API key is ready</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Free tier: <b style="color:#fafafa">${limit} requests per month</b>, reset on the 1st.</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin:0 0 8px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Your API key</div>
      <code style="font-family:'JetBrains Mono',monospace;font-size:14px;color:#f59e0b;word-break:break-all">${p.rawKey}</code>
    </div>
    <p style="color:#71717a;font-size:12px;margin:0 0 22px">Keep it safe. It will not be shown again, and we store only its hash.</p>
    ${buildFirstCallHtml({ bearer: p.rawKey })}
    <p style="color:#a1a1aa;font-size:13px;margin:0 0 14px">Something does not work on the first try? Reply to this mail and we look at it with you.</p>
    <p style="font-size:14px;margin:0"><a href="https://ibanforge.com/docs" style="color:#fbbf24;text-decoration:none">Read the docs</a> &nbsp;&middot;&nbsp; <a href="https://ibanforge.com/legal/terms" style="color:#fbbf24;text-decoration:none">Terms</a></p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge &middot; <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a></p>
  </div></body></html>`;

  return { subject: 'Your IBANforge API key, and the call that proves it works', text, html };
}

export async function sendFreeKeyEmail(p: FreeKeyEmailInput & { to: string }): Promise<boolean> {
  const { subject, text, html } = buildFreeKeyEmail(p);
  const { outcome } = await deliverViaRelay({ to: p.to, subject, text, html });
  // An address its own mail server refuses is not a delivery failure on our
  // side: the key was shown on screen, and no relay fix will make that
  // mailbox exist. Waking someone up for it trains them to ignore the alert
  // that matters, the one where the relay itself is down.
  if (outcome !== 'sent') reportUndelivered('free key delivery', p.to, outcome !== 'undeliverable');
  return outcome === 'sent';
}

export interface ActivationNudgeInput {
  /** The 12-character prefix of the key that has never been called. */
  keyPrefix: string;
}

/**
 * Composes the one and only "your key never made its first call" message.
 *
 * The curl carries KEY_PLACEHOLDER, not a key: free keys are stored hashed and
 * nothing else, so days after a signup we can name the key by its prefix and
 * must say plainly that we cannot reprint it. Printing something key-shaped
 * that is not the key would be the worse move.
 *
 * Signed by name, with a real invitation to reply, because that is what this
 * message is for: the founder's own mail is what gets answers, and this is its
 * automated, lighter cousin.
 */
export function buildActivationNudgeEmail(p: ActivationNudgeInput): { subject: string; text: string; html: string } {
  const text =
    `Your IBANforge key has not made its first call yet.\n\n` +
    `No reproach in that, it usually means the first call is still one copy-paste away.\n` +
    `Here is that copy-paste.\n\n` +
    buildFirstCallText({ bearer: KEY_PLACEHOLDER, keyPrefix: p.keyPrefix }) +
    `\nReply to this email and I will personally help: send me the call you are making\n` +
    `and I will tell you what comes back and why.\n\n` +
    `Claude-Alain Martin\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your key has not made its first call yet</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">No reproach in that, it usually means the first call is still one copy-paste away. Here is that copy-paste.</p>
    ${buildFirstCallHtml({ bearer: KEY_PLACEHOLDER, keyPrefix: p.keyPrefix })}
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 18px">Reply to this email and I will personally help: send me the call you are making and I will tell you what comes back and why.</p>
    <p style="color:#a1a1aa;font-size:14px;margin:0">Claude-Alain Martin<br><span style="color:#71717a;font-size:12px">IBANforge</span></p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">You received this once, because a key was created on <a href="${ACCOUNT_PAGE}" style="color:#71717a">ibanforge.com</a> and never used. There is no second one.</p>
  </div></body></html>`;

  return { subject: 'Your IBANforge key has not made its first call yet', text, html };
}

export async function sendActivationNudgeEmail(p: ActivationNudgeInput & { to: string }): Promise<boolean> {
  const { subject, text, html } = buildActivationNudgeEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject, text, html });
  if (!ok) reportUndelivered('activation nudge', p.to, false);
  return ok;
}

export interface QuotaWarningInput {
  used: number;
  limit: number;
  month: string;
  keyPrefix: string;
}

/**
 * Composes the "you are at 80% of your free tier" email. Pure (no transport),
 * so the wording can be asserted in tests — it is the only commercial message
 * a free-tier holder ever receives before being cut off.
 *
 * Deliberately does NOT mention POST /v1/keys/generate: pointing a client who
 * is running out of allowance at a second free key is what the 2026-07-25
 * funnel audit measured happening (hit the wall, minted a fresh free key and
 * was back in service within the hour, without paying). Card first, USDC
 * second, nothing else.
 */
export function buildQuotaWarningEmail(p: QuotaWarningInput): { subject: string; text: string; html: string } {
  const pct = Math.round((p.used / p.limit) * 100);
  const left = Math.max(0, p.limit - p.used);
  const subject = `You are at ${pct}% of your IBANforge free tier (80% alert)`;

  const text =
    `Heads up: key ${p.keyPrefix} has used ${p.used} of its ${p.limit} free requests for ${p.month}.\n` +
    `About ${left} calls left before validation stops until the 1st of next month.\n\n` +
    `Keep it running, pay by card in one click:\n` +
    `  1,000 credits  $5   ${PAYMENT_LINKS['1k']}\n` +
    `  5,000 credits  $20  ${PAYMENT_LINKS['5k']}\n` +
    ` 25,000 credits  $80  ${PAYMENT_LINKS['25k']}\n\n` +
    `See where those calls went: https://ibanforge.com/en/account\n` +
    `Your usage, what failed and why. The key stays in your browser.\n\n` +
    `Credits never expire and carry no subscription. All packs: ${PRICING_PAGE}\n` +
    `Paying in USDC instead? POST /v1/credits/buy/1k|5k|25k, or per call via x402.\n\n` +
    `Need a higher monthly allowance or an embedding licence? Reply to this email.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">You are at ${pct}% of your free tier</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Key <code style="color:#fafafa">${p.keyPrefix}</code> has used <b style="color:#fafafa">${p.used} of ${p.limit}</b> requests for ${p.month}. About <b style="color:#fafafa">${left}</b> left before calls stop until the 1st.</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:16px;margin:0 0 18px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Keep it running, pay by card</div>
      <p style="margin:0 0 8px"><a href="${PAYMENT_LINKS['1k']}" style="color:#fbbf24;text-decoration:none">1,000 credits · $5 →</a></p>
      <p style="margin:0 0 8px"><a href="${PAYMENT_LINKS['5k']}" style="color:#fbbf24;text-decoration:none">5,000 credits · $20 →</a></p>
      <p style="margin:0"><a href="${PAYMENT_LINKS['25k']}" style="color:#fbbf24;text-decoration:none">25,000 credits · $80 →</a></p>
    </div>
    <p style="color:#71717a;font-size:13px;margin:0 0 6px">Credits never expire, no subscription. Paying in USDC instead? <code>POST /v1/credits/buy/1k|5k|25k</code>.</p>
    <p style="font-size:13px;margin:14px 0 0"><a href="https://ibanforge.com/en/account" style="color:#fbbf24;text-decoration:none">See where those calls went →</a> <span style="color:#71717a">Your usage and what failed, with the cause.</span></p>
    <p style="color:#a1a1aa;font-size:13px;margin:14px 0 0">Need a higher monthly allowance or an embedding licence? Just reply.</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge · <a href="${PRICING_PAGE}" style="color:#71717a">all packs</a></p>
  </div></body></html>`;

  return { subject, text, html };
}

/**
 * Sends the 80% warning. Same fail-soft contract as the other senders: no SMTP
 * config means no send and no throw, so a missing mailbox can never break a
 * customer's API call (this runs off the hot path, fire-and-forget).
 */
export async function sendQuotaWarningEmail(p: QuotaWarningInput & { to: string }): Promise<boolean> {
  const { subject, text, html } = buildQuotaWarningEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject: subject, text, html });
  if (!ok) reportUndelivered('quota warning', p.to, false);
  return ok;
}

/**
 * 6-digit code for the second-key-per-network verification step. Plain and
 * short on purpose: the reader may be an agent parsing the mailbox, so the code
 * appears alone on its own line and a regex finds it without heuristics.
 *
 * Split out of its sender on 2026-09-01 (BIZ-14): the wording used to be built
 * inside the async function, where nothing pure could be asserted, which is
 * exactly how the em dash rule stayed green while two live messages broke it.
 */
export function buildKeyVerificationEmail(p: { code: string }): { subject: string; text: string; html: string } {
  const subject = `${p.code} is your IBANforge verification code`;
  const text =
    `Your IBANforge verification code:\n\n${p.code}\n\n` +
    `Valid for 15 minutes. Repeat your key request with {"email": "...", "code": "${p.code}"}.\n\n` +
    `You received this because a second API key was requested from your network today. ` +
    `If that was not you, ignore this mail: no key was created.\n\nIBANforge`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your verification code</h1>
    <p style="font-size:32px;letter-spacing:.3em;font-family:monospace;color:#fafafa;margin:18px 0">${p.code}</p>
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 10px">Valid 15 minutes. Repeat your key request with <code style="color:#fafafa">{"email": "...", "code": "${p.code}"}</code>.</p>
    <p style="color:#71717a;font-size:12px;margin:14px 0 0">You received this because a second API key was requested from your network today. If that was not you, ignore this mail: no key was created.</p>
  </div></body></html>`;
  return { subject, text, html };
}

/**
 * Says WHY a code did not leave, because the two reasons want opposite
 * answers: an address the mail server refuses is the caller's to fix (400,
 * no alert), a relay that is down or misconfigured is ours (503, alert).
 * Measured 02/09/2026: every 503 of the previous month was a script feeding
 * addresses that cannot exist, and the relay was healthy throughout.
 */
export async function deliverKeyVerificationEmail(p: { to: string; code: string }): Promise<RelayOutcome> {
  const { subject, text, html } = buildKeyVerificationEmail(p);
  const { outcome } = await deliverViaRelay({ to: p.to, subject, text, html });
  if (outcome !== 'sent') reportUndelivered('verification code', p.to, false);
  return outcome;
}

export async function sendKeyVerificationEmail(p: { to: string; code: string }): Promise<boolean> {
  return (await deliverKeyVerificationEmail(p)) === 'sent';
}

/**
 * Editor/OEM subscription welcome: same delivery mechanics as buildApiKeyEmail,
 * worded for a monthly allowance that renews rather than a prepaid credit pool.
 *
 * BIZ-14 (2026-09-01): the subject carried an em dash, on a live transactional
 * message, while the same rule was locked by test on the four builders that
 * were pure. It was not pure because it was assembled inline in the sender
 * below, so there was nothing for the sweep to look at. Making it pure is the
 * fix; removing the dash is only the symptom.
 */
export function buildOemKeyEmail(p: { rawKey: string; monthlyLimit: number }): {
  subject: string;
  text: string;
  html: string;
} {
  const limit = p.monthlyLimit.toLocaleString('en-US');

  const text =
    `Welcome to IBANforge Editor / OEM.\n\n` +
    `API key: ${p.rawKey}\n` +
    `Plan: Editor / OEM subscription (${limit} requests/month, resets on the 1st)\n` +
    `Your key at a glance: https://ibanforge.com/en/account\n` +
    `SLA: https://ibanforge.com/en/legal/sla\n` +
    `DPA: https://ibanforge.com/en/legal/dpa\n` +
    `Terms: https://ibanforge.com/en/legal/terms\n\n` +
    `Use it as a Bearer token:\n` +
    `  curl -H "Authorization: Bearer ${p.rawKey}" \\\n` +
    `       -X POST https://api.ibanforge.com/v1/iban/validate \\\n` +
    `       -H "content-type: application/json" -d '{"iban":"CH1000230000000012345"}'\n\n` +
    `Check your usage any time:\n` +
    `  curl -H "Authorization: Bearer ${p.rawKey}" https://api.ibanforge.com/v1/keys/usage\n\n` +
    `Your named support contact: support@ibanforge.com (mention Editor/OEM).\n` +
    `Keep this key safe. It will not be shown again.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Welcome to Editor / OEM</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Your subscription is active: <b style="color:#fafafa">${limit} requests/month</b>, resets on the 1st.</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin:0 0 8px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Your API key</div>
      <code style="font-family:'JetBrains Mono',monospace;font-size:14px;color:#f59e0b;word-break:break-all">${p.rawKey}</code>
    </div>
    <p style="color:#71717a;font-size:12px;margin:0 0 22px">Keep it safe. It will not be shown again.</p>
    <div style="font-size:13px;color:#a1a1aa;margin-bottom:6px">Use it as a Bearer token:</div>
    <pre style="background:#09090b;border:1px solid #1c1c22;border-radius:10px;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#d6d3cc;white-space:pre-wrap;overflow-x:auto;margin:0 0 22px">curl -H "Authorization: Bearer ${p.rawKey}" \\
     -X POST https://api.ibanforge.com/v1/iban/validate \\
     -H "content-type: application/json" \\
     -d '{"iban":"CH1000230000000012345"}'</pre>
    <p style="font-size:14px;margin:0 0 6px"><a href="https://ibanforge.com/en/legal/sla" style="color:#fbbf24;text-decoration:none">Your SLA →</a> &nbsp;·&nbsp; <a href="https://ibanforge.com/en/legal/dpa" style="color:#fbbf24;text-decoration:none">DPA →</a> &nbsp;·&nbsp; <a href="https://ibanforge.com/en/legal/terms" style="color:#fbbf24;text-decoration:none">Terms →</a> &nbsp;·&nbsp; <a href="https://ibanforge.com/docs" style="color:#fbbf24;text-decoration:none">Docs →</a></p>
    <p style="color:#a1a1aa;font-size:13px;margin:14px 0 0">Named support: <a href="mailto:support@ibanforge.com" style="color:#fbbf24;text-decoration:none">support@ibanforge.com</a> (mention Editor/OEM).</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge · bank data API for software vendors · <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a></p>
  </div></body></html>`;

  return { subject: `Your IBANforge Editor / OEM key, ${limit} requests/month`, text, html };
}

export async function sendOemKeyEmail(p: { to: string; rawKey: string; monthlyLimit: number }): Promise<boolean> {
  const { subject, text, html } = buildOemKeyEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject, text, html });
  if (!ok) reportUndelivered('OEM key delivery', p.to, true);
  return ok;
}
