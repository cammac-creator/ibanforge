import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import * as XLSX from 'xlsx';
import { audit } from './audit.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  markAuditPaid,
  getAuditJob,
  purgeExpiredAuditJobs,
  auditStats,
} from '../lib/audit-jobs.js';
import { AUDIT_MAX_BYTES } from '../lib/audit-file.js';

const VALID_CH = 'CH1000230000000012345';
const VALID_DE = 'DE89370400440532013000';
const BAD_CHECK = 'CH1000230000000012346';

function app() {
  const a = new Hono();
  a.route('/', audit);
  return a;
}

interface UploadBody {
  job: string;
  rows: number;
  paid: boolean;
  price_chf: number;
  currency: string;
  download: string | null;
  checkout: string | null;
  summary: { error: number };
  preview: Array<{ line: number; iban_masked: string }>;
  error?: string;
}

function upload(content: Buffer | string, name = 'creanciers.csv', lang = 'fr') {
  const form = new FormData();
  const part: BlobPart =
    typeof content === 'string' ? content : (new Uint8Array(content) as unknown as BlobPart);
  form.append('file', new File([part], name, { type: 'text/csv' }));
  form.append('lang', lang);
  return app().request('/v1/audit/upload', { method: 'POST', body: form });
}

afterAll(() => closeAll());

describe('POST /v1/audit/upload', () => {
  it('audits a CSV, returns the free preview with masked IBANs and a job id, and stores the report', async () => {
    const r = await upload(
      ['Nom;IBAN', `Alpha SA;${VALID_CH}`, `Beta GmbH;${VALID_DE}`, `Gamma;${BAD_CHECK}`].join(
        '\n',
      ),
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as UploadBody;
    expect(body.job).toMatch(/^[0-9a-f]{36}$/);
    expect(body.rows).toBe(3);
    expect(body.paid).toBe(false);
    expect(body.price_chf).toBe(149);
    expect(body.currency).toBe('CHF');
    expect(body.summary.error).toBe(1);
    expect(body.preview[0].line).toBe(3);
    expect(body.preview[0].iban_masked).toBe('CH10 **** 2346');
    expect(JSON.stringify(body)).not.toContain(VALID_CH);
    expect(body.download).toBeNull();
    expect(body.checkout).toBe(`POST /v1/audit/checkout/${body.job}`);
    const stored = getAuditJob(body.job);
    expect(stored?.rows).toBe(3);
    expect(stored?.lang).toBe('fr');
  });

  it('rejects a missing file, an unreadable table and an oversized upload', async () => {
    const none = await app().request('/v1/audit/upload', { method: 'POST', body: new FormData() });
    expect(none.status).toBe(400);
    expect(((await none.json()) as UploadBody).error).toBe('file_missing');

    const noIban = await upload('a;b\n1;2\n');
    expect(noIban.status).toBe(400);
    expect(((await noIban.json()) as UploadBody).error).toBe('no_iban_column');

    const big = await upload(Buffer.alloc(AUDIT_MAX_BYTES + 1, 0x41), 'big.csv');
    expect(big.status).toBe(413);
  });
});

describe('checkout, status and report', () => {
  it('answers 503 for checkout when Stripe is not configured', async () => {
    const r = await upload(['IBAN', VALID_CH].join('\n'));
    const { job } = (await r.json()) as { job: string };
    const prev = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const c = await app().request(`/v1/audit/checkout/${job}`, {
        method: 'POST',
        body: '{}',
        headers: { 'content-type': 'application/json' },
      });
      expect(c.status).toBe(503);
    } finally {
      if (prev !== undefined) process.env.STRIPE_SECRET_KEY = prev;
    }
  });

  it('serves the report only after payment and only with the paying session', async () => {
    const r = await upload(['Nom;IBAN', `Alpha;${VALID_CH}`].join('\n'), 'f.csv', 'de');
    const { job } = (await r.json()) as { job: string };

    const unpaid = await app().request(`/v1/audit/report/${job}?session_id=cs_test_x`);
    expect(unpaid.status).toBe(402);

    const paid = markAuditPaid(job, {
      session_id: 'cs_test_123',
      email: 'buyer@example.com',
      amount_minor: 14900,
      currency: 'chf',
    });
    expect(paid?.paid_at).toBeTruthy();
    expect(paid!.expires_at > paid!.created_at).toBe(true);

    const status = await app().request(`/v1/audit/status/${job}?session_id=cs_test_123`);
    const sb = (await status.json()) as UploadBody;
    expect(sb.paid).toBe(true);
    expect(sb.download).toBe(`/v1/audit/report/${job}?session_id=cs_test_123`);

    const wrong = await app().request(`/v1/audit/report/${job}?session_id=cs_other`);
    expect(wrong.status).toBe(403);

    const ok = await app().request(`/v1/audit/report/${job}?session_id=cs_test_123`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('spreadsheetml');
    const wb = XLSX.read(Buffer.from(await ok.arrayBuffer()), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Prüfung', 'Zusammenfassung']);
    expect(getAuditJob(job)?.downloads).toBe(1);
  });

  it('purges expired jobs and answers 404 afterwards', async () => {
    const r = await upload(['IBAN', VALID_DE].join('\n'));
    const { job } = (await r.json()) as { job: string };
    getStatsDB()
      .prepare("UPDATE audit_jobs SET expires_at = '2000-01-01 00:00:00' WHERE id = ?")
      .run(job);
    expect(purgeExpiredAuditJobs()).toBeGreaterThanOrEqual(1);
    const s = await app().request(`/v1/audit/status/${job}`);
    expect(s.status).toBe(404);
  });
});

describe('sample report and statistics', () => {
  it('serves the sample annotated workbook without a job, cacheable', async () => {
    const r = await app().request('/v1/audit/sample-report.xlsx?lang=de');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('spreadsheetml');
    expect(r.headers.get('cache-control')).toContain('public');
    const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
    expect(wb.SheetNames).toEqual(['Prüfung', 'Zusammenfassung']);
  });

  it('counts a sale once, on the transition to paid, and reports it in the statistics', async () => {
    const before = auditStats(30);
    const r = await upload(['IBAN', VALID_CH].join('\n'));
    const { job } = (await r.json()) as { job: string };
    markAuditPaid(job, {
      session_id: 'cs_stats_1',
      email: null,
      amount_minor: 14900,
      currency: 'chf',
    });
    markAuditPaid(job, {
      session_id: 'cs_stats_1',
      email: null,
      amount_minor: 14900,
      currency: 'chf',
    });
    const after = auditStats(30);
    expect(after.sales).toBe(before.sales + 1);
    expect(after.revenue_chf).toBe(before.revenue_chf + 149);
    expect(after.uploads).toBeGreaterThan(before.uploads);
    expect(after.last_sale_at).toBeTruthy();
  });
});
