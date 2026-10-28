import { describe, expect, it } from "vitest";
import robots from "./robots";

const agents = [
  "*", "GPTBot", "ChatGPT-User", "OAI-SearchBot", "ClaudeBot",
  "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User",
  "meta-webindexer", "MistralAI-User", "MistralAI-Index", "YouBot",
];

describe("accueil des assistants et exclusion des pages privées", () => {
  it.each(agents)("%s lit les pages publiques, sans exception pour le privé", (agent) => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    const matches = rules.filter((rule) => [rule.userAgent].flat().includes(agent));
    expect(matches).toHaveLength(1);
    const rule = matches[0];
    expect(rule.allow).toBe("/");
    const excluded = [rule.disallow].flat().filter((path): path is string => typeof path === "string");
    // Une règle nommée remplace celle de « * » : chaque robot doit porter les refus.
    for (const locale of ["", "/en", "/fr", "/de"]) {
      for (const path of ["/dashboard", "/dashboard/", "/dashboard/login", "/dashboard?view=today"]) {
        expect(excluded.some((prefix) => `${locale}${path}`.startsWith(prefix)), `${agent}: ${locale}${path}`).toBe(true);
      }
      // Le compte garde son noindex lisible : aucun refus ne doit le couvrir.
      for (const path of ["/account", "/account/", "/account?code=fictif"]) {
        expect(excluded.some((prefix) => `${locale}${path}`.startsWith(prefix)), `${agent}: ${locale}${path}`).toBe(false);
      }
    }
    for (const path of ["/api/crm/send", "/api/auth/login", "/api/dashboard/revenue", "/api/playground"]) {
      expect(excluded.some((prefix) => path.startsWith(prefix)), `${agent}: ${path}`).toBe(true);
    }
    for (const path of ["/", "/fr", "/docs", "/fr/pricing", "/llms.txt", "/llms-full.txt"]) {
      expect(excluded.some((prefix) => path.startsWith(prefix)), `${agent}: ${path}`).toBe(false);
    }
  });

  it.each(["meta-externalagent", "AwarioBot"])("conserve le refus de %s", (agent) => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules : [result.rules];
    expect(rules.filter((rule) => [rule.userAgent].flat().includes(agent))).toEqual([
      { userAgent: agent, disallow: "/" },
    ]);
    expect(result.sitemap).toBe("https://ibanforge.com/sitemap.xml");
  });
});
