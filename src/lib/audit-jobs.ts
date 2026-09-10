/**
 * Storage for creditor-file audits between the upload and the download.
 *
 * Why a table at all: the customer uploads, looks at the free preview, then
 * leaves for Stripe's hosted page and comes back. The annotated workbook has
 * to survive that round trip, and a redeploy in between, so it lives on the
 * persistent volume with the stats database, never on the container disk.
 *
 * Why short-lived: the report holds bank details of the customer's
 * creditors. An unpaid job is gone after two hours, a paid one twenty-four
 * hours after payment, and the page says exactly that.
 */
import { randomBytes } from 'node:crypto';
import type Stripe from 'stripe';
import { getStatsDB } from './db.js';
import { isInternalEmail } from './internal-accounts.js';
import type { AuditSummary, PreviewRow, AuditLang, AuditTierCode } from './audit-file.js';

export const UNPAID_TTL_HOURS = 2;
export const PAID_TTL_HOURS = 24;

export interface AuditJob {
  id: string;
  created_at: string;
  expires_at: string;
  filename: string | null;
  rows: number;
  tier: AuditTierCode;
  price_chf: number;
  lang: AuditLang;
  summary: AuditSummary;
  preview: PreviewRow[];
  stripe_session_id: string | null;
  paid_at: string | null;
  payer_email: string | null;
  downloads: number;
}

interface Row {
  id: string;
  created_at: string;
  expires_at: string;
  filename: string | null;
  rows: number;
  tier: string;
  price_chf: number;
  lang: string;
  summary_json: string;
  preview_json: string;
  stripe_session_id: string | null;
  paid_at: string | null;
  payer_email: string | null;
  downloads: number;
}

function isoIn(hours: number, from = Date.now()): string {
  return new Date(from + hours * 3_600_000).toISOString().replace('T', ' ').slice(0, 19);
}

function toJob(r: Row): AuditJob {
  return {
    id: r.id,
    created_at: r.created_at,
    expires_at: r.expires_at,
    filename: r.filename,
    rows: r.rows,
    tier: r.tier as AuditTierCode,
    price_chf: r.price_chf,
    lang: r.lang as AuditLang,
    summary: JSON.parse(r.summary_json) as AuditSummary,
    preview: JSON.parse(r.preview_json) as PreviewRow[],
    stripe_session_id: r.stripe_session_id,
    paid_at: r.paid_at,
    payer_email: r.payer_email,
    downloads: r.downloads,
  };
}

export function createAuditJob(input: {
  filename: string | null;
  rows: number;
  tier: AuditTierCode;
  price_chf: number;
  lang: AuditLang;
  summary: AuditSummary;
  preview: PreviewRow[];
  report: Buffer;
}): AuditJob {
  const id = randomBytes(18).toString('hex');
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO audit_jobs (id, expires_at, filename, rows, tier, price_chf, lang, summary_json, preview_json, report)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    isoIn(UNPAID_TTL_HOURS),
    input.filename,
    input.rows,
    input.tier,
    input.price_chf,
    input.lang,
    JSON.stringify(input.summary),
    JSON.stringify(input.preview),
    input.report,
  );
  return getAuditJob(id)!;
}

const COLUMNS =
  'id, created_at, expires_at, filename, rows, tier, price_chf, lang, summary_json, preview_json, stripe_session_id, paid_at, payer_email, downloads';

export function getAuditJob(id: string): AuditJob | null {
  const r = getStatsDB()
    .prepare(`SELECT ${COLUMNS} FROM audit_jobs WHERE id = ? AND expires_at > ?`)
    .get(id, isoIn(0)) as Row | undefined;
  return r ? toJob(r) : null;
}

export function getAuditReport(id: string): Buffer | null {
  const r = getStatsDB()
    .prepare('SELECT report FROM audit_jobs WHERE id = ? AND expires_at > ?')
    .get(id, isoIn(0)) as { report: Buffer } | undefined;
  return r ? r.report : null;
}

/** Fige le corps Stripe avant le réseau, y compris après un arrêt avant attachement. */
export function getReservedAuditCheckout(id: string): Stripe.Checkout.SessionCreateParams | null {
  const row = getStatsDB()
    .prepare('SELECT checkout_params_json FROM audit_jobs WHERE id = ? AND expires_at > ?')
    .get(id, isoIn(0)) as { checkout_params_json: string | null } | undefined;
  return row?.checkout_params_json
    ? (JSON.parse(row.checkout_params_json) as Stripe.Checkout.SessionCreateParams)
    : null;
}

export function reserveAuditCheckout(
  id: string,
  params: Stripe.Checkout.SessionCreateParams,
): Stripe.Checkout.SessionCreateParams | null {
  const db = getStatsDB();
  return db
    .transaction(() => {
      const info = db
        .prepare(
          `UPDATE audit_jobs SET checkout_params_json = COALESCE(checkout_params_json, ?)
       WHERE id = ? AND paid_at IS NULL AND stripe_session_id IS NULL AND expires_at > ?`,
        )
        .run(JSON.stringify(params), id, isoIn(0));
      if (!info.changes) return null;
      const row = db
        .prepare('SELECT checkout_params_json FROM audit_jobs WHERE id = ?')
        .get(id) as {
        checkout_params_json: string;
      };
      return JSON.parse(row.checkout_params_json) as Stripe.Checkout.SessionCreateParams;
    })
    .immediate();
}

/** Un attachement tardif ne doit remplacer ni un paiement ni une autre session. */
export function attachAuditSession(id: string, sessionId: string): boolean {
  return (
    getStatsDB()
      .prepare(
        `UPDATE audit_jobs SET stripe_session_id = ?
       WHERE id = ? AND paid_at IS NULL AND expires_at > ?
         AND (stripe_session_id IS NULL OR stripe_session_id = ?)`,
      )
      .run(sessionId, id, isoIn(0), sessionId).changes > 0
  );
}

export interface AuditPaymentResult {
  status: 'paid' | 'already_paid' | 'additional_payment' | 'job_missing';
  job: AuditJob | null;
}

/** Le premier paiement confirmé fixe la livraison et sa vente dans une même transaction. */
export function markAuditPaid(
  id: string,
  payment: {
    session_id: string;
    email: string | null;
    amount_minor: number | null;
    currency: string | null;
  },
): AuditPaymentResult {
  const db = getStatsDB();
  return db
    .transaction((): AuditPaymentResult => {
      const before = getAuditJob(id);
      // La vente survit à la purge : un autre événement du même paiement reste un rejeu.
      const sale = db
        .prepare('SELECT stripe_session_id FROM audit_sales WHERE job_id = ? ORDER BY id LIMIT 1')
        .get(id) as { stripe_session_id: string | null } | undefined;
      const paidSession =
        sale?.stripe_session_id ?? (before?.paid_at ? before.stripe_session_id : null);
      if (paidSession) {
        return {
          status: paidSession === payment.session_id ? 'already_paid' : 'additional_payment',
          job: before,
        };
      }
      if (!before) return { status: 'job_missing', job: null };
      if (before.paid_at) return { status: 'additional_payment', job: before };
      db.prepare(
        `UPDATE audit_jobs SET paid_at = ?, stripe_session_id = ?, payer_email = ?,
       amount_paid_minor = ?, amount_paid_currency = ?, expires_at = ? WHERE id = ?`,
      ).run(
        isoIn(0),
        payment.session_id,
        payment.email,
        payment.amount_minor,
        payment.currency,
        isoIn(PAID_TTL_HOURS),
        id,
      );
      db.prepare(
        `INSERT INTO audit_sales (job_id, rows, tier, price_chf, amount_paid_minor, amount_paid_currency, stripe_session_id, lang)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        before.rows,
        before.tier,
        before.price_chf,
        payment.amount_minor,
        payment.currency,
        payment.session_id,
        before.lang,
      );
      return { status: 'paid', job: getAuditJob(id) };
    })
    .immediate();
}

export function countAuditDownload(id: string): void {
  getStatsDB().prepare('UPDATE audit_jobs SET downloads = downloads + 1 WHERE id = ?').run(id);
}

/** Remove what nobody may read any more. Cheap; called on every upload and status read. */
export function purgeExpiredAuditJobs(now = new Date()): number {
  const cutoff = now.toISOString().replace('T', ' ').slice(0, 19);
  const info = getStatsDB().prepare('DELETE FROM audit_jobs WHERE expires_at <= ?').run(cutoff);
  return info.changes;
}

/** For the admin dashboard: sales, without any report content. */
export function listPaidAuditJobs(limit = 50): Array<
  Omit<AuditJob, 'preview' | 'summary'> & {
    amount_paid_minor: number | null;
    amount_paid_currency: string | null;
  }
> {
  const rows = getStatsDB()
    .prepare(
      `SELECT id, created_at, expires_at, filename, rows, tier, price_chf, lang, stripe_session_id, paid_at, payer_email, downloads,
              amount_paid_minor, amount_paid_currency
         FROM audit_jobs WHERE paid_at IS NOT NULL ORDER BY paid_at DESC LIMIT ?`,
    )
    .all(limit) as Array<
    Row & { amount_paid_minor: number | null; amount_paid_currency: string | null }
  >;
  return rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    expires_at: r.expires_at,
    filename: r.filename,
    rows: r.rows,
    tier: r.tier as AuditTierCode,
    price_chf: r.price_chf,
    lang: r.lang as AuditLang,
    stripe_session_id: r.stripe_session_id,
    paid_at: r.paid_at,
    payer_email: r.payer_email,
    downloads: r.downloads,
    amount_paid_minor: r.amount_paid_minor,
    amount_paid_currency: r.amount_paid_currency,
  }));
}

export interface AuditStats {
  period_days: number;
  since: string;
  uploads: number;
  sales: number;
  /** Total CHF connu à la commande, avant remboursements et frais ; jamais le catalogue. */
  revenue_chf: number | null;
  revenue_basis: 'stripe_checkout';
  payment_amounts: { chf: number; other_currency: number; unknown: number };
  last_sale_at: string | null;
  conversion: number | null;
  /**
   * The uploads themselves, newest first, so "2 files" on the card can be read
   * as two dated events: the size class the API recorded, whether a key was
   * sent (the page never sends one, a script might), and whether that key is
   * one of ours. Nothing else is kept about an upload once its job is purged.
   */
  recent_uploads: Array<{
    at: string;
    rows: number | null;
    tier: string | null;
    key_prefix: string | null;
    internal: boolean;
  }>;
  /** The sales of the window, from the durable ledger. */
  recent_sales: Array<{
    paid_at: string;
    rows: number;
    tier: string;
    price_chf: number;
    amount_paid_minor: number | null;
    amount_paid_currency: string | null;
  }>;
}

/** Uploads (durable, from the operations log) and sales (durable ledger) over the period. */
export function auditStats(days: number): AuditStats {
  const db = getStatsDB();
  const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const uploads = (
    db
      .prepare(
        `SELECT COUNT(*) n FROM operations WHERE operation_type = 'audit_upload' AND created_at >= datetime('now', ?)`,
      )
      .get(`-${days} days`) as { n: number }
  ).n;
  // Un ancien montant absent reste inconnu. Les devises ne sont jamais additionnées.
  const sales = db
    .prepare(
      `WITH measured AS (
         SELECT paid_at, amount_paid_minor, lower(trim(amount_paid_currency)) currency,
                (typeof(amount_paid_minor) = 'integer' AND amount_paid_minor >= 0
                 AND lower(trim(amount_paid_currency)) GLOB '[a-z][a-z][a-z]') valid_amount
         FROM audit_sales WHERE paid_at >= datetime('now', ?)
       )
       SELECT COUNT(*) n, MAX(paid_at) last,
              COALESCE(SUM(CASE WHEN valid_amount AND currency = 'chf' THEN amount_paid_minor ELSE 0 END), 0) chf_minor,
              COUNT(CASE WHEN valid_amount AND currency = 'chf' THEN 1 END) chf_payments,
              COUNT(CASE WHEN valid_amount AND currency != 'chf' THEN 1 END) other_currency_payments
       FROM measured`,
    )
    .get(`-${days} days`) as {
    n: number;
    last: string | null;
    chf_minor: number;
    chf_payments: number;
    other_currency_payments: number;
  };
  const uploadRows = db
    .prepare(
      `SELECT created_at AS at, error_detail AS detail, key_prefix
       FROM operations
       WHERE operation_type = 'audit_upload' AND created_at >= datetime('now', ?)
       ORDER BY created_at DESC, id DESC LIMIT 20`,
    )
    .all(`-${days} days`) as Array<{
    at: string;
    detail: string | null;
    key_prefix: string | null;
  }>;
  // Which of the keys that uploaded are ours: resolved in code with the one
  // rule every other reader uses (isInternalEmail), not with the SQL function
  // some connections register and others do not.
  const prefixes = [
    ...new Set(uploadRows.map((r) => r.key_prefix).filter((p): p is string => !!p)),
  ];
  const emailOf = new Map<string, string>();
  if (prefixes.length) {
    const rows = db
      .prepare(
        `SELECT key_prefix, email FROM api_keys WHERE key_prefix IN (${prefixes.map(() => '?').join(',')})`,
      )
      .all(...prefixes) as Array<{ key_prefix: string; email: string }>;
    for (const r of rows) emailOf.set(r.key_prefix, r.email);
  }
  const recentUploads = uploadRows.map((r) => {
    // recordOperation keeps the first twelve characters of "<rows> rows, tier
    // <tier>", so the row count survives and the tier usually does not.
    const m = /^(\d+) rows(?:, tier (\S+))?/.exec(r.detail ?? '');
    return {
      at: r.at,
      rows: m ? Number(m[1]) : null,
      tier: m?.[2] ?? null,
      key_prefix: r.key_prefix,
      internal: r.key_prefix ? isInternalEmail(emailOf.get(r.key_prefix)) : false,
    };
  });
  const recentSales = db
    .prepare(
      `SELECT paid_at, rows, tier, price_chf, amount_paid_minor, amount_paid_currency
       FROM audit_sales WHERE paid_at >= datetime('now', ?)
       ORDER BY paid_at DESC LIMIT 20`,
    )
    .all(`-${days} days`) as AuditStats['recent_sales'];
  return {
    period_days: days,
    since,
    uploads,
    sales: sales.n,
    revenue_chf: sales.chf_payments > 0 || sales.n === 0 ? sales.chf_minor / 100 : null,
    revenue_basis: 'stripe_checkout',
    payment_amounts: {
      chf: sales.chf_payments,
      other_currency: sales.other_currency_payments,
      unknown: sales.n - sales.chf_payments - sales.other_currency_payments,
    },
    last_sale_at: sales.last,
    conversion: uploads > 0 ? Math.round((sales.n / uploads) * 1000) / 1000 : null,
    recent_uploads: recentUploads,
    recent_sales: recentSales,
  };
}
