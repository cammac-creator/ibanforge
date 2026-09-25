import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { JourneyActions } from "@/components/journey-actions";
import { JOURNEY_PAGES } from "./journeys";
import { getCountry } from "./countries";
import { getBlz, getBeCode } from "./registers";

function render(path: string, locale = "en") {
  return renderToStaticMarkup(createElement(JourneyActions, { path, locale }));
}

describe("Parcours depuis les pages existantes", () => {
  it("relie chaque sélection à un contenu réel, dans les trois langues", () => {
    expect(new Set(JOURNEY_PAGES.map((page) => page.path)).size).toBe(20);
    for (const { path } of JOURNEY_PAGES) {
      const [, section, slug] = path.split("/");
      if (section === "docs" || section === "blog") {
        for (const locale of ["en", "fr", "de"]) {
          expect(existsSync(join(process.cwd(), "content", locale, section, `${slug}.mdx`)), `${locale}${path}`).toBe(true);
        }
      } else if (section === "iban") {
        expect(getCountry(slug.toUpperCase()), path).toBeTruthy();
      } else if (section === "blz") {
        expect(getBlz(slug), path).toBeTruthy();
      } else if (section === "be") {
        // La page retenue doit être la canonique, pas un autre code du même groupe.
        expect(getBeCode(slug)?.register.canonical, path).toBe(slug);
      } else {
        expect(existsSync(join(process.cwd(), "app", "[locale]", section, "page.tsx")), path).toBe(true);
      }
    }
  });

  it.each([
    ["en", "/vendors", "/audit"],
    ["fr", "/fr/vendors", "/fr/audit"],
    ["de", "/de/vendors", "/de/audit"],
  ])("rend de vrais liens %s utilisables sans JavaScript et sans réécrire l’attribution", (locale, api, audit) => {
    const html = render("/iban/ae", locale);
    expect(html).toContain(`href="${api}"`);
    expect(html).toContain(`href="${audit}"`);
    expect(html).not.toContain("utm_");
    expect(html).not.toContain("?src=");
    expect(html).toContain('data-evt="cta:journey-api"');
    expect(html).toContain('data-evt="cta:journey-audit"');
    expect(html.match(/id="journey-heading"/g)).toHaveLength(1);
  });

  it("propose le fichier en premier pour le traitement par lot, l’API pour la fiche pays", () => {
    expect(render("/docs/iban-batch").indexOf('href="/audit"')).toBeLessThan(render("/docs/iban-batch").indexOf('href="/vendors"'));
    expect(render("/iban/ae").indexOf('href="/vendors"')).toBeLessThan(render("/iban/ae").indexOf('href="/audit"'));
  });

  it("laisse les autres pages et les deux destinations sans bloc supplémentaire", () => {
    for (const path of ["/docs/api-keys", "/iban/us", "/be/001", "/vendors", "/audit"]) {
      expect(render(path), path).toBe("");
    }
  });
});
