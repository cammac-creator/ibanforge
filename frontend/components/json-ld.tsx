/**
 * JSON-LD structured data for IBANforge.
 *
 * Six schemas help AI agents and search engines understand the product:
 * - SoftwareApplication: full product description with offers + featureList
 * - Organization: name, logo, social links
 * - FAQPage: 10 Q&A about validation, pricing, MCP, x402, coverage, etc.
 * - HowTo: 3-step integration guide (key/x402 → validate → MCP)
 * - BreadcrumbList: site hierarchy hint for crawlers
 * - WebAPI: machine-readable pointer to OpenAPI spec
 *
 * Ported from version A (Vite/SSG live on ibanforge.com) to maintain SEO and
 * agent-discovery parity when this Next.js version replaces it.
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
    'IBAN validation, BIC/SWIFT lookup, Swiss BC-Nummer (1,190 SIX entries), EMI/vIBAN classification, SEPA + VoP reachability and compliance risk scoring. Pay-per-call in USDC via x402, or 200 free requests/month with an API key. Native MCP server for Claude Desktop, Cursor, and Cline.',
  offers: [
    {
      '@type': 'Offer',
      name: 'Validate IBAN',
      description: 'Validate single IBAN with BIC lookup, issuer classification, SEPA + VoP flags',
      price: '0.005',
      priceCurrency: 'USDC',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Batch validate IBANs',
      description: 'Validate up to 100 IBANs in one call',
      price: '0.002',
      priceCurrency: 'USDC',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'IBAN' },
    },
    {
      '@type': 'Offer',
      name: 'Lookup BIC',
      description: 'Lookup BIC/SWIFT against 121,197 GLEIF entries with LEI enrichment',
      price: '0.003',
      priceCurrency: 'USDC',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Swiss clearing lookup',
      description: 'Swiss BC-Nummer / IID lookup (1,190 SIX BankMaster entries)',
      price: '0.003',
      priceCurrency: 'USDC',
      eligibleQuantity: { '@type': 'QuantitativeValue', value: 1, unitText: 'request' },
    },
    {
      '@type': 'Offer',
      name: 'Compliance check',
      description:
        'Full compliance triage: sanctions (OFAC/EU/UN), FATF, SEPA Instant, VoP, risk score (0-100)',
      price: '0.02',
      priceCurrency: 'USDC',
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
    'BIC/SWIFT lookup against 121,197 GLEIF entries',
    'Swiss BC-Nummer / IID lookup (1,190 SIX BankMaster)',
    'EMI / vIBAN / neobank issuer classification',
    'SEPA Instant reachability flag',
    'VoP (PSR 2024/886) participant check',
    'Compliance risk scoring (OFAC/EU/UN)',
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

const FAQ = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: [
    {
      '@type': 'Question',
      name: 'What does IBANforge validate?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'IBANforge validates IBAN structure (ISO 13616 mod-97 check digits + country-specific BBAN), resolves the associated BIC/SWIFT against 121,197 GLEIF entries, looks up Swiss BC-Nummer / IID against 1,190 SIX BankMaster entries, classifies the issuer (bank, EMI, vIBAN provider, neobank), and flags SEPA Instant + VoP (Verification of Payee, EU 2024/886) reachability.',
      },
    },
    {
      '@type': 'Question',
      name: 'How much does IBANforge cost?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Pay-per-call in USDC via x402: 0.005 USDC for IBAN validation, 0.003 USDC for BIC lookup, 0.003 USDC for Swiss BC-Nummer lookup, 0.002 USDC per IBAN in batch mode, 0.02 USDC for full compliance check. Or use an API key for 200 free requests per month.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does IBANforge support MCP (Model Context Protocol)?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. IBANforge ships an official MCP server (com.ibanforge/mcp) with 5 tools: validate_iban, batch_validate_iban, lookup_bic, lookup_ch_clearing, check_compliance. Install in Claude Desktop, Cursor, Cline or any MCP-compatible client via npx or streamable-HTTP at https://api.ibanforge.com/mcp.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does IBANforge support x402 for autonomous AI agents?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'Yes. Every paid endpoint accepts x402 micropayments in USDC on Base L2. Agents discover pricing via /.well-known/x402, pay autonomously and call the API without human onboarding. Listed on Coinbase Bazaar discovery.',
      },
    },
    {
      '@type': 'Question',
      name: 'How many countries does IBANforge cover?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'All 84 countries with a standardized IBAN format, including the full SEPA zone, the UK, Switzerland, and most of MENA and Latin America with IBAN coverage.',
      },
    },
    {
      '@type': 'Question',
      name: 'What is vIBAN detection and why does it matter?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'A virtual IBAN (vIBAN) is an IBAN issued by an EMI or fintech (e.g., Wise, Revolut, Mercury, Modulr) that maps to an underlying account at a partner bank. Detecting vIBANs matters for compliance: VoP often fails on vIBANs and EMI exposure changes the risk profile. IBANforge classifies 30+ known issuer prefixes.',
      },
    },
    {
      '@type': 'Question',
      name: 'Where does the BIC and Swiss clearing data come from?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'BIC/SWIFT data: 121,197 entries from GLEIF (Global Legal Entity Identifier Foundation), enriched with LEI codes. Swiss data: 1,190 BC-Nummern from the official SIX BankMaster CSV — the canonical source used by the Swiss banking industry.',
      },
    },
    {
      '@type': 'Question',
      name: 'Does IBANforge replace a regulated AML/sanctions screening provider?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'No. The /v1/iban/compliance endpoint runs OFAC/EU/UN list checks and produces a risk score (0-100) — useful for triage and pre-flight screening. For regulated AML/CFT obligations use a regulated vendor like Refinitiv World-Check, Acuris or ComplyAdvantage.',
      },
    },
    {
      '@type': 'Question',
      name: 'How fast is IBANforge?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'p99 latency under 50ms for /v1/iban/validate (single IBAN). All databases are SQLite WAL with in-process reads — no external lookups. Batch endpoint scales linearly to 100 IBANs per request.',
      },
    },
    {
      '@type': 'Question',
      name: 'Is IBANforge open-source?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: 'The MCP server (ibanforge-mcp), the SDK (@ibanforge/sdk) and the OpenAPI spec are open-source on GitHub at github.com/cammac-creator/ibanforge. The hosted API and proprietary issuer classification dataset are commercial.',
      },
    },
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
      text: 'curl -X POST https://api.ibanforge.com/v1/iban/validate -H "Authorization: Bearer ifk_***" -H "Content-Type: application/json" -d \'{"iban": "CH93 0076 2011 6238 5295 7"}\'',
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

const BREADCRUMB = {
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://ibanforge.com/' },
    { '@type': 'ListItem', position: 2, name: 'Docs', item: 'https://ibanforge.com/docs' },
    { '@type': 'ListItem', position: 3, name: 'OpenAPI', item: 'https://api.ibanforge.com/openapi.json' },
  ],
};

const WEB_API = {
  '@context': 'https://schema.org',
  '@type': 'WebAPI',
  name: 'IBANforge REST API',
  url: 'https://api.ibanforge.com',
  documentation: 'https://ibanforge.com/docs',
  termsOfService: 'https://ibanforge.com/terms',
  provider: { '@type': 'Organization', name: 'IBANforge', url: 'https://ibanforge.com' },
  endpointDescription: 'https://api.ibanforge.com/openapi.json',
};

const SCHEMAS = [SOFTWARE_APPLICATION, ORGANIZATION, FAQ, HOW_TO, BREADCRUMB, WEB_API];

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
