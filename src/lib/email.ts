import {
  PAYMENT_LINKS,
  PRICING_PAGE,
  PRO_PAYMENT_LINK,
  PRO_PORTAL_URL,
  PRO_PRICE_USD,
  topupLinks,
  type PackSlug,
} from './payment-links.js';
import { CREDITS_NOTICE_RATIO } from './tiers.js';
import {
  sendViaRelay,
  deliverViaRelay,
  isRelayConfigured,
  type RelayOutcome,
} from './mail-transport.js';
import { opsFail, opsOk } from './ops-alert.js';
import {
  ACCOUNT_PAGE,
  ACCOUNT_SIGN_IN,
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
  void opsFail(
    'mail:key-delivery',
    `${what}: the relay refused the message or could not be reached.`,
    1,
  );
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

/**
 * The other half of the alert. `opsFail` stays silent while `firing` is true,
 * and nothing ever called `opsOk('mail:key-delivery')`: the alert fired once on
 * 02/09/2026 and stayed locked open, so a second undelivered key would have
 * warned nobody (production audit of 16/09/2026, I1). A delivered key closes
 * it, and the next failure alerts again.
 */
function reportKeyDelivered(what: string): void {
  if (process.env.VITEST) return;
  void opsOk('mail:key-delivery', `${what}: delivered.`);
}

/**
 * Les liens de pack d'un mail : ceux de CETTE clé quand sa référence de
 * recharge est connue (lot B1, 25.09.2026 : le pack atterrit sur la clé du
 * porteur), sinon les liens publics, qui frappent une clé neuve.
 */
function packLinks(topupRef: string | null | undefined): Record<PackSlug, string> {
  return topupRef ? topupLinks(topupRef) : { ...PAYMENT_LINKS };
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
export function buildApiKeyEmail(p: ApiKeyEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const credits = p.credits.toLocaleString('en-US');
  const noticePct = Math.round(CREDITS_NOTICE_RATIO * 100);

  // Le solde, dit en toutes lettres. Le lien vers le compte du bloc « premier
  // appel » s'intitule « everything this key does », et un acheteur qui
  // cherchait ses « crédits restants » ne l'y a pas reconnu : la partie HTML ne
  // disait jamais « solde ».
  //
  // Depuis le lot C3 (25.09.2026), on s'y connecte avec l'adresse de ce mail,
  // celle que l'acheteur a donnée au paiement : plus aucune clé à coller.
  const text =
    `Thanks for your purchase. Your IBANforge API key is ready.\n\n` +
    `API key: ${p.rawKey}\n` +
    `Credits: ${credits} (pack ${p.bundle})\n\n` +
    buildFirstCallText({ bearer: p.rawKey }) +
    `\nYour balance any time:\n` +
    `  - your account page: sign in at ${ACCOUNT_PAGE} with this e-mail address, no key to paste\n` +
    `  - the X-Credits-Remaining header on every paid response\n` +
    `  - curl -H "Authorization: Bearer ${p.rawKey}" https://api.ibanforge.com/v1/credits/balance\n` +
    `We e-mail you once when ${noticePct}% of the pack is left.\n\n` +
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
    <div style="font-size:13px;color:#a1a1aa;margin:0 0 6px">Your balance any time</div>
    <p style="font-size:14px;margin:0 0 6px"><a href="${ACCOUNT_PAGE}" style="color:#fbbf24;text-decoration:none">Credits left, on your account page &rarr;</a> <span style="color:#71717a">${ACCOUNT_SIGN_IN}</span></p>
    <p style="color:#71717a;font-size:13px;margin:0 0 6px">Every paid response also carries <code style="color:#d4d4d8">X-Credits-Remaining</code>, and <code style="color:#d4d4d8">GET /v1/credits/balance</code> answers on demand.</p>
    <p style="color:#71717a;font-size:13px;margin:0 0 22px">We e-mail you once when ${noticePct}% of the pack is left.</p>
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
  else reportKeyDelivered('purchase key delivery');
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
export function buildFreeKeyEmail(p: FreeKeyEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const limit = p.monthlyLimit.toLocaleString('en-US');

  const text =
    `Your IBANforge API key is ready.\n\n` +
    `API key: ${p.rawKey}\n` +
    `Free tier: ${limit} requests per month, reset on the 1st.\n` +
    `Need more later? Pro is $29 a month for 10,000 requests, and prepaid credit packs never expire: ${PRICING_PAGE}\n\n` +
    buildFirstCallText({ bearer: p.rawKey }) +
    `\nDocs: https://ibanforge.com/docs\n` +
    `Terms: https://ibanforge.com/legal/terms\n` +
    `Keep this key safe. It will not be shown again, and we store only its hash.\n\n` +
    `Something does not work on the first try? Reply to this mail and we look at it with you.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your API key is ready</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 6px">Free tier: <b style="color:#fafafa">${limit} requests per month</b>, reset on the 1st.</p>
    <p style="color:#71717a;font-size:13px;margin:0 0 22px">Need more later? Pro is $29 a month for 10,000 requests, and <a href="${PRICING_PAGE}" style="color:#a1a1aa">prepaid credit packs</a> never expire.</p>
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
  else reportKeyDelivered('free key delivery');
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
export function buildActivationNudgeEmail(p: ActivationNudgeInput): {
  subject: string;
  text: string;
  html: string;
} {
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

export async function sendActivationNudgeEmail(
  p: ActivationNudgeInput & { to: string },
): Promise<boolean> {
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
  /**
   * Une clé mixte (allocation + crédits, lot B1) : le solde qui prend le relais
   * une fois l'allocation épuisée. Absent = une clé sans crédits, comme avant.
   */
  creditsRemaining?: number;
  /** La référence de recharge de la clé : les liens rechargent alors CETTE clé. */
  topupRef?: string | null;
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
export function buildQuotaWarningEmail(p: QuotaWarningInput): {
  subject: string;
  text: string;
  html: string;
} {
  const pct = Math.round((p.used / p.limit) * 100);
  const left = Math.max(0, p.limit - p.used);
  const subject = `You are at ${pct}% of your IBANforge free tier (80% alert)`;
  const links = packLinks(p.topupRef);
  // Une clé qui a aussi des crédits ne s'arrête pas le 1er : ses crédits
  // prennent le relais, sans interruption (règle B, lot B1).
  const credits =
    typeof p.creditsRemaining === 'number' && p.creditsRemaining > 0
      ? p.creditsRemaining.toLocaleString('en-US')
      : null;
  const afterAllowance = credits
    ? `About ${left} calls left on this allowance, then your ${credits} prepaid credits on this key take over, without interruption.`
    : `About ${left} calls left before validation stops until the 1st of next month.`;
  const afterAllowanceHtml = credits
    ? `About <b style="color:#fafafa">${left}</b> left, then your <b style="color:#fafafa">${credits}</b> prepaid credits on this key take over, without interruption.`
    : `About <b style="color:#fafafa">${left}</b> left before calls stop until the 1st.`;
  const sameKey = p.topupRef
    ? 'A pack bought from these links lands on this same key: nothing to change in your integration.\n'
    : '';

  const text =
    `Heads up: key ${p.keyPrefix} has used ${p.used} of its ${p.limit} free requests for ${p.month}.\n` +
    `${afterAllowance}\n\n` +
    `Keep it running, pay by card in one click:\n` +
    `  1,000 credits  $4   ${links['1k']}\n` +
    `  5,000 credits  $20  ${links['5k']}\n` +
    ` 25,000 credits  $80  ${links['25k']}\n` +
    sameKey +
    `\n` +
    // L'alerte part à l'adresse de la clé : c'est elle qui ouvre le compte
    // (lot C3, 25.09.2026). « The key stays in your browser » ne décrivait que
    // le repli où l'on colle la clé.
    `See where those calls went: ${ACCOUNT_PAGE}\n` +
    `${ACCOUNT_SIGN_IN} Your usage, what failed and why.\n\n` +
    `Credits never expire and carry no subscription. All packs: ${PRICING_PAGE}\n` +
    `Paying in USDC instead? POST /v1/credits/buy/1k|5k|25k, or per call via x402.\n\n` +
    `Need a higher monthly allowance or an embedding licence? Reply to this email.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">You are at ${pct}% of your free tier</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Key <code style="color:#fafafa">${p.keyPrefix}</code> has used <b style="color:#fafafa">${p.used} of ${p.limit}</b> requests for ${p.month}. ${afterAllowanceHtml}</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:16px;margin:0 0 18px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Keep it running, pay by card</div>
      <p style="margin:0 0 8px"><a href="${links['1k']}" style="color:#fbbf24;text-decoration:none">1,000 credits · $4 →</a></p>
      <p style="margin:0 0 8px"><a href="${links['5k']}" style="color:#fbbf24;text-decoration:none">5,000 credits · $20 →</a></p>
      <p style="margin:0"><a href="${links['25k']}" style="color:#fbbf24;text-decoration:none">25,000 credits · $80 →</a></p>
      ${p.topupRef ? '<p style="color:#71717a;font-size:12px;margin:10px 0 0">A pack bought here lands on this same key: nothing to change in your integration.</p>' : ''}
    </div>
    <p style="color:#71717a;font-size:13px;margin:0 0 6px">Credits never expire, no subscription. Paying in USDC instead? <code>POST /v1/credits/buy/1k|5k|25k</code>.</p>
    <p style="font-size:13px;margin:14px 0 0"><a href="${ACCOUNT_PAGE}" style="color:#fbbf24;text-decoration:none">See where those calls went →</a> <span style="color:#71717a">Your usage and what failed, with the cause. ${ACCOUNT_SIGN_IN}</span></p>
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
export async function sendQuotaWarningEmail(
  p: QuotaWarningInput & { to: string },
): Promise<boolean> {
  const { subject, text, html } = buildQuotaWarningEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject: subject, text, html });
  if (!ok) reportUndelivered('quota warning', p.to, false);
  return ok;
}

export interface CreditsWarningInput {
  keyPrefix: string;
  /** Crédits restants une fois facturé l'appel qui a franchi le seuil. */
  remaining: number;
  /** Ce que contenait le pack. */
  total: number;
  /** L'allocation Pro, passée en paramètre pour que ce module reste à l'écart du magasin des clés. */
  proMonthlyLimit: number;
  /** La référence de recharge de la clé (lot B1) : les liens rechargent alors CETTE clé. */
  topupRef?: string | null;
}

/**
 * Compose l'e-mail « il ne reste que 10 % de votre pack », le pendant de
 * buildQuotaWarningEmail pour le porteur d'un pack. Pur, pour que les tests en
 * vérifient la formulation.
 *
 * Il dit ce qui se passe à zéro (un 402 sur cette clé), parce que c'est ce
 * qu'un porteur qui fait tourner un circuit de production doit savoir avant que
 * cela arrive. Depuis le lot B1 (25.09.2026), ses liens portent la référence de
 * recharge de la clé : le pack acheté atterrit sur CETTE clé, et la phrase qui
 * disait qu'un achat par carte arrive sous une clé neuve est retirée. Sans
 * référence (base indisponible à l'envoi), les liens publics restent, avec la
 * phrase d'avant, qui est alors vraie.
 */
export function buildCreditsWarningEmail(p: CreditsWarningInput): {
  subject: string;
  text: string;
  html: string;
} {
  const remaining = p.remaining.toLocaleString('en-US');
  const total = p.total.toLocaleString('en-US');
  const pro = p.proMonthlyLimit.toLocaleString('en-US');
  const pct = Math.round(CREDITS_NOTICE_RATIO * 100);
  const subject = `${remaining} IBANforge credits left on key ${p.keyPrefix} (${pct}% alert)`;
  const links = packLinks(p.topupRef);
  const sameKey = p.topupRef
    ? 'A pack bought from these links lands on this same key: nothing to change in your integration. ' +
      'Pro is delivered as a new key.'
    : 'For now, a purchase by card arrives as a new key: put it in place of this one in your integration.';

  const text =
    `Heads up: key ${p.keyPrefix} has ${remaining} of its ${total} prepaid credits left.\n` +
    `When they run out, calls with this key answer HTTP 402 (payment required) until you top up.\n\n` +
    `Keep it running, pay by card in one click:\n` +
    `  1,000 credits  $4   ${links['1k']}\n` +
    `  5,000 credits  $20  ${links['5k']}\n` +
    ` 25,000 credits  $80  ${links['25k']}\n` +
    `Or a flat $${PRO_PRICE_USD}/month for ${pro} requests: ${PRO_PAYMENT_LINK}\n\n` +
    `${sameKey}\n\n` +
    `Your balance any time:\n` +
    `  - your account page: sign in at ${ACCOUNT_PAGE} with this e-mail address, no key to paste\n` +
    `  - the X-Credits-Remaining header on every paid response\n` +
    `  - GET https://api.ibanforge.com/v1/credits/balance\n\n` +
    `Credits never expire. Paying in USDC instead? POST /v1/credits/buy/1k|5k|25k.\n` +
    `A larger volume, or a question? Reply to this email.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">${remaining} credits left on your key</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Key <code style="color:#fafafa">${p.keyPrefix}</code> has <b style="color:#fafafa">${remaining} of its ${total}</b> prepaid credits left. When they run out, calls with this key answer <b style="color:#fafafa">HTTP 402</b> (payment required) until you top up.</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:16px;margin:0 0 12px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Keep it running, pay by card</div>
      <p style="margin:0 0 8px"><a href="${links['1k']}" style="color:#fbbf24;text-decoration:none">1,000 credits · $4 →</a></p>
      <p style="margin:0 0 8px"><a href="${links['5k']}" style="color:#fbbf24;text-decoration:none">5,000 credits · $20 →</a></p>
      <p style="margin:0 0 8px"><a href="${links['25k']}" style="color:#fbbf24;text-decoration:none">25,000 credits · $80 →</a></p>
      <p style="margin:0"><a href="${PRO_PAYMENT_LINK}" style="color:#fbbf24;text-decoration:none">Pro · ${pro} requests a month · $${PRO_PRICE_USD} →</a></p>
    </div>
    <p style="color:#71717a;font-size:13px;margin:0 0 18px">${sameKey}</p>
    <p style="font-size:14px;margin:0 0 6px"><a href="${ACCOUNT_PAGE}" style="color:#fbbf24;text-decoration:none">Credits left, on your account page &rarr;</a> <span style="color:#71717a">${ACCOUNT_SIGN_IN}</span></p>
    <p style="color:#71717a;font-size:13px;margin:0 0 6px">Every paid response also carries <code style="color:#d4d4d8">X-Credits-Remaining</code>, and <code style="color:#d4d4d8">GET /v1/credits/balance</code> answers on demand.</p>
    <p style="color:#71717a;font-size:13px;margin:0 0 6px">Credits never expire. Paying in USDC instead? <code>POST /v1/credits/buy/1k|5k|25k</code>.</p>
    <p style="color:#a1a1aa;font-size:13px;margin:14px 0 0">A larger volume, or a question? Just reply.</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge · <a href="${PRICING_PAGE}" style="color:#71717a">all packs</a></p>
  </div></body></html>`;

  return { subject, text, html };
}

/** Envoie l'avertissement du pack. Même contrat sans échec bloquant que sendQuotaWarningEmail. */
export async function sendCreditsWarningEmail(
  p: CreditsWarningInput & { to: string },
): Promise<boolean> {
  const { subject, text, html } = buildCreditsWarningEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject, text, html });
  if (!ok) reportUndelivered('credits warning', p.to, false);
  return ok;
}

export interface RechargeEmailInput {
  keyPrefix: string;
  creditsAdded: number;
  /** Le solde de la clé juste après la recharge. */
  balance: number;
  bundle: string;
}

/**
 * Le mail d'une RECHARGE (lot B1, 25.09.2026) : un pack acheté par carte avec la
 * référence d'une clé a atterri sur cette clé. Aucune clé brute, et il n'y en a
 * pas à donner : le porteur l'a déjà, et rien ne change dans son intégration.
 * C'est la phrase qui compte, et elle vient en premier.
 *
 * Envoyé à l'adresse de la clé quand elle est joignable, sinon à celle du
 * payeur (contact de service, jamais l'identité de la clé).
 */
export function buildRechargeEmail(p: RechargeEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const added = p.creditsAdded.toLocaleString('en-US');
  const balance = p.balance.toLocaleString('en-US');
  const noticePct = Math.round(CREDITS_NOTICE_RATIO * 100);
  const text =
    `Key ${p.keyPrefix} recharged: +${added} credits (pack ${p.bundle}). Balance: ${balance}.\n` +
    `Nothing to change in your integration: keep calling with the same key.\n\n` +
    `Your balance any time:\n` +
    `  - your account page: sign in at ${ACCOUNT_PAGE} with the address attached to the key, no key to paste\n` +
    `  - the X-Credits-Remaining header on every paid response\n` +
    `  - GET https://api.ibanforge.com/v1/credits/balance\n` +
    `We e-mail you once when ${noticePct}% of the balance is left.\n\n` +
    `Terms: https://ibanforge.com/legal/terms (unused card-paid packs: 14-day refund)\n\nIBANforge`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Key ${p.keyPrefix} recharged</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 6px"><b style="color:#fafafa">+${added} credits</b> (pack ${p.bundle}). Balance: <b style="color:#fafafa">${balance}</b>.</p>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Nothing to change in your integration: keep calling with the same key.</p>
    <div style="font-size:13px;color:#a1a1aa;margin:0 0 6px">Your balance any time</div>
    <p style="font-size:14px;margin:0 0 6px"><a href="${ACCOUNT_PAGE}" style="color:#fbbf24;text-decoration:none">Credits left, on your account page &rarr;</a> <span style="color:#71717a">${ACCOUNT_SIGN_IN}</span></p>
    <p style="color:#71717a;font-size:13px;margin:0 0 6px">Every paid response also carries <code style="color:#d4d4d8">X-Credits-Remaining</code>, and <code style="color:#d4d4d8">GET /v1/credits/balance</code> answers on demand.</p>
    <p style="color:#71717a;font-size:13px;margin:0 0 22px">We e-mail you once when ${noticePct}% of the balance is left.</p>
    <p style="font-size:14px;margin:0"><a href="https://ibanforge.com/docs" style="color:#fbbf24;text-decoration:none">Read the docs</a> &nbsp;&middot;&nbsp; <a href="https://ibanforge.com/legal/terms" style="color:#fbbf24;text-decoration:none">Terms</a></p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge &middot; <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a></p>
  </div></body></html>`;
  return {
    subject: `IBANforge key ${p.keyPrefix} recharged: +${added} credits`,
    text,
    html,
  };
}

/** Envoie le mail de recharge. Même contrat sans échec bloquant que les autres. */
export async function sendRechargeEmail(p: RechargeEmailInput & { to: string }): Promise<boolean> {
  const { subject, text, html } = buildRechargeEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject, text, html });
  if (!ok) reportUndelivered('recharge confirmation', p.to, false);
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
export function buildKeyVerificationEmail(p: { code: string }): {
  subject: string;
  text: string;
  html: string;
} {
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
export async function deliverKeyVerificationEmail(p: {
  to: string;
  code: string;
}): Promise<RelayOutcome> {
  const { subject, text, html } = buildKeyVerificationEmail(p);
  const { outcome } = await deliverViaRelay({ to: p.to, subject, text, html });
  if (outcome !== 'sent') reportUndelivered('verification code', p.to, false);
  return outcome;
}

export async function sendKeyVerificationEmail(p: { to: string; code: string }): Promise<boolean> {
  return (await deliverKeyVerificationEmail(p)) === 'sent';
}

/**
 * Le code de connexion à la page du compte (lot C1, 24.09.2026).
 *
 * Un gabarit à part de `buildKeyVerificationEmail`, qui parle d'une « second
 * API key requested from your network » : faux pour une connexion. Trois
 * règles, chacune verrouillée par `src/lib/email.account-code.test.ts` :
 *  - AUCUN LIEN. Pas de lien magique, jamais un secret dans une URL : le code
 *    se recopie là où il a été demandé. Un lien vers le site serait aussi le
 *    geste qu'un hameçonnage imite le mieux ;
 *  - RIEN SUR LES CLÉS. Le même mail part que l'adresse porte des clés ou non :
 *    c'est ce qui rend la connexion muette sur l'existence d'un compte. Un mot
 *    sur « vos clés » dans ce texte trahirait ce que la route tait ;
 *  - la durée vient de la constante (`ttlMinutes`), jamais d'un littéral.
 *
 * Le code est seul sur sa ligne, comme dans le mail de vérification : un lecteur
 * automatique le trouve sans heuristique, et iOS le propose dans le champ
 * `one-time-code` de la page.
 *
 * N'importe qui peut faire envoyer un code à n'importe quelle adresse, et le
 * code figure dans l'objet (écran verrouillé, notifications) : le mail dit donc
 * aussi de ne jamais le transmettre (`NEVER_SHARE`).
 */
const NEVER_SHARE = 'Never share this code. IBANforge will never ask you for it.';

export function buildAccountCodeEmail(p: { code: string; ttlMinutes: number }): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `${p.code} is your IBANforge sign-in code`;
  const text =
    `Your IBANforge sign-in code:\n\n${p.code}\n\n` +
    `Enter it where you asked for it, within ${p.ttlMinutes} minutes. ${NEVER_SHARE}\n\n` +
    `If you did not ask for it, ignore this mail: nobody can sign in without this code.\n\nIBANforge`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your sign-in code</h1>
    <p style="font-size:32px;letter-spacing:.3em;font-family:monospace;color:#fafafa;margin:18px 0">${p.code}</p>
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 10px">Enter it where you asked for it, within ${p.ttlMinutes} minutes.</p>
    <p style="color:#fafafa;font-size:14px;margin:0 0 10px">${NEVER_SHARE}</p>
    <p style="color:#71717a;font-size:12px;margin:14px 0 0">If you did not ask for it, ignore this mail: nobody can sign in without this code.</p>
  </div></body></html>`;
  return { subject, text, html };
}

/**
 * L'envoi du code de connexion, avec la même issue à trois voies que le code de
 * vérification : adresse refusée par le serveur de courrier (400, rien à
 * alerter), relais en panne (503 et alerte, côté route), parti.
 */
export async function deliverAccountCodeEmail(p: {
  to: string;
  code: string;
  ttlMinutes: number;
}): Promise<RelayOutcome> {
  const { subject, text, html } = buildAccountCodeEmail(p);
  const { outcome } = await deliverViaRelay({ to: p.to, subject, text, html });
  if (outcome !== 'sent') reportUndelivered('sign-in code', p.to, false);
  return outcome;
}

/**
 * Subscription welcome (Editor/OEM, and Pro since 2026-09-02): same delivery
 * mechanics as buildApiKeyEmail, worded for a monthly allowance that renews
 * rather than a prepaid credit pool.
 *
 * BIZ-14 (2026-09-01): the subject carried an em dash, on a live transactional
 * message, while the same rule was locked by test on the four builders that
 * were pure. It was not pure because it was assembled inline in the sender
 * below, so there was nothing for the sweep to look at. Making it pure is the
 * fix; removing the dash is only the symptom.
 */
export type SubscriptionEmailPlan = 'oem' | 'pro';

const SUBSCRIPTION_EMAIL_COPY: Record<
  SubscriptionEmailPlan,
  { name: string; support: string; footer: string; legalLinks: boolean }
> = {
  oem: {
    name: 'Editor / OEM',
    support: 'Your named support contact: support@ibanforge.com (mention Editor/OEM).',
    footer: 'bank data API for software vendors',
    legalLinks: true,
  },
  // Pro (2026-09-02): the public monthly tier. No SLA and no DPA link, because
  // neither is part of the plan; the cancellation rule is stated because it is
  // the first question a subscriber asks.
  pro: {
    name: 'Pro',
    support: `Your card, your invoices and your cancellation are in your hands in the customer portal: ${PRO_PORTAL_URL} (sign in with the e-mail used at checkout). Cancelling stops the next renewal; the key keeps working until the end of the paid month. Questions or a plan change: support@ibanforge.com (mention Pro).`,
    footer: 'IBAN and bank data API',
    legalLinks: false,
  },
};

export function buildSubscriptionKeyEmail(p: {
  rawKey: string;
  monthlyLimit: number;
  plan: SubscriptionEmailPlan;
}): {
  subject: string;
  text: string;
  html: string;
} {
  const limit = p.monthlyLimit.toLocaleString('en-US');
  const copy = SUBSCRIPTION_EMAIL_COPY[p.plan];
  const legalText = copy.legalLinks
    ? `SLA: https://ibanforge.com/en/legal/sla\n` + `DPA: https://ibanforge.com/en/legal/dpa\n`
    : '';
  // Le lien du compte ne vit plus dans cette rangée (lot C3, 25.09.2026) : il a
  // sa propre ligne, pour les deux formules. L'éditeur n'en avait aucun dans la
  // partie HTML (les liens SLA et DPA en tenaient la place), alors que c'est lui
  // qui porte le plus de clés, une par client final.
  const legalHtml = copy.legalLinks
    ? `<a href="https://ibanforge.com/en/legal/sla" style="color:#fbbf24;text-decoration:none">Your SLA →</a> &nbsp;·&nbsp; <a href="https://ibanforge.com/en/legal/dpa" style="color:#fbbf24;text-decoration:none">DPA →</a> &nbsp;·&nbsp; `
    : '';

  const text =
    `Welcome to IBANforge ${copy.name}.\n\n` +
    `API key: ${p.rawKey}\n` +
    `Plan: ${copy.name} subscription (${limit} requests/month, resets on the 1st)\n` +
    `Your account (balance, usage, subscription): ${ACCOUNT_PAGE}\n` +
    `${ACCOUNT_SIGN_IN}\n` +
    legalText +
    `Terms: https://ibanforge.com/en/legal/terms\n\n` +
    `Use it as a Bearer token:\n` +
    `  curl -H "Authorization: Bearer ${p.rawKey}" \\\n` +
    `       -X POST https://api.ibanforge.com/v1/iban/validate \\\n` +
    `       -H "content-type: application/json" -d '{"iban":"CH1000230000000012345"}'\n\n` +
    `Check your usage any time:\n` +
    `  curl -H "Authorization: Bearer ${p.rawKey}" https://api.ibanforge.com/v1/keys/usage\n\n` +
    `${copy.support}\n` +
    `Keep this key safe. It will not be shown again.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Welcome to ${copy.name}</h1>
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
    <p style="font-size:14px;margin:0 0 6px"><a href="${ACCOUNT_PAGE}" style="color:#fbbf24;text-decoration:none">Your account: balance, usage, subscription →</a> <span style="color:#71717a">${ACCOUNT_SIGN_IN}</span></p>
    <p style="font-size:14px;margin:0 0 6px">${legalHtml}<a href="https://ibanforge.com/en/legal/terms" style="color:#fbbf24;text-decoration:none">Terms →</a> &nbsp;·&nbsp; <a href="https://ibanforge.com/docs" style="color:#fbbf24;text-decoration:none">Docs →</a></p>
    <p style="color:#a1a1aa;font-size:13px;margin:14px 0 0">${copy.support.replace('support@ibanforge.com', '<a href="mailto:support@ibanforge.com" style="color:#fbbf24;text-decoration:none">support@ibanforge.com</a>')}</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge · ${copy.footer} · <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a></p>
  </div></body></html>`;

  return { subject: `Your IBANforge ${copy.name} key, ${limit} requests/month`, text, html };
}

export function buildOemKeyEmail(p: { rawKey: string; monthlyLimit: number }): {
  subject: string;
  text: string;
  html: string;
} {
  return buildSubscriptionKeyEmail({ ...p, plan: 'oem' });
}

export function buildProKeyEmail(p: { rawKey: string; monthlyLimit: number }): {
  subject: string;
  text: string;
  html: string;
} {
  return buildSubscriptionKeyEmail({ ...p, plan: 'pro' });
}

export async function sendSubscriptionKeyEmail(p: {
  to: string;
  rawKey: string;
  monthlyLimit: number;
  plan: SubscriptionEmailPlan;
}): Promise<boolean> {
  const { subject, text, html } = buildSubscriptionKeyEmail(p);
  const ok = await sendViaRelay({ to: p.to, subject, text, html });
  if (!ok) reportUndelivered(`${SUBSCRIPTION_EMAIL_COPY[p.plan].name} key delivery`, p.to, true);
  else reportKeyDelivered(`${SUBSCRIPTION_EMAIL_COPY[p.plan].name} key delivery`);
  return ok;
}

export async function sendOemKeyEmail(p: {
  to: string;
  rawKey: string;
  monthlyLimit: number;
}): Promise<boolean> {
  return sendSubscriptionKeyEmail({ ...p, plan: 'oem' });
}

// ---------------------------------------------------------------------------
// Creditor-file audit: "your report is ready" (02/09/2026)
// ---------------------------------------------------------------------------

export interface AuditReadyEmailInput {
  to: string;
  lang: 'en' | 'fr' | 'de';
  link: string;
  rows: number;
  price: number;
  /** ISO 4217 code of `price` (USD since 16/09/2026, CHF for older jobs). */
  currency: string;
}

const AUDIT_READY_COPY = {
  en: {
    subject: (rows: number) => `Your creditor file audit is ready (${rows} rows)`,
    title: 'Your audit is ready',
    body: (rows: number, price: number, currency: string) =>
      `Thanks for your purchase (${price} ${currency}). The annotated workbook for your ${rows}-row file is ready to download.`,
    button: 'Open the report',
    retention:
      'The report stays available for 24 hours after payment, then it is deleted. The link works from any browser.',
    support: 'A question, a row you disagree with, an invoice: support@ibanforge.com.',
  },
  fr: {
    subject: (rows: number) => `Votre audit de fichier de créanciers est prêt (${rows} lignes)`,
    title: 'Votre audit est prêt',
    body: (rows: number, price: number, currency: string) =>
      `Merci pour votre achat (${price} ${currency}). Le classeur annoté de votre fichier de ${rows} lignes est prêt à télécharger.`,
    button: 'Ouvrir le rapport',
    retention:
      "Le rapport reste disponible 24 heures après le paiement, puis il est effacé. Le lien fonctionne depuis n'importe quel navigateur.",
    support: 'Une question, une ligne que vous contestez, une facture : support@ibanforge.com.',
  },
  de: {
    subject: (rows: number) => `Ihre Prüfung der Kreditorendatei ist bereit (${rows} Zeilen)`,
    title: 'Ihre Prüfung ist bereit',
    body: (rows: number, price: number, currency: string) =>
      `Danke für Ihren Kauf (${price} ${currency}). Die kommentierte Arbeitsmappe Ihrer Datei mit ${rows} Zeilen steht zum Download bereit.`,
    button: 'Bericht öffnen',
    retention:
      'Der Bericht bleibt 24 Stunden nach der Zahlung verfügbar und wird dann gelöscht. Der Link funktioniert in jedem Browser.',
    support: 'Eine Frage, eine strittige Zeile, eine Rechnung: support@ibanforge.com.',
  },
} as const;

export function buildAuditReadyEmail(p: AuditReadyEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const c = AUDIT_READY_COPY[p.lang] ?? AUDIT_READY_COPY.en;
  const text = `${c.title}\n\n${c.body(p.rows, p.price, p.currency)}\n\n${c.button}: ${p.link}\n\n${c.retention}\n${c.support}\n\nIBANforge`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">${c.title}</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">${c.body(p.rows, p.price, p.currency)}</p>
    <p style="margin:0 0 22px"><a href="${p.link}" style="display:inline-block;background:#f59e0b;color:#111;font-weight:600;padding:12px 18px;border-radius:10px;text-decoration:none">${c.button}</a></p>
    <p style="color:#71717a;font-size:12px;margin:0 0 6px">${c.retention}</p>
    <p style="color:#71717a;font-size:12px;margin:0">${c.support}</p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge &middot; <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a></p>
  </div></body></html>`;
  return { subject: c.subject(p.rows), text, html };
}

/** Fire-and-forget: a lost mail must never fail the webhook; the done page still works. */
export function sendAuditReadyEmail(p: AuditReadyEmailInput): void {
  if (process.env.VITEST) return;
  const { subject, text, html } = buildAuditReadyEmail(p);
  void deliverViaRelay({ to: p.to, subject, text, html })
    .then((r) => {
      if (r.outcome !== 'sent')
        reportUndelivered('audit-ready mail', p.to, r.outcome !== 'undeliverable');
    })
    .catch(() => reportUndelivered('audit-ready mail', p.to, true));
}
