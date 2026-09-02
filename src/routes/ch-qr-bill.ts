/**
 * POST /v1/ch/qr-bill/check — free check of a Swiss QR-bill payload.
 *
 * Paste the text a QR-bill's code carries (the "Swiss Payments Code",
 * starting with SPC) and get every rule verdict at once: header, creditor
 * IBAN and QR-IBAN range, QRR / SCOR / NON reference checksums and their
 * pairing with the IBAN, amount and currency, and above all whether the
 * addresses are STRUCTURED (type S) or still COMBINED (type K), which the
 * standard removed on 21.11.2025 and which banks stop processing on
 * 14.11.2026. A combined address comes back with a proposed structured form.
 *
 * Free: pure rule evaluation over a published standard, no database, no
 * key, no quota. The paid surface stays the bank behind the IBAN.
 */
import { Hono } from 'hono';
import { z } from 'zod';
import type { HonoEnv } from '../types.js';
import { checkSwissQrBill, QR_BILL_SOURCE } from '../lib/swiss-qr-bill.js';
import { recordOperation } from '../lib/stats.js';
import { recordSafely } from '../lib/record-safely.js';

const MAX_PAYLOAD = 4_000;

const USAGE = {
  example: {
    payload:
      'SPC\\n0200\\n1\\nCH4431999123000889012\\nS\\nRobert Schneider AG\\nRue du Lac\\n1268\\n2501\\nBiel\\nCH\\n\\n\\n\\n\\n\\n\\n\\n1949.75\\nCHF\\nS\\nPia Rutschmann\\nMarktgasse\\n28\\n9400\\nRorschach\\nCH\\nQRR\\n210000000003139471430009017\\nOrder 15.06.2026\\nEPD',
  },
  note: 'Pass the Swiss QR Code text as {"payload": "..."} with real line breaks (\\n). Lines are positional: 31 lines up to the trailer EPD, then optional billing information and up to two alternative schemes.',
  source: QR_BILL_SOURCE,
} as const;

const bodySchema = z.object({
  payload: z.string().min(1).max(MAX_PAYLOAD),
});

const chQrBill = new Hono<HonoEnv>();

chQrBill.post('/v1/ch/qr-bill/check', async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return c.json(
      { error: 'invalid_json', message: 'Request body must be valid JSON', ...USAGE },
      400,
    );
  }
  const body = raw as Record<string, unknown> | null;
  const candidate = body?.payload ?? body?.text ?? body?.qr ?? body?.code;
  const parsed = bodySchema.safeParse({
    payload: typeof candidate === 'string' ? candidate : undefined,
  });
  if (!parsed.success) {
    return c.json(
      {
        error: 'invalid_payload',
        message: `Send the QR-bill text as "payload" (1 to ${MAX_PAYLOAD} characters).`,
        ...USAGE,
      },
      400,
    );
  }
  const result = checkSwissQrBill(parsed.data.payload);
  recordSafely(
    () =>
      recordOperation(
        'qr_bill_check',
        'CH',
        result.valid,
        0,
        result.findings.length
          ? result.findings
              .map((f) => f.code)
              .slice(0, 5)
              .join(',')
          : undefined,
        c.get('apiKeyPrefix'),
      ),
    'qr_bill_check',
  );
  return c.json(result);
});

export { chQrBill };
