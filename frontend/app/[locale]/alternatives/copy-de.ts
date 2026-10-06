import type { AlternativesCopy } from './copy';

// Ein Satz pro Zeile, wo eine Zahl steht: die Textwächter des API-Repositorys
// lesen diese Datei Zeile für Zeile und Satz für Satz.
export const COPY_DE: AlternativesCopy = {
  ogLocale: 'de_DE',
  breadcrumbHome: 'Startseite',
  breadcrumbIndex: 'Alternativen',
  eyebrow: 'Im Vergleich',
  disclosure:
    'Wir verkaufen IBANforge; lesen Sie diese Seite mit diesem Wissen. Jede Angabe zu {name} stammt von dessen öffentlichen Seiten, gelesen am {readOn} und unten verlinkt. Ist etwas falsch oder hat sich ein Preis geändert, schreiben Sie an support@ibanforge.com, und wir korrigieren es.',
  labels: {
    strengths: 'Was {name} gut macht',
    theirPrices: 'Preise von {name}',
    readOn: 'So wie seine Seiten sie am {readOn} zeigten.',
    ourPricesNote: 'Aktuelle Preise, dieselben wie auf der Preisseite.',
    allPrices: 'Alle Preise und der Kostenrechner',
    calculation: 'Rechnung',
    betterFor: 'Wann {name} die bessere Wahl ist',
    sources: 'Quellen, gelesen am {readOn}',
    next: 'Weiterlesen',
    compare: 'Vollständiger Vergleich',
    compareBody: 'IBANforge, AbstractAPI, iban.com, IBANAPI und Open-Source-Bibliotheken in einer Tabelle.',
    api: 'IBAN prüfen per API',
    apiBody: 'Was ein Aufruf prüft, und der erste Aufruf in curl, Python und JavaScript.',
    sandbox: 'Sandbox',
    sandboxBody: 'Die echte API in Ihrem Browser, mit Beispiel-IBANs.',
  },
  ours: {
    heading: 'Was IBANforge anders macht',
    items: [
      'Die Bankleitzahl wird im nationalen Register geprüft, wo wir es vollständig lesen: Deutschland (Deutsche Bundesbank, Stand {deAsOf}), Schweiz und Liechtenstein (SIX BankMaster, gültig ab {chAsOf}), Österreich, Belgien, die Slowakei, Tschechien und Bulgarien. Dort kommt ein Code, den das Register nicht führt, als not_allocated zurück, mit authoritative: true.',
      'Jede Antwort nennt ihre Quellen: das Register hinter dem Urteil über den Bankcode, die Quelle des BIC und den gelesenen Stand (bank_code_check.register, bic.source, as_of).',
      'Nationale Prüfziffern in der Kontonummer, wo ein Land sie hat: Frankreich und Monaco (RIB-Schlüssel), Belgien, Italien und San Marino (CIN), Spanien (DC), Deutschland (die Prüfziffermethode der Bundesbank für jede Bankleitzahl) und das Vereinigte Königreich (Modulus-Prüfung).',
      'Für KI-Agenten gebaut: ein MCP-Server, gehostet oder als Paket ibanforge-mcp, und x402, mit dem ein Agent jeden Aufruf in USDC auf Base bezahlt, ohne Konto.',
      'Eine Kostprobe ohne Schlüssel mit 25 Prüfungen pro Woche auf POST /v1/iban/validate, zum Ausprobieren, bevor Sie einen Schlüssel nehmen.',
    ],
    limitsHeading: 'Was IBANforge nicht macht',
    limits: [
      'Den Namen des Kontoinhabers prüfen. Das ist die Empfängerüberprüfung (Verification of Payee), die die Bank des Empfängers durchführt.',
      'Die nationalen Schlüssel der oben nicht genannten Länder prüfen: noch nicht.',
      'Sagen, ob das Konto existiert oder offen ist. Das veröffentlicht kein Register.',
    ],
    pricesHeading: 'Preise von IBANforge',
    free: [
      'Kostprobe ohne Schlüssel: 25 Prüfungen pro Woche auf POST /v1/iban/validate.',
      'Kostenloser Schlüssel: 200 Anfragen pro Monat, sobald er mit einer E-Mail-Adresse beansprucht ist, auf allen Endpunkten, ohne Karte.',
    ],
    paid: [
      'Pro: 29 $ pro Monat für 10.000 Anfragen, jederzeit kündbar.',
      'Guthabenpakete, die nie verfallen: 1.000 Credits für 4 $, 5.000 für 20 $, 25.000 für 80 $.',
      'x402: 0,005 $ pro Prüfung und 0,002 $ pro IBAN in einem Stapel, in USDC auf Base, ohne Konto.',
    ],
  },
  index: {
    meta: {
      title: 'Alternativen zu IBAN-APIs: IBANAPI, iban.com, AbstractAPI',
      description:
        'Alternativen zu IBANAPI, iban.com und AbstractAPI für die IBAN-Prüfung: was jeder gut macht, was IBANforge anders macht, und beide Preislisten mit Datum.',
    },
    h1: 'Alternativen zu IBAN-Prüf-APIs',
    lead:
      'Eine Seite pro Anbieter, mit dem man uns vergleicht: was er gut macht, was IBANforge anders macht, beide Preislisten mit dem Tag, an dem sie gelesen wurden, und wann der andere die bessere Wahl ist.',
    cardCta: 'Vergleich lesen',
    compareLine: 'Alle in einer Tabelle, mit den Open-Source-Bibliotheken:',
  },
  fromCompare: {
    heading: 'Eine Seite pro Anbieter',
    body: 'IBANAPI, iban.com und AbstractAPI, jeweils neben IBANforge: Stärken, Preise und wann welcher passt.',
  },
  vendors: {
    ibanapi: {
      meta: {
        title: 'IBANAPI-Alternative: Preise und Unterschiede im Vergleich',
        description:
          'Sie suchen eine IBANAPI-Alternative? Was IBANAPI gut macht, was IBANforge anders macht (nationale Register, MCP, x402) und beide Preislisten mit Datum.',
      },
      h1: 'Eine Alternative zu IBANAPI',
      lead:
        'IBANAPI ist eine API zur IBAN-Prüfung mit einem kostenlosen Tarif und einer selbst gehosteten Variante. Wenn Sie sie mit IBANforge vergleichen: Hier steht, was jede macht, mit den Preisen beider.',
      summary: 'Ein kostenloser Tarif, der sich erneuert, eine selbst gehostete Engine, Guthaben mit Laufzeit.',
      strengths: [
        'Ein kostenloser Tarif ohne Kreditkarte: 100 Basis-Credits und 20 Credits für Bankabfragen pro 30 Tage, und der kostenlose Tarif erneuert sich automatisch.',
        'Eine selbst gehostete Variante: IBANAPI gibt an, dass seine Prüf-Engine in Ihrer eigenen Infrastruktur laufen kann, ohne Abrechnung pro Anfrage.',
        'Für einige Länder kündigt IBANAPI eine Prüfung der nationalen Kontonummer selbst an.',
        'IBANAPI nennt 90 Länder, mit Banknamen und BIC aus Registern der Zentralbanken. Es löst den Bankcode der IBAN in seinem eigenen Register auf, gebaut aus Zentralbanken, SEPA-Daten und manueller Prüfung, und liefert den BIC, wo er verfügbar ist.',
      ],
      prices: [
        'Free: 0 $ für 30 Tage, mit 100 Basis-Credits und 20 Credits für Bankabfragen.',
        'Professional: 15 $ für 60 Tage, mit 2.000 Basis-Credits und 400 Credits für Bankabfragen.',
        'Business: 40 $ für 180 Tage, mit 7.000 Basis-Credits und 1.500 Credits für Bankabfragen.',
        'Enterprise: 115 $ für 365 Tage, mit 30.000 Basis-Credits und 5.000 Credits für Bankabfragen.',
        'Jede Prüfung verbraucht 1 Basis-Credit; ein Aufruf, der auch die Bankdaten auflöst, verbraucht zusätzlich 1 Credit für Bankabfragen. Die Credits sind an die Laufzeit des Tarifs gebunden.',
      ],
      calculation:
        'Für 2.000 Prüfungen mit Bankdaten, nach den veröffentlichten Preisen: bei IBANforge 8 $ Guthaben (zwei Pakete zu 1.000), das nie verfällt. Bei IBANAPI ist der kleinste einzelne Tarif mit 2.000 Bankabfragen Enterprise, 115 $ für 365 Tage, mit 5.000 inklusive. Mehrfachkäufe eines kleineren Tarifs werden hier nicht verglichen.',
      betterFor: [
        'Sie wollen die Prüf-Engine in Ihrer eigenen Infrastruktur betreiben.',
        'Sie brauchen die Prüfung der nationalen Kontonummer in Ländern, für die IBANAPI sie ankündigt und IBANforge nicht.',
      ],
      note:
        'Was ein Bankcode bedeutet, der in IBANAPIs Register fehlt (niemandem zugeteilt oder nur nicht erfasst), steht nicht auf den Seiten, die wir gelesen haben.',
    },
    'iban-com': {
      meta: {
        title: 'iban.com-Alternative: Preise von IBAN Suite und Unterschiede',
        description:
          'Sie suchen eine iban.com-Alternative? Was IBAN Suite gut macht (BIC-Daten unter SWIFT-Lizenz, Empfängerüberprüfung), was IBANforge anders macht, Preise mit Datum.',
      },
      h1: 'Eine Alternative zu iban.com',
      lead:
        'iban.com verkauft IBAN Suite, einen Dienst für IBAN-Prüfung und Bankdaten mit Jahreslizenz, und einen eigenen Dienst zur Empfängerüberprüfung. Wenn Sie ihn mit IBANforge vergleichen: Hier steht, was jeder macht, mit den Preisen beider.',
      summary: 'BIC-Daten unter SWIFT-Lizenz, Empfängerüberprüfung, britische Sort Codes, Jahreslizenzen.',
      strengths: [
        'IBAN Suite ermittelt den BIC und die Bankdaten hinter einer IBAN, mit BIC-Daten unter Lizenz von S.W.I.F.T., und nennt SEPA-Erreichbarkeit und unterstützte Verfahren.',
        'Bank Account Verification (BAV), bei iban.com auch Verification of Payee genannt, prüft den Namen des Kontoinhabers und antwortet mit Match, No Match, Close Match oder Unavailable, in 21 aufgeführten Ländern.',
        'SORTware, ein eigener Dienst für britische und irische Sort Codes und Kontonummern.',
        'Veröffentlichte Nutzungsbedingungen, Datenschutzerklärung, AVV (DPA) und SLA, und ein angegebenes Limit von 15 Anfragen pro Sekunde je IP-Adresse und je Schlüssel.',
        'Ein kostenloser Test nach Online-Registrierung: 100 Abfragen, einen Monat aktiv. Lizenzen lassen sich online kaufen oder auf Rechnung über den Vertrieb.',
      ],
      prices: [
        'IBAN Suite, pro Jahr: Professional 530 € für 2.000 Abfragen, Business 1.450 € für 20.000, Corporate 2.350 € für 50.000, Enterprise 4.150 € unbegrenzt.',
        'Lizenzen laufen mindestens ein Jahr, die Mehrwertsteuer ist nicht enthalten.',
        'BAV (Empfängerüberprüfung), pro Paket: 2.500 Prüfungen für 2.000 €, 10.000 für 7.000 €, 20.000 für 12.000 €, 50.000 für 25.000 €.',
        'SORTware: 2.800 € pro Jahr, unbegrenzt.',
      ],
      calculation:
        'Für 2.000 Prüfungen mit Bankdaten, nach den veröffentlichten Preisen: bei IBANforge 8 $ Guthaben (zwei Pakete zu 1.000), das nie verfällt. Bei iban.com enthält die Lizenz Professional 2.000 Abfragen pro Jahr für 530 €, ohne Mehrwertsteuer.',
      betterFor: [
        'Sie müssen den Namen des Kontoinhabers prüfen (Empfängerüberprüfung). IBANforge tut das nicht: Es prüft die Bank hinter der IBAN, nicht die Person.',
        'Sie prüfen britische oder irische Sort Codes und Kontonummern.',
        'Sie wollen BIC-Daten unter SWIFT-Lizenz und einen Jahresvertrag, der auf Rechnung bezahlt werden kann.',
      ],
      note:
        'iban.de, das angibt, dass seine IBAN- und BIC-Dienste von iban.com angetrieben werden, nennt im Impressum die Gesellschaft, die in den Bedingungen von iban.com als Lizenzgeber steht. Es nennt 420 € bis 3.800 € pro Jahr bei einem Jahr Laufzeit und einen kostenlosen Test mit 100 Abfragen, einen Monat aktiv.',
    },
    abstractapi: {
      meta: {
        title: 'AbstractAPI-Alternative für IBANs: Preise und Unterschiede',
        description:
          'Sie suchen eine AbstractAPI-Alternative für die IBAN-Prüfung? Was jede zurückgibt, die Tarife beider mit Datum, und wann AbstractAPI die bessere Wahl bleibt.',
      },
      h1: 'Eine Alternative zu AbstractAPI für IBANs',
      lead:
        'Die IBAN Validation API von AbstractAPI beantwortet, ob eine IBAN gültig ist. Wenn Sie sie mit IBANforge vergleichen: Hier steht, was jede zurückgibt, mit den Tarifen beider.',
      summary: 'Ein Gültigkeits-Boolean, hohe Anfrageraten, ein Enterprise-Tarif mit SLA.',
      strengths: [
        'Eine kurze Antwort, leicht einzubauen: Die dokumentierte Antwort enthält die IBAN und is_valid.',
        'Hohe Anfrageraten: 25 Anfragen pro Sekunde im Tarif Standard, 100 in den höheren Stufen.',
        'Ein Enterprise-Tarif auf Anfrage, dessen Karte ein SLA von 99,99 % Verfügbarkeit nennt.',
        'Ein kostenloser Tarif mit 100 Anfragen, bei 1 Anfrage pro Sekunde.',
      ],
      prices: [
        'Standard, jährlich abgerechnet (die voreingestellte Ansicht): 63 $ pro Monat für 60.000 Anfragen pro Jahr.',
        'Standard, monatlich abgerechnet: 69 $ pro Monat für 5.000 Anfragen pro Monat.',
        'Höhere Stufen: 182 $ pro Monat bei jährlicher Abrechnung für 240.000 Anfragen pro Jahr, oder 199 $ pro Monat für 20.000 pro Monat.',
        'Dann 457 $ pro Monat bei jährlicher Abrechnung für 600.000 Anfragen pro Jahr, oder 499 $ pro Monat für 50.000 pro Monat.',
        'Kostenlos: 100 Anfragen, bei 1 Anfrage pro Sekunde.',
      ],
      calculation:
        'Die beiden Antworten decken nicht dasselbe ab: AbstractAPI dokumentiert in seiner Antwort weder BIC noch Banknamen, IBANforge nennt die Bank und ihren BIC. Nur nach Menge, nach den veröffentlichten Preisen: 5.000 Prüfungen kosten bei AbstractAPI 69 $ für einen Monat (Standard, monatlich abgerechnet) und bei IBANforge 20 $ (ein Paket mit 5.000 Credits, ohne Verfall).',
      betterFor: [
        'Sie müssen nur wissen, ob eine IBAN korrekt aufgebaut ist, bei einer hohen Rate einzelner Aufrufe: Standard nennt 25 Anfragen pro Sekunde. IBANforge nimmt 100 Anfragen pro Minute je IP-Adresse an, mit bis zu 100 IBANs in einem Stapelaufruf.',
        'Sie wollen einen Enterprise-Tarif, dessen Karte ein SLA von 99,99 % Verfügbarkeit nennt.',
      ],
    },
  },
};
