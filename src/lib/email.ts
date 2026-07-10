import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

/**
 * Transactional email for IBANforge — delivers the API key after a Stripe
 * purchase, sent from an @ibanforge.com mailbox via Infomaniak SMTP.
 *
 * DELIBERATELY separate from openswissdata: IBANforge email must NOT go through
 * openswissdata infrastructure (owner's explicit instruction). All config comes
 * from SMTP_* env vars; if they're unset this no-ops (returns false) so a missing
 * mailbox can never break the payment webhook — the success page stays the
 * primary delivery path, this is the safety net.
 *
 * Env: SMTP_HOST (mail.infomaniak.com), SMTP_PORT (465), SMTP_USER (the full
 *      @ibanforge.com address), SMTP_PASS, EMAIL_FROM (optional display name).
 */
let _transport: Transporter | null = null;

function getTransport(): Transporter | null {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  if (!_transport) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    _transport = nodemailer.createTransport({
      host,
      port,
      secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
      auth: { user, pass },
    });
  }
  return _transport;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendApiKeyEmail(p: {
  to: string;
  rawKey: string;
  credits: number;
  bundle: string;
}): Promise<boolean> {
  const transport = getTransport();
  if (!transport) {
    console.error('[email] SMTP_* not configured — API key email skipped');
    return false;
  }
  const from = process.env.EMAIL_FROM || `IBANforge <${process.env.SMTP_USER}>`;
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
    `Docs: https://ibanforge.com/docs\n` +
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
    <p style="font-size:14px;margin:0"><a href="https://ibanforge.com/docs" style="color:#fbbf24;text-decoration:none">Read the docs →</a></p>
    <hr style="border:none;border-top:1px solid rgba(255,255,255,.06);margin:24px 0 14px">
    <p style="color:#52525b;font-size:12px;margin:0">IBANforge · pre-payout screening for AI agents · <a href="https://ibanforge.com" style="color:#71717a">ibanforge.com</a></p>
  </div></body></html>`;

  try {
    await transport.sendMail({ from, to: p.to, subject: `Your IBANforge API key — ${credits} credits`, text, html });
    return true;
  } catch (e) {
    console.error('[email] SMTP send failed', (e as Error).message);
    return false;
  }
}
