import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import de from "@/messages/de.json";
import { doorForPath } from "./key-origin";
import { localePath } from "./locale-path";
import { PUBLIC_API, REGISTER_CTA_DOCS_PATH, REGISTER_CTA_EVENT, trialCurl } from "./register-cta";

/**
 * The call to action under the API's answer on the bank-code pages (29/09/2026).
 * What it may say and why: lib/register-cta.ts.
 *
 * The figures are read from the API's own constants, by file and not by import
 * (the site cannot import from src/), the way anonymous-key-copy.test.ts does:
 * the day a quota changes, this test names the sentence that still says the old
 * one. The "two figures never share a sentence" rule is held for the whole site
 * by src/routes/free-doors-claims.test.ts, which reads these texts too.
 */

const ROOT = resolve(__dirname, "..", "..");
const APP = resolve(__dirname, "..", "app", "[locale]");
const constant = (file: string, name: string): string => {
  const value = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(readFileSync(join(ROOT, file), "utf8"))?.[1];
  expect(value, `${name} introuvable dans ${file}`).toBeDefined();
  return value as string;
};

const TRIAL_WEEK = constant("src/lib/trial.ts", "REST_TRIAL_WEEKLY_LIMIT");
const KEY_START = constant("src/lib/tiers.ts", "ANONYMOUS_MONTHLY_LIMIT");
const KEY_CLAIMED = constant("src/lib/tiers.ts", "FREE_TIER_MONTHLY_LIMIT");

const COPY = { en: en.registerCta, fr: fr.registerCta, de: de.registerCta } as const;

describe("the words of the call to action", () => {
  it("exist in the three languages, none empty", () => {
    const keys = Object.keys(COPY.en).sort();
    for (const [l, c] of Object.entries(COPY)) {
      expect(Object.keys(c).sort(), l).toEqual(keys);
      for (const [k, v] of Object.entries(c)) {
        expect(v.trim(), `${l}.${k}`).not.toBe("");
        expect(v, `${l}.${k}`).not.toContain("—");
      }
    }
  });

  it("quote the keyless trial by its week and its one route, with the figure the API applies", () => {
    expect(COPY.en.trialText).toContain(`up to ${TRIAL_WEEK} times a week, on that route only`);
    expect(COPY.fr.trialText).toContain(`jusqu’à ${TRIAL_WEEK} fois par semaine, sur cette seule route`);
    expect(COPY.de.trialText).toContain(`bis zu ${TRIAL_WEEK}-mal pro Woche, nur auf dieser Route`);
    for (const c of Object.values(COPY)) expect(c.trialText).toContain("POST /v1/iban/validate");
  });

  it("announce the key by what it reaches once an address is confirmed, then where it starts", () => {
    // The house rule (CLAUDE.md): name the door, announce the key by its
    // monthly ceiling once claimed, and give the starting figure after it.
    expect(COPY.en.keyText.startsWith(`${KEY_CLAIMED} requests a month on every endpoint`)).toBe(true);
    expect(COPY.fr.keyText.startsWith(`${KEY_CLAIMED} requêtes par mois sur tous les endpoints`)).toBe(true);
    expect(COPY.de.keyText.startsWith(`${KEY_CLAIMED} Anfragen pro Monat auf allen Endpunkten`)).toBe(true);
    expect(COPY.en.keyText).toContain(`starts at ${KEY_START} requests a month`);
    expect(COPY.fr.keyText).toContain(`à ${KEY_START} requêtes par mois`);
    expect(COPY.de.keyText).toContain(`mit ${KEY_START} Anfragen pro Monat`);
  });

  it("never put the trial's figure and the key's in one sentence", () => {
    for (const [l, c] of Object.entries(COPY)) {
      for (const text of Object.values(c)) {
        for (const sentence of text.split(/(?<=[.!?:])\s+/)) {
          const figures = sentence.match(/(?<![.,\d])\d+(?![.,]?\d)/g) ?? [];
          const quotas = figures.filter((f) => f === TRIAL_WEEK || f === KEY_START || f === KEY_CLAIMED);
          expect(quotas.length, `${l}: ${sentence}`).toBeLessThan(2);
        }
      }
    }
  });
});

describe("the keyless command", () => {
  it("is the one request the trial serves, with the page's IBAN in the body", () => {
    const cmd = trialCurl("DE00 1234 5678 0000 0000 00");
    expect(cmd).toContain(`curl -X POST ${PUBLIC_API}/v1/iban/validate`);
    expect(cmd).toContain('-H "Content-Type: application/json"');
    const body = /-d '(.*)'/.exec(cmd)?.[1];
    // A body-less POST keeps its 402: the body must be there and be JSON.
    expect(JSON.parse(body ?? "null")).toEqual({ iban: "DE00123456780000000000" });
    expect(PUBLIC_API).toBe("https://api.ibanforge.com");
  });

  it("reports its click under a name the API accepts", () => {
    expect(REGISTER_CTA_EVENT).toMatch(/^(nav|cta|film):[a-z0-9][a-z0-9-]{0,31}$/);
  });

  it("points to a documentation page that exists in the three languages", () => {
    for (const l of ["en", "fr", "de"]) {
      expect(existsSync(resolve(__dirname, "..", "content", l, "docs", "api-keys.mdx")), l).toBe(true);
    }
    expect(REGISTER_CTA_DOCS_PATH).toBe("/docs/api-keys");
  });
});

describe("where the block sits", () => {
  const PUBLISHABLE = [
    ["blz/[blz]/page.tsx", "/blz/12345678"],
    ["iid/[iid]/page.tsx", "/iid/09999"],
    ["it/[code]/page.tsx", "/it/09999"],
    ["sk/[code]/page.tsx", "/sk/0999"],
  ] as const;

  it.each(PUBLISHABLE)("%s: right after the API's answer, before anything else", (file) => {
    const source = readFileSync(join(APP, file), "utf8");
    const answer = source.indexOf("{apiJson(entry.api)}");
    const block = source.indexOf("<RegisterApiCta locale={locale} exampleIban={entry.example_iban} />");
    expect(answer).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(answer);
    // Nothing else between the answer's section and the block.
    expect(source.slice(answer, block).replace(/\s+/g, " ").trim()).toBe("{apiJson(entry.api)}</pre> </section>");
  });

  it.each(PUBLISHABLE)("%s: a key taken there is counted under the door site-register", (_file, path) => {
    for (const locale of ["en", "fr", "de"]) {
      expect(doorForPath(localePath(locale, path)), `${locale} ${path}`).toBe("site-register");
    }
  });

  it.each(["at/[code]/page.tsx", "be/[code]/page.tsx", "sm/[code]/page.tsx"])(
    "%s: a register served but not redistributed gets nothing new",
    (file) => {
      expect(readFileSync(join(APP, file), "utf8")).not.toContain("RegisterApiCta");
    },
  );
});
