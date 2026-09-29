import type { WelcheBankCopy } from './copy';

export const COPY_DE: WelcheBankCopy = {
  meta: {
    title: 'Welche Bank gehört zu dieser IBAN? Bankleitzahl finden',
    description:
      'Welche Bank gehört zu dieser IBAN? Nicht die zwei Ziffern nach DE: Das ist eine Prüfziffer. Die Bank steckt in der Bankleitzahl, Stellen 5 bis 12. Hier im Browser finden.',
    ogLocale: 'de_DE',
  },
  breadcrumbHome: 'Startseite',
  hero: {
    eyebrow: 'IBAN · Bankleitzahl · Prüfziffer',
    h1: 'Welche Bank gehört zu dieser IBAN?',
    lead:
      'Die Bank steht in der IBAN selbst: bei einer deutschen IBAN in den Stellen 5 bis 12, der Bankleitzahl. Die zwei Ziffern direkt nach DE sind eine Prüfziffer und verraten keine Bank.',
  },
  finder: {
    label: 'IBAN eingeben oder einfügen (der Anfang genügt)',
    placeholder: 'DE89 3704 0044 0532 0130 00',
    privacy:
      'Die IBAN wird in Ihrem Browser gelesen. Sie wird nirgendwohin gesendet, und die API wird nicht aufgerufen. Erst ein Klick öffnet die Seite der Bankleitzahl, und in deren Adresse steht nur dieser Code.',
    example: 'Beispiel: DE89 3704 0044 0532 0130 00. Die Bankleitzahl ist 37040044.',
    partialTitle: '{cd} ist eine Prüfziffer, keine Bank',
    partialStart: 'Weiter tippen: Der Code der Bank beginnt an Stelle 5.',
    partialBody: {
      DE: 'Die zwei Ziffern nach DE werden aus allen anderen Zeichen berechnet, damit ein Tippfehler auffällt. Die Bank steckt in der Bankleitzahl, den acht Ziffern danach (Stellen 5 bis 12). Tippen Sie mindestens {needed} Zeichen.',
      AT: 'Die zwei Ziffern nach AT werden aus allen anderen Zeichen berechnet, damit ein Tippfehler auffällt. Die Bank steckt in der Bankleitzahl, den fünf Ziffern danach (Stellen 5 bis 9). Tippen Sie mindestens {needed} Zeichen.',
      CH: 'Die zwei Ziffern nach CH werden aus allen anderen Zeichen berechnet, damit ein Tippfehler auffällt. Die Bank steckt in der IID (Clearing-Nummer), den fünf Ziffern danach (Stellen 5 bis 9). Tippen Sie mindestens {needed} Zeichen.',
      LI: 'Die zwei Ziffern nach LI werden aus allen anderen Zeichen berechnet, damit ein Tippfehler auffällt. Die Bank steckt in der IID, den fünf Ziffern danach (Stellen 5 bis 9). Tippen Sie mindestens {needed} Zeichen.',
    },
    codeName: {
      DE: 'Bankleitzahl',
      AT: 'Bankleitzahl',
      CH: 'IID (Clearing-Nummer)',
      LI: 'IID (Clearing-Nummer)',
    },
    status: {
      deAllocated: 'Steht in der Bankleitzahlendatei der Deutschen Bundesbank (Stand {asOf}). Ihre Seite nennt die Bank und ihren BIC.',
      deRetired: 'Steht in der Bankleitzahlendatei der Deutschen Bundesbank (Stand {asOf}), ist dort aber zur Löschung vorgemerkt.',
      deRetiredSuccessor: 'Die Bundesbank nennt als Nachfolger die Bankleitzahl {successor}.',
      deMissing:
        'Steht nicht in der Bankleitzahlendatei der Deutschen Bundesbank (Stand {asOf}): Keine Bank führt diesen Code. Prüfen Sie die IBAN noch einmal.',
      atUnchecked:
        'Gelesen aus den Stellen 5 bis 9. Ihre Seite nennt die Bank, wenn das Verzeichnis der Oesterreichischen Nationalbank den Code führt.',
      chAllocated: 'Steht im SIX BankMaster (gültig ab {asOf}). Ihre Seite nennt die Bank und ihren BIC.',
      chMissing:
        'Steht nicht im SIX BankMaster (gültig ab {asOf}): Kein Institut führt diese IID. Prüfen Sie die IBAN noch einmal.',
    },
    checksum: {
      pass: 'Prüfziffer {cd}: passt. Die IBAN hat keinen Tippfehler, den die Modulo-97-Prüfung erkennt.',
      fail: 'Prüfziffer {cd}: passt nicht zum Rest. Irgendwo steckt ein Tippfehler, vielleicht in der Bankleitzahl selbst.',
      incomplete: 'Prüfziffer {cd}: wird geprüft, sobald die IBAN vollständig ist ({length} Zeichen).',
    },
    bareBlz: 'Acht Ziffern ohne Ländercode: als deutsche Bankleitzahl gelesen.',
    open: 'Seite der {code} öffnen',
    openSuccessor: 'Nachfolger {successor} öffnen',
    errors: {
      characters: 'Eine IBAN besteht nur aus Buchstaben und Ziffern, und nach dem Ländercode folgen zwei Ziffern.',
      country: 'Beginnen Sie mit den zwei Buchstaben des Landes (DE, AT, CH oder LI), oder tippen Sie die acht Ziffern einer Bankleitzahl.',
      tooLong: 'Länger als eine IBAN aus {country} ({length} Zeichen): Prüfen Sie, was eingefügt wurde.',
    },
    unsupported:
      '{country}: Dieses Feld liest IBANs aus Deutschland, Österreich, der Schweiz und Liechtenstein. Für andere Länder prüft die Sandbox eine IBAN mit der API; die IBAN wird dann an die API gesendet.',
    unsupportedLink: 'Zur Sandbox',
  },
  anatomy: {
    heading: 'So ist eine deutsche IBAN aufgebaut',
    intro: 'Immer 22 Zeichen, immer in dieser Reihenfolge. Das Beispiel ist die Muster-IBAN, die in vielen Anleitungen steht.',
    parts: {
      country: { label: 'Ländercode', note: 'DE für Deutschland' },
      check: { label: 'Prüfziffer', note: 'Keine Bank: berechnet aus allen anderen Zeichen' },
      bank: { label: 'Bankleitzahl', note: 'Die Bank: hier Commerzbank, Köln' },
      account: { label: 'Kontonummer', note: 'Zehn Stellen, vorne mit Nullen aufgefüllt' },
    },
  },
  trap: {
    heading: 'Warum „DE55“ keine Bank ist',
    paragraphs: [
      'Viele suchen nach „DE55 welche Bank“ oder „DE87 welche Bank“. Die Ziffern nach DE sind aber die Prüfziffer nach ISO 13616: Sie werden mit dem Verfahren Modulo 97 aus allen übrigen Zeichen der IBAN berechnet. Ändert sich ein einziges Zeichen, passt die Prüfziffer nicht mehr, und die IBAN fällt als fehlerhaft auf.',
      'Deshalb kann hinter DE55 jede Bank stehen, genauso wie hinter jeder anderen Prüfziffer. Zwei Kunden derselben Bank haben fast immer verschiedene Prüfziffern, weil ihre Kontonummern verschieden sind.',
      'Die Bank erkennen Sie an der Bankleitzahl: den acht Ziffern ab Stelle 5. Die Deutsche Bundesbank vergibt diese Codes und veröffentlicht sie in der Bankleitzahlendatei, zusammen mit dem Namen der Bank, dem Ort und dem BIC.',
    ],
  },
  countries: {
    heading: 'Österreich, Schweiz, Liechtenstein',
    intro: 'Dieselbe Idee, andere Längen. Das Feld oben liest alle vier Länder.',
    cols: { country: 'Land', length: 'Länge', position: 'Code der Bank', code: 'Name', register: 'Register' },
    rows: [
      { cc: 'DE', country: 'Deutschland', code: 'Bankleitzahl', register: 'Deutsche Bundesbank' },
      { cc: 'AT', country: 'Österreich', code: 'Bankleitzahl', register: 'Oesterreichische Nationalbank' },
      { cc: 'CH', country: 'Schweiz', code: 'IID (Clearing-Nummer)', register: 'SIX BankMaster' },
      { cc: 'LI', country: 'Liechtenstein', code: 'IID (Clearing-Nummer)', register: 'SIX BankMaster' },
    ],
    positions: 'Stellen {from} bis {to}',
  },
  tells: {
    heading: 'Was die Bankleitzahl verrät, und was nicht',
    yes: [
      'Welche Bank das Konto führt, mit Ort und BIC, so wie das Register sie nennt.',
      'Ob der Code vergeben ist. Ein Code, den die Bundesbank nicht führt, gehört keiner Bank.',
    ],
    no: [
      'Ob das Konto existiert oder offen ist. Das weiß nur die Bank des Empfängers.',
      'Wem das Konto gehört. Den Namen gleichen die Banken beim Überweisen ab (Empfängerüberprüfung, Verification of Payee).',
    ],
  },
  developers: {
    heading: 'Aus einer Software prüfen',
    body: 'Wer viele IBANs prüfen muss, etwa in einer Kundendatenbank oder vor einem Zahlungslauf, ruft dasselbe Register über die API ab: Prüfziffer, Bank, BIC, das Urteil des Registers mit Quelle und Stand, in einer JSON-Antwort.',
    api: 'IBAN prüfen per API',
    sandbox: 'In der Sandbox ausprobieren',
    article: 'Beispiel in Python und JavaScript',
  },
  sources: {
    de: 'Quelle: Deutsche Bundesbank, Bankleitzahlendatei, Stand {asOf}.',
    ch: 'Quelle: SIX BankMaster, gültig ab {asOf}.',
    at: 'Österreich: Das Feld liest nur die Stellen 5 bis 9; die Seite eines Codes fragt das Register erst beim Öffnen ab.',
  },
};
