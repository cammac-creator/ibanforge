import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

describe("Exemples exécutables des guides métier", () => {
  it("exécute la revue CSV distribuée avec des réponses fictives, sans réseau", () => {
    execFileSync("python3", ["-B", join(process.cwd(), "lib/vendor-review-example.test.py")], {
      timeout: 15_000,
      stdio: "pipe",
    });
  });

  it.each(["en", "fr", "de"])("exécute le premier appel JavaScript du guide %s", async (locale) => {
    const article = readFileSync(join(process.cwd(), "content", locale, "blog/2026-04-02-iban-validation-use-cases.mdx"), "utf8");
    const code = article.match(/```javascript\n([\s\S]*?)\n```/)?.[1];
    expect(code).toBeTruthy();
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const run = new AsyncFunction("process", "fetch", "console", code);
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ valid: true, bank_code_holder: "confirmed", checks: {} }) });
    await run({ env: { IBANFORGE_API_KEY: "cle-fictive" } }, fetch, { log: vi.fn() });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe("https://api.ibanforge.com/v1/iban/validate");
    expect(request.headers.Authorization).toBe("Bearer cle-fictive");
    expect(JSON.parse(request.body)).toEqual({ iban: "DE89370400440532013000" });
    fetch.mockClear();
    await expect(run({ env: {} }, fetch, { log: vi.fn() })).rejects.toThrow("IBANFORGE_API_KEY");
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockResolvedValue({ ok: false, status: 429 });
    await expect(run({ env: { IBANFORGE_API_KEY: "cle-fictive" } }, fetch, { log: vi.fn() })).rejects.toThrow("HTTP 429");
  });
});
