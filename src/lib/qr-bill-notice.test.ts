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
  SPS_2026_ADDRESS_RULES_FROM,
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
 *
 * Jusqu'au 28.10.2026, la notice, la page d'audit et le billet sur le fichier
 * de créanciers annonçaient pour le 14.11.2026 un refus général des ordres à
 * adresse non structurée. La page SIX lue ce jour-là garde la règle, pas ce
 * refus (SIC ne valide pas les adresses, chaque banque décide) : sources dans
 * qr-bill-notice.ts. REFUSAL_CLAIM empêche la phrase de revenir.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

type Lang = keyof typeof COMBINED_ADDRESS_NOTICE;
const LANGS: Lang[] = ['fr', 'de', 'en'];

/** "2026-09-30" -> "30.09.2026", the form the notice prints. */
const dotted = (iso: string): string => iso.split('-').reverse().join('.');

/**
 * Le refus général du 14.11.2026, dans chaque formulation publiée : la notice,
 * la page d'audit, le billet sur le fichier de créanciers et le contrôle
 * d'adresse.
 */
const REFUSAL_CLAIM = [
  /tout ordre de paiement[^.]{0,30} non structurée est refusé/,
  /jeder Zahlungsauftrag mit unstrukturierter Adresse abgewiesen/,
  /Zahlungsaufträge mit unstrukturierter Adresse werden abgewiesen/,
  /any payment order with an unstructured address is refused/i,
  /payment orders with an unstructured address are refused/i,
  /SIX (?:stops processing|cesse de traiter)/,
  /verarbeitet SIX keine Zahlungen mehr/,
  /hybrid form is no longer processed/,
  /forme hybride n'est plus traité/,
  /hybriden Form folgt, wird nicht mehr verarbeitet/,
  /last SIC release accepting unstructured/i,
];

/** Là où il a paru, et là où il pourrait revenir. */
const REFUSAL_SURFACES = [
  ...LANGS.map(
    (l) => `frontend/content/${l}/blog/2026-09-06-creditor-file-checks-before-14-november.mdx`,
  ),
  'src/lib/address-conformity.ts',
  'src/lib/postal-address.ts',
];

/** Every surface that speaks about the QR-bill check. */
const QR_SURFACES = [
  'src/lib/swiss-qr-bill.ts',
  'src/routes/ch-qr-bill.ts',
  'src/app.ts',
  'src/mcp/server.ts',
  'src/routes/mcp-http.ts',
  'src/mcp/directory.ts',
  'src/mcp/directory-responses.ts',
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
      expect(text, lang).toContain(dotted(SPS_2026_ADDRESS_RULES_FROM));
    }
    expect(COMBINED_ADDRESS_CLAUSE).toContain(dotted(COMBINED_ADDRESS_FORBIDDEN_FROM));
    expect(READY_FIELD_DESCRIPTION).toContain(COMBINED_ADDRESS_CLAUSE);
  });

  it('ties 14.11.2026 to payment orders, never to the payment of a QR-bill', () => {
    expect(COMBINED_ADDRESS_NOTICE.fr).toContain(
      'Dès le 14.11.2026, les Swiss Payment Standards exigent dans un ordre de paiement une adresse structurée ou hybride',
    );
    expect(COMBINED_ADDRESS_NOTICE.de).toContain(
      'Ab dem 14.11.2026 verlangen die Swiss Payment Standards in einem Zahlungsauftrag',
    );
    expect(COMBINED_ADDRESS_NOTICE.en).toContain(
      'From 14.11.2026, the Swiss Payment Standards require a structured or hybrid address in a payment order',
    );
    expect(COMBINED_ADDRESS_CLAUSE).not.toContain('14.11.2026');
  });

  it('dit qui applique la règle suisse et ce qui peut être rejeté, sans refus général', () => {
    expect(COMBINED_ADDRESS_NOTICE.fr).toContain(
      'Le système SIC ne valide pas les adresses : chaque banque décide.',
    );
    expect(COMBINED_ADDRESS_NOTICE.fr).toContain(
      'un paiement SEPA ou international sans localité peut être rejeté',
    );
    expect(COMBINED_ADDRESS_NOTICE.de).toContain(
      'Das SIC-System prüft die Adressen nicht: Jede Bank entscheidet selbst.',
    );
    expect(COMBINED_ADDRESS_NOTICE.de).toContain(
      'eine SEPA- oder Auslandzahlung ohne Ort kann abgewiesen werden',
    );
    expect(COMBINED_ADDRESS_NOTICE.en).toContain(
      'The SIC system does not validate addresses: each bank decides.',
    );
    expect(COMBINED_ADDRESS_NOTICE.en).toContain(
      'a SEPA or international payment without a town may be rejected',
    );
    for (const lang of LANGS)
      for (const re of REFUSAL_CLAIM) expect(COMBINED_ADDRESS_NOTICE[lang], lang).not.toMatch(re);
  });

  it('cites the documents each date comes from', () => {
    for (const needle of [
      'Implementation Guidelines QR-bill, version 2.3',
      'ubs.com',
      '30 September 2026',
      'zkb.ch',
      'längstens bis Ende September 2026',
      'six-group.com/en/products-services/banking-services/payment-standardization/swiss-payments.html',
      'validation of the addresses will be waived',
      'zkb.ch/de/lps/unternehmen/zahlen/neuer-zahlungsverkehr.html',
      'werden vorläufig weiterhin akzeptiert',
      'postfinance.ch/de/unternehmen/kampagnen/iso-updates.html',
      'vorerst nicht strikt abgewiesen',
      'read 28.10.2026',
      '14 November 2026',
    ])
      expect(COMBINED_ADDRESS_SOURCE).toContain(needle);
    // La fiche SIX du 19.08.2025 qui annonçait le refus général n'est plus la
    // source citée par le constat.
    expect(COMBINED_ADDRESS_SOURCE).not.toContain('factsheet-address-messageversion-erp-en.pdf');
    expect(COMBINED_ADDRESS_SOURCE).not.toContain('can no longer be processed');
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

describe('le refus général du 14.11.2026 a disparu', () => {
  it.each([...QR_SURFACES, ...REFUSAL_SURFACES])('%s', (path) => {
    const text = read(path);
    for (const re of REFUSAL_CLAIM) expect(text, `${path} still says ${re}`).not.toMatch(re);
  });

  it.each(LANGS)('la page d’audit (%s) dit la règle, qui l’applique, et sa date', (lang) => {
    const messages = JSON.parse(read(`frontend/messages/${lang}.json`)) as {
      audit: { deadline: { title: string; text: string } };
    };
    const { title, text } = messages.audit.deadline;
    expect(title, lang).toContain(dotted(SPS_2026_ADDRESS_RULES_FROM));
    expect(text, lang).toContain(dotted(SPS_2026_ADDRESS_RULES_FROM));
    expect(text, lang).toContain('Swiss Payment Standards');
    expect(text, lang).toContain('SIC');
    expect(text, lang).toMatch(/SEPA/);
  });
});
