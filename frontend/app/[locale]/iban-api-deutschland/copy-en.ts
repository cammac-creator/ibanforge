import type { GermanApiCopy } from './copy';

export const COPY_EN: GermanApiCopy = {
  meta: {
    title: 'IBAN API for Germany: Bundesbank register, bank and BIC',
    description:
      'Which API checks German IBANs and names the bank and BIC? IBANforge reads the Bundesbank bank code file. With real answers, VoP and a comparison.',
    ogLocale: 'en_US',
  },
  breadcrumbHome: 'Home',
  hero: {
    eyebrow: 'Germany · Bundesbank · SEPA',
    h1: 'Which API checks German IBANs and names the bank and BIC?',
    answer:
      'IBANforge checks a German IBAN in one call against the bank code file of the Deutsche Bundesbank (edition {asOf}): structure and check digits, the Bankleitzahl in the register, the account-number check digit by the Bundesbank method, and the bank and BIC from the same file. When the Bankleitzahl is not in the register, the answer is not_allocated with authoritative: true, because then no bank holds that code.',
    limit:
      'The API does not match the account holder\'s name and does not say whether the account exists. The name match is the Verification of Payee run by the banks.',
    interest: 'We sell IBANforge. The comparison further down also says when another provider is the better choice.',
    tryIt: 'Try it in the sandbox',
    compare: 'Go to the comparison',
  },
  need: {
    heading: 'What an API has to do for a German IBAN',
    intro:
      'Correct check digits only prove that the characters fit together. A useful check also answers the questions below, and says where each answer comes from.',
    cols: { check: 'The question', source: 'Where the answer comes from', field: 'Field in the response' },
    rows: [
      {
        check: 'Is the IBAN well formed?',
        source: 'ISO 13616: 22 characters, modulo 97 check digits',
        field: 'valid',
      },
      {
        check: 'Is the Bankleitzahl allocated?',
        source: 'The Bundesbank bank code file',
        field: 'bank_code_check',
      },
      {
        check: 'Does the account-number check digit fit?',
        source: 'The method the Bundesbank assigns to the Bankleitzahl',
        field: 'national_check_digits',
      },
      {
        check: 'Which bank, which BIC?',
        source: 'The same entry of the bank code file',
        field: 'bank_code_check.institution, bic',
      },
      {
        check: 'Which SEPA schemes, which VoP status for the bank?',
        source: 'The European Payments Council registers, otherwise the country (the answer says which)',
        field: 'sepa',
      },
    ],
  },
  bundesbank: {
    heading: 'What we read at the Bundesbank',
    items: [
      {
        title: 'The bank code file, with its edition',
        body: 'The Bundesbank allocates the Bankleitzahlen and publishes the file every month. The edition read is {asOf}: {count} bank codes, {retired} of them marked for deletion. Every answer names its edition in as_of.',
      },
      {
        title: 'A missing code carries weight',
        body: 'Because the Bundesbank allocates the codes itself, an absence is a fact about Germany and not about our data: status not_in_register, reason not_allocated, authoritative true. Where we read no complete register, the same miss is absent_from_reference_data and rules nothing out.',
      },
      {
        title: 'The account-number check digit',
        body: 'The file assigns a check-digit method (Prüfzifferberechnungsmethode) to every Bankleitzahl. The answer names it in national_check_digits.method, with the result and the source. A wrong check digit never turns valid to false. With a method the Bundesbank publishes without test account numbers it is only a warning, and a method we cannot check reliably stays not_checked.',
      },
      {
        title: 'The BIC and its source',
        body: 'The file carries the BIC next to the Bankleitzahl. bic.source names the file, and bic.basis: national_register says that the BIC was read there and not guessed.',
      },
      {
        title: 'Codes that end',
        body: 'When the Bundesbank marks a Bankleitzahl for deletion, the answer carries retired: true and, when the register names a successor, superseded_by. A format check does not see this.',
      },
    ],
    credit: 'Quelle: Deutsche Bundesbank, Bankleitzahlendatei, edition {asOf}.',
  },
  examples: {
    heading: 'Two answers',
    intro: 'These values are not typed by hand: when this page is built they are read from the Bundesbank edition {asOf}.',
    allocatedTitle: 'An allocated Bankleitzahl',
    allocatedNote:
      'DE89 3704 0044 0532 0130 00 is the specimen IBAN of many tutorials. The Bankleitzahl 37040044 belongs to Commerzbank, and the BIC comes from the same file. It says nothing about the account itself.',
    missingTitle: 'A Bankleitzahl nobody holds',
    missingNote:
      'The check digits of this IBAN are correct, so valid stays true. Only the register shows that the Bundesbank never allocated 99999999. next_steps turns that into an action software can branch on.',
    curlTitle: 'Call it yourself, without a key',
    curlNote: 'For production, take a key.',
    keyLink: 'Prices and allowances',
    extract: 'Extract of the response',
  },
  vop: {
    heading: 'Verification of Payee: what is mandatory, and what we say about it',
    what: {
      title: 'What it is',
      body: 'Before a credit transfer, the payee name entered is matched against the name that belongs to the IBAN. This applies to SEPA credit transfers and SEPA instant credit transfers between payment accounts. The legal basis is Article 5c of the SEPA Regulation, inserted by Regulation (EU) 2024/886.',
    },
    duty: {
      title: 'Who the duty falls on',
      body: 'Payment service providers in the euro area, since 9 October 2025: the payer\'s bank asks, the payee\'s bank answers. A business submitting transfers in a bundle must have the option to opt out. This page is not legal advice.',
    },
    says: {
      title: 'What IBANforge says about it',
      body: 'Whether the bank it resolved is in the European Payments Council VoP register: sepa.vop_participant and sepa.vop_register_status, with register_source and register_as_of when the register was read for that bank. That is a statement about the bank, not about the account.',
    },
    not: {
      title: 'What IBANforge does not do',
      body: 'Match a name. The API never answers Match or No Match and does not replace your bank\'s check. A false or null in the VoP fields is not a result about a name.',
    },
    sourcesTitle: 'Sources',
    readOn: 'read on {date}',
    sources: [
      {
        label: 'BaFin: Verification of payee',
        url: 'https://www.bafin.de/EN/verbraucherinnen-verbraucher/themen-finanzprodukte/konten-zahlungen/zahlungen/ueberweisungen-und-lastschriften/empfaengerueberpruefung/empfaengerueberpruefung_en.html',
        read: 'authorities',
      },
      {
        label: 'BaFin: questions and answers on the Instant Payments Regulation (German)',
        url: 'https://www.bafin.de/SharedDocs/Fragen-antworten/DE/faq-voechtzeitueberweisungen/faq-voechtzeitueberweisungen_node.html',
        read: 'authorities',
      },
      {
        label: 'Deutsche Bundesbank: questions and answers on instant payments and verification of payee (German)',
        url: 'https://www.bundesbank.de/dynamic/action/de/aufgaben/unbarer-zahlungsverkehr/veroeffentlichungen/fragen-und-antworten-zu-echtzeitueberweisungen-und-empfaengerueberpruefung/963980/fragen-und-antworten-zu-echtzeitueberweisungen-und-empfaengerueberpruefung-',
        read: 'authorities',
      },
      {
        label: 'Regulation (EU) 2024/886, EUR-Lex',
        url: 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R0886',
        read: 'regulation',
      },
    ],
    docsLink: 'The VoP fields in detail',
  },
  comparison: {
    heading: 'The comparison for German IBANs',
    interest:
      'We sell IBANforge; read this comparison knowing that. Every statement about another provider comes from its public pages, read on {readOn}. What we did not check says so. If something is wrong or a price has changed, write to support@ibanforge.com.',
    bankCode: 'Bank code in the national register',
    prices: 'The calculation, prices read on {readOn}',
    ourPrices: 'Prices',
    libsName: 'Open-source libraries',
    libsBetter: 'When a library is the better choice',
    vendorLink: 'The full comparison with {name}',
    ourLink: 'All prices',
    tableLink: 'All providers in one table',
  },
  europe: {
    heading: 'The same logic across Europe',
    full: 'The registers of Germany, Austria, Belgium, Slovakia, the Czech Republic, Bulgaria, Switzerland and Liechtenstein are read in full. There, a missing code comes back as not_allocated.',
    elsewhere:
      'In the rest of the {countries} IBAN countries a partial register or a composite map names the bank, and the answer says that it cannot rule a code out. A batch call takes up to 100 IBANs.',
    link: 'IBAN formats and registers by country',
  },
  next: {
    heading: 'Read on',
    finder: 'Which bank does this IBAN belong to? No code, in the browser',
    register: 'Every Bankleitzahl on its own page',
    docs: 'The BLZ check in the documentation',
    article: 'Example in Python and JavaScript',
    alternatives: 'Alternatives, one page per provider',
  },
};
