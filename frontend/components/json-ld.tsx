/**
 * JSON-LD structured data for IBANforge.
 *
 * Three schemas help AI agents and search engines understand the product:
 * - SoftwareApplication: full product description with offers + featureList
 * - Organization: name, logo, social links
 *
 * FAQPage and WebAPI were removed 2026-08: Google dropped the FAQ rich result
 * on 2026-05-07, and no consumer of the WebAPI type was ever identified — the
 * OpenAPI pointer lives in /.well-known/api-catalog instead.
 *
 * `priceCurrency` is 'USD' and not 'USDC' since the same audit: the field takes
 * an ISO 4217 code, 'USDC' is not one, and Search Console reports it as an
 * invalid value on every offer. Settlement really happens in USDC on Base, and
 * the stablecoin is pegged to the dollar the prices are quoted in, so 'USD' is
 * the truthful currency of the price. The payment asset is stated where it can
 * be stated properly: the x402 402 responses and the pricing page.
 *
 * BreadcrumbList was removed 2026-09-01 (audit WEB-15). This component is
 * embedded in the LOCALE LAYOUT, so its single hard-coded trail
 * "Home > Docs > OpenAPI" was emitted on all 170 pages, describing a position
 * in the hierarchy that is true of none of them and contradicting, on every
 * doc page, the accurate BreadcrumbList that `docs/[slug]/page.tsx` builds from
 * its own frontmatter. A breadcrumb is a per-page statement; the only place it
 * can be true is the page.
 *
 * Embedded in app/[locale]/layout.tsx <head>. Inline JSON.stringify is safe
 * here because we control the source — none of these strings contain user
 * input or "</script>" sequences.
 *
 * 24/09/2026: the description is the one line the API serves from
 * src/lib/positioning.ts (src/lib/positioning.test.ts holds this copy to it),
 * and the free-key figures come from the catalogue the API exports, not from
 * a literal: "200 free requests/month" stayed here after the key that needs no
 * e-mail started at a smaller allowance.
 */

import catalogue from "@/data/onboarding.json";

const FREE_KEY = `a free API key with no e-mail (${catalogue.claimedMonthly} requests a month once claimed, ${catalogue.anonymousMonthly} a month before that)`;

const SOFTWARE_APPLICATION = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  '@id': 'https://ibanforge.com/#software',
  name: 'IBANforge',
  provider: { '@id': 'https://ibanforge.com/#organization' },
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'API',
  operatingSystem: 'Web, REST API, MCP',
  url: 'https://ibanforge.com',
  description:
    'Check the bank behind an IBAN before you pay: validation in 89 countries, a bank-code verdict from the national register (DE, AT, BE, SK, BG, CH, LI), the bank and BIC with their source, SEPA and VoP readiness from the EPC registers where they list the bank, and bank-level sanctions (OFAC, EU, UN).' +
    ` It does not check the payee's name. Prepaid packs by card, a Pro subscription, or pay-per-call in USDC via x402; ${FREE_KEY}. Native MCP server for Claude Desktop, Cursor, and Cline.`,
  offers: [
    {
      '@type': 'Offer',
      name: 'Validate IBAN',
      description: 'Validate single IBAN with the bank-code verdict, BIC lookup with its source, issuer classification, SEPA and VoP readiness',
      price: '0.005',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Batch validate IBANs',
      description: 'Validate up to 100 IBANs in one call',
      price: '0.002',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'IBAN' },
    },
    {
      '@type': 'Offer',
      name: 'Lookup BIC',
      description: 'Lookup BIC/SWIFT against 121k+ BIC entries: GLEIF (39k+ rows, with LEI), a public copy of the SWIFT directory frozen in January 2018 (about two thirds of the rows), and rows from the Bundesbank, SIX, NBP and EBA STEP2',
      price: '0.003',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Swiss clearing lookup',
      description: 'Swiss BC-Nummer / IID lookup (1,100+ SIX BankMaster entries)',
      price: '0.003',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Compliance check',
      description:
        "Bank-level compliance triage: sanctions lists (OFAC, EU, UN) on the payee's bank (BIC8), the country against a fixed sanctions list, FATF, SEPA Instant, VoP readiness, risk score (0-100)",
      price: '0.02',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Free API key',
      description: `No e-mail required: ${catalogue.claimedMonthly} requests a month once the key is claimed, ${catalogue.anonymousMonthly} a month before that`,
      price: '0',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: catalogue.anonymousMonthly, unitText: 'requests/month' },
    },
  ],
  featureList: [
    'IBAN validation (ISO 13616 mod-97 + BBAN)',
    'Bank-code verdict against the national register (DE, AT, BE, SK, BG, CH, LI)',
    'BIC/SWIFT lookup against 121k+ BIC entries; validation answers name the source of every BIC',
    'Swiss BC-Nummer / IID lookup (1,100+ SIX BankMaster)',
    'EMI / vIBAN / neobank issuer classification',
    'SEPA Instant reachability flag',
    "VoP readiness of the payee's bank (Regulation (EU) 2024/886)",
    'Bank-level risk scoring (OFAC, EU, UN, FATF)',
    'x402 micropayments (USDC on Base L2)',
    'Native MCP server (Claude Desktop, Cursor, Cline)',
    FREE_KEY.charAt(0).toUpperCase() + FREE_KEY.slice(1),
    'Official npm SDK @ibanforge/sdk',
  ],
};

const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': 'https://ibanforge.com/#organization',
  name: 'IBANforge',
  url: 'https://ibanforge.com',
  // /icon.png is the one served (app/icon.png); /icon-512.png answered 500 (2026-09-05)
  logo: 'https://ibanforge.com/icon.png',
  email: 'support@ibanforge.com',
  sameAs: [
    'https://github.com/cammac-creator/ibanforge',
    'https://www.npmjs.com/package/ibanforge-mcp',
    'https://www.npmjs.com/package/@ibanforge/sdk',
    // The registry lists the server under io.github.cammac-creator/ibanforge;
    // the com.ibanforge/mcp path this used to name answers 404.
    'https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge',
  ],
};

// No HowTo since 2026-09-05: Google dropped that rich result in 2023, the
// block was 1 KB of dead weight on every page.
const SCHEMAS = [SOFTWARE_APPLICATION, ORGANIZATION];

export function JsonLd() {
  return (
    <>
      {SCHEMAS.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
