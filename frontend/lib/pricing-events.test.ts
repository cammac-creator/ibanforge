import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTranslator } from "next-intl";
import { describe, expect, it, vi } from "vitest";
import PricingPage from "@/app/[locale]/pricing/page";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";
import de from "@/messages/de.json";

const language = vi.hoisted(() => ({ current: "en" as "fr" | "en" | "de" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: language.current, messages: { fr, en, de }[language.current], namespace: "pricing" }),
}));
// Seuls les îlots sans lien d'achat sont remplacés ; la page et ses liens sont réels.
vi.mock("@/components/client-messages", () => ({ ClientMessages: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/api-key-dialog", () => ({ GetKeyButton: ({ children }: { children: ReactNode }) => createElement("button", null, children) }));
vi.mock("@/app/[locale]/pricing/calculator", () => ({ CostCalculator: () => null }));
vi.mock("@/app/[locale]/pricing/faq", () => ({ Faq: () => null }));

describe("les liens d'achat réellement rendus sur les tarifs", () => {
  it.each(["fr", "en", "de"] as const)("porte les trois paquets et Pro en %s", async (locale) => {
    language.current = locale;
    const html = renderToStaticMarkup(await PricingPage({ params: Promise.resolve({ locale }) }));
    for (const event of ["cta:buy-pro", "cta:buy-pack-1k", "cta:buy-pack-5k", "cta:buy-pack-25k"]) {
      const links = html.match(/<a\b[^>]*>/g) ?? [];
      const tagged = links.filter((link) => link.includes(`data-evt="${event}"`));
      expect(tagged, event).toHaveLength(1);
      expect(tagged[0]).toMatch(/href="https:\/\/buy\.stripe\.com\//);
    }
  });
});
