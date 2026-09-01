import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(resolve(__dirname, rel), "utf8");

/**
 * WEB-01/WEB-02 (audit 2026-09-01), continued from `lib/seo.test.ts`.
 *
 * That audit found the canonical living in the locale layout (so every page
 * that did not redeclare it inherited the locale HOME's URL) and, on the two
 * pages that did redeclare it, a hand-written `alternates: { canonical }`
 * that erased the `languages`/hreflang block instead of carrying it. This is
 * the same guard, extended to the pages that were still on neither pattern
 * as of 2026-09-01: every page below must build its `alternates` with the
 * shared helper, and never by hand.
 *
 * Read as source, not imported: these are async server components that call
 * `getTranslations`, which needs a request context this suite does not set up.
 */
const PAGES_WITH_OWN_ALTERNATES = [
  "page.tsx",
  "agents/page.tsx",
  "compare/page.tsx",
  "vendors/page.tsx",
  "sources/page.tsx",
  "status/page.tsx",
  "tools/test-iban/page.tsx",
  "legal/page.tsx",
  "legal/[slug]/page.tsx",
  "account/page.tsx",
  "pricing/page.tsx",
  "docs/page.tsx",
  "blog/page.tsx",
] as const;

describe.each(PAGES_WITH_OWN_ALTERNATES)("%s", (file) => {
  const source = read(file);

  it("builds its alternates with the shared helper, never by hand", () => {
    expect(source).toContain("alternatesFor(");
    // A hand-written `alternates: { canonical: url }` is exactly what dropped
    // the hreflang block from 116 pages on the two pages that had it (WEB-02).
    expect(source).not.toMatch(/alternates:\s*\{\s*canonical/);
  });
});

/** The exact path each page passes to `alternatesFor`, so a typo in the path
 *  string (which `tsc` cannot catch, since any string is a valid argument)
 *  fails a test instead of silently mis-declaring a page's own canonical. */
const EXPECTED_PATH: Record<(typeof PAGES_WITH_OWN_ALTERNATES)[number], string> = {
  "page.tsx": '"/"',
  "agents/page.tsx": '"/agents"',
  "compare/page.tsx": '"/compare"',
  "vendors/page.tsx": '"/vendors"',
  "sources/page.tsx": '"/sources"',
  "status/page.tsx": '"/status"',
  "tools/test-iban/page.tsx": '"/tools/test-iban"',
  "legal/page.tsx": '"/legal"',
  "legal/[slug]/page.tsx": "`/legal/${slug}`",
  "account/page.tsx": '"/account"',
  "pricing/page.tsx": '"/pricing"',
  "docs/page.tsx": '"/docs"',
  "blog/page.tsx": '"/blog"',
};

describe("alternatesFor path argument", () => {
  it.each(PAGES_WITH_OWN_ALTERNATES)("%s names its own path", (file) => {
    const source = read(file);
    expect(source).toContain(`alternatesFor(locale, ${EXPECTED_PATH[file]})`);
  });
});

/**
 * WEB-20 (audit 2026-09-01): the locale layout's title template already
 * appends "| IBANforge" (`"%s | IBANforge"`), so a page that also appended
 * the brand rendered it twice, e.g. "Status | IBANforge | IBANforge". Checked
 * on code lines only (comments below spell out the removed pattern for
 * anyone reading the fix, which would otherwise self-trigger this guard).
 */
const DEDUPED_TITLE_PAGES = ["status/page.tsx", "legal/page.tsx", "legal/[slug]/page.tsx", "account/page.tsx"] as const;

function codeOnly(source: string): string {
  return source
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

describe.each(DEDUPED_TITLE_PAGES)("%s", (file) => {
  it("does not re-append the brand the layout's title template already adds", () => {
    expect(codeOnly(read(file))).not.toMatch(/\|\s*IBANforge["`]/);
  });
});
