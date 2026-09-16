import { createElement, type ReactNode, type ComponentType, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { VerificationSummary } from "@/app/[locale]/playground/verification-summary";
import { AuditSummaryView, type AuditStatus } from "@/components/audit-summary";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";
import de from "@/messages/de.json";

const messages = { fr, en, de };
const Provider = NextIntlClientProvider as ComponentType<Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }>;
const render = (node: ReactNode, locale: keyof typeof messages) => renderToStaticMarkup(createElement(Provider, { locale, messages: messages[locale], timeZone: "UTC", now: new Date("2026-01-01T12:00:00Z") }, node));
const fixture: AuditStatus = { job: "exemple-fictif", rows: 1, tier: "small", price_chf: 149, currency: "CHF", lang: "fr", paid: false, paid_at: null, expires_at: "2026-12-01", summary: { rows: 1, ok: 1, warning: 0, error: 0, by_code: {}, countries: [], columns_detected: ["IBAN"], address_checked: false }, preview: [{ line: 2, iban_masked: "CH•• ••••", status: "ok", findings: [], bank_name: "Banque fictive" }], download: null };

describe("Lisibilité des preuves et du mode démonstration", () => {
  it.each(["fr", "en", "de"] as const)("traduit les limites du contrôle en %s", (locale) => {
    const html = render(createElement(VerificationSummary, { data: { valid: true }, mode: "iban" }), locale);
    expect(html).toContain(messages[locale].playground.verdict.title);
    expect(html).toContain(messages[locale].playground.verdict.holderScope);
    expect(html).not.toMatch(/MISSING_MESSAGE|NaN|Infinity/);
  });
  it.each(["fr", "en", "de"] as const)("annonce le rapport fictif gratuit en %s", (locale) => {
    const html = render(createElement(AuditSummaryView, { status: fixture, masked: true, demonstration: true }), locale);
    expect(html).toContain(messages[locale].audit.demo.masked);
    expect(html).not.toMatch(/MISSING_MESSAGE|NaN/);
    expect(render(createElement(AuditSummaryView, { status: fixture, masked: true }), locale)).not.toContain(messages[locale].audit.demo.masked);
  });
});
