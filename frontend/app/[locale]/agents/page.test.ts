import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

/**
 * DX-01 (audit 2026-09-01): the MCP server exposes 8 tools (`tools/list` in
 * prod returns count=8, and `mcp/src/index.ts` — the up-to-date surface —
 * lists all 8), but this page's own `TOOLS` array stopped at 7 and left
 * `send_feedback` out, while `messages/*.json` already advertised "8 tools"
 * in every locale. Read as source, not imported: the component calls
 * `getTranslations`, which needs a request context this suite does not set up.
 */
describe("agents page TOOLS list", () => {
  it("lists exactly 8 tools, matching the MCP server's tools/list", () => {
    const toolsBlock = SOURCE.match(/const TOOLS = \[([\s\S]*?)\n\];/);
    expect(toolsBlock).not.toBeNull();
    const names = [...toolsBlock![1].matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(8);
    expect(names).toContain("send_feedback");
  });
});
