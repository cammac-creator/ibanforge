import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { chClearing } from './ch-clearing.js';
import { getRejectionStats } from '../lib/stats.js';

// Create a minimal test app with the clearing route
const app = new Hono();

// Pre-validation middleware (mirrors index.ts)
app.get('/v1/ch/clearing/:iid', async (c, next) => {
  const iid = c.req.param('iid');
  if (iid === '{iid}' || /^\{.*\}$/.test(iid)) {
    return c.json({ error: 'placeholder_literal', example: 'GET /v1/ch/clearing/230' }, 400);
  }
  if (!/^\d{1,5}$/.test(iid)) {
    return c.json({ error: 'invalid_iid_format', message: 'IID must be a 1-5 digit number.' }, 400);
  }
  await next();
});
app.route('/', chClearing);

describe('GET /v1/ch/clearing/:iid', () => {
  it('GET /v1/ch/clearing/230 → 200, found=true', async () => {
    const res = await app.request('/v1/ch/clearing/230');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.iid).toBe('00230');
    expect(body.institution.name).toBe('UBS Switzerland AG');
    expect(body.cost_usdc).toBe(0.003);
    expect(typeof body.processing_ms).toBe('number');
  });

  it('GET /v1/ch/clearing/00230 → 200, found=true, same result', async () => {
    const res = await app.request('/v1/ch/clearing/00230');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.iid).toBe('00230');
    expect(body.institution.name).toBe('UBS Switzerland AG');
  });

  it('GET /v1/ch/clearing/30000 (QR-IID) → PostFinance with correct semantics', async () => {
    const res = await app.request('/v1/ch/clearing/30000');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.institution.name).toBe('PostFinance AG');
    expect(body.institution.type).toBe('postfinance');
    // iid = the institution's STANDARD IID; qr_iid = the queried QR-IID.
    expect(body.iid).toBe('09000');
    expect(body.qr_iid).toBe('30000');
    expect(body.is_qr_iid).toBe(true);
    expect(body.note).toContain('QR-IID');
    expect(body.payment_services.lsv_bdd_chf).toBe(false);
  });

  it('GET /v1/ch/clearing/9000 (standard) is unchanged — no is_qr_iid field', async () => {
    const res = await app.request('/v1/ch/clearing/9000');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.iid).toBe('09000');
    expect(body.institution.name).toBe('PostFinance AG');
    expect(body.qr_iid).toBeNull();
    expect(body).not.toHaveProperty('is_qr_iid');
    expect(body).not.toHaveProperty('note');
  });

  it('GET /v1/ch/clearing/700 → Cantonal bank', async () => {
    const res = await app.request('/v1/ch/clearing/700');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.institution.type).toBe('cantonal_bank');
  });

  it('GET /v1/ch/clearing/99999 → 200, found=false', async () => {
    const res = await app.request('/v1/ch/clearing/99999');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(false);
    expect(body.error).toBe('clearing_not_found');
    expect(body.cost_usdc).toBe(0.003);
  });

  it('GET /v1/ch/clearing/abc → 400, invalid_iid_format', async () => {
    const res = await app.request('/v1/ch/clearing/abc');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_iid_format');
  });

  it('GET /v1/ch/clearing/123456 → 400, invalid_iid_format (too long)', async () => {
    const res = await app.request('/v1/ch/clearing/123456');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_iid_format');
  });

  it('GET /v1/ch/clearing/{iid} (literal OpenAPI placeholder) → 400, placeholder_literal', async () => {
    const res = await app.request('/v1/ch/clearing/%7Biid%7D');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('placeholder_literal');
    expect(body.example).toContain('/v1/ch/clearing/');
  });

  it('GET /v1/ch/clearing/04835 → follows the CS→UBS concatenation', async () => {
    const res = await app.request('/v1/ch/clearing/04835');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(true);
    expect(body.redirected_from).toBe('04835');
    expect(body.note).toContain('merged');
  });

  it('response includes payment_services structure', async () => {
    const res = await app.request('/v1/ch/clearing/00230');
    const body = await res.json();
    expect(body.payment_services).toBeDefined();
    expect(typeof body.payment_services.sic).toBe('boolean');
    expect(typeof body.payment_services.rtgs_chf).toBe('boolean');
    expect(typeof body.payment_services.instant_payments_chf).toBe('boolean');
    expect(typeof body.payment_services.eurosic).toBe('boolean');
    expect(typeof body.payment_services.lsv_bdd_chf).toBe('boolean');
    expect(typeof body.payment_services.lsv_bdd_eur).toBe('boolean');
  });

  it('response includes address structure', async () => {
    const res = await app.request('/v1/ch/clearing/00230');
    const body = await res.json();
    expect(body.address).toBeDefined();
    expect(body.address.country).toBe('CH');
    expect(typeof body.address.town).toBe('string');
  });
});

// L'app ci-dessus recopie la pré-validation d'index.ts : elle répond 400 AVANT
// que la route ne s'exécute, donc elle ne peut pas voir l'instrumentation de la
// route. Celle-ci monte `chClearing` nu, gardes de la route comprises.
const bareApp = new Hono();
bareApp.route('/', chClearing);

function rejections(reason: string): number {
  return (
    getRejectionStats(1).find(
      (r) => r.operation_type === 'ch_clearing_lookup' && r.reject_reason === reason,
    )?.count ?? 0
  );
}

describe('GET /v1/ch/clearing/:iid — instrumentation des rejets (phase 1)', () => {
  it('renvoie toujours 400 sur un IID préfixé CH (phase 1 ne change rien)', async () => {
    const res = await bareApp.request('/v1/ch/clearing/CH-230');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_iid_format');
    expect(body.message).toBe('IID must be a 1-5 digit number.');
  });

  it('enregistre exactement un rejet `normalizable` pour cet IID préfixé', async () => {
    const before = rejections('normalizable');
    await bareApp.request('/v1/ch/clearing/CH-230');
    expect(rejections('normalizable')).toBe(before + 1);
  });

  it('enregistre `not_numeric` pour du texte', async () => {
    const before = rejections('not_numeric');
    const res = await bareApp.request('/v1/ch/clearing/abc');
    expect(res.status).toBe(400);
    expect(rejections('not_numeric')).toBe(before + 1);
  });

  it('enregistre `too_long` pour 6 chiffres', async () => {
    const before = rejections('too_long');
    const res = await bareApp.request('/v1/ch/clearing/123456');
    expect(res.status).toBe(400);
    expect(rejections('too_long')).toBe(before + 1);
  });

  it('enregistre le placeholder littéral, corps de réponse inchangé', async () => {
    const before = rejections('placeholder_literal');
    const res = await bareApp.request('/v1/ch/clearing/%7Biid%7D');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; example: string };
    expect(body.error).toBe('placeholder_literal');
    expect(body.example).toBe('GET /v1/ch/clearing/230');
    expect(rejections('placeholder_literal')).toBe(before + 1);
  });

  it("n'enregistre aucun rejet pour un IID accepté, même introuvable", async () => {
    const before = getRejectionStats(1).reduce((n, r) => n + r.count, 0);
    const res = await bareApp.request('/v1/ch/clearing/99999');
    // 200 + found:false : ce n'est pas un rejet de format, il n'a rien à compter.
    expect(res.status).toBe(200);
    expect(getRejectionStats(1).reduce((n, r) => n + r.count, 0)).toBe(before);
  });
});
