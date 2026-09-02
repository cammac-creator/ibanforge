import { describe, it, expect, afterAll } from 'vitest';
import { Hono } from 'hono';
import { chQrBill } from './ch-qr-bill.js';
import { closeAll } from '../lib/db.js';
import type { SwissQrBillCheck } from '../lib/swiss-qr-bill.js';

type ErrorBody = { error: string; example: { payload: string } };

const GOOD = [
  'SPC',
  '0200',
  '1',
  'CH4431999123000889012',
  'S',
  'Robert Schneider AG',
  'Rue du Lac',
  '1268',
  '2501',
  'Biel',
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

function app() {
  const a = new Hono();
  a.route('/', chQrBill);
  return a;
}

afterAll(() => closeAll());

describe('POST /v1/ch/qr-bill/check', () => {
  it('answers the full verdict for a conformant payload', async () => {
    const r = await app().request('/v1/ch/qr-bill/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ payload: GOOD }),
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as SwissQrBillCheck;
    expect(body.valid).toBe(true);
    expect(body.ready_for_2026_11_14).toBe(true);
    expect(body.creditor_iban.qr_iban).toBe(true);
    expect(body.source).toContain('SIX');
  });

  it('accepts "text" as an alias and reports a combined address', async () => {
    const combined = GOOD.replace(
      'S\nRobert Schneider AG\nRue du Lac\n1268\n2501\nBiel\nCH',
      'K\nRobert Schneider AG\nRue du Lac 1268\n2501 Biel\n\n\nCH',
    );
    const r = await app().request('/v1/ch/qr-bill/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: combined }),
    });
    const body = (await r.json()) as SwissQrBillCheck;
    expect(r.status).toBe(200);
    expect(body.valid).toBe(false);
    expect(body.creditor.proposed_structured?.pst_cd).toBe('2501');
  });

  it('explains itself on a bad body', async () => {
    const none = await app().request('/v1/ch/qr-bill/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(none.status).toBe(400);
    const body = (await none.json()) as ErrorBody;
    expect(body.error).toBe('invalid_payload');
    expect(body.example.payload).toContain('SPC');
    const bad = await app().request('/v1/ch/qr-bill/check', { method: 'POST', body: 'not json' });
    expect(bad.status).toBe(400);
  });
});
