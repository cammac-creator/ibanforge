/**
 * Le fichier des localités manque sur le serveur (`directory_unavailable`) :
 * la QR-facture garde `valid` et l'audit garde le statut de la ligne, au
 * niveau des ROUTES (relecture de la PR 470, 29.10.2026).
 *
 * `src/lib/ch-localities.test.ts` tient déjà le contrôle seul sans le fichier ;
 * ici on passe par `POST /v1/ch/qr-bill/check` et `POST /v1/audit/upload`, ce
 * que reçoit un client. Chaque test essaie d'abord le même couple AVEC le
 * répertoire (8001 Bern, qui y est contredit) : sans cette moitié, un
 * avertissement jamais émis passerait aussi pour « aucun avertissement sans le
 * fichier ».
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { chQrBill } from './ch-qr-bill.js';
import { audit, resetAuditUploadLimiter } from './audit.js';
import { closeAll } from '../lib/db.js';
import { resetChLocalities } from '../lib/ch-localities.js';
import type { SwissQrBillCheck } from '../lib/swiss-qr-bill.js';

function app() {
  const a = new Hono();
  a.route('/', chQrBill);
  a.route('/', audit);
  return a;
}

/** Le fichier des localités rendu introuvable, comme sur une image sans la copie du Dockerfile. */
function withoutDirectory(): void {
  process.env.CH_LOCALITIES_PATH = '/nonexistent/ch-localities.json';
  resetChLocalities();
}

beforeEach(() => resetAuditUploadLimiter());
afterEach(() => {
  delete process.env.CH_LOCALITIES_PATH;
  resetChLocalities();
});
afterAll(() => closeAll());

/** La QR-facture d'exemple de SIX, créancier « Société Alpha, 8001 Bern » (8001 est Zürich). */
const PAYLOAD = [
  'SPC',
  '0200',
  '1',
  'CH4431999123000889012',
  'S',
  'Société Alpha',
  'Rue du Lac',
  '12',
  '8001',
  'Bern',
  'CH',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '1949.75',
  'CHF',
  'S',
  'Pia Rutschmann',
  'Marktgasse',
  '28',
  '9400',
  'Rorschach',
  'CH',
  'QRR',
  '210000000003139471430009017',
  'Order 15.06.2026',
  'EPD',
].join('\n');

async function checkQr(): Promise<SwissQrBillCheck> {
  const r = await app().request('/v1/ch/qr-bill/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ payload: PAYLOAD }),
  });
  expect(r.status).toBe(200);
  return (await r.json()) as SwissQrBillCheck;
}

const postcodeCodes = (b: SwissQrBillCheck) =>
  b.findings.map((f) => f.code).filter((c) => c.startsWith('postcode_'));

describe('POST /v1/ch/qr-bill/check without the directory of localities', () => {
  it('with the directory: 8001 Bern is a warning, and valid stays true', async () => {
    const body = await checkQr();
    expect(body.creditor.sps_check?.postcode_locality?.status).toBe('town_mismatch');
    expect(postcodeCodes(body)).toEqual(['postcode_town_mismatch']);
    expect(body.valid).toBe(true);
    expect(body.ready_for_2026_11_14).toBe(true);
  });

  it('without it: directory_unavailable, no warning, and valid and ready unchanged', async () => {
    withoutDirectory();
    const body = await checkQr();
    expect(body.creditor.sps_check?.postcode_locality?.status).toBe('directory_unavailable');
    expect(body.creditor.sps_check?.postcode_locality?.as_of).toBeNull();
    expect(body.creditor.sps_check?.postcode_locality?.source).toContain('©swisstopo');
    expect(body.ultimate_debtor.sps_check?.postcode_locality?.status).toBe('directory_unavailable');
    expect(postcodeCodes(body)).toEqual([]);
    expect(body.findings).toEqual([]);
    expect(body.valid).toBe(true);
    expect(body.ready_for_2026_11_14).toBe(true);
  });
});

interface UploadBody {
  rows: number;
  summary: { ok: number; warning: number; error: number };
  preview: Array<{ line: number; status: string; findings: string[] }>;
}

async function uploadOneRow(): Promise<UploadBody> {
  const csv = [
    'Nom;IBAN;Rue;NPA;Ville;Pays',
    'Société Alpha;CH1000230000000012345;Bahnhofstrasse 1;8001;Bern;CH',
  ].join('\n');
  const form = new FormData();
  form.append('file', new File([csv], 'creanciers.csv', { type: 'text/csv' }));
  form.append('lang', 'fr');
  const r = await app().request('/v1/audit/upload', { method: 'POST', body: form });
  expect(r.status).toBe(200);
  return (await r.json()) as UploadBody;
}

describe('POST /v1/audit/upload without the directory of localities', () => {
  it('with the directory: the row is "to check", with postcode_locality_mismatch', async () => {
    const body = await uploadOneRow();
    expect(body.rows).toBe(1);
    expect(body.preview[0]!.status).toBe('warning');
    expect(body.preview[0]!.findings).toEqual(['postcode_locality_mismatch']);
    expect(body.summary.warning).toBe(1);
  });

  it('without it: the row keeps its status, ok, and no finding is added', async () => {
    withoutDirectory();
    const body = await uploadOneRow();
    expect(body.rows).toBe(1);
    expect(body.preview[0]!.status).toBe('ok');
    expect(body.preview[0]!.findings).toEqual([]);
    expect(body.summary.warning).toBe(0);
    expect(body.summary.error).toBe(0);
  });
});
