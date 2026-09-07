import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Condition 2 of the FCA's permission (07/09/2026): the register data is
 * never used "to target or market to entities contained within the dataset".
 *
 * A comment cannot hold that promise; a test can. Every module that writes
 * the CRM or runs the prospecting — by name, or because it writes one of the
 * outreach tables — must stay ignorant of the register module, and the
 * register module must write nothing but its own cache. Whoever wires the
 * two together, however well-meaning, turns this file red first.
 */

const SRC = join(process.cwd(), 'src');

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...tsFiles(path));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(path);
  }
  return out;
}

/** Paths that are the CRM or the prospecting by their name. */
const OUTREACH_PATH = /prospect|forum|moisson|outreach|activation|digest|crm|email|mail|api-keys/i;
/** Tables that only the CRM and the prospecting write. */
const OUTREACH_WRITE =
  /(INSERT\s+INTO|UPDATE|INSERT\s+OR\s+REPLACE\s+INTO)\s+(prospects|email_messages|institutional_contacts|contact_notes|orphan_mail)\b/i;

describe('the FCA register never feeds the CRM or the prospecting', () => {
  const files = tsFiles(SRC);
  const register = files.find((f) => f.endsWith('/lib/fca-register.ts'));

  it('finds the register module and enough source to check', () => {
    expect(register).toBeDefined();
    expect(files.length).toBeGreaterThan(50);
  });

  it('is imported by no outreach module, by name or by what it writes', () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file === register) continue;
      const source = readFileSync(file, 'utf8');
      const isOutreach = OUTREACH_PATH.test(file.slice(SRC.length)) || OUTREACH_WRITE.test(source);
      if (isOutreach && /fca-register/.test(source)) offenders.push(file.slice(SRC.length));
    }
    expect(offenders, 'outreach modules importing the FCA register').toEqual([]);
  });

  it('writes nothing but its own cache table, and reads only the firm resource', () => {
    const source = readFileSync(register!, 'utf8');
    // Statements, not the `DO UPDATE SET` clause of the upsert: the table a
    // statement names is what matters, and that clause names none.
    const writes = source.match(/\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE)\s+(?!SET\b)(\w+)/gi) ?? [];
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w, w).toMatch(/fca_firm_cache$/);
    // Every URL built against the register base is the firm resource: no
    // Individuals, no controlled functions, no search — GDPR minimisation.
    const urls = source.match(/\$\{FCA_REGISTER_BASE\}[^`]*/g) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const u of urls) expect(u).toBe('${FCA_REGISTER_BASE}/Firm/${frn}');
    // And it imports nothing that could carry the data elsewhere.
    const imports = source.match(/^import .* from '([^']+)';$/gm) ?? [];
    expect(imports.filter((i) => !/'(\.\/db\.js|node:module)'/.test(i))).toEqual([]);
  });
});
