import { describe, expect, it } from "vitest";
import { IT_REGISTER_COPY, itCopy, type ItRegisterCopy } from "./it-register-copy";

/**
 * Les textes des pages italiennes vivent hors de `messages/*.json` (voir le
 * fichier) : ce test tient ce que messages-parity.test.ts tient pour les autres.
 * Même forme dans les trois langues (le type l'impose déjà), aucun texte vide,
 * chaque variable bien reprise, et la règle de la maison sur les tirets longs.
 */

type Leaf = string | ((...args: string[]) => string);

/** Chaque texte d'une langue, les fonctions appelées avec des valeurs repérables. */
function texts(copy: ItRegisterCopy): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (node: Record<string, unknown>, prefix: string) => {
    for (const [k, v] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "function") out.push([path, (v as (...a: string[]) => string)("A1", "B2", "C3")]);
      else if (typeof v === "string") out.push([path, v]);
      else out.push(...texts(v as ItRegisterCopy).map(([p, t]) => [`${path}.${p}`, t] as [string, string]));
    }
  };
  walk(copy as unknown as Record<string, unknown>, "");
  return out;
}

describe("the Italian register copy", () => {
  const langs = Object.keys(IT_REGISTER_COPY) as Array<keyof typeof IT_REGISTER_COPY>;

  it("carries the same texts in the three languages", () => {
    const keys = langs.map((l) => texts(IT_REGISTER_COPY[l]).map(([k]) => k).sort());
    expect(keys[1]).toEqual(keys[0]);
    expect(keys[2]).toEqual(keys[0]);
    expect(langs.sort()).toEqual(["de", "en", "fr"]);
  });

  it("leaves no text empty and writes no long dash", () => {
    for (const l of langs) {
      for (const [k, t] of texts(IT_REGISTER_COPY[l])) {
        expect(t.trim(), `${l} ${k}`).not.toBe("");
        expect(t, `${l} ${k}`).not.toContain("—");
      }
    }
  });

  it("repeats every value a function is given", () => {
    for (const l of langs) {
      const c = IT_REGISTER_COPY[l];
      expect(c.metaTitle("03069", "INTESA", "TORINO"), l).toMatch(/03069.*INTESA.*TORINO/);
      expect(c.retiredMetaDescription("03111", "UBI", "2021-04-11"), l).toMatch(/03111/);
      expect(c.retiredMetaDescription("03111", "UBI", "2021-04-11"), l).toMatch(/UBI/);
      expect(c.retiredMetaDescription("03111", "UBI", "2021-04-11"), l).toMatch(/2021-04-11/);
      expect(c.successorText("INTESA", "03069"), l).toMatch(/INTESA.*03069/);
      expect(c.indexIntro(464), l).toContain("464");
      expect(c.partialRegisterCheck("Banca d'Italia, registers"), l).toContain("Banca d'Italia, registers");
    }
  });

  it("falls back to English for a language the site does not carry", () => {
    expect(itCopy("it")).toBe(IT_REGISTER_COPY.en);
    expect(itCopy("fr")).toBe(IT_REGISTER_COPY.fr);
  });

  it("types every leaf as a string or a function", () => {
    const leaves: Leaf[] = texts(IT_REGISTER_COPY.en).map(([, t]) => t);
    expect(leaves.length).toBeGreaterThan(30);
  });
});
