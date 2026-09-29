import type { WelcheBankCopy } from './copy';

export const COPY_EN: WelcheBankCopy = {
  meta: {
    title: 'Which bank does this IBAN belong to? Find the bank code',
    description:
      'Which bank does this IBAN belong to? Not the two digits after DE: those are check digits. The bank is in the Bankleitzahl, positions 5 to 12. Find it in your browser.',
    ogLocale: 'en_US',
  },
  breadcrumbHome: 'Home',
  hero: {
    eyebrow: 'IBAN · bank code · check digits',
    h1: 'Which bank does this IBAN belong to?',
    lead:
      'The bank is written inside the IBAN itself: in a German IBAN, in positions 5 to 12, the Bankleitzahl. The two digits right after DE are check digits and name no bank.',
  },
  finder: {
    label: 'Type or paste an IBAN (the beginning is enough)',
    placeholder: 'DE89 3704 0044 0532 0130 00',
    privacy:
      'The IBAN is read in your browser. It is not sent anywhere and the API is not called. Only a click opens the page of the bank code, and that code is all its address carries.',
    example: 'Example: DE89 3704 0044 0532 0130 00. The Bankleitzahl is 37040044.',
    partialTitle: '{cd} are check digits, not a bank',
    partialStart: 'Keep typing: the bank code starts at position 5.',
    partialBody: {
      DE: 'The two digits after DE are computed from all the other characters, so that a typo shows. The bank is in the Bankleitzahl, the eight digits that follow (positions 5 to 12). Type at least {needed} characters.',
      AT: 'The two digits after AT are computed from all the other characters, so that a typo shows. The bank is in the Bankleitzahl, the five digits that follow (positions 5 to 9). Type at least {needed} characters.',
      CH: 'The two digits after CH are computed from all the other characters, so that a typo shows. The bank is in the IID (clearing number), the five digits that follow (positions 5 to 9). Type at least {needed} characters.',
      LI: 'The two digits after LI are computed from all the other characters, so that a typo shows. The bank is in the IID, the five digits that follow (positions 5 to 9). Type at least {needed} characters.',
    },
    codeName: {
      DE: 'Bankleitzahl',
      AT: 'Bankleitzahl',
      CH: 'IID (clearing number)',
      LI: 'IID (clearing number)',
    },
    status: {
      deAllocated: 'Listed in the Deutsche Bundesbank register (edition {asOf}). Its page names the bank and its BIC.',
      deRetired: 'Listed in the Deutsche Bundesbank register (edition {asOf}), and marked there for deletion.',
      deRetiredSuccessor: 'The Bundesbank names Bankleitzahl {successor} as its successor.',
      deMissing:
        'Not in the Deutsche Bundesbank register (edition {asOf}): no bank holds this code. Check the IBAN again.',
      atUnchecked:
        'Read from positions 5 to 9. Its page names the bank when the directory of the Oesterreichische Nationalbank lists the code.',
      chAllocated: 'Listed in the SIX BankMaster (valid from {asOf}). Its page names the bank and its BIC.',
      chMissing: 'Not in the SIX BankMaster (valid from {asOf}): no institution holds this IID. Check the IBAN again.',
    },
    checksum: {
      pass: 'Check digits {cd}: they match. The IBAN has no typo that the mod 97 check would catch.',
      fail: 'Check digits {cd}: they do not match the rest. There is a typo somewhere, possibly in the bank code itself.',
      incomplete: 'Check digits {cd}: checked once the IBAN is complete ({length} characters).',
    },
    bareBlz: 'Eight digits with no country code: read as a German Bankleitzahl.',
    open: 'Open the page of {code}',
    openSuccessor: 'Open successor {successor}',
    errors: {
      characters: 'An IBAN holds only letters and digits, and two digits follow the country code.',
      country: 'Start with the two letters of the country (DE, AT, CH or LI), or type the eight digits of a Bankleitzahl.',
      tooLong: 'Longer than an IBAN from {country} ({length} characters): check what was pasted.',
    },
    unsupported:
      '{country}: this box reads IBANs from Germany, Austria, Switzerland and Liechtenstein. For other countries, the sandbox checks an IBAN with the API; the IBAN is then sent to the API.',
    unsupportedLink: 'Go to the sandbox',
  },
  anatomy: {
    heading: 'How a German IBAN is built',
    intro: 'Always 22 characters, always in this order. The example is the specimen IBAN found in many guides.',
    parts: {
      country: { label: 'Country code', note: 'DE for Germany' },
      check: { label: 'Check digits', note: 'Not a bank: computed from all the other characters' },
      bank: { label: 'Bankleitzahl', note: 'The bank: here Commerzbank, Köln' },
      account: { label: 'Account number', note: 'Ten digits, padded with zeros on the left' },
    },
  },
  trap: {
    heading: 'Why "DE55" is not a bank',
    paragraphs: [
      'Many people search for "DE55 welche Bank" or "DE87 welche Bank" (which bank is DE55?). The digits after DE are the ISO 13616 check digits: they are computed with the mod 97 method from every other character of the IBAN. Change a single character and the check digits no longer match, so the IBAN shows up as wrong.',
      'That is why any bank can sit behind DE55, just as behind any other check digits. Two customers of the same bank almost always have different check digits, because their account numbers differ.',
      'The bank is told by the Bankleitzahl: the eight digits from position 5. The Deutsche Bundesbank allocates these codes and publishes them in its register, the Bankleitzahlendatei, with the name of the bank, its town and its BIC.',
    ],
  },
  countries: {
    heading: 'Austria, Switzerland, Liechtenstein',
    intro: 'The same idea, other lengths. The box above reads all four countries.',
    cols: { country: 'Country', length: 'Length', position: 'Bank code', code: 'Name', register: 'Register' },
    rows: [
      { cc: 'DE', country: 'Germany', code: 'Bankleitzahl', register: 'Deutsche Bundesbank' },
      { cc: 'AT', country: 'Austria', code: 'Bankleitzahl', register: 'Oesterreichische Nationalbank' },
      { cc: 'CH', country: 'Switzerland', code: 'IID (clearing number)', register: 'SIX BankMaster' },
      { cc: 'LI', country: 'Liechtenstein', code: 'IID (clearing number)', register: 'SIX BankMaster' },
    ],
    positions: 'positions {from} to {to}',
  },
  tells: {
    heading: 'What the bank code tells you, and what it does not',
    yes: [
      'Which bank holds the account, with its town and BIC, as the register names them.',
      'Whether the code is allocated. A code the Bundesbank does not list belongs to no bank.',
    ],
    no: [
      'Whether the account exists or is open. Only the payee’s bank knows that.',
      'Whose account it is. Banks compare the name when you pay (Verification of Payee).',
    ],
  },
  developers: {
    heading: 'Checking from software',
    body: 'If you check many IBANs, in a customer database or before a payment run, the API reads the same register: check digits, bank, BIC, the register’s verdict with its source and edition, in one JSON answer.',
    api: 'IBAN validation API',
    sandbox: 'Try it in the sandbox',
    article: 'Example in Python and JavaScript',
  },
  sources: {
    de: 'Source: Deutsche Bundesbank, Bankleitzahlendatei, edition {asOf}.',
    ch: 'Source: SIX BankMaster, valid from {asOf}.',
    at: 'Austria: the box only reads positions 5 to 9; the page of a code asks the register when it is opened.',
  },
};
