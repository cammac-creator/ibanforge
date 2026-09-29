import type { AlternativesCopy } from './copy';

// One sentence per line where a figure appears: the prose guards of the API
// repository read this file line by line and sentence by sentence.
export const COPY_EN: AlternativesCopy = {
  ogLocale: 'en_US',
  breadcrumbHome: 'Home',
  breadcrumbIndex: 'Alternatives',
  eyebrow: 'Side by side',
  disclosure:
    'We sell IBANforge, so read this page with that in mind. Every fact about {name} comes from its public pages, read on {readOn} and linked at the bottom. If something is wrong or a price has changed, write to support@ibanforge.com and we will correct it.',
  labels: {
    strengths: 'What {name} does well',
    theirPrices: '{name} prices',
    readOn: 'As its pages showed them on {readOn}.',
    ourPricesNote: 'Current prices, the same as on the pricing page.',
    allPrices: 'All prices and the cost calculator',
    calculation: 'Calculation',
    betterFor: 'When {name} is the better choice',
    sources: 'Sources, read on {readOn}',
    next: 'Go further',
    compare: 'Full comparison',
    compareBody: 'IBANforge, AbstractAPI, iban.com, IBANAPI and open-source libraries in one table.',
    api: 'IBAN validation API',
    apiBody: 'What one call checks, and the first call in curl, Python and JavaScript.',
    sandbox: 'Sandbox',
    sandboxBody: 'The real API in your browser, with example IBANs.',
  },
  ours: {
    heading: 'What IBANforge does differently',
    items: [
      'The bank code is checked in the national register where we read it in full: Germany (Deutsche Bundesbank, edition of {deAsOf}), Switzerland and Liechtenstein (SIX BankMaster, valid from {chAsOf}), Austria, Belgium, Slovakia, the Czech Republic and Bulgaria. There, a code the register does not hold comes back not_allocated, with authoritative: true.',
      'Every answer names its sources: the register behind the bank-code verdict, the source of the BIC and the edition it was read from (bank_code_check.register, bic.source, as_of).',
      'National check digits inside the account number, where a country has them: France and Monaco (RIB key), Belgium, Italy and San Marino (CIN), Spain (DC) and the United Kingdom (modulus check).',
      'Built for AI agents: an MCP server, hosted or as the ibanforge-mcp package, and x402, which lets an agent pay each call in USDC on Base with no account.',
      'A keyless trial of 25 validations a week on POST /v1/iban/validate, to try it before taking a key.',
    ],
    limitsHeading: 'What IBANforge does not do',
    limits: [
      'Check the account holder’s name. That is Verification of Payee, run by the payee’s bank.',
      'Check the German account-number methods, or the national keys of the countries not named above: not yet.',
      'Say whether the account exists or is open. No register publishes that.',
    ],
    pricesHeading: 'IBANforge prices',
    free: [
      'Keyless trial: 25 validations a week on POST /v1/iban/validate.',
      'Free key: 200 requests a month once claimed with an e-mail address, on every endpoint, no card.',
    ],
    paid: [
      'Pro: $29 a month for 10,000 requests, cancel anytime.',
      'Credit packs that never expire: 1,000 credits for $4, 5,000 for $20, 25,000 for $80.',
      'x402: $0.005 per validation and $0.002 per IBAN in a batch, in USDC on Base, no account.',
    ],
  },
  index: {
    meta: {
      title: 'IBAN API alternatives: IBANAPI, iban.com, AbstractAPI',
      description:
        'Alternatives to IBANAPI, iban.com and AbstractAPI for IBAN validation: what each does well, what IBANforge does differently, and both price lists, dated.',
    },
    h1: 'Alternatives to IBAN validation APIs',
    lead:
      'One page per provider people compare us with: what it does well, what IBANforge does differently, both price lists with the day they were read, and when the other one is the better choice.',
    cardCta: 'Read the comparison',
    compareLine: 'All of them in one table, with the open-source libraries:',
  },
  fromCompare: {
    heading: 'One page per provider',
    body: 'IBANAPI, iban.com and AbstractAPI, each next to IBANforge: strengths, prices and when to choose which.',
  },
  vendors: {
    ibanapi: {
      meta: {
        title: 'IBANAPI alternative: prices and differences, side by side',
        description:
          'Looking for an IBANAPI alternative? What IBANAPI does well, what IBANforge does differently (national registers, MCP, x402) and both price lists, dated.',
      },
      h1: 'An alternative to IBANAPI',
      lead:
        'IBANAPI is an IBAN validation API with a free plan and a self-hosted option. If you are weighing it against IBANforge, here is what each one does, with the prices of both.',
      summary: 'A free plan that renews, a self-hosted engine, prepaid credits tied to a period.',
      strengths: [
        'A free plan with no card required: 100 basic credits and 20 bank-lookup credits per 30 days, and the free plan renews automatically.',
        'A self-hosted version: IBANAPI states that its validation engine can run inside your own infrastructure, with no per-request calls.',
        'For some countries, IBANAPI announces a check of the domestic account number itself.',
        'IBANAPI announces 90 countries, with bank names and BIC codes sourced from central bank registries. It resolves the bank code inside the IBAN against its own registry, built from central banks, SEPA data and manual review, and returns the BIC where available.',
      ],
      prices: [
        'Free: $0 for 30 days, with 100 basic credits and 20 bank-lookup credits.',
        'Professional: $15 for 60 days, with 2,000 basic credits and 400 bank-lookup credits.',
        'Business: $40 for 180 days, with 7,000 basic credits and 1,500 bank-lookup credits.',
        'Enterprise: $115 for 365 days, with 30,000 basic credits and 5,000 bank-lookup credits.',
        'Every validation uses 1 basic credit; a call that also resolves bank details uses 1 bank-lookup credit as well. Credits are tied to the plan’s period.',
      ],
      calculation:
        'For 2,000 validations with bank data, from the published prices: at IBANforge, $8 in prepaid credits (two packs of 1,000) that never expire. At IBANAPI, the smallest single plan with 2,000 bank lookups is Enterprise, $115 for 365 days, which includes 5,000. Repeat purchases of a smaller plan are not compared here.',
      betterFor: [
        'You want to run the validation engine inside your own infrastructure.',
        'You need the domestic account number checked in the countries where IBANAPI announces it. IBANforge does not check the German account-number methods yet.',
      ],
      note:
        'What a bank code missing from IBANAPI’s registry means (allocated to nobody, or simply not listed) is not stated on the pages we read.',
    },
    'iban-com': {
      meta: {
        title: 'iban.com alternative: IBAN Suite prices and differences',
        description:
          'Looking for an iban.com alternative? What IBAN Suite does well (SWIFT-licensed BIC data, Verification of Payee), what IBANforge does differently, prices dated.',
      },
      h1: 'An alternative to iban.com',
      lead:
        'iban.com sells IBAN Suite, a validation and bank-data service under an annual licence, and a separate Verification of Payee service. If you are weighing it against IBANforge, here is what each one does, with the prices of both.',
      summary: 'SWIFT-licensed BIC data, Verification of Payee, UK sort codes, annual licences.',
      strengths: [
        'IBAN Suite identifies the BIC and the bank details behind an IBAN, with BIC data licensed from S.W.I.F.T., and announces SEPA reachability and scheme support.',
        'Bank Account Verification (BAV), which iban.com also calls Verification of Payee, checks the account holder’s name and answers Match, No Match, Close Match or Unavailable, in 21 listed countries.',
        'SORTware, a separate service for UK and Irish sort codes and account numbers.',
        'Published terms, privacy policy, DPA and SLA, and a stated rate limit of 15 requests per second per IP address and per key.',
        'A free trial by online sign-up: 100 queries, active one month. Licences can be bought online, or by invoice through the sales team.',
      ],
      prices: [
        'IBAN Suite, per year: Professional €530 for 2,000 lookups, Business €1,450 for 20,000, Corporate €2,350 for 50,000, Enterprise €4,150 unlimited.',
        'Licences run for one year at least, and VAT is not included.',
        'BAV (Verification of Payee), per package: 2,500 verifications for €2,000, 10,000 for €7,000, 20,000 for €12,000, 50,000 for €25,000.',
        'SORTware: €2,800 a year, unlimited.',
      ],
      calculation:
        'For 2,000 validations with bank data, from the published prices: at IBANforge, $8 in prepaid credits (two packs of 1,000) that never expire. At iban.com, the Professional licence includes 2,000 lookups a year for €530, excluding VAT.',
      betterFor: [
        'You need to check the account holder’s name (Verification of Payee). IBANforge does not: it checks the bank behind the IBAN, not the person.',
        'You validate UK or Irish sort codes and account numbers.',
        'You want BIC data under a SWIFT licence, and an annual contract that can be paid by invoice.',
      ],
      note:
        'iban.de, which says its IBAN and BIC services are powered by iban.com, names in its legal notice the company that iban.com’s terms name as licensor. It lists €420 to €3,800 a year for a one-year term, and a free trial of 100 queries active one month.',
    },
    abstractapi: {
      meta: {
        title: 'AbstractAPI IBAN alternative: prices and differences',
        description:
          'Looking for an AbstractAPI alternative for IBAN validation? What each one returns, the plans of both with their dates, and when AbstractAPI is the better choice.',
      },
      h1: 'An alternative to AbstractAPI for IBANs',
      lead:
        'AbstractAPI’s IBAN Validation API answers whether an IBAN is valid. If you are weighing it against IBANforge, here is what each one returns, with the plans of both.',
      summary: 'A validity boolean, high request rates, an Enterprise plan with an SLA.',
      strengths: [
        'A short answer that is easy to wire in: the documented response carries the IBAN and is_valid.',
        'High request rates: 25 requests per second on Standard, 100 on the higher tiers.',
        'An Enterprise plan, on quote, whose card lists a 99.99% uptime SLA.',
        'A free plan of 100 requests, at 1 request per second.',
      ],
      prices: [
        'Standard, billed annually (the view shown by default): $63 a month for 60,000 requests a year.',
        'Standard, billed monthly: $69 a month for 5,000 requests a month.',
        'Higher tiers: $182 a month billed annually for 240,000 requests a year, or $199 a month for 20,000 a month.',
        'Then $457 a month billed annually for 600,000 requests a year, or $499 a month for 50,000 a month.',
        'Free: 100 requests, at 1 request per second.',
      ],
      calculation:
        'The two answers do not cover the same ground: AbstractAPI documents no BIC or bank name in its response, while IBANforge names the bank and its BIC. For volume alone, from the published prices: 5,000 validations cost $69 for a month at AbstractAPI (Standard, billed monthly) and $20 at IBANforge (one pack of 5,000 credits, no expiry).',
      betterFor: [
        'You only need to know whether an IBAN is well formed, at a high rate of single calls: Standard lists 25 requests per second. IBANforge accepts 100 requests a minute per IP address, with up to 100 IBANs in one batch call.',
        'You want an Enterprise plan whose card lists a 99.99% uptime SLA.',
      ],
    },
  },
};
