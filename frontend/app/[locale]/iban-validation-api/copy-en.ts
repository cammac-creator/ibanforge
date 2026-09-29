import type { ApiPageCopy } from "./copy";

// One sentence per line where a figure appears: the prose guards of the API
// repository read this file line by line and sentence by sentence.
export const COPY_EN: ApiPageCopy = {
  meta: {
    title: "IBAN validation API: bank, BIC and bank code check",
    description:
      "IBAN validation API for your software: check digits, country structure, the bank and BIC from the national registers with source and date, SEPA reach. Try it keyless.",
    ogLocale: "en_US",
  },
  breadcrumbHome: "Home",
  hero: {
    eyebrow: "REST API · JSON · MCP",
    h1: "IBAN validation API",
    lead:
      "One POST checks an IBAN the way a payment run needs it: the check digits and the country's layout, then the bank behind it, read from the national register with its source and its date.",
    facts: ["{countries} IBAN countries", "Bank and BIC with their source", "First calls without a key"],
    ctaKey: "Get a free API key",
    ctaSandbox: "Try it in the sandbox",
    ctaDocs: "Read the docs",
  },
  checks: {
    heading: "What one call checks",
    intro:
      "POST /v1/iban/validate answers with one JSON object. Each check has its own field, so your code reads exactly what was verified and what was not.",
    items: [
      {
        title: "Check digits",
        field: "checks.iban_checksum",
        body: "The ISO 13616 mod-97 check on the two digits after the country code. A single mistyped character fails it.",
      },
      {
        title: "Country structure",
        field: "checks.iban_structure",
        body: "The length and the layout of the account part for each of the {countries} countries of the IBAN registry. An invalid IBAN is not an HTTP error: the answer is a 200 with valid: false and the reason.",
      },
      {
        title: "National check digits",
        field: "checks.national_check_digits",
        body: "Where a country hides its own key inside the account number: France and Monaco (RIB key), Belgium, Italy and San Marino (CIN), Spain (DC), the United Kingdom (modulus check) and the Polish settlement number. A wrong key shows in this field and never turns valid to false.",
      },
      {
        title: "The bank and its BIC",
        field: "bank_code_check · bic.source · as_of",
        body: "The bank code is looked up in the national register where we read it in full: Germany, Austria, Belgium, Slovakia, Czech Republic, Bulgaria, Switzerland and Liechtenstein. There, a code the register does not hold comes back not_allocated. Elsewhere a partial register or a composite map names the bank, and the answer says it cannot rule a code out. The register and the date of its edition travel with the answer.",
      },
      {
        title: "SEPA and Verification of Payee",
        field: "sepa · risk_indicators.vop_coverage",
        body: "The SEPA schemes that reach the bank (Credit Transfer, Instant, Direct Debit), from the EPC scheme registers when they list it and from the country otherwise, with the basis named. And whether the EPC Verification of Payee register lists the bank as ready.",
      },
      {
        title: "Bank screening, when you ask for it",
        field: "POST /v1/iban/compliance",
        body: "A separate call screens the payee's bank (BIC8) against the OFAC, EU and UN lists, checks the country against FATF and a fixed list of sanctioned jurisdictions, and returns a risk score from 0 to 100. It is informational, and it never screens the payee's name.",
      },
    ],
  },
  notDo: {
    heading: "What it does not tell you",
    items: [
      "Whether the account exists or is open. No register publishes that: only the payee's bank knows.",
      "Whose name is on the account. That check is Verification of Payee, run by the payee's bank; the API only says whether that bank is listed as ready for it.",
      "Whether the payee is sanctioned. The optional screening covers the bank and the country, not the person or the company you pay.",
      "The German account-number methods and the national keys of the countries not named above: they are not checked yet.",
    ],
    sources: "Every register, its licence and the date of the edition we read",
  },
  firstCall: {
    heading: "Your first call",
    intro:
      "Copy one of these as it stands. The IBAN is the example the sandbox uses: a valid Swiss IBAN that resolves to a real bank.",
    trial:
      "The keyless trial serves 25 validations a week on POST /v1/iban/validate, counted for the address the call comes from, ISO week in UTC, reset on Monday 00:00 UTC.",
    tabsLabel: "The same call in three languages",
    answerHeading: "The answer, as the API gave it",
    answerCaption:
      "Extract of the answer the API returned for this IBAN on {date}: the fields that say what was checked, and against which register. The full answer also carries the issuer, the Swiss clearing data, risk indicators and the next step to take. Called with no key, it ends with a trial block that says how many calls are left this week and when the count resets.",
    withKey:
      "Past the keyless trial, send the same request with the header Authorization: Bearer ifk_… and your key.",
  },
  mod97: {
    heading: "Why a mod-97 check is not enough",
    body:
      "The official Swiss example of the IBAN registry, CH93 0076 2011 6238 5295 7, has correct check digits. Its bank code is allocated to no one in the SIX BankMaster, and the API says so:",
    caption: "Answer of the API to that IBAN, exported on {date}.",
  },
  doors: {
    heading: "Start free, then pay for what you use",
    intro: "Three free ways in, each with its own allowance. None asks for a card.",
    trial: {
      tag: "No key",
      title: "The keyless trial",
      body: "25 validations a week on POST /v1/iban/validate, for the address the call comes from, as a taster. Reset on Monday 00:00 UTC.",
    },
    anonymous: {
      tag: "Key, no e-mail",
      title: "A key in one click",
      body: "25 requests a month, on every endpoint. One empty POST to /v1/keys/generate, or the button below: no e-mail, no card.",
    },
    claimed: {
      tag: "Key, with an address",
      title: "200 requests a month",
      body: "Claim the same key with a 6-digit code sent to an address you read, or give the address when you create it. Same key, same prefix, no card.",
    },
    keyCta: "Get the free key",
    paidHeading: "When you need more",
    paid: [
      "Pro: $29 a month for 10,000 requests, reset on the 1st, cancel anytime.",
      "Credit packs that never expire, by card or in USDC: 1,000 credits for $4, 5,000 for $20, 25,000 for $80.",
      "x402: pay per call in USDC on Base, no account at all, $0.005 per validation and $0.002 per IBAN in a batch.",
    ],
    pricingLink: "All prices and the cost calculator",
  },
  tools: {
    heading: "Everything around the API",
    links: [
      { href: "/playground", title: "Sandbox", body: "The real API in your browser, with example IBANs from several countries." },
      { href: "/docs/onboarding", title: "Onboarding", body: "From the keyless call to a batch of 100 IBANs, every block of the answer by its real name." },
      { href: "/docs/iban-validate", title: "Endpoint reference", body: "POST /v1/iban/validate, field by field, with the error codes." },
      { href: "/openapi", title: "OpenAPI 3.1", body: "The contract, to generate a client or import into Postman." },
      { href: "https://www.npmjs.com/package/@ibanforge/sdk", title: "npm: @ibanforge/sdk", body: "The TypeScript and JavaScript SDK." },
      { href: "https://pypi.org/project/ibanforge/", title: "PyPI: ibanforge", body: "The Python SDK, sync and async clients." },
      { href: "/docs/mcp", title: "MCP server", body: "ibanforge-mcp for Claude, Cursor and other MCP clients, or the hosted endpoint." },
      { href: "https://www.npmjs.com/package/n8n-nodes-ibanforge", title: "n8n", body: "The community node for self-hosted n8n." },
    ],
  },
  closing: {
    heading: "Try it on your own IBANs",
    body: "The sandbox runs the real API. When you are ready, take a key: no e-mail, no card.",
  },
};
