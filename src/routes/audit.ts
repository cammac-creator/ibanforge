/**
 * Creditor-file audit ("audit de fichier"), sold at a displayed price.
 *
 *   POST /v1/audit/upload            multipart: file (CSV/XLSX), lang     -> free preview + job id
 *   POST /v1/audit/checkout/:job     { locale?, email? }                  -> Stripe Checkout URL
 *   GET  /v1/audit/status/:job       ?session_id=                         -> paid?, summary, preview
 *   GET  /v1/audit/report/:job       ?session_id=                         -> the annotated .xlsx (paid only)
 *
 * The engine (src/lib/audit-file.ts) runs in-process on the same data the
 * API serves per call; no key, no quota, no relay. Payment is a one-off
 * Stripe Checkout Session with an inline price (149 or 349 CHF by row
 * count); the webhook marks the job paid (stripe-webhook.ts), and the status
 * route double-checks with Stripe when the webhook is late, so a customer
 * back from the payment page never waits on a retry.
 *
 * Privacy contract, enforced here and stated on the page: the file is read
 * in memory, only the annotated report is stored, and audit-jobs.ts deletes
 * it two hours after an unpaid upload or twenty-four hours after payment.
 */
import { Hono } from 'hono';
import Stripe from 'stripe';
import type { HonoEnv } from '../types.js';
import {
  auditFile,
  buildWorkbook,
  previewRows,
  AuditFileError,
  AUDIT_MAX_BYTES,
  AUDIT_MAX_ROWS,
  AUDIT_TIERS,
  type AuditLang,
} from '../lib/audit-file.js';
import {
  createAuditJob,
  getAuditJob,
  getAuditReport,
  attachAuditSession,
  reserveAuditCheckout,
  getReservedAuditCheckout,
  markAuditPaid,
  countAuditDownload,
  purgeExpiredAuditJobs,
  PAID_TTL_HOURS,
  UNPAID_TTL_HOURS,
  type AuditPaymentResult,
} from '../lib/audit-jobs.js';
import { extractClientIp, recordOperation } from '../lib/stats.js';
import { SAMPLE_CREDITOR_CSV } from '../lib/audit-sample.js';
import { recordSafely } from '../lib/record-safely.js';

const SITE = process.env.PUBLIC_SITE_URL ?? 'https://ibanforge.com';
const LANGS: readonly AuditLang[] = ['en', 'fr', 'de'];

/**
 * Uploads per address, on top of the general per-minute limiter.
 *
 * The general limiter allows 100 requests a minute, sized for validate calls
 * that cost a few milliseconds each. An upload parses a spreadsheet on the
 * same thread as every other request, so the same 100 requests are a
 * different order of cost (adversarial review of 07/09/2026, A1: ~1.3 s of
 * CPU per 4.5 MB workbook before the row cap moved ahead of the parse).
 * Nobody audits a creditor file more than a few times in ten minutes; a
 * caller who does is a script, and gets a 429 that costs nothing to serve.
 * In-memory and per instance, like the general limiter and for the same
 * reasons (see middleware/rate-limit.ts).
 */
export const AUDIT_UPLOADS_PER_WINDOW = 5;
export const AUDIT_UPLOAD_WINDOW_MS = 10 * 60_000;
const uploadTimes = new Map<string, number[]>();

/** Tests only: forget every address. */
export function resetAuditUploadLimiter(): void {
  uploadTimes.clear();
}

function uploadAllowed(ip: string, now: number = Date.now()): boolean {
  const floor = now - AUDIT_UPLOAD_WINDOW_MS;
  // Sweep every address on each call: bounded by the addresses seen in one
  // window, and a spray across many addresses cannot pin entries for the
  // life of the process.
  for (const [key, times] of uploadTimes) {
    const kept = times.filter((t) => t > floor);
    if (kept.length) uploadTimes.set(key, kept);
    else uploadTimes.delete(key);
  }
  const recent = uploadTimes.get(ip) ?? [];
  if (recent.length >= AUDIT_UPLOADS_PER_WINDOW) return false;
  recent.push(now);
  uploadTimes.set(ip, recent);
  return true;
}

function langOf(v: unknown): AuditLang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v)
    ? (v as AuditLang)
    : 'en';
}

let _stripe: Stripe | null = null;
function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  _stripe = new Stripe(key);
  return _stripe;
}
/** Tests swap the client; production never calls this. */
export function _setStripeForTests(client: Stripe | null): void {
  _stripe = client;
}

const PRODUCT_NAME: Record<AuditLang, (rows: number) => string> = {
  en: (rows) => `Creditor file audit, ${rows} rows`,
  fr: (rows) => `Audit de fichier de créanciers, ${rows} lignes`,
  de: (rows) => `Prüfung der Kreditorendatei, ${rows} Zeilen`,
};

function publicJob(
  job: NonNullable<ReturnType<typeof getAuditJob>>,
  opts: { sessionId?: string | null },
) {
  const paid = job.paid_at !== null;
  const sessionOk = !!opts.sessionId && opts.sessionId === job.stripe_session_id;
  return {
    job: job.id,
    rows: job.rows,
    tier: job.tier,
    price_chf: job.price_chf,
    currency: 'CHF',
    lang: job.lang,
    paid,
    paid_at: job.paid_at,
    expires_at: job.expires_at,
    retention: paid ? `${PAID_TTL_HOURS}h after payment` : `${UNPAID_TTL_HOURS}h`,
    summary: job.summary,
    preview: job.preview,
    checkout: paid ? null : `POST /v1/audit/checkout/${job.id}`,
    download:
      paid && sessionOk
        ? `/v1/audit/report/${job.id}?session_id=${encodeURIComponent(opts.sessionId!)}`
        : null,
  };
}

const audit = new Hono<HonoEnv>();

audit.post('/v1/audit/upload', async (c) => {
  purgeExpiredAuditJobs();
  const ip =
    extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for'),
      'x-real-ip': c.req.header('x-real-ip'),
    }) ?? 'unknown';
  if (!uploadAllowed(ip)) {
    return c.json(
      {
        error: 'rate_limited',
        message: `At most ${AUDIT_UPLOADS_PER_WINDOW} uploads every ${AUDIT_UPLOAD_WINDOW_MS / 60_000} minutes per address. Try again later.`,
      },
      429,
    );
  }
  const length = Number(c.req.header('content-length') ?? '0');
  if (length > AUDIT_MAX_BYTES + 64 * 1024) {
    return c.json(
      {
        error: 'file_too_large',
        message: `The file must be under ${AUDIT_MAX_BYTES / 1024 / 1024} MB.`,
      },
      413,
    );
  }
  let body: Record<string, string | File | (string | File)[]>;
  try {
    body = await c.req.parseBody();
  } catch {
    return c.json(
      {
        error: 'invalid_multipart',
        message: 'Send the file as multipart/form-data in a field named "file".',
      },
      400,
    );
  }
  const file = body.file;
  if (!(file instanceof File)) {
    return c.json(
      { error: 'file_missing', message: 'Send a CSV or XLSX in a multipart field named "file".' },
      400,
    );
  }
  if (file.size > AUDIT_MAX_BYTES) {
    return c.json(
      {
        error: 'file_too_large',
        message: `The file must be under ${AUDIT_MAX_BYTES / 1024 / 1024} MB.`,
      },
      413,
    );
  }
  const lang = langOf(body.lang);
  const buffer = Buffer.from(await file.arrayBuffer());
  const started = performance.now();
  let result;
  try {
    result = auditFile(buffer, file.name);
  } catch (e) {
    if (e instanceof AuditFileError) {
      return c.json(
        {
          error: e.code,
          message: e.message,
          limits: { max_rows: AUDIT_MAX_ROWS, max_bytes: AUDIT_MAX_BYTES },
        },
        400,
      );
    }
    throw e;
  }
  const report = buildWorkbook(result, lang);
  const preview = previewRows(result, 20);
  const job = createAuditJob({
    filename: file.name || null,
    rows: result.summary.rows,
    tier: result.summary.tier,
    price_chf: result.summary.price_chf,
    lang,
    summary: result.summary,
    preview,
    report,
  });
  recordSafely(
    () =>
      recordOperation(
        'audit_upload',
        null,
        true,
        0,
        `${result.summary.rows} rows, tier ${result.summary.tier}`,
        c.get('apiKeyPrefix'),
      ),
    'audit_upload',
  );
  return c.json({
    ...publicJob(job, { sessionId: null }),
    processing_ms: Math.round((performance.now() - started) * 100) / 100,
    tiers: AUDIT_TIERS.map((t) => ({ up_to_rows: t.max_rows, price_chf: t.price_chf })),
  });
});

/** The deliverable, shown before anyone uploads anything: the sample file's annotated workbook. */
audit.get('/v1/audit/sample-report.xlsx', (c) => {
  const lang = langOf(c.req.query('lang'));
  const result = auditFile(Buffer.from(SAMPLE_CREDITOR_CSV, 'utf8'), 'exemple-creanciers.csv');
  const report = buildWorkbook(result, lang, new Date('2026-09-02T12:00:00Z'));
  const bytes = report.buffer.slice(
    report.byteOffset,
    report.byteOffset + report.byteLength,
  ) as ArrayBuffer;
  return c.body(bytes, 200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="ibanforge-exemple-audit-${lang}.xlsx"`,
    'Cache-Control': 'public, max-age=3600',
  });
});

audit.post('/v1/audit/checkout/:job', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const job = getAuditJob(c.req.param('job'));
  if (!job)
    return c.json(
      {
        error: 'job_not_found',
        message: 'This audit has expired or never existed. Upload the file again.',
      },
      404,
    );
  if (job.paid_at)
    return c.json(
      {
        error: 'already_paid',
        message: 'This audit is paid; use the status route to download it.',
      },
      409,
    );
  const stripe = getStripe();
  if (!stripe)
    return c.json(
      {
        error: 'payments_unavailable',
        message: 'Card payments are not configured on this server.',
      },
      503,
    );
  const locale = langOf(body.locale ?? job.lang);
  const email =
    typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)
      ? body.email
      : undefined;
  // Le paiement ferme avant le rapport, sans prolonger les deux heures du dépôt.
  const checkoutExpiresAt =
    Math.floor(Date.parse(`${job.expires_at.replace(' ', 'T')}Z`) / 1000) - 300;
  const params: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    expires_at: checkoutExpiresAt,
    locale,
    // A 100 % promotion code is how the operator proves the paid path without a card.
    allow_promotion_codes: true,
    customer_email: email,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'chf',
          unit_amount: job.price_chf * 100,
          product_data: {
            name: PRODUCT_NAME[locale](job.rows),
            description:
              'IBAN, bank, BIC, SEPA reachability and ISO 20022 address check of every row; annotated workbook and summary, available for 24 hours.',
          },
        },
      },
    ],
    metadata: { audit_job: job.id, rows: String(job.rows), tier: job.tier },
    success_url: `${SITE}/${locale}/audit/done?job=${job.id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${SITE}/${locale}/audit?job=${job.id}&cancelled=1`,
  };
  const expired = () =>
    c.json(
      {
        error: 'checkout_expired',
        message: 'The payment window has closed. Upload the file again before paying.',
      },
      410,
    );
  const pending = () =>
    c.json(
      {
        error: 'checkout_in_progress',
        message: 'This payment is already being prepared. Try again in a few seconds.',
      },
      409,
    );
  try {
    let session: Stripe.Checkout.Session;
    if (job.stripe_session_id) {
      session = await stripe.checkout.sessions.retrieve(job.stripe_session_id);
    } else {
      let reserved = getReservedAuditCheckout(job.id);
      if (!reserved) {
        // La borne Stripe ne concerne que la première création, pas son rejeu.
        if (checkoutExpiresAt - Math.floor(Date.now() / 1000) < 1805) return expired();
        reserved = reserveAuditCheckout(job.id, params);
      }
      if (!reserved) return pending();
      if (!reserved.expires_at || reserved.expires_at <= Date.now() / 1000) return expired();
      session = await stripe.checkout.sessions.create(reserved, {
        idempotencyKey: `audit:${job.id}`,
      });
    }
    if (session.metadata?.audit_job !== job.id) {
      return c.json(
        { error: 'payment_session_mismatch', message: 'This payment does not match the audit.' },
        409,
      );
    }
    if (session.payment_status === 'paid' || session.payment_status === 'no_payment_required') {
      const result = markAuditPaid(job.id, {
        session_id: session.id,
        email: session.customer_email ?? session.customer_details?.email ?? null,
        amount_minor: session.amount_total,
        currency: session.currency,
      });
      if ((result.status === 'paid' || result.status === 'already_paid') && result.job) {
        return c.json({
          url: `${SITE}/${result.job.lang}/audit/done?job=${job.id}&session_id=${encodeURIComponent(session.id)}`,
          session_id: session.id,
          price_chf: job.price_chf,
        });
      }
      return c.json(
        {
          error: result.status,
          message: 'The payment requires review. No new payment was created.',
        },
        409,
      );
    }
    if (session.status === 'expired') return expired();
    if (session.status !== 'open') return pending();
    // Une ancienne session peut encore porter l'échéance Stripe par défaut d'une journée.
    if (session.expires_at > checkoutExpiresAt || session.expires_at <= Date.now() / 1000) {
      await stripe.checkout.sessions.expire(session.id);
      return expired();
    }
    if (!session.url) return pending();
    if (!attachAuditSession(job.id, session.id)) {
      const current = getAuditJob(job.id);
      if (!current) return expired();
      if (current.paid_at && current.stripe_session_id === session.id) {
        return c.json({
          url: `${SITE}/${current.lang}/audit/done?job=${job.id}&session_id=${encodeURIComponent(session.id)}`,
          session_id: session.id,
          price_chf: job.price_chf,
        });
      }
      // Ne pas exposer une deuxième session ouverte si un paiement a gagné la course.
      if (current.paid_at) await stripe.checkout.sessions.expire(session.id);
      return pending();
    }
    return c.json({ url: session.url, session_id: session.id, price_chf: job.price_chf });
  } catch (error) {
    if (error instanceof Stripe.errors.StripeInvalidRequestError && error.param === 'expires_at') {
      // Une réservation tardivement rejouée n'avait peut-être jamais atteint Stripe.
      return expired();
    }
    // Reprendre la même réservation au prochain essai, même si Stripe a créé la session.
    return c.json(
      {
        error: 'payments_unavailable',
        message: 'Payment could not be resumed. Try again shortly.',
      },
      503,
    );
  }
});

audit.get('/v1/audit/status/:job', async (c) => {
  purgeExpiredAuditJobs();
  const id = c.req.param('job');
  let job = getAuditJob(id);
  if (!job)
    return c.json(
      { error: 'job_not_found', message: 'This audit has expired or never existed.' },
      404,
    );
  const sessionId = c.req.query('session_id') ?? null;
  let delivery: AuditPaymentResult['status'] | undefined;
  // The webhook is the normal path. When the customer is back before it
  // landed, ask Stripe directly rather than making them refresh.
  if (!job.paid_at && sessionId && sessionId === job.stripe_session_id) {
    const stripe = getStripe();
    if (stripe) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        if (
          session.metadata?.audit_job === id &&
          (session.payment_status === 'paid' || session.payment_status === 'no_payment_required')
        ) {
          const result = markAuditPaid(id, {
            session_id: session.id,
            email: session.customer_email ?? session.customer_details?.email ?? null,
            amount_minor: session.amount_total,
            currency: session.currency,
          });
          delivery = result.status;
        }
      } catch {
        // Stripe unreachable: the page keeps polling; the webhook will land.
      }
    }
  }
  // Le rapport peut avoir expiré ou être devenu payé pendant la lecture Stripe.
  job = getAuditJob(id);
  if (!job) {
    return c.json(
      { error: 'job_not_found', message: 'This audit has expired or never existed.' },
      404,
    );
  }
  return c.json({
    ...publicJob(job, { sessionId: delivery === 'additional_payment' ? null : sessionId }),
    ...(delivery ? { delivery } : {}),
  });
});

audit.get('/v1/audit/report/:job', (c) => {
  const id = c.req.param('job');
  const job = getAuditJob(id);
  if (!job)
    return c.json(
      { error: 'job_not_found', message: 'This audit has expired or never existed.' },
      404,
    );
  if (!job.paid_at)
    return c.json(
      {
        error: 'payment_required',
        message: 'Pay the audit first; the download opens right after.',
      },
      402,
    );
  const sessionId = c.req.query('session_id') ?? '';
  if (!sessionId || sessionId !== job.stripe_session_id) {
    return c.json(
      { error: 'forbidden', message: 'The download link is tied to the payment session.' },
      403,
    );
  }
  const report = getAuditReport(id);
  if (!report)
    return c.json({ error: 'job_not_found', message: 'The report is no longer available.' }, 404);
  countAuditDownload(id);
  const name = `ibanforge-audit-${id.slice(0, 8)}.xlsx`;
  const bytes = report.buffer.slice(
    report.byteOffset,
    report.byteOffset + report.byteLength,
  ) as ArrayBuffer;
  return c.body(bytes, 200, {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${name}"`,
    'Cache-Control': 'private, no-store',
    'Content-Length': String(report.length),
  });
});

export { audit };
