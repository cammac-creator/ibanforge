import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The weights the check_compliance description publishes are the weights the
 * score applies.
 *
 * The stdio server said "sanctioned bank (+50)" for weeks after
 * calculateRiskScore moved it to +80, and it listed eleven flags while the
 * score raised more. A client building a hard-block policy on those numbers
 * would have read a designated bank as a lesser risk than it is. Both files are
 * read as text: the weights are literals inside calculateRiskScore, and the
 * description is prose inside a server that starts on import.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

function weightsInCode(): Map<string, number> {
  const src = read('src/lib/compliance.ts');
  const pairs = [...src.matchAll(/score \+= (\d+);\s*\n\s*flags\.push\('([a-z_]+)'\);/g)];
  return new Map(pairs.map((m) => [m[2], Number(m[1])]));
}

function weightsInDescription(): Map<string, number> {
  const line = read('src/mcp/server.ts')
    .split('\n')
    .find((l) => l.startsWith('Risk score weights, by the flag each one raises:'));
  expect(line, 'the weights line of check_compliance was reworded').toBeTruthy();
  const pairs = [...line!.matchAll(/([a-z_]+) \+(\d+)/g)];
  return new Map(pairs.map((m) => [m[1], Number(m[2])]));
}

describe('check_compliance publishes the weights the score applies', () => {
  it('finds the weights in the code, so an empty match cannot pass', () => {
    expect(weightsInCode().size).toBeGreaterThan(10);
  });

  it('names every weighted flag, with its weight', () => {
    expect(Object.fromEntries(weightsInDescription())).toEqual(Object.fromEntries(weightsInCode()));
  });
});
