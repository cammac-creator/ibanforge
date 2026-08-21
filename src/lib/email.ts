import { PAYMENT_LINKS, PRICING_PAGE } from './payment-links.js';
import { sendViaRelay, isRelayConfigured } from './mail-transport.js';

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

export async function sendApiKeyEmail(p: {
  to: string;
  rawKey: string;
  credits: number;
  bundle: string;
}): Promise<boolean> {
  const credits = p.credits.toLocaleString('en-US');

  const text =
    `Thanks for your purchase — your IBANforge API key is ready.\n\n` +
    `API key: ${p.rawKey}\n` +
    `Credits: ${credits} (pack ${p.bundle})\n\n` +
    `Use it as a Bearer token:\n` +
    `  curl -H "Authorization: Bearer ${p.rawKey}" \\\n` +
    `       -X POST https://api.ibanforge.com/v1/iban/validate \\\n` +
    `       -H "content-type: application/json" -d '{"iban":"CH1000230000000012345"}'\n\n` +
    `Check your balance any time:\n` +
    `  curl -H "Authorization: Bearer ${p.rawKey}" https://api.ibanforge.com/v1/credits/balance\n\n` +
    `Or read everything your key did, in one page:\n` +
    `  https://ibanforge.com/en/account\n` +
    `  Your usage, what failed and why, and the networks it was called from.\n` +
    `  Your key stays in your browser: it is sent to the API and nowhere else.\n\n` +
    `Docs: https://ibanforge.com/docs\n` +
    `Terms: https://ibanforge.com/legal/terms (unused card-paid packs: 14-day refund)\n` +
    `Keep this key safe — it will not be shown again.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your API key is ready</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Thanks for your purchase — <b style="color:#fafafa">${credits} credits</b> (pack ${p.bundle}).</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin:0 0 8px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Your API key</div>
      <code style="font-family:'JetBrains Mono',monospace;font-size:14px;color:#f59e0b;word-break:break-all">${p.rawKey}</code>
    </div>
    <p style="color:#71717a;font-size:12px;margin:0 0 22px">Keep it safe — it will not be shown again.</p>
    <div style="font-size:13px;color:#a1a1aa;margin-bottom:6px">Use it as a Bearer token:</div>
    <pre style="background:#09090b;border:1px solid #1c1c22;border-radius:10px;padding:14px 16px;font-family:'JetBrains Mono',monospace;font-size:12px;color:#d6d3cc;white-space:pre-wrap;overflow-x:auto;margin:0 0 22px">curl -H "Authorization: Bearer ${p.rawKey}" \\
     -X POST https://api.ibanforge.com/v1/iban/validate \\
     -H "content-type: application/json" \\
     -d '{"iban":"CH1000230000000012345"}'</pre>
    <p style="font-size:14px;margin:0 0 10px"><a href="https://ibanforge.com/en/account" style="color:#fbbf24;text-decoration:none">See everything your key did →</a></p>
    <p style="color:#71717a;font-size:12px;margin:0 0 22px">Usage, failures with their cause, and the networks your key was called from. The key stays in your browser.</p>
    <p style="font-size:14px;margin:0"><a href="https://ibanforge.com/docs" style="color:#fbbf24;text-decoration:none">Read the docs →</a> &nbsp;·&nbsp; <a href="https://ibanforge.com/legal/terms" style="color:#fbbf24;text-decoration:none">Terms →</a></p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge · pre-payout screening for AI agents · <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a> · governed by the <a href="https://ibanforge.com/legal/terms" style="color:#71717a">Terms of Service</a></p>
  </div></body></html>`;

  const ok = await sendViaRelay({ to: p.to, subject: `Your IBANforge API key — ${credits} credits`, text, html });
  if (!ok) console.error('[email] API key not delivered to', p.to);
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
    `Heads up — key ${p.keyPrefix} has used ${p.used} of its ${p.limit} free requests for ${p.month}.\n` +
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
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Keep it running — pay by card</div>
      <p style="margin:0 0 8px"><a href="${PAYMENT_LINKS['1k']}" style="color:#fbbf24;text-decoration:none">1,000 credits — $5 →</a></p>
      <p style="margin:0 0 8px"><a href="${PAYMENT_LINKS['5k']}" style="color:#fbbf24;text-decoration:none">5,000 credits — $20 →</a></p>
      <p style="margin:0"><a href="${PAYMENT_LINKS['25k']}" style="color:#fbbf24;text-decoration:none">25,000 credits — $80 →</a></p>
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
  if (!ok) console.error('[email] quota warning not delivered to', p.to);
  return ok;
}

/**
 * 6-digit code for the second-key-per-network verification step. Plain and
 * short on purpose: the reader may be an agent parsing the mailbox — the code
 * appears alone on its own line so a regex finds it without heuristics.
 */
export async function sendKeyVerificationEmail(p: { to: string; code: string }): Promise<boolean> {
  const subject = `${p.code} is your IBANforge verification code`;
  const text =
    `Your IBANforge verification code:\n\n${p.code}\n\n` +
    `Valid for 15 minutes. Repeat your key request with {"email": "...", "code": "${p.code}"}.\n\n` +
    `You received this because a second API key was requested from your network today. ` +
    `If that was not you, ignore this mail — no key was created.\n\nIBANforge`;
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Your verification code</h1>
    <p style="font-size:32px;letter-spacing:.3em;font-family:monospace;color:#fafafa;margin:18px 0">${p.code}</p>
    <p style="color:#a1a1aa;font-size:14px;margin:0 0 10px">Valid 15 minutes. Repeat your key request with <code style="color:#fafafa">{"email": "...", "code": "${p.code}"}</code>.</p>
    <p style="color:#71717a;font-size:12px;margin:14px 0 0">You received this because a second API key was requested from your network today. If that was not you, ignore this mail — no key was created.</p>
  </div></body></html>`;
  const ok = await sendViaRelay({ to: p.to, subject, text, html });
  if (!ok) console.error('[email] verification code not delivered to', p.to);
  return ok;
}

/**
 * Editor/OEM subscription welcome — same delivery mechanics as
 * sendApiKeyEmail but worded for a monthly allowance that renews, not a
 * prepaid credit pool.
 */
export async function sendOemKeyEmail(p: {
  to: string;
  rawKey: string;
  monthlyLimit: number;
}): Promise<boolean> {
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
    `Keep this key safe — it will not be shown again.\n\nIBANforge`;

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#0f0f13;padding:28px;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#d4d4d8">
  <div style="max-width:560px;margin:0 auto;background:#16161b;border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:30px 32px">
    <div style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#71717a;font-family:monospace">IBANforge</div>
    <h1 style="color:#fafafa;font-size:22px;margin:10px 0 6px">Welcome to Editor / OEM</h1>
    <p style="color:#a1a1aa;font-size:15px;margin:0 0 22px">Your subscription is active — <b style="color:#fafafa">${limit} requests/month</b>, resets on the 1st.</p>
    <div style="background:#09090b;border:1px solid #27272a;border-radius:10px;padding:14px 16px;margin:0 0 8px">
      <div style="font-size:11px;color:#71717a;font-family:monospace;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px">Your API key</div>
      <code style="font-family:'JetBrains Mono',monospace;font-size:14px;color:#f59e0b;word-break:break-all">${p.rawKey}</code>
    </div>
    <p style="color:#71717a;font-size:12px;margin:0 0 22px">Keep it safe — it will not be shown again.</p>
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

  const ok = await sendViaRelay({ to: p.to, subject: `Your IBANforge Editor / OEM key — ${limit} requests/month`, text, html });
  if (!ok) console.error('[email] OEM key not delivered to', p.to);
  return ok;
}
