import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COMBINED_ADDRESS_CLAUSE,
  COMBINED_ADDRESS_FORBIDDEN_FROM,
  COMBINED_ADDRESS_NOTICE,
  COMBINED_ADDRESS_PAYMENT_GUARANTEED_UNTIL,
  COMBINED_ADDRESS_SOURCE,
  READY_FIELD_DESCRIPTION,
  UNSTRUCTURED_PAYMENT_ORDERS_REFUSED_FROM,
} from './qr-bill-notice.js';
import { MCP_TOOLS } from '../mcp/inventory.js';

/**
 * The type K notice is said once, in src/lib/qr-bill-notice.ts. The site and
 * the npm package cannot import it, so this test holds their copies to it.
 *
 * Until 02/10/2026 every surface below told callers to "convert before
 * 14.11.2026", the day "banks stop processing" type K QR-bills. No source says
 * so: the banks guarantee payment of a type K QR-bill only until the end of
 * September 2026, and 14.11.2026 is the SIX date for payment ORDERS. The
 * articles on payment orders (blog, structured-addresses) use that date
 * correctly and are not scanned here.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

type Lang = keyof typeof COMBINED_ADDRESS_NOTICE;
const LANGS: Lang[] = ['fr', 'de', 'en'];

/** "2026-09-30" -> "30.09.2026", the form the notice prints. */
const dotted = (iso: string): string => iso.split('-').reverse().join('.');

/** Every surface that speaks about the QR-bill check. */
const QR_SURFACES = [
  'src/lib/swiss-qr-bill.ts',
  'src/routes/ch-qr-bill.ts',
  'src/app.ts',
  'src/mcp/server.ts',
  'src/routes/mcp-http.ts',
  'src/mcp/inventory.ts',
  'src/routes/openapi.ts',
  'src/mcp/output-schemas.ts',
  'src/routes/discovery.ts',
  'mcp/src/index.ts',
  'frontend/messages/fr.json',
  'frontend/messages/de.json',
  'frontend/messages/en.json',
  ...LANGS.flatMap((l) => [
    `frontend/content/${l}/docs/swiss-qr-iban.mdx`,
    `frontend/content/${l}/docs/index.mdx`,
    `frontend/content/${l}/docs/mcp.mdx`,
  ]),
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'README.md',
  'integrations/postman/ibanforge.postman_collection.json',
];

/** The old claim, in each wording it was published in. */
const OLD_CLAIM = [
  /stop processing/i,
  /banks require from 14\.11\.2026/,
  /no longer process(?:es)? standing orders/i,
  /cessent de traiter/,
  /ne traitent plus les ordres permanents/,
  /verarbeiten die Banken darauf beruhende/,
  /verarbeiten darauf beruhende Zahlungen/,
  /(?:ahead of|before) (?:the SIX deadline of )?14\.11\.2026/,
  /avant le 14\.11\.2026/,
  /vor dem 14\.11\.2026/,
  /ready for (?:14|mid-November)/i,
  /prête pour la mi-novembre/,
  /bereit für Mitte November/i,
];

describe('the type K notice, said once', () => {
  it('prints the dates its constants hold', () => {
    for (const lang of LANGS) {
      const text = COMBINED_ADDRESS_NOTICE[lang];
      expect(text, lang).toContain(dotted(COMBINED_ADDRESS_FORBIDDEN_FROM));
      expect(text, lang).toContain(dotted(COMBINED_ADDRESS_PAYMENT_GUARANTEED_UNTIL));
      expect(text, lang).toContain(dotted(UNSTRUCTURED_PAYMENT_ORDERS_REFUSED_FROM));
    }
    expect(COMBINED_ADDRESS_CLAUSE).toContain(dotted(COMBINED_ADDRESS_FORBIDDEN_FROM));
    expect(READY_FIELD_DESCRIPTION).toContain(COMBINED_ADDRESS_CLAUSE);
  });

  it('ties 14.11.2026 to payment orders, never to the payment of a QR-bill', () => {
    expect(COMBINED_ADDRESS_NOTICE.fr).toContain(
      'Dès le 14.11.2026, tout ordre de paiement à adresse non structurée est refusé.',
    );
    expect(COMBINED_ADDRESS_NOTICE.en).toContain(
      'From 14.11.2026, any payment order with an unstructured address is refused.',
    );
    expect(COMBINED_ADDRESS_CLAUSE).not.toContain('14.11.2026');
  });

  it('cites the documents each date comes from', () => {
    for (const needle of [
      'Implementation Guidelines QR-bill, version 2.3',
      'ubs.com',
      '30 September 2026',
      'zkb.ch',
      'längstens bis Ende September 2026',
      'factsheet-address-messageversion-erp-en.pdf',
      '14 November 2026',
    ])
      expect(COMBINED_ADDRESS_SOURCE).toContain(needle);
  });
});

describe('every surface carries it verbatim', () => {
  it.each(LANGS)('the QR-bill tool page (%s) shows the notice', (lang) => {
    const messages = JSON.parse(read(`frontend/messages/${lang}.json`)) as {
      qrBill: { deadline: string };
    };
    expect(messages.qrBill.deadline).toBe(COMBINED_ADDRESS_NOTICE[lang]);
  });

  it.each(LANGS)('the docs (%s) quote the notice in the QR-bill guide and the MCP page', (lang) => {
    expect(read(`frontend/content/${lang}/docs/swiss-qr-iban.mdx`)).toContain(
      COMBINED_ADDRESS_NOTICE[lang],
    );
    expect(read(`frontend/content/${lang}/docs/mcp.mdx`)).toContain(COMBINED_ADDRESS_NOTICE[lang]);
  });

  it('the Postman collection quotes the English notice', () => {
    expect(
      JSON.stringify(JSON.parse(read('integrations/postman/ibanforge.postman_collection.json'))),
    ).toContain(COMBINED_ADDRESS_NOTICE.en);
  });

  it('the npm package, which cannot import it, carries the clause word for word', () => {
    const pkg = read('mcp/src/index.ts');
    expect(pkg).toContain(COMBINED_ADDRESS_CLAUSE);
    expect(pkg).toContain(READY_FIELD_DESCRIPTION);
  });

  it('the MCP catalogue reads the clause', () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'check_swiss_qr_bill');
    expect(tool?.description).toContain(COMBINED_ADDRESS_CLAUSE);
  });
});

describe('the old claim is gone', () => {
  it.each(QR_SURFACES)('%s', (path) => {
    const text = read(path);
    for (const re of OLD_CLAIM) expect(text, `${path} still says ${re}`).not.toMatch(re);
  });
});
