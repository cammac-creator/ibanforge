import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  TITLE_MAX,
  atMeta,
  beMeta,
  blzMeta,
  cutAtWord,
  iidMeta,
  itMeta,
  registerIndexMeta,
  skMeta,
  type PageMeta,
} from "./register-meta";
import { iidIdentity, type BlzEntry, type BlzRegister, type IidEntry, type ItEntry, type SkEntry } from "./registers";

/**
 * Titles and descriptions of the bank-code pages (29/09/2026). Why they read the
 * way they do: the header of lib/register-meta.ts.
 *
 * Two halves. Invented rows first (this repository is public: "Bank Alpha",
 * "Musterstadt", made-up codes and BICs), to pin each rule on a case built for
 * it. Then a sweep of every row of the exported registers, which are public bank
 * data read in place, never copied here: a rule that holds on a fixture and
 * breaks on the 3 000th real name is the failure a sweep exists to catch.
 */

const LOCALES = ["en", "fr", "de"] as const;

function withinLimits(m: PageMeta, context: string) {
  expect(m.title.length, `${context} title: ${m.title}`).toBeLessThanOrEqual(TITLE_MAX);
  expect(m.description.length, `${context} description: ${m.description}`).toBeLessThanOrEqual(DESCRIPTION_MAX);
  expect(m.title.trim(), context).not.toBe("");
  // The house rule on long dashes, and no brand repeated by a template.
  expect(`${m.title} ${m.description}`, context).not.toContain("—");
  expect(m.title, context).not.toMatch(/IBANforge.*IBANforge/);
}

const blz = (over: Partial<BlzRegister> = {}): BlzRegister => ({
  blz: "12345678",
  name: "Bank Alpha",
  short_name: "Bank Alpha Musterstadt",
  bic: "ALPHDEFFXXX",
  post_code: "10000",
  town: "Musterstadt",
  retired: false,
  successor_blz: null,
  as_of: "2026-09",
  ...over,
});

describe("the BLZ pages", () => {
  it("lead with the code as people type it, then the bank, the town and the BIC", () => {
    for (const l of LOCALES) {
      const m = blzMeta(l, blz());
      expect(m.title, l).toBe("BLZ 12345678 · Bank Alpha, Musterstadt · BIC ALPHDEFFXXX");
      withinLimits(m, l);
    }
  });

  it("answer « which bank » in the first sentence of the description, in each language", () => {
    expect(blzMeta("de", blz()).description).toMatch(/^Welche Bank hat die BLZ 12345678\? Bank Alpha in Musterstadt, BIC ALPHDEFFXXX\./);
    expect(blzMeta("fr", blz()).description).toMatch(/^Quelle banque porte la BLZ 12345678 \? Bank Alpha à Musterstadt, BIC ALPHDEFFXXX\./);
    expect(blzMeta("en", blz()).description).toMatch(/^Which bank is BLZ 12345678 \(Bankleitzahl\)\? Bank Alpha in Musterstadt, BIC ALPHDEFFXXX\./);
    for (const l of LOCALES) expect(blzMeta(l, blz()).description, l).toContain("Bundesbank");
  });

  it("say a code marked for deletion, and its successor, only when the register does", () => {
    const retired = blz({ retired: true, successor_blz: "87654321" });
    expect(blzMeta("de", retired).description).toContain("Zur Löschung vorgemerkt, Nachfolge-BLZ 87654321");
    expect(blzMeta("fr", retired).description).toContain("Marquée pour suppression, BLZ successeur 87654321");
    expect(blzMeta("en", retired).description).toContain("Marked for deletion, successor BLZ 87654321");
    for (const l of LOCALES) {
      expect(blzMeta(l, blz()).description, l).not.toMatch(/Löschung|suppression|deletion/);
      withinLimits(blzMeta(l, retired), l);
    }
  });

  it("carry no BIC where the register gives none, and invent none", () => {
    for (const l of LOCALES) {
      const m = blzMeta(l, blz({ bic: null }));
      expect(m.title, l).toBe("BLZ 12345678 · Bank Alpha, Musterstadt");
      expect(m.description, l).not.toContain("BIC");
    }
  });

  it("do not repeat a town the name already carries", () => {
    const m = blzMeta("en", blz({ name: "Sparkasse Musterstadt", short_name: null }));
    expect(m.title).toBe("BLZ 12345678 · Sparkasse Musterstadt · BIC ALPHDEFFXXX");
    expect(m.description).not.toContain("Musterstadt in Musterstadt");
  });

  it("fall back to the register's short name, then drop the town, keeping the code and the BIC", () => {
    const long = blz({ name: "Genossenschaftsbank Alpha Beta Gamma Delta, Zweigniederlassung", short_name: "GB Alpha Musterstadt" });
    for (const l of LOCALES) {
      const m = blzMeta(l, long);
      expect(m.title, l).toBe("BLZ 12345678 · GB Alpha Musterstadt · BIC ALPHDEFFXXX");
      withinLimits(m, l);
    }
  });

  it("cut a name that fits nowhere at a word, never the code", () => {
    const huge = blz({ name: "Alpha ".repeat(20).trim(), short_name: null, town: "Musterstadt an der Beispielach" });
    for (const l of LOCALES) {
      const m = blzMeta(l, huge);
      expect(m.title.startsWith("BLZ 12345678 · Alpha"), l).toBe(true);
      expect(m.title, l).toContain("…");
      expect(m.title, l).toContain("BIC ALPHDEFFXXX");
      withinLimits(m, l);
      expect(m.description, l).toContain("12345678");
      expect(m.description, l).toContain("Bundesbank");
    }
  });
});

describe("the IID, ABI, Slovak, Austrian and Belgian pages", () => {
  it("IID: code, bank, town, BIC; a redirected number says so", () => {
    const id = { name: "Bank Alpha AG", town: "Musterdorf", bic: "ALPHCHZZXXX", redirectedTo: null };
    for (const l of LOCALES) {
      const m = iidMeta(l, "09999", id, "2026-09-01");
      expect(m.title, l).toBe("IID 09999 · Bank Alpha AG, Musterdorf · BIC ALPHCHZZXXX");
      expect(m.description, l).toContain("SIX BankMaster");
      withinLimits(m, l);
    }
    expect(iidMeta("de", "09999", id, "2026-09-01").description).toMatch(/^Welche Bank hat die IID 09999 \(BC-Nummer\)\?/);
    const merged = { ...id, redirectedTo: "09998" };
    expect(iidMeta("en", "09997", merged, "2026-09-01").title).toContain("merged into IID 09998");
    expect(iidMeta("fr", "09997", merged, "2026-09-01").title).toContain("fusionné dans l’IID 09998");
    expect(iidMeta("de", "09997", merged, "2026-09-01").title).toContain("zusammengeführt mit IID 09998");
    for (const l of LOCALES) withinLimits(iidMeta(l, "09997", merged, "2026-09-01"), l);
  });

  it("ABI: no BIC in the title, the Banca d'Italia named, a struck-off code keeps its status", () => {
    const inForce = {
      code: "09999",
      status: "in_force" as const,
      name: "BANCA ALPHA S.P.A.",
      street: null,
      post_code: null,
      town: "BORGO ESEMPIO",
      lei: null,
      as_of: "2026-09-23",
      source: "Banca d'Italia (fixture)",
    };
    for (const l of LOCALES) {
      const m = itMeta(l, inForce);
      expect(m.title, l).toBe("ABI 09999 · BANCA ALPHA S.P.A., BORGO ESEMPIO");
      expect(m.title, l).not.toContain("BIC");
      expect(m.description, l).toContain("Banca d'Italia");
      withinLimits(m, l);
    }
    const struck = {
      code: "09998",
      status: "retired" as const,
      name: "CASSA RURALE ALPHA ".repeat(5).trim(),
      retired_on: "2001-02-03",
      successor_code: "09999",
      successor_name: "BANCA ALPHA S.P.A.",
      as_of: "2026-09-23",
      source: "Banca d'Italia (fixture)",
    };
    const status = { en: "struck off", fr: "radié", de: "gelöscht" };
    for (const l of LOCALES) {
      const m = itMeta(l, struck);
      expect(m.title.endsWith(` · ${status[l]}`), `${l}: ${m.title}`).toBe(true);
      expect(m.title.startsWith("ABI 09998 · "), l).toBe(true);
      expect(m.description, l).toContain("2001-02-03");
      withinLimits(m, l);
    }
  });

  it("Slovak, Austrian and Belgian codes carry the code and the register's BIC", () => {
    const sk = { code: "0999", name: "Banka Alpha, a.s.", bic: "ALPHSKBX", as_of: "2026-05-18", source: "NBS (fixture)" };
    const at = { code: "99999", name: "Bank Alpha AG", town: "Musterort", bic: "ALPHATWWXXX" };
    const be = { code: "999", name: "Bank Alpha NV", bic: "ALPHBEBB" };
    for (const l of LOCALES) {
      for (const [m, code, bic, register] of [
        [skMeta(l, sk), "0999", "ALPHSKBX", "Národná banka Slovenska"],
        [atMeta(l, at), "99999", "ALPHATWWXXX", "Nationalbank"],
        [beMeta(l, be), "999", "ALPHBEBB", "Belgi"],
      ] as const) {
        expect(m.title, l).toContain(code);
        expect(m.title, l).toContain(`BIC ${bic}`);
        expect(m.description, l).toContain(bic);
        expect(m.description, l).toContain(register);
        withinLimits(m, l);
      }
    }
    expect(atMeta("en", at).title).toBe("BLZ 99999 (Austria) · Bank Alpha AG, Musterort · BIC ALPHATWWXXX");
    expect(atMeta("de", at).description).toMatch(/^Welche Bank hat die österreichische BLZ 99999\?/);
    expect(beMeta("fr", { ...be, bic: null }).title).toBe("Code banque belge 999 · Bank Alpha NV");
  });

  it("the six indexes, in three languages, fit and name what a reader looks for", () => {
    for (const l of LOCALES) {
      for (const index of ["blz", "iid", "it", "sk", "at", "be"] as const) {
        const m = registerIndexMeta(l, index, 123);
        withinLimits(m, `${l} ${index}`);
        // Italy's register publishes no BIC, so its index does not promise one.
        if (index === "it") expect(m.title, `${l} ${index}`).not.toContain("BIC");
        else expect(m.title, `${l} ${index}`).toContain("BIC");
      }
      expect(registerIndexMeta(l, "blz").title, l).toContain("BLZ");
      expect(registerIndexMeta(l, "it", 123).description, l).toContain("123");
    }
  });

  it("cut at a word and leave no dangling punctuation", () => {
    expect(cutAtWord("Bank Alpha, Musterstadt", 100)).toBe("Bank Alpha, Musterstadt");
    expect(cutAtWord("Bank Alpha, Musterstadt", 13)).toBe("Bank Alpha…");
    expect(cutAtWord("Bank Alpha, Musterstadt", 13).length).toBeLessThanOrEqual(13);
  });
});

describe("every row of the exported registers", () => {
  const data = (file: string) =>
    JSON.parse(readFileSync(resolve(__dirname, "../data/registers", file), "utf8")) as { entries: Record<string, unknown> };

  it("BLZ: fits, starts with the code, always carries the BIC the register gives", () => {
    for (const e of Object.values(data("de-blz.json").entries) as BlzEntry[]) {
      for (const l of LOCALES) {
        const m = blzMeta(l, e.register);
        withinLimits(m, `${l} ${e.register.blz}`);
        expect(m.title.startsWith(`BLZ ${e.register.blz} · `), m.title).toBe(true);
        if (e.register.bic) expect(m.title, m.title).toContain(e.register.bic);
        if (e.register.bic) expect(m.description, m.description).toContain(e.register.bic);
        expect(m.description, m.description).toContain("Bundesbank");
      }
    }
  });

  it("IID: fits, starts with the code, names the SIX BankMaster and the BIC", () => {
    for (const e of Object.values(data("ch-iid.json").entries) as IidEntry[]) {
      const id = iidIdentity(e);
      for (const l of LOCALES) {
        const m = iidMeta(l, e.register.iid, id, e.register.valid_on);
        withinLimits(m, `${l} ${e.register.iid}`);
        expect(m.title.startsWith(`IID ${e.register.iid}`), m.title).toBe(true);
        if (id.bic) expect(m.description, m.description).toContain(id.bic);
        expect(m.description, m.description).toContain("SIX BankMaster");
      }
    }
  });

  it("ABI: fits, starts with the code, names the Banca d'Italia, never a BIC in the title", () => {
    for (const e of Object.values(data("it-bank.json").entries) as ItEntry[]) {
      for (const l of LOCALES) {
        const m = itMeta(l, e.register);
        withinLimits(m, `${l} ${e.register.code}`);
        expect(m.title.startsWith(`ABI ${e.register.code} · `), m.title).toBe(true);
        // A word boundary: "VERBICARO" is a real Italian town.
        expect(m.title, m.title).not.toMatch(/\bBIC\b/);
        expect(m.description, m.description).toContain("Banca d'Italia");
      }
    }
  });

  it("Slovakia: fits, carries the code, names the NBS and the BIC", () => {
    for (const e of Object.values(data("sk-bank.json").entries) as SkEntry[]) {
      for (const l of LOCALES) {
        const m = skMeta(l, e.register);
        withinLimits(m, `${l} ${e.register.code}`);
        expect(m.title, m.title).toContain(e.register.code);
        if (e.register.bic) expect(m.description, m.description).toContain(e.register.bic);
        expect(m.description, m.description).toContain("Národná banka Slovenska");
      }
    }
  });
});

describe("the pages read their titles from here", () => {
  const read = (rel: string) => readFileSync(resolve(__dirname, "../app/[locale]", rel), "utf8");
  it.each([
    ["blz/[blz]/page.tsx", "blzMeta("],
    ["iid/[iid]/page.tsx", "iidMeta("],
    ["it/[code]/page.tsx", "itMeta("],
    ["sk/[code]/page.tsx", "skMeta("],
    ["at/[code]/page.tsx", "atMeta("],
    ["be/[code]/page.tsx", "beMeta("],
    ["blz/page.tsx", 'registerIndexMeta(locale, "blz")'],
    ["iid/page.tsx", 'registerIndexMeta(locale, "iid")'],
    ["it/page.tsx", 'registerIndexMeta(locale, "it"'],
    ["sk/page.tsx", 'registerIndexMeta(locale, "sk")'],
    ["at/page.tsx", 'registerIndexMeta(locale, "at")'],
    ["be/page.tsx", 'registerIndexMeta(locale, "be")'],
  ])("%s", (file, call) => {
    const source = read(file);
    expect(source).toContain(call);
    // `absolute`: the layout's template would push every title twelve characters over.
    expect(source).toContain("title: { absolute: meta.title }");
  });
});
