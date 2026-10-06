import type { ApiPageCopy } from "./copy";

// Ein Satz pro Zeile, wo eine Zahl steht: die Prosa-Wächter des API-Repositorys
// lesen diese Datei Zeile für Zeile und Satz für Satz.
export const COPY_DE: ApiPageCopy = {
  meta: {
    title: "IBAN prüfen per API: Bank, BIC und Bankleitzahl",
    description:
      "IBAN prüfen per API in Ihrer Software: Prüfziffer, Länderstruktur, Bank und BIC aus den nationalen Registern mit Quelle und Stand, SEPA. Ohne Schlüssel testen.",
    ogLocale: "de_DE",
  },
  breadcrumbHome: "Startseite",
  hero: {
    eyebrow: "REST-API · JSON · MCP",
    h1: "IBAN prüfen per API",
    lead:
      "Ein einziger POST prüft eine IBAN so, wie ein Zahlungslauf es braucht: Prüfziffer und Länderstruktur, dann die Bank dahinter, gelesen im nationalen Register, mit Quelle und Stand.",
    facts: ["{countries} IBAN-Länder", "Bank und BIC mit Quelle", "Erste Aufrufe ohne Schlüssel"],
    ctaKey: "Kostenlosen API-Schlüssel holen",
    ctaSandbox: "In der Sandbox testen",
    ctaDocs: "Zur Dokumentation",
  },
  checks: {
    heading: "Was ein Aufruf prüft",
    intro:
      "POST /v1/iban/validate antwortet mit einem einzigen JSON-Objekt. Jede Prüfung hat ihr eigenes Feld: Ihr Code liest genau, was geprüft wurde und was nicht.",
    items: [
      {
        title: "Prüfziffer",
        field: "checks.iban_checksum",
        body: "Die Modulo-97-Prüfung nach ISO 13616 über die zwei Ziffern nach dem Ländercode. Ein einziges falsch getipptes Zeichen lässt sie scheitern.",
      },
      {
        title: "Länderstruktur",
        field: "checks.iban_structure",
        body: "Länge und Aufbau des Kontoteils für jedes der {countries} Länder des IBAN-Registers. Eine ungültige IBAN ist kein HTTP-Fehler: Die Antwort ist ein 200 mit valid: false und dem Grund.",
      },
      {
        title: "Nationale Prüfziffern",
        field: "checks.national_check_digits",
        body: "Wo ein Land seinen eigenen Schlüssel in der Kontonummer versteckt: Frankreich und Monaco (RIB-Schlüssel), Belgien, Italien und San Marino (CIN), Spanien (DC), Deutschland (die Prüfziffer der Kontonummer, nach der Methode, die die Bundesbank jeder Bankleitzahl zuordnet) und das Vereinigte Königreich (Modulus-Prüfung). Ein falscher Schlüssel steht in diesem Feld und macht valid nie falsch. In Polen kommt die Prüfziffer der Abrechnungsnummer mit der Bankleitzahl, in bank_code_check.check_digit.",
      },
      {
        title: "Die Bank und ihr BIC",
        field: "bank_code_check · bic.source · as_of",
        body: "Die Bankleitzahl wird im nationalen Register nachgeschlagen, wo wir es vollständig lesen: Deutschland, Österreich, Belgien, Slowakei, Tschechien, Bulgarien, Schweiz und Liechtenstein. Dort kommt ein Code, den das Register nicht führt, als not_allocated zurück. Anderswo nennt ein Teilregister oder eine zusammengesetzte Tabelle die Bank, und die Antwort sagt, dass sie einen Code nicht ausschließen kann. Register und Stand der Ausgabe stehen in der Antwort.",
      },
      {
        title: "SEPA und Empfängerüberprüfung",
        field: "sepa · risk_indicators.vop_coverage",
        body: "Die SEPA-Verfahren, die die Bank erreichen (Überweisung, Echtzeitüberweisung, Lastschrift), aus den Registern des EPC, wenn sie die Bank führen, sonst aus dem Land, mit genannter Grundlage. Und ob das EPC-Register der Empfängerüberprüfung (VoP) die Bank als bereit führt.",
      },
      {
        title: "Prüfung der Bank, auf Wunsch",
        field: "POST /v1/iban/compliance",
        body: "Ein eigener Aufruf gleicht die Bank des Empfängers (BIC8) mit den Listen von OFAC, EU und UN ab, prüft das Land gegen die FATF und eine feste Liste sanktionierter Länder und liefert einen Risikowert von 0 bis 100. Er dient der Information und prüft nie den Namen des Empfängers.",
      },
    ],
  },
  notDo: {
    heading: "Was sie Ihnen nicht sagt",
    items: [
      "Ob das Konto existiert oder offen ist. Kein Register veröffentlicht das: Nur die Bank des Empfängers weiß es.",
      "Auf wessen Namen das Konto läuft. Das ist die Empfängerüberprüfung, durchgeführt von der Bank des Empfängers; die API sagt nur, ob diese Bank dafür als bereit geführt wird.",
      "Ob der Empfänger sanktioniert ist. Die optionale Prüfung betrifft die Bank und das Land, nicht die Person oder das Unternehmen, das Sie bezahlen.",
      "Die nationalen Schlüssel der oben nicht genannten Länder: Sie werden noch nicht geprüft. In Deutschland liefert eine Methode, die die Bundesbank ohne Testkontonummern veröffentlicht, eine Warnung, nie eine Ablehnung.",
    ],
    sources: "Jedes Register, seine Lizenz und der Stand der Ausgabe, die wir lesen",
  },
  firstCall: {
    heading: "Ihr erster Aufruf",
    intro:
      "Kopieren Sie einen dieser Blöcke unverändert. Die IBAN ist das Beispiel der Sandbox: eine gültige Schweizer IBAN, die zu einer echten Bank führt.",
    trial:
      "Die Kostprobe ohne Schlüssel beantwortet 25 Prüfungen pro Woche auf POST /v1/iban/validate, gezählt für die Adresse, von der der Aufruf kommt, ISO-Woche in UTC, Neustart am Montag um 00:00 UTC.",
    tabsLabel: "Derselbe Aufruf in drei Sprachen",
    answerHeading: "Die Antwort, wie die API sie gegeben hat",
    answerCaption:
      "Auszug aus der Antwort der API auf diese IBAN vom {date}: die Felder, die sagen, was geprüft wurde und in welchem Register. Die vollständige Antwort enthält außerdem den Herausgeber, die Schweizer Clearing-Daten, Risikoindikatoren und den empfohlenen nächsten Schritt. Ohne Schlüssel aufgerufen, enthält sie zusätzlich einen trial-Block, der sagt, wie viele Aufrufe in dieser Woche bleiben und wann der Zähler neu beginnt.",
    withKey:
      "Nach der Kostprobe ohne Schlüssel senden Sie dieselbe Anfrage mit dem Header Authorization: Bearer ifk_… und Ihrem Schlüssel.",
  },
  mod97: {
    heading: "Warum eine Modulo-97-Prüfung nicht reicht",
    body:
      "Das offizielle Schweizer Beispiel des IBAN-Registers, CH93 0076 2011 6238 5295 7, hat eine korrekte Prüfziffer. Seine Bankleitzahl ist im SIX BankMaster niemandem zugeteilt, und die API sagt es:",
    caption: "Antwort der API auf diese IBAN, exportiert am {date}.",
  },
  doors: {
    heading: "Kostenlos starten, dann nach Nutzung zahlen",
    intro: "Drei kostenlose Zugänge, jeder mit eigenem Kontingent. Keiner verlangt eine Karte.",
    trial: {
      tag: "Ohne Schlüssel",
      title: "Die Kostprobe",
      body: "25 Prüfungen pro Woche auf POST /v1/iban/validate, als Kostprobe ohne Schlüssel für die Adresse, von der der Aufruf kommt. Neustart am Montag um 00:00 UTC.",
    },
    anonymous: {
      tag: "Schlüssel, ohne E-Mail",
      title: "Ein Schlüssel mit einem Klick",
      body: "25 Anfragen pro Monat, auf allen Endpunkten. Ein leerer POST an /v1/keys/generate oder der Knopf unten: ohne E-Mail, ohne Karte.",
    },
    claimed: {
      tag: "Schlüssel, mit Adresse",
      title: "200 Anfragen pro Monat",
      body: "Beanspruchen Sie denselben Schlüssel mit einem sechsstelligen Code, der an eine Adresse geht, die Sie lesen, oder geben Sie die Adresse beim Erstellen an. Derselbe Schlüssel, dasselbe Präfix, ohne Karte.",
    },
    keyCta: "Kostenlosen Schlüssel holen",
    paidHeading: "Wenn Sie mehr brauchen",
    paid: [
      "Pro: 29 $ im Monat für 10.000 Anfragen, Zurücksetzung am 1., jederzeit kündbar.",
      "Guthabenpakete, die nie verfallen, per Karte oder in USDC: 1.000 Credits für 4 $, 5.000 für 20 $, 25.000 für 80 $.",
      "x402: Bezahlung pro Aufruf in USDC auf Base, ganz ohne Konto, 0,005 $ pro Prüfung und 0,002 $ pro IBAN in einem Stapel.",
    ],
    pricingLink: "Alle Preise und der Kostenrechner",
  },
  tools: {
    heading: "Alles rund um die API",
    links: [
      { href: "/playground", title: "Sandbox", body: "Die echte API im Browser, mit Beispiel-IBANs aus mehreren Ländern." },
      { href: "/docs/onboarding", title: "Erste Schritte", body: "Vom Aufruf ohne Schlüssel bis zum Stapel von 100 IBANs, jeder Block der Antwort mit seinem echten Namen." },
      { href: "/docs/iban-validate", title: "Endpunkt-Referenz", body: "POST /v1/iban/validate, Feld für Feld, mit den Fehlercodes." },
      { href: "/openapi", title: "OpenAPI 3.1", body: "Der Vertrag, um einen Client zu erzeugen oder ihn in Postman zu importieren." },
      { href: "https://www.npmjs.com/package/@ibanforge/sdk", title: "npm: @ibanforge/sdk", body: "Das SDK für TypeScript und JavaScript." },
      { href: "https://pypi.org/project/ibanforge/", title: "PyPI: ibanforge", body: "Das Python-SDK, synchroner und asynchroner Client." },
      { href: "/docs/mcp", title: "MCP-Server", body: "ibanforge-mcp für Claude, Cursor und andere MCP-Clients, oder der gehostete Endpunkt." },
      { href: "https://www.npmjs.com/package/n8n-nodes-ibanforge", title: "n8n", body: "Der Community-Node für selbst gehostetes n8n." },
      { href: "/alternatives", title: "Alternativen", body: "IBANAPI, iban.com und AbstractAPI neben IBANforge, mit Preisen und Datum." },
    ],
  },
  closing: {
    heading: "Testen Sie sie mit Ihren eigenen IBANs",
    body: "Die Sandbox ruft die echte API auf. Wenn Sie so weit sind, holen Sie sich einen Schlüssel: ohne E-Mail, ohne Karte.",
  },
};
