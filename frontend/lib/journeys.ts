export type Journey = "api" | "audit";

/** Première sélection par besoin ; les autres pages conservent leurs actions. */
export const JOURNEY_PAGES: ReadonlyArray<{ path: string; primary: Journey }> = [
  { path: "/compare", primary: "api" },
  { path: "/agents", primary: "api" },
  { path: "/docs/iban-validate", primary: "api" },
  { path: "/docs/iban-to-bic", primary: "api" },
  { path: "/docs/bic-lookup", primary: "api" },
  { path: "/docs/iban-batch", primary: "audit" },
  { path: "/docs/recipes", primary: "api" },
  { path: "/docs/structured-addresses", primary: "audit" },
  { path: "/blog/2026-08-26-choosing-an-iban-validation-api", primary: "api" },
  { path: "/blog/2026-08-26-bic-swift-lookup-done-right", primary: "api" },
  { path: "/blog/2026-09-02-missing-bank-details-before-an-erp-migration", primary: "audit" },
  { path: "/blog/2026-09-04-what-changes-in-bank-registers-each-month", primary: "audit" },
  { path: "/blog/2026-09-06-creditor-file-checks-before-14-november", primary: "audit" },
  { path: "/blog/2026-09-02-which-date-structured-addresses", primary: "audit" },
  { path: "/blog/2026-09-02-german-iban-validation-bundesbank-blz", primary: "api" },
  { path: "/iban/de", primary: "api" },
  { path: "/iban/fr", primary: "api" },
  { path: "/iban/ae", primary: "api" },
  { path: "/blz/37040044", primary: "api" },
  { path: "/be/000", primary: "api" },
];

export function journeyFor(path: string): Journey | undefined {
  return JOURNEY_PAGES.find((page) => page.path === path)?.primary;
}

export const JOURNEY_LINKS = {
  api: { path: "/vendors", event: "cta:journey-api" },
  audit: { path: "/audit", event: "cta:journey-audit" },
} as const;

type JourneyCopy = {
  heading: string;
  intro: string;
  note: string;
  api: { title: string; body: string; action: string };
  audit: { title: string; body: string; action: string };
};

/** Textes rendus côté serveur : aucun catalogue supplémentaire dans le navigateur. */
const COPY: Record<"en" | "fr" | "de", JourneyCopy> = {
  en: {
    heading: "Put these checks to work",
    intro: "Choose a first step for your software or your supplier file.",
    note: "Available bank information varies by country and source. These checks do not confirm the account holder or guarantee that a payment will succeed.",
    api: {
      title: "Integrate IBAN checks into your software",
      body: "Try a validation, inspect the response, then connect your application through the API or an existing integration.",
      action: "Explore the API workflow",
    },
    audit: {
      title: "Check a supplier file",
      body: "Upload a CSV or Excel file and preview the findings for free. Purchase the annotated workbook if you need the full report. No account or subscription required.",
      action: "Explore the file audit",
    },
  },
  fr: {
    heading: "Passez à votre cas concret",
    intro: "Choisissez une première étape pour votre logiciel ou votre fichier fournisseurs.",
    note: "Les informations bancaires disponibles varient selon le pays et la source. Ces contrôles ne confirment pas le titulaire du compte et ne garantissent pas la réussite d’un paiement.",
    api: {
      title: "Intégrer les contrôles IBAN à votre logiciel",
      body: "Essayez une validation, examinez la réponse, puis reliez votre application à l’API ou à une intégration existante.",
      action: "Découvrir le parcours API",
    },
    audit: {
      title: "Contrôler un fichier fournisseurs",
      body: "Déposez un CSV ou un fichier Excel et consultez gratuitement l’aperçu des constats. Achetez le classeur annoté si vous avez besoin du rapport complet. Sans compte ni abonnement.",
      action: "Découvrir l’audit de fichiers",
    },
  },
  de: {
    heading: "Nutzen Sie die Prüfungen für Ihren Anwendungsfall",
    intro: "Wählen Sie den ersten Schritt für Ihre Software oder Ihre Lieferantendatei.",
    note: "Die verfügbaren Bankinformationen hängen von Land und Quelle ab. Diese Prüfungen bestätigen weder den Kontoinhaber noch die erfolgreiche Ausführung einer Zahlung.",
    api: {
      title: "IBAN-Prüfungen in Ihre Software integrieren",
      body: "Testen Sie eine Validierung, sehen Sie sich die Antwort an und verbinden Sie Ihre Anwendung über die API oder eine vorhandene Integration.",
      action: "API-Ablauf ansehen",
    },
    audit: {
      title: "Eine Lieferantendatei prüfen",
      body: "Laden Sie eine CSV- oder Excel-Datei hoch und sehen Sie die Ergebnisse kostenlos in der Vorschau. Bei Bedarf kaufen Sie die kommentierte Arbeitsmappe. Ohne Konto oder Abonnement.",
      action: "Dateiprüfung kennenlernen",
    },
  },
};

export function journeyCopy(locale: string): JourneyCopy {
  return COPY[locale as keyof typeof COPY] ?? COPY.en;
}
