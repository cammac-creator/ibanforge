import { createElement, type ReactNode, type ComponentType, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { AuditSummaryView, type AuditStatus } from "@/components/audit-summary";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";
import de from "@/messages/de.json";

/**
 * Le constat `national_check_digits_failed` de l'audit de fichier (26/09/2026) :
 * l'API le sert par son code, le résumé le traduit. Un code absent de `KNOWN`
 * ou des messages s'afficherait brut (« national_check_digits_failed ») devant un
 * client qui paie : ce test le rend dans les trois langues.
 */
const messages = { fr, en, de };
const Provider = NextIntlClientProvider as ComponentType<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>;
const render = (node: ReactNode, locale: keyof typeof messages) =>
  renderToStaticMarkup(
    createElement(
      Provider,
      { locale, messages: messages[locale], timeZone: "UTC", now: new Date("2026-01-01T12:00:00Z") },
      node,
    ),
  );

const fixture: AuditStatus = {
  job: "exemple-fictif",
  rows: 2,
  tier: "standard",
  price: 149,
  currency: "USD",
  lang: "fr",
  paid: false,
  paid_at: null,
  expires_at: "2026-12-01",
  summary: {
    rows: 2,
    ok: 0,
    warning: 0,
    error: 2,
    by_code: { national_check_digits_failed: 1, modulus_check_failed: 1 },
    countries: [],
    columns_detected: ["IBAN"],
    address_checked: false,
  },
  preview: [
    { line: 2, iban_masked: "FR96 **** 2606", status: "error", findings: ["national_check_digits_failed"], bank_name: "Banque fictive" },
    { line: 3, iban_masked: "GB00 **** 0000", status: "error", findings: ["modulus_check_failed"], bank_name: "Banque fictive" },
  ],
  download: null,
};

describe("le résumé d'audit nomme la clé nationale fausse", () => {
  it.each(["fr", "en", "de"] as const)("en %s, par son libellé, jamais par son code", (locale) => {
    const html = render(createElement(AuditSummaryView, { status: fixture, masked: true }), locale);
    const label = messages[locale].audit.findings.national_check_digits_failed;
    expect(label.length).toBeGreaterThan(5);
    // Deux fois : dans le décompte par type et dans la ligne de l'aperçu.
    expect(html.split(label).length - 1).toBe(2);
    expect(html).toContain(messages[locale].audit.findings.modulus_check_failed);
    expect(html).toContain(messages[locale].audit.status.error);
    expect(html).not.toContain("national_check_digits_failed");
    expect(html).not.toMatch(/MISSING_MESSAGE|NaN/);
  });

  it("porte le même libellé que le classeur de l'API, dans les trois langues", () => {
    // Les libellés de `src/lib/audit-file.ts` (classeur payant) et ceux du site
    // (aperçu gratuit) disent la même chose : le client lit un seul constat.
    expect(en.audit.findings.national_check_digits_failed).toBe("National check key fails");
    expect(fr.audit.findings.national_check_digits_failed).toBe("Clé de contrôle nationale en échec");
    expect(de.audit.findings.national_check_digits_failed).toBe("Nationale Prüfziffer fehlgeschlagen");
  });
});
