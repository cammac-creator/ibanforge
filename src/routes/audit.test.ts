import { describe, it, expect, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { Hono } from 'hono';
import { HonoRequest } from 'hono/request';
import * as XLSX from 'xlsx';
import {
  audit,
  resetAuditUploadLimiter,
  AUDIT_UPLOADS_PER_WINDOW,
  AUDIT_UPLOAD_BODY_MAX_BYTES,
} from './audit.js';
import { buildApp } from '../app.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import {
  markAuditPaid,
  getAuditJob,
  purgeExpiredAuditJobs,
  auditStats,
} from '../lib/audit-jobs.js';
import {
  AUDIT_MAX_BYTES,
  AUDIT_MAX_CELLS,
  AUDIT_MAX_ROWS,
  AUDIT_MAX_UNZIPPED_BYTES,
} from '../lib/audit-file.js';
import { SAMPLE_CREDITOR_CSV } from '../lib/audit-sample.js';

const VALID_CH = 'CH1000230000000012345';
const VALID_DE = 'DE89370400440532013000';
const BAD_CHECK = 'CH1000230000000012346';

function app() {
  const a = new Hono();
  a.route('/', audit);
  return a;
}

// Every upload in this file comes from the same (absent) address; the
// per-address budget must start fresh for each test.
beforeEach(() => resetAuditUploadLimiter());

interface UploadBody {
  job: string;
  rows: number;
  paid: boolean;
  price: number;
  currency: string;
  download: string | null;
  checkout: string | null;
  summary: { error: number };
  preview: Array<{ line: number; iban_masked: string }>;
  error?: string;
}

function upload(
  content: Buffer | string,
  name = 'creanciers.csv',
  lang = 'fr',
  extra: Record<string, string> = {},
) {
  const form = new FormData();
  const part: BlobPart =
    typeof content === 'string' ? content : (new Uint8Array(content) as unknown as BlobPart);
  form.append('file', new File([part], name, { type: 'text/csv' }));
  form.append('lang', lang);
  for (const [k, v] of Object.entries(extra)) form.append(k, v);
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
    expect(body.price).toBe(149);
    expect(body.currency).toBe('USD');
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

  /**
   * A file one row past the cap must be told SO, and nothing else.
   *
   * Until 22/09/2026 it was answered `unreadable` — "we could not read your
   * file as CSV or XLSX" — because `readTable` threw its own `too_many_rows`
   * inside the try block that catches parser failures. The customer read that
   * their export was malformed, when it was perfectly formed and simply longer
   * than the product accepts; `no_iban_column` and `empty` travelled fine, so
   * the one refusal with an obvious remedy was the one that lost it.
   *
   * The assertion is on the CODE, not the wording: the code is what the site
   * maps to "split the file and upload the parts".
   */
  /**
   * SEC-02 (10.11.2026) : un classeur de quelques dizaines de kilo-octets qui se
   * décompresserait en plus de 60 Mo est refusé avant toute lecture par SheetJS,
   * en 400 file_too_large, le code que le site traduit déjà.
   */
  it('answers 400 file_too_large to a workbook that would expand past the unzipped ceiling', async () => {
    const content = Buffer.alloc(AUDIT_MAX_UNZIPPED_BYTES + 1024 * 1024, 0x20);
    const packed = deflateRawSync(content);
    const name = Buffer.from('xl/worksheets/sheet1.xml', 'latin1');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(content.length, 24);
    entry.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(1, 8);
    end.writeUInt16LE(1, 10);
    end.writeUInt32LE(46 + name.length, 12);
    end.writeUInt32LE(30 + name.length + packed.length, 16);
    const file = Buffer.concat([local, name, packed, entry, name, end]);
    expect(file.length).toBeLessThan(1024 * 1024);

    const r = await upload(file, 'classeur.xlsx');
    expect(r.status).toBe(400);
    const body = (await r.json()) as {
      error: string;
      limits: { max_unzipped_bytes: number; max_bytes: number };
    };
    expect(body.error).toBe('file_too_large');
    expect(body.limits.max_unzipped_bytes).toBe(AUDIT_MAX_UNZIPPED_BYTES);
    expect(body.limits.max_bytes).toBe(AUDIT_MAX_BYTES);
  });

  it('answers 400 file_too_large to a small CSV whose range runs thousands of columns wide', async () => {
    const lines = [
      'IBAN' + ';'.repeat(16_383) + 'x',
      ...Array.from({ length: 2_000 }, () => VALID_CH),
    ];
    const r = await upload(lines.join('\n'), 'large.csv');
    expect(r.status).toBe(400);
    const body = (await r.json()) as { error: string; limits: { max_cells: number } };
    expect(body.error).toBe('file_too_large');
    expect(body.limits.max_cells).toBe(AUDIT_MAX_CELLS);
  });

  it('gives the sample file the same report as a workbook as it does as text', async () => {
    const asText = (await (await upload(SAMPLE_CREDITOR_CSV, 'exemple.csv')).json()) as {
      summary: unknown;
      preview: unknown;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(SAMPLE_CREDITOR_CSV.split('\n').map((l) => l.split(';'))),
      'Feuil1',
    );
    const book = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
    const r = await upload(book, 'exemple.xlsx');
    expect(r.status).toBe(200);
    const asBook = (await r.json()) as { summary: unknown; preview: unknown };
    expect(asBook.summary).toEqual(asText.summary);
    expect(asBook.preview).toEqual(asText.preview);
  });

  it('answers too_many_rows — not unreadable — on a file one row past the cap', async () => {
    const lines = ['IBAN', ...Array.from({ length: AUDIT_MAX_ROWS + 1 }, () => VALID_CH)];
    const csv = Buffer.from(lines.join('\n') + '\n', 'utf8');
    // The proof only means something if the file reaches the parser at all:
    // the byte ceiling must leave room for the row count the tiers promise.
    expect(csv.length).toBeLessThan(AUDIT_MAX_BYTES);
    const r = await upload(csv, 'trop-long.csv');
    expect(r.status).toBe(400);
    const body = (await r.json()) as UploadBody & { limits?: { max_rows: number } };
    expect(body.error).toBe('too_many_rows');
    expect(body.limits?.max_rows).toBe(AUDIT_MAX_ROWS);
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
    expect(paid.status).toBe('paid');
    expect(paid.job?.paid_at).toBeTruthy();
    expect(paid.job!.expires_at > paid.job!.created_at).toBe(true);

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

  /**
   * The purge above works; what was missing was anything to CALL it.
   *
   * Until 22/09/2026 `purgeExpiredAuditJobs` ran only from the upload route and
   * the status route, so on a quiet week an expired report — every column of a
   * customer's creditor file, IBANs included — stayed on the volume until the
   * next visitor happened to arrive, while /audit promised it was gone after
   * two hours. The clock now lives in `src/index.ts`, which no test can import
   * (it calls `serve()` at import time), so it is read as text — the same
   * remedy `scripts/mcp-parity.test.ts` uses for a constant it cannot import.
   */
  it('the entry point arms a clock for the purge, not just the request paths', () => {
    const entry = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(entry).toContain('purgeExpiredAuditJobs');
    const interval = entry.match(/setInterval\(auditReportPurgeTick,\s*([A-Z_]+)\)/)?.[1];
    expect(interval, 'aucun setInterval sur la purge des rapports d’audit').toBeDefined();
    const ms = entry.match(new RegExp(`const ${interval} = ([^;]+);`))?.[1];
    expect(ms).toBeTruthy();
    const value = ms!.split('*').reduce((acc, part) => acc * Number(part.trim()), 1);
    expect(Number.isFinite(value)).toBe(true);
    // Shorter than the shortest promise on the page (2 h unpaid), by a margin.
    expect(value).toBeLessThanOrEqual(30 * 60 * 1000);
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
      currency: 'usd',
    });
    markAuditPaid(job, {
      session_id: 'cs_stats_1',
      email: null,
      amount_minor: 14900,
      currency: 'usd',
    });
    const after = auditStats(30);
    expect(after.sales).toBe(before.sales + 1);
    expect(after.revenue_usd).toBe((before.revenue_usd ?? 0) + 149);
    expect(after.revenue_chf).toBe(before.revenue_chf);
    expect(after.uploads).toBeGreaterThan(before.uploads);
    expect(after.last_sale_at).toBeTruthy();
  });
});

/**
 * 28.10.2026 : le fichier d'exemple passait par la route de dépôt et comptait
 * comme un fichier de client ; aucune lecture d'`uploads` ne pouvait dire si un
 * vrai fichier était jamais arrivé. L'exemple est désormais compté à part, et un
 * vrai fichier avec une ligne suisse ou liechtensteinoise laisse un marqueur.
 */
describe('l’exemple est compté à part des fichiers de clients', () => {
  const delta = (before: ReturnType<typeof auditStats>) => {
    const after = auditStats(30);
    return {
      uploads: after.uploads - before.uploads,
      samples: after.samples - before.samples,
      uploads_ch: after.uploads_ch - before.uploads_ch,
    };
  };

  it('compte l’exemple envoyé par la page (sample=1) comme exemple, jamais comme fichier suisse', async () => {
    const before = auditStats(30);
    const r = await upload(SAMPLE_CREDITOR_CSV, 'exemple-creanciers.csv', 'fr', { sample: '1' });
    expect(r.status).toBe(200);
    // L'exemple porte des lignes suisses : il ne doit pas compter comme fichier suisse.
    expect(SAMPLE_CREDITOR_CSV).toContain(';CH10 0023');
    expect(delta(before)).toEqual({ uploads: 0, samples: 1, uploads_ch: 0 });
  });

  it('reconnaît l’exemple à son contenu quand une page en cache n’envoie pas le champ', async () => {
    const before = auditStats(30);
    const r = await upload(SAMPLE_CREDITOR_CSV, 'exemple-creanciers.csv');
    expect(r.status).toBe(200);
    expect(delta(before)).toEqual({ uploads: 0, samples: 1, uploads_ch: 0 });
  });

  it('compte un vrai fichier suisse comme dépôt et comme dépôt suisse', async () => {
    const before = auditStats(30);
    const r = await upload(
      ['Nom;IBAN', `Alpha SA;${VALID_CH}`, `Beta GmbH;${VALID_DE}`].join('\n'),
    );
    expect(r.status).toBe(200);
    expect(delta(before)).toEqual({ uploads: 1, samples: 0, uploads_ch: 1 });
  });

  it('compte un vrai fichier sans ligne suisse ni liechtensteinoise comme dépôt seulement', async () => {
    const before = auditStats(30);
    const r = await upload(['Nom;IBAN', `Beta GmbH;${VALID_DE}`].join('\n'));
    expect(r.status).toBe(200);
    expect(delta(before)).toEqual({ uploads: 1, samples: 0, uploads_ch: 0 });
  });

  it('compte comme suisses une ligne CH à l’IBAN invalide et une ligne LI', async () => {
    let before = auditStats(30);
    await upload(['Nom;IBAN', `Gamma;${BAD_CHECK}`, `Beta GmbH;${VALID_DE}`].join('\n'));
    expect(delta(before)).toEqual({ uploads: 1, samples: 0, uploads_ch: 1 });
    before = auditStats(30);
    await upload(['Nom;IBAN', 'Delta Anstalt;LI21 0881 0000 2324 013A A'].join('\n'));
    expect(delta(before)).toEqual({ uploads: 1, samples: 0, uploads_ch: 1 });
  });

  it('écrit le marqueur suisse sans pays, hors de tout compte par pays', async () => {
    await upload(['Nom;IBAN', `Alpha SA;${VALID_CH}`].join('\n'));
    const row = getStatsDB()
      .prepare(
        `SELECT country_code FROM operations WHERE operation_type = 'audit_upload_ch' ORDER BY id DESC LIMIT 1`,
      )
      .get() as { country_code: string | null } | undefined;
    expect(row).toBeDefined();
    expect(row?.country_code).toBeNull();
  });
});

/**
 * SEC-02 (audit du 10.11.2026) : le plafond du corps compte les octets reçus.
 *
 * La seule borne était l'en-tête `Content-Length`. Un corps envoyé par morceaux
 * n'en porte pas : il passait, et `parseBody()` le mettait tout entier en
 * mémoire. Les corps ci-dessous sont des flux sans `Content-Length` (c'est aussi
 * le cas de tout `FormData` passé à `app.request`, qui ne traverse pas HTTP), et
 * le flux compte ce qu'on lui tire : la preuve que la lecture s'arrête au
 * plafond, sans avaler le reste.
 */
describe('POST /v1/audit/upload: the body cap counts the bytes that arrive', () => {
  const CHUNK = 64 * 1024;
  const BOUNDARY = 'ibanforge-test-boundary';

  /**
   * Un corps produit à la demande, un morceau par lecture ; `pulled` dit combien
   * a été lu. `highWaterMark: 0` : le flux ne prend rien d'avance, `pulled`
   * compte donc ce que la route a demandé et rien d'autre.
   */
  function meteredStream(parts: Buffer[], chunk = CHUNK) {
    const all = Buffer.concat(parts);
    const meter = { pulled: 0, total: all.length };
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          if (meter.pulled >= all.length) return controller.close();
          const next = all.subarray(meter.pulled, meter.pulled + chunk);
          meter.pulled += next.length;
          controller.enqueue(new Uint8Array(next));
        },
      },
      { highWaterMark: 0 },
    );
    return { stream, meter };
  }

  /** Un corps multipart écrit à la main, pour voyager en flux nu. */
  function multipart(file: Buffer, name: string): Buffer[] {
    return [
      Buffer.from(
        `--${BOUNDARY}\r\nContent-Disposition: form-data; name="lang"\r\n\r\nfr\r\n` +
          `--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\n` +
          'Content-Type: text/csv\r\n\r\n',
      ),
      file,
      Buffer.from(`\r\n--${BOUNDARY}--\r\n`),
    ];
  }

  function streamUpload(stream: ReadableStream<Uint8Array>, headers: Record<string, string> = {}) {
    return app().request('/v1/audit/upload', {
      method: 'POST',
      body: stream,
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}`, ...headers },
      duplex: 'half',
    } as RequestInit);
  }

  /**
   * Neuf mégaoctets de vrai fichier, bon marché à auditer : deux lignes à IBAN,
   * le reste en lignes sans IBAN, chaque note sous les 32 767 caractères qu'une
   * cellule de classeur admet (le rapport recopie les colonnes source).
   */
  function nineMegabyteCsv(): Buffer {
    const note = 'x'.repeat(30_000);
    const lines = ['IBAN;Note', `${VALID_CH};${note}`, `${VALID_DE};${note}`];
    while (lines.join('\n').length < 9 * 1024 * 1024) lines.push(`;${note}`);
    const csv = Buffer.from(lines.join('\n'), 'utf8');
    expect(csv.length).toBeGreaterThan(9 * 1024 * 1024);
    expect(csv.length).toBeLessThan(AUDIT_MAX_BYTES);
    return csv;
  }

  // Une lecture de neuf mégaoctets et un rapport du même poids : quelques
  // secondes sur une machine occupée. Ce délai n'est qu'un filet.
  const NINE_MB_TIMEOUT_MS = 60_000;

  afterEach(() => vi.restoreAllMocks());

  it('refuses a chunked body past the cap with 413 file_too_large, before parseBody, without reading the rest', async () => {
    const parseBody = vi.spyOn(HonoRequest.prototype, 'parseBody');
    const { stream, meter } = meteredStream(
      multipart(Buffer.alloc(AUDIT_MAX_BYTES + 1024 * 1024, 0x41), 'gros.csv'),
    );
    const r = await streamUpload(stream);
    expect(r.status).toBe(413);
    const body = (await r.json()) as { error: string; message: string };
    expect(body.error).toBe('file_too_large');
    expect(body.message).toBe(`The file must be under ${AUDIT_MAX_BYTES / 1024 / 1024} MB.`);
    expect(parseBody).not.toHaveBeenCalled();
    // Lu jusqu'au plafond, plus au plus le morceau qui le franchit ; jamais le
    // mégaoctet qui suit.
    expect(meter.pulled).toBeGreaterThan(AUDIT_UPLOAD_BODY_MAX_BYTES);
    expect(meter.pulled).toBeLessThanOrEqual(AUDIT_UPLOAD_BODY_MAX_BYTES + CHUNK);
    expect(meter.pulled).toBeLessThan(meter.total);
  });

  it('refuses on a declared Content-Length above the cap without reading a byte', async () => {
    const parseBody = vi.spyOn(HonoRequest.prototype, 'parseBody');
    const { stream, meter } = meteredStream(multipart(Buffer.from('IBAN\n'), 'f.csv'));
    const r = await streamUpload(stream, {
      'content-length': String(AUDIT_UPLOAD_BODY_MAX_BYTES + 1),
    });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toBe('file_too_large');
    expect(parseBody).not.toHaveBeenCalled();
    expect(meter.pulled).toBe(0);
  });

  it('does not take a small Content-Length at its word', async () => {
    // Un en-tête qui annonce peu ne dispense pas du comptage. Le statut seul ne
    // prouverait rien : l'ancien code finissait aussi en 413, mais sur la taille
    // de la partie, après avoir tout lu.
    const parseBody = vi.spyOn(HonoRequest.prototype, 'parseBody');
    const { stream, meter } = meteredStream(
      multipart(Buffer.alloc(AUDIT_MAX_BYTES + 1024 * 1024, 0x41), 'gros.csv'),
    );
    const r = await streamUpload(stream, { 'content-length': '100' });
    expect(r.status).toBe(413);
    expect(((await r.json()) as { error: string }).error).toBe('file_too_large');
    expect(parseBody).not.toHaveBeenCalled();
    expect(meter.pulled).toBeLessThan(meter.total);
  });

  it('answers 400 invalid_multipart, not 500, when the stream fails mid-read', async () => {
    let pulls = 0;
    const failing = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulls += 1;
          if (pulls === 1) return controller.enqueue(new Uint8Array(CHUNK).fill(0x41));
          controller.error(new Error('client went away'));
        },
      },
      { highWaterMark: 0 },
    );
    const r = await streamUpload(failing);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('invalid_multipart');
  });

  it('reads no byte of the body of a caller refused with 429', async () => {
    const ip = '198.51.100.31';
    const headers = { 'x-forwarded-for': `10.9.9.9, ${ip}` };
    for (let i = 0; i < AUDIT_UPLOADS_PER_WINDOW; i++) {
      const form = new FormData();
      form.append('file', new File([['IBAN', VALID_CH].join('\n')], 'f.csv', { type: 'text/csv' }));
      expect(
        (await app().request('/v1/audit/upload', { method: 'POST', body: form, headers })).status,
      ).toBe(200);
    }
    const { stream, meter } = meteredStream(multipart(Buffer.from('IBAN\n'), 'f.csv'));
    const r = await streamUpload(stream, headers);
    expect(r.status).toBe(429);
    expect(meter.pulled).toBe(0);
  });

  it(
    'still accepts a 9 MB file, as a form and as a bare chunked stream',
    async () => {
      const csv = nineMegabyteCsv();
      const asForm = await upload(csv, 'neuf-mo.csv');
      expect(asForm.status).toBe(200);
      const formBody = (await asForm.json()) as UploadBody;
      expect(formBody.rows).toBeGreaterThan(2);

      const { stream, meter } = meteredStream(multipart(csv, 'neuf-mo.csv'));
      const asStream = await streamUpload(stream);
      expect(asStream.status).toBe(200);
      expect(meter.pulled).toBe(meter.total);
      expect(((await asStream.json()) as UploadBody).rows).toBe(formBody.rows);
    },
    NINE_MB_TIMEOUT_MS,
  );

  /**
   * Par l'application entière : la route est la seule sortie du plafond général
   * de 256 Ko (app.ts). Le banc ci-dessus monte le routeur seul et ne peut voir
   * ni cette exemption ni ce qui la précède.
   */
  describe('through buildApp()', () => {
    // Adresses TEST-NET-3, jamais routables, propres à ces deux cas.
    function appUpload(ip: string, body: ReadableStream<Uint8Array> | FormData) {
      const headers: Record<string, string> = { 'x-real-ip': ip };
      if (!(body instanceof FormData))
        headers['content-type'] = `multipart/form-data; boundary=${BOUNDARY}`;
      return buildApp().request('https://api.ibanforge.com/v1/audit/upload', {
        method: 'POST',
        body,
        headers,
        duplex: 'half',
      } as RequestInit);
    }

    it('answers 413 file_too_large to a chunked oversize body, not the general 256 KB refusal', async () => {
      const { stream, meter } = meteredStream(
        multipart(Buffer.alloc(AUDIT_MAX_BYTES + 1024 * 1024, 0x41), 'gros.csv'),
      );
      const r = await appUpload('203.0.113.71', stream);
      expect(r.status).toBe(413);
      expect(((await r.json()) as { error: string }).error).toBe('file_too_large');
      expect(meter.pulled).toBeLessThan(meter.total);
    });

    it(
      'lets a 9 MB file through to the audit',
      async () => {
        const form = new FormData();
        form.append(
          'file',
          new File([new Uint8Array(nineMegabyteCsv())], 'neuf-mo.csv', { type: 'text/csv' }),
        );
        const r = await appUpload('203.0.113.72', form);
        expect(r.status).toBe(200);
        expect(((await r.json()) as UploadBody).rows).toBeGreaterThan(2);
      },
      NINE_MB_TIMEOUT_MS,
    );
  });
});

/**
 * Adversarial review of 07/09/2026, A1: the upload route is keyless and the
 * general limiter allows a hundred requests a minute, each of which parses a
 * spreadsheet on the request thread. A budget of its own, per address.
 */
describe('POST /v1/audit/upload — per-address budget', () => {
  function uploadFrom(ip: string) {
    const form = new FormData();
    form.append('file', new File([['IBAN', VALID_CH].join('\n')], 'f.csv', { type: 'text/csv' }));
    form.append('lang', 'fr');
    return app().request('/v1/audit/upload', {
      method: 'POST',
      body: form,
      headers: { 'x-forwarded-for': `10.9.9.9, ${ip}` },
    });
  }

  it('answers 429 past the budget, and keeps other addresses unaffected', async () => {
    for (let i = 0; i < AUDIT_UPLOADS_PER_WINDOW; i++) {
      expect((await uploadFrom('198.51.100.7')).status).toBe(200);
    }
    const over = await uploadFrom('198.51.100.7');
    expect(over.status).toBe(429);
    expect(((await over.json()) as { error: string }).error).toBe('rate_limited');
    expect((await uploadFrom('198.51.100.8')).status).toBe(200);
  });

  it('keys on the platform-appended hop, not on the segment the client writes', async () => {
    for (let i = 0; i < AUDIT_UPLOADS_PER_WINDOW; i++) {
      expect((await uploadFrom('198.51.100.9')).status).toBe(200);
    }
    const form = new FormData();
    form.append('file', new File([['IBAN', VALID_CH].join('\n')], 'f.csv', { type: 'text/csv' }));
    const spoofed = await app().request('/v1/audit/upload', {
      method: 'POST',
      body: form,
      headers: { 'x-forwarded-for': '10.0.0.42, 198.51.100.9' },
    });
    expect(spoofed.status).toBe(429);
  });
});
