import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOOL_OUTPUT_SCHEMAS } from './output-schemas.js';
import { MCP_TOOLS } from './inventory.js';

/**
 * Both internal MCP transports must declare the SAME `outputSchema` per tool.
 *
 * ## Why this exists
 *
 * Audit MCP-15 (2026-09-01): `src/routes/mcp-http.ts` declared an
 * `outputSchema` on every data tool; `src/mcp/server.ts` (stdio, `npm run mcp`)
 * declared one only on `send_feedback`. A conformant MCP client validates
 * `structuredContent` against whatever `outputSchema` a transport advertises —
 * so the two surfaces of the SAME product disagreed on whether an agent could
 * even ask for structured data, let alone what shape it would be in.
 *
 * The fix (this commit) moved every `outputSchema` into `output-schemas.ts`
 * and made both transports import `TOOL_OUTPUT_SCHEMAS` instead of declaring
 * their own. This file is what keeps that true: it fails the moment either
 * transport's `registerTool` call stops referencing the shared constant —
 * whether by reverting to a hand-copied literal (today's would still look
 * identical; next month's edit to one copy would not reach the other) or by
 * pointing at the wrong tool's entry.
 *
 * ## Why a source scan, and not two live servers compared at runtime
 *
 * Neither MCP surface can be imported: `src/mcp/server.ts` calls main() at
 * module scope (importing it would start a real stdio server in the test
 * runner), and `createMcpServer` is not exported from `mcp-http.ts`. Same
 * constraint, same remedy as `src/mcp/tool-contracts.test.ts` and
 * `scripts/mcp-parity.test.ts` — less elegant than an import, and the only
 * thing that works.
 *
 * A one-time runtime `deepEqual` would also be the WEAKER check here even if
 * it were possible: a maintainer who hand-copies one file's schema into the
 * other would pass it today and reintroduce exactly the drift this file
 * exists to prevent, because the two copies would no longer be one thing to
 * edit. Checking that both call sites reference the identical import is a
 * structural guarantee, not a snapshot — reference identity in a shared
 * module makes the two schemas the same object, so "deepEqual" holds for as
 * long as neither side stops importing it.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

const SURFACES = {
  stdio: { label: 'stdio embarqué (npm run mcp / smithery)', path: 'src/mcp/server.ts' },
  http: { label: 'HTTP distant (api.ibanforge.com/mcp)', path: 'src/routes/mcp-http.ts' },
} as const;
type SurfaceId = keyof typeof SURFACES;

const SRC: Record<SurfaceId, string> = {
  stdio: read(SURFACES.stdio.path),
  http: read(SURFACES.http.path),
};

/**
 * The `outputSchema:` right-hand side inside ONE tool's `registerTool(...)`
 * call, as written in `source` — e.g. `TOOL_OUTPUT_SCHEMAS.validate_iban`.
 *
 * Bounded to that tool's own block (up to the next `registerTool(`, or the
 * end of the file for the last tool declared) so a schema declared on a
 * NEIGHBOURING tool can never be picked up by mistake.
 */
function outputSchemaRefFor(source: string, toolName: string): string {
  const startMatch = new RegExp(`registerTool\\(\\s*\\n?\\s*'${toolName}'`).exec(source);
  if (!startMatch) throw new Error(`no registerTool('${toolName}') found`);
  const from = startMatch.index;
  const rest = source.slice(from);
  const nextToolOffset = rest.slice(1).search(/registerTool\(/);
  const block = nextToolOffset === -1 ? rest : rest.slice(0, nextToolOffset + 1);
  const schemaMatch = /outputSchema:\s*([A-Za-z0-9_.]+),/.exec(block);
  if (!schemaMatch)
    throw new Error(
      `'${toolName}' declares no \`outputSchema: <identifier>,\` in its registerTool block`,
    );
  return schemaMatch[1];
}

describe('output schema parity — stdio and HTTP declare the same shared schema', () => {
  it('TOOL_OUTPUT_SCHEMAS covers every MCP tool, no more and no less', () => {
    // The completeness half of MCP-15: a data tool (or send_feedback) missing
    // from this map has no outputSchema on EITHER transport, because both
    // read this same table.
    expect(Object.keys(TOOL_OUTPUT_SCHEMAS).sort()).toEqual(MCP_TOOLS.map((t) => t.name).sort());
  });

  for (const tool of MCP_TOOLS) {
    const expectedRef = `TOOL_OUTPUT_SCHEMAS.${tool.name}`;

    it(`${tool.name}: its schema shape is real and non-empty`, () => {
      const shape = TOOL_OUTPUT_SCHEMAS[tool.name as keyof typeof TOOL_OUTPUT_SCHEMAS];
      expect(shape, `TOOL_OUTPUT_SCHEMAS.${tool.name} is missing`).toBeDefined();
      expect(
        Object.keys(shape).length,
        `TOOL_OUTPUT_SCHEMAS.${tool.name} has no fields`,
      ).toBeGreaterThan(0);
    });

    for (const id of Object.keys(SURFACES) as SurfaceId[]) {
      it(`${tool.name}: ${SURFACES[id].label} references ${expectedRef} exactly`, () => {
        expect(
          outputSchemaRefFor(SRC[id], tool.name),
          `${SURFACES[id].path} does not pass outputSchema: ${expectedRef} to registerTool('${tool.name}', ...) — ` +
            "either it is missing, or it points at a different (possibly wrong) tool's schema.",
        ).toBe(expectedRef);
      });
    }

    it(`${tool.name}: stdio and HTTP reference the identical expression`, () => {
      // Redundant with the two checks above given both must equal
      // `expectedRef`, kept because it is the literal "deepEqual between the
      // two surfaces" MCP-15 asks for, stated directly rather than implied.
      expect(outputSchemaRefFor(SRC.stdio, tool.name)).toBe(
        outputSchemaRefFor(SRC.http, tool.name),
      );
    });
  }
});
