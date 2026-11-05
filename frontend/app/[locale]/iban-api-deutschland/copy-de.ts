import type { GermanApiCopy } from './copy';

export const COPY_DE: GermanApiCopy = {
  meta: {
    title: 'IBAN-API für Deutschland: Bundesbank-Register, Bank und BIC',
    description:
      'Welche API prüft deutsche IBANs und nennt Bank und BIC? IBANforge liest die Bankleitzahlendatei der Bundesbank. Mit echten Antworten, VoP und einem Vergleich.',
    ogLocale: 'de_DE',
  },
  breadcrumbHome: 'Startseite',
  hero: {
    eyebrow: 'Deutschland · Bundesbank · SEPA',
    h1: 'Welche API prüft deutsche IBANs und nennt Bank und BIC?',
    answer:
      'IBANforge prüft eine deutsche IBAN in einem Aufruf gegen die Bankleitzahlendatei der Deutschen Bundesbank (Stand {asOf}): Aufbau und Prüfziffer, die Bankleitzahl im Register, die Prüfziffer der Kontonummer nach der Methode der Bundesbank, dazu Bank und BIC aus derselben Datei. Fehlt die Bankleitzahl im Register, lautet die Antwort not_allocated mit authoritative: true, denn dann führt keine Bank diesen Code.',
    limit:
      'Den Namen des Kontoinhabers gleicht die API nicht ab, und sie sagt nicht, ob das Konto existiert. Der Namensabgleich ist die Empfängerüberprüfung der Banken.',
    interest: 'Wir verkaufen IBANforge. Der Vergleich weiter unten sagt auch, wann ein anderer Anbieter die bessere Wahl ist.',
    tryIt: 'In der Sandbox ausprobieren',
    compare: 'Zum Vergleich',
  },
  need: {
    heading: 'Was eine API für eine deutsche IBAN leisten muss',
    intro:
      'Eine richtige Prüfziffer beweist nur, dass die Zeichen zueinander passen. Eine brauchbare Prüfung beantwortet auch die folgenden Fragen und sagt bei jeder Antwort, woher sie stammt.',
    cols: { check: 'Die Frage', source: 'Woher die Antwort kommt', field: 'Feld in der Antwort' },
    rows: [
      {
        check: 'Ist die IBAN richtig aufgebaut?',
        source: 'ISO 13616: 22 Zeichen, Prüfziffer nach Modulo 97',
        field: 'valid',
      },
      {
        check: 'Ist die Bankleitzahl vergeben?',
        source: 'Bankleitzahlendatei der Bundesbank',
        field: 'bank_code_check',
      },
      {
        check: 'Passt die Prüfziffer der Kontonummer?',
        source: 'Die Methode, die die Bundesbank der Bankleitzahl zuordnet',
        field: 'national_check_digits',
      },
      {
        check: 'Welche Bank, welcher BIC?',
        source: 'Derselbe Eintrag der Bankleitzahlendatei',
        field: 'bank_code_check.institution, bic',
      },
      {
        check: 'Welche SEPA-Verfahren, welcher VoP-Status der Bank?',
        source: 'Register des European Payments Council, sonst das Land (die Antwort sagt, welches)',
        field: 'sepa',
      },
    ],
  },
  bundesbank: {
    heading: 'Was wir bei der Bundesbank lesen',
    items: [
      {
        title: 'Die Bankleitzahlendatei, mit Ausgabe',
        body: 'Die Bundesbank vergibt die Bankleitzahlen und veröffentlicht die Datei jeden Monat. Gelesen wird die Ausgabe {asOf}: {count} Bankleitzahlen, {retired} davon zur Löschung vorgemerkt. Jede Antwort nennt ihre Ausgabe in as_of.',
      },
      {
        title: 'Ein fehlender Code hat Gewicht',
        body: 'Weil die Bundesbank selbst vergibt, ist ein Fehlen eine Tatsache über Deutschland und nicht über unsere Daten: status not_in_register, reason not_allocated, authoritative true. Wo wir kein vollständiges Register lesen, heißt derselbe Fehltreffer absent_from_reference_data und schließt nichts aus.',
      },
      {
        title: 'Die Prüfziffer der Kontonummer',
        body: 'Die Datei ordnet jeder Bankleitzahl eine Prüfzifferberechnungsmethode zu. Die Antwort nennt sie in national_check_digits.method, mit Ergebnis und Quelle. Eine falsche Prüfziffer macht valid nie falsch. Bei einer Methode, die die Bundesbank ohne Testkontonummern veröffentlicht, ist sie nur eine Warnung, und eine Methode, die wir nicht belastbar prüfen können, bleibt not_checked.',
      },
      {
        title: 'Der BIC und seine Quelle',
        body: 'Die Datei führt den BIC neben der Bankleitzahl. bic.source nennt die Datei, und bic.basis: national_register sagt, dass der BIC dort gelesen und nicht vermutet wurde.',
      },
      {
        title: 'Codes, die enden',
        body: 'Merkt die Bundesbank eine Bankleitzahl zur Löschung vor, trägt die Antwort retired: true und, wenn das Register einen Nachfolger nennt, superseded_by. Eine Formatprüfung sieht das nicht.',
      },
    ],
    credit: 'Quelle: Deutsche Bundesbank, Bankleitzahlendatei, Stand {asOf}.',
  },
  examples: {
    heading: 'Zwei Antworten',
    intro:
      'Diese Werte sind nicht von Hand getippt: Beim Erstellen der Seite werden sie aus der Bundesbank-Ausgabe {asOf} gelesen.',
    allocatedTitle: 'Eine vergebene Bankleitzahl',
    allocatedNote:
      'DE89 3704 0044 0532 0130 00 ist die Muster-IBAN aus vielen Anleitungen. Die Bankleitzahl 37040044 gehört der Commerzbank, und der BIC stammt aus derselben Datei. Über das Konto selbst sagt das nichts.',
    missingTitle: 'Eine Bankleitzahl, die niemand führt',
    missingNote:
      'Die Prüfziffer dieser IBAN stimmt, darum bleibt valid wahr. Erst das Register zeigt, dass die Bundesbank 99999999 nicht vergeben hat. next_steps übersetzt das in eine Handlung, auf die eine Software verzweigen kann.',
    curlTitle: 'Selbst aufrufen, ohne Schlüssel',
    curlNote: 'Für den Betrieb nehmen Sie einen Schlüssel.',
    keyLink: 'Preise und Kontingente',
    extract: 'Auszug aus der Antwort',
  },
  vop: {
    heading: 'Empfängerüberprüfung (VoP): was Pflicht ist, und was wir dazu sagen',
    what: {
      title: 'Was das ist',
      body: 'Vor einer Überweisung wird der eingegebene Empfängername mit dem Namen abgeglichen, der zur IBAN gehört. Das gilt für SEPA-Überweisungen und SEPA-Echtzeitüberweisungen zwischen Zahlungskonten. Die Grundlage ist Artikel 5c der SEPA-Verordnung, eingefügt durch die Verordnung (EU) 2024/886.',
    },
    duty: {
      title: 'Wen die Pflicht trifft',
      body: 'Die Zahlungsdienstleister im Euroraum, seit dem 9. Oktober 2025: Die Bank des Zahlers fragt, die Bank des Empfängers antwortet. Ein Unternehmen, das Überweisungen als Bündel einreicht, muss die Möglichkeit haben, darauf zu verzichten. Diese Seite ist keine Rechtsberatung.',
    },
    says: {
      title: 'Was IBANforge dazu sagt',
      body: 'Ob die ermittelte Bank im VoP-Register des European Payments Council steht: sepa.vop_participant und sepa.vop_register_status, mit register_source und register_as_of, wenn das Register für diese Bank gelesen wurde. Das ist eine Angabe über die Bank, nicht über das Konto.',
    },
    not: {
      title: 'Was IBANforge nicht tut',
      body: 'Keinen Namen abgleichen. Die API antwortet nie mit Match oder No Match und ersetzt die Prüfung Ihrer Bank nicht. Ein false oder null bei den VoP-Feldern ist kein Ergebnis über einen Namen.',
    },
    sourcesTitle: 'Quellen',
    readOn: 'gelesen am {date}',
    sources: [
      {
        label: 'BaFin: Empfängerüberprüfung bei Überweisungen',
        url: 'https://www.bafin.de/DE/verbraucherinnen-verbraucher/themen-finanzprodukte/konten-zahlungen/zahlungen/ueberweisungen-und-lastschriften/empfaengerueberpruefung/empfaengerueberpruefung.html',
        read: 'authorities',
      },
      {
        label: 'BaFin: Fragen und Antworten zur Verordnung über Echtzeitüberweisungen',
        url: 'https://www.bafin.de/SharedDocs/Fragen-antworten/DE/faq-voechtzeitueberweisungen/faq-voechtzeitueberweisungen_node.html',
        read: 'authorities',
      },
      {
        label: 'Deutsche Bundesbank: Fragen und Antworten zu Echtzeitüberweisungen und Empfängerüberprüfung',
        url: 'https://www.bundesbank.de/dynamic/action/de/aufgaben/unbarer-zahlungsverkehr/veroeffentlichungen/fragen-und-antworten-zu-echtzeitueberweisungen-und-empfaengerueberpruefung/963980/fragen-und-antworten-zu-echtzeitueberweisungen-und-empfaengerueberpruefung-',
        read: 'authorities',
      },
      {
        label: 'Verordnung (EU) 2024/886, EUR-Lex',
        url: 'https://eur-lex.europa.eu/legal-content/DE/TXT/?uri=CELEX:32024R0886',
        read: 'regulation',
      },
    ],
    docsLink: 'Die VoP-Felder im Einzelnen',
  },
  comparison: {
    heading: 'Der Vergleich für deutsche IBANs',
    interest:
      'Wir verkaufen IBANforge; lesen Sie diesen Vergleich mit diesem Wissen. Jede Angabe zu einem anderen Anbieter stammt von dessen öffentlichen Seiten, gelesen am {readOn}. Was wir nicht geprüft haben, steht auch so da. Ist etwas falsch oder hat sich ein Preis geändert, schreiben Sie an support@ibanforge.com.',
    bankCode: 'Bankcode im nationalen Register',
    prices: 'Rechnung, Preise gelesen am {readOn}',
    ourPrices: 'Preise',
    libsName: 'Open-Source-Bibliotheken',
    libsBetter: 'Wann eine Bibliothek die bessere Wahl ist',
    vendorLink: 'Der ganze Vergleich mit {name}',
    ourLink: 'Alle Preise',
    tableLink: 'Alle Anbieter in einer Tabelle',
  },
  europe: {
    heading: 'Für ganz Europa dieselbe Logik',
    full: 'Vollständig gelesen werden die Register von Deutschland, Österreich, Belgien, der Slowakei, Tschechien, Bulgarien, der Schweiz und Liechtenstein. Dort kommt ein fehlender Code als not_allocated zurück.',
    elsewhere:
      'In den übrigen der {countries} IBAN-Länder nennt ein Teilregister oder eine zusammengesetzte Tabelle die Bank, und die Antwort sagt, dass sie einen Code nicht ausschließen kann. Eine Sammelprüfung nimmt bis zu 100 IBANs je Aufruf.',
    link: 'IBAN-Formate und Register nach Land',
  },
  next: {
    heading: 'Weiterlesen',
    finder: 'Welche Bank gehört zu dieser IBAN? Ohne Code, im Browser',
    register: 'Jede Bankleitzahl auf ihrer eigenen Seite',
    docs: 'BLZ-Prüfung in der Dokumentation',
    article: 'Beispiel in Python und JavaScript',
    alternatives: 'Alternativen, eine Seite pro Anbieter',
  },
};
