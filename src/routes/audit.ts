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
  markAuditPaid,
  countAuditDownload,
  purgeExpiredAuditJobs,
  PAID_TTL_HOURS,
  UNPAID_TTL_HOURS,
} from '../lib/audit-jobs.js';
import { recordOperation } from '../lib/stats.js';
import { SAMPLE_CREDITOR_CSV } from '../lib/audit-sample.js';
import { recordSafely } from '../lib/record-safely.js';

const SITE = process.env.PUBLIC_SITE_URL ?? 'https://ibanforge.com';
const LANGS: readonly AuditLang[] = ['en', 'fr', 'de'];

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
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const locale = langOf(body.locale ?? job.lang);
  const email =
    typeof body.email === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)
      ? body.email
      : undefined;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
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
  });
  attachAuditSession(job.id, session.id);
  return c.json({ url: session.url, session_id: session.id, price_chf: job.price_chf });
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
          job =
            markAuditPaid(id, {
              session_id: session.id,
              email: session.customer_email ?? session.customer_details?.email ?? null,
              amount_minor: session.amount_total,
              currency: session.currency,
            }) ?? job;
        }
      } catch {
        // Stripe unreachable: the page keeps polling; the webhook will land.
      }
    }
  }
  return c.json(publicJob(job, { sessionId }));
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
