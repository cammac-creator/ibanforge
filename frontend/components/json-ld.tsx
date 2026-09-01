/**
 * JSON-LD structured data for IBANforge.
 *
 * Three schemas help AI agents and search engines understand the product:
 * - SoftwareApplication: full product description with offers + featureList
 * - Organization: name, logo, social links
 * - HowTo: 3-step integration guide (key/x402 → validate → MCP)
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
 */

const SOFTWARE_APPLICATION = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'IBANforge',
  applicationCategory: 'DeveloperApplication',
  applicationSubCategory: 'API',
  operatingSystem: 'Web, REST API, MCP',
  url: 'https://ibanforge.com',
  description:
    'IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer (1,100+ SIX entries), EMI/vIBAN classification, SEPA + VoP reachability and compliance risk scoring. Pay-per-call in USDC via x402, or 200 free requests/month with an API key. Native MCP server for Claude Desktop, Cursor, and Cline.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Validate IBAN',
      description: 'Validate single IBAN with BIC lookup, issuer classification, SEPA + VoP flags',
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
      description: 'Lookup BIC/SWIFT against 121k+ BIC entries from public sources (GLEIF, SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), with LEI enrichment for 39k+ rows sourced from GLEIF',
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
        'Full compliance triage: sanctions (OFAC), FATF, SEPA Instant, VoP, risk score (0-100)',
      price: '0.02',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Free tier',
      description: '200 requests/month free with an API key',
      price: '0',
      priceCurrency: 'USD',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 200, unitText: 'requests/month' },
    },
  ],
  featureList: [
    'IBAN validation (ISO 13616 mod-97 + BBAN)',
    'BIC/SWIFT lookup against 121k+ BIC entries (39k+ LEI-enriched via GLEIF)',
    'Swiss BC-Nummer / IID lookup (1,100+ SIX BankMaster)',
    'EMI / vIBAN / neobank issuer classification',
    'SEPA Instant reachability flag',
    'VoP (PSR 2024/886) participant check',
    'Compliance risk scoring (OFAC)',
    'x402 micropayments (USDC on Base L2)',
    'Native MCP server (Claude Desktop, Cursor, Cline)',
    '200 free requests/month with API key',
    'Official npm SDK @ibanforge/sdk',
  ],
};

const ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'IBANforge',
  url: 'https://ibanforge.com',
  logo: 'https://ibanforge.com/icon-512.png',
  email: 'support@ibanforge.com',
  sameAs: [
    'https://github.com/cammac-creator/ibanforge',
    'https://www.npmjs.com/package/ibanforge-mcp',
    'https://www.npmjs.com/package/@ibanforge/sdk',
    'https://registry.modelcontextprotocol.io/servers/com.ibanforge/mcp',
  ],
};

const HOW_TO = {
  '@context': 'https://schema.org',
  '@type': 'HowTo',
  name: 'Integrate IBANforge in 3 steps',
  description: 'How to validate an IBAN with the IBANforge API in three steps.',
  totalTime: 'PT5M',
  step: [
    {
      '@type': 'HowToStep',
      name: 'Get an API key (free) or use x402',
      text: 'POST /v1/keys/generate with your email to get a free API key (200 requests/month). Or skip signup entirely and let your agent pay 0.005 USDC per call via x402.',
      url: 'https://ibanforge.com/docs/api-keys',
    },
    {
      '@type': 'HowToStep',
      name: 'Call the validate endpoint',
      text: 'curl -X POST https://api.ibanforge.com/v1/iban/validate -H "Authorization: Bearer ifk_***" -H "Content-Type: application/json" -d \'{"iban": "CH1000230000000012345"}\'',
      url: 'https://ibanforge.com/docs/iban-validate',
    },
    {
      '@type': 'HowToStep',
      name: 'Or install the MCP server',
      text: 'In Claude Desktop / Cursor / Cline: npx -y ibanforge-mcp (stdio) or point to https://api.ibanforge.com/mcp (streamable-HTTP).',
      url: 'https://ibanforge.com/docs/mcp',
    },
  ],
};

const SCHEMAS = [SOFTWARE_APPLICATION, ORGANIZATION, HOW_TO];

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
