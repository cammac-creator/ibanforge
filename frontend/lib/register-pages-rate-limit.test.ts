import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { routing } from "@/i18n/routing";

/**
 * The per-visitor cap on the /at, /be and /sm code pages (audit of 29/09/2026).
 *
 * It cannot live in the page nor in middleware.ts: a page served from the ISR
 * cache never runs our code, and a counter held in the memory of one instance
 * does not see the others. It lives in a Vercel Firewall rate-limit rule,
 * evaluated at the edge before the cache, so it counts cached and uncached
 * pages alike. The rule is kept in this repository as the exact body of
 * `PATCH /v1/security/firewall/config`, and these tests hold what it promises:
 * which paths it counts, and what the numbers mean for a visitor, for a
 * copier and for the API behind the site.
 *
 * Posting it is an infrastructure change with a usage-based price: it is not
 * done from a pull request.
 */

const FRONTEND = resolve(__dirname, "..");
const RULE_FILE = resolve(FRONTEND, "firewall/register-pages-rate-limit.json");

interface RateLimitRule {
  action: string;
  id: null;
  value: {
    name: string;
    description: string;
    active: boolean;
    conditionGroup: Array<{ conditions: Array<{ type: string; op: string; value: string; neg?: boolean }> }>;
    action: {
      mitigate: {
        action: string;
        rateLimit: { algo: string; window: number; limit: number; keys: string[]; action: string };
        actionDuration?: string | null;
      };
    };
  };
}

const rule = JSON.parse(readFileSync(RULE_FILE, "utf8")) as RateLimitRule;
const conditions = rule.value.conditionGroup.flatMap((g) => g.conditions);
const pathCondition = conditions.find((c) => c.type === "path");
// Vercel compares case-insensitively ("All operators are case insensitive").
const counted = new RegExp(pathCondition?.value ?? "(?!)", "i");
const { window: windowSeconds, limit } = rule.value.action.mitigate.rateLimit;

/** The countries whose code pages read a register from the API at request time. */
function liveRegisterPages(): Array<{ dir: string; country: string }> {
  const localeDir = resolve(FRONTEND, "app/[locale]");
  const pages: Array<{ dir: string; country: string }> = [];
  for (const dir of readdirSync(localeDir)) {
    const page = resolve(localeDir, dir, "[code]/page.tsx");
    if (!existsSync(page)) continue;
    const match = readFileSync(page, "utf8").match(/fetchLiveRegisterEntry\(\s*"([A-Z]{2})"/);
    if (match) pages.push({ dir, country: match[1]! });
  }
  return pages;
}

describe("the firewall rule that caps the register pages", () => {
  it("is a well-formed insert for the Vercel firewall API", () => {
    expect(rule.action).toBe("rules.insert");
    expect(rule.id).toBeNull();
    expect(rule.value.active).toBe(true);
    // Limits of the API schema (openapi.vercel.sh, 29/09/2026).
    expect(rule.value.name.length).toBeLessThanOrEqual(160);
    expect(rule.value.description.length).toBeLessThanOrEqual(256);
    // A single condition: the path. Anything else would narrow the cap in a way
    // this file does not show.
    expect(conditions).toHaveLength(1);
    expect(pathCondition).toMatchObject({ type: "path", op: "re" });
    expect(pathCondition?.neg).toBeFalsy();
  });

  it("counts by address, over a fixed window the Pro plan accepts, and answers 429", () => {
    const { mitigate } = rule.value.action;
    expect(mitigate.action).toBe("rate_limit");
    expect(mitigate.rateLimit.algo).toBe("fixed_window");
    expect(mitigate.rateLimit.keys).toEqual(["ip"]);
    // Pro: a window of 10 s to 10 min. The default action returns 429, which a
    // crawler reads as "come back later", unlike a 403.
    expect(windowSeconds).toBeGreaterThanOrEqual(10);
    expect(windowSeconds).toBeLessThanOrEqual(600);
    expect(Number.isInteger(limit) && limit > 0).toBe(true);
    expect(mitigate.rateLimit.action).toBe("rate_limit");
  });

  it("never blocks an address for longer than the window, nor anywhere else on the site", () => {
    // A persistent action blocks the client's address on every path of the
    // project for its duration: a shared office network, or a search engine's
    // crawler, would lose the whole site for a few register pages.
    expect(rule.value.action.mitigate.actionDuration ?? null).toBeNull();
  });

  it("keeps to plain regular-expression syntax, without lookaround", () => {
    // The firewall's regex engine is not JavaScript's: stay in the subset both
    // agree on.
    expect(pathCondition?.value).not.toMatch(/\(\?[=!<]/);
    expect(pathCondition?.value.startsWith("^")).toBe(true);
    expect(pathCondition?.value.endsWith("$")).toBe(true);
  });

  it("counts every code page that reads a register live, in every language, with or without its prefix", () => {
    const pages = liveRegisterPages();
    expect(pages.map((p) => p.country).sort()).toEqual(["AT", "BE", "SM"]);
    const samples: Record<string, string> = { AT: "19981", BE: "990", SM: "09991" };
    for (const { dir, country } of pages) {
      const code = samples[country]!;
      expect(counted.test(`/${dir}/${code}`)).toBe(true);
      expect(counted.test(`/${dir}/${code}/`)).toBe(true);
      for (const locale of routing.locales) expect(counted.test(`/${locale}/${dir}/${code}`)).toBe(true);
    }
    // A malformed code is still a page request (it answers 404 without calling
    // the API, but a sweep would try them too).
    expect(counted.test("/be/abc")).toBe(true);
  });

  it("counts nothing else: not the index pages, not the other registers, not the playground", () => {
    const untouched = [
      "/",
      "/at",
      "/be/",
      "/fr/sm",
      "/de/at",
      "/playground",
      "/api/playground",
      "/blz/10070000",
      "/de/blz/10070000",
      "/it/03069",
      "/sk/0900",
      "/iid/00762",
      "/fr/blog/at-registre",
      "/at/19981/extra",
      "/xx/at/19981",
    ];
    for (const path of untouched) expect(counted.test(path), path).toBe(false);
  });

  it("leaves an honest reader room, prefetch included", () => {
    // Opening a code page from a link can cost two requests (the prefetch and
    // the page). Twenty pages read in one window is far above what a person
    // looking up a bank does.
    expect(limit / 2).toBeGreaterThanOrEqual(20);
  });

  it("makes a copy of the Belgian register from one address take hours, not minutes", () => {
    // Belgian codes have three digits: the whole space is a thousand pages.
    const secondsForAllBelgianCodes = Math.ceil(1000 / limit) * windowSeconds;
    expect(secondsForAllBelgianCodes).toBeGreaterThanOrEqual(2 * 3600);
  });

  it("keeps one address well under the API's own per-address limit", () => {
    // The site reads the API from its own servers: a sweep of never-read codes
    // turns page views into API calls, one for one at worst. The API allows 100
    // calls a minute per address (RATE_LIMIT in src/middleware/rate-limit.ts).
    // Even if one window's whole allowance fell into a single minute, one
    // visitor could not reach it alone.
    expect(limit).toBeLessThan(100);
  });
});
