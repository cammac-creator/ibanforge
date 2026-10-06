import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import de from '@/messages/de.json';
import fr from '@/messages/fr.json';
import { DPF_CHECKED_ON, OPERATOR_ADDRESS_LINES, TRUST_PROCESSORS } from './trust';

/**
 * The "Security and trust" page (/trust) summarises the contractual texts. A
 * summary that drifts from its documents is worse than no summary: an EU
 * buyer's review compares the two line by line. These checks hold the page to
 * the DPA (Annex II), the Privacy Policy (§3) and the Legal Notice.
 */

const LEGAL = join(process.cwd(), 'content', 'legal');
const read = (rel: string) => readFileSync(join(LEGAL, rel), 'utf8');

/** The data rows of the markdown table that follows `heading`. */
function tableRows(doc: string, heading: string): string[] {
  const start = doc.indexOf(heading);
  expect(start, heading).toBeGreaterThanOrEqual(0);
  const lines = doc.slice(start).split('\n');
  const first = lines.findIndex((l) => l.startsWith('|'));
  const table: string[] = [];
  for (const line of lines.slice(first)) {
    if (!line.startsWith('|')) break;
    table.push(line);
  }
  // Header and separator rows are not processors.
  return table.slice(2);
}

describe('the sub-processors of the trust page', () => {
  it.each([
    ['dpa.mdx', '## Annex II'],
    ['de/dpa.mdx', '## Anhang II'],
  ])('match Annex II of %s, register entry by register entry', (rel, heading) => {
    const doc = read(rel);
    const rows = tableRows(doc, heading);
    expect(rows).toHaveLength(TRUST_PROCESSORS.length);
    for (const { key, dpf, basis } of TRUST_PROCESSORS) {
      // Every register entry of the page is in the annex, cell for cell.
      if (dpf !== null) {
        expect(new URL(dpf).hostname, key).toBe('www.dataprivacyframework.gov');
        expect(rows.some((r) => r.includes(`(${dpf})`)), `${key} ${dpf}`).toBe(true);
      }
      if (key === 'anthropic' && basis !== null) {
        expect(rows.some((r) => r.includes(`(${basis})`)), key).toBe(true);
      }
    }
  });

  it.each([
    ['privacy.mdx', '## 3. Processors we use'],
    ['de/privacy.mdx', '## 3. Unsere Auftragsverarbeiter'],
  ])('are the processors listed in §3 of %s', (rel, heading) => {
    expect(tableRows(read(rel), heading)).toHaveLength(TRUST_PROCESSORS.length);
  });

  it('carry a name, a role, a region, an answer on IBANs and a basis in every language', () => {
    for (const catalogue of [en, de, fr]) {
      for (const { key } of TRUST_PROCESSORS) {
        const row = catalogue.legal.trust.processors.rows[key];
        for (const field of ['name', 'role', 'region', 'ibans', 'basis'] as const) {
          expect(row[field].length, `${key}.${field}`).toBeGreaterThan(1);
        }
      }
    }
  });

  it('date the register check the same way as the DPA', () => {
    expect(DPF_CHECKED_ON).toBe('2026-10-05');
    expect(en.legal.trust.processors.sub).toContain('October 5, 2026');
    expect(read('dpa.mdx')).toContain('on October 5, 2026');
    expect(de.legal.trust.processors.sub).toContain('5. Oktober 2026');
    expect(read('de/dpa.mdx')).toContain('am 5. Oktober 2026');
  });

  it('never call the EU card processor itself certified', () => {
    // The register entry is Stripe, LLC, the US affiliate; the processor is
    // Stripe Payments Europe, in the EU.
    expect(en.legal.trust.processors.rows.stripe.basis).toMatch(/Established in the EU/);
    expect(en.legal.trust.processors.rows.stripe.basis).toMatch(/Stripe, LLC/);
  });
});

describe('the operator and the promises the page repeats', () => {
  it('prints the address of the Legal Notice', () => {
    for (const rel of ['imprint.mdx', 'de/imprint.mdx']) {
      for (const line of OPERATOR_ADDRESS_LINES) {
        expect(read(rel), `${rel}: ${line}`).toContain(line);
      }
    }
  });

  it('repeats the Terms and the Privacy Policy, not more', () => {
    expect(read('terms.mdx')).toContain('at least six months before it stops');
    expect(read('terms.mdx')).toContain('at least 30 days\' notice for a free key');
    expect(read('privacy.mdx')).toContain('Yes, **7 days**, then deleted by Railway');
    expect(read('privacy.mdx')).toContain('at most the **first 4 characters**');
    expect(en.legal.trust.retention.rows['1'].keep).toContain('first 4 characters');
    expect(en.legal.trust.retention.rows['3'].keep).toContain('7 days');
    // The one-time view of a fresh key is said next to the hashing, as in DPA 4.2.
    expect(read('dpa.mdx')).toContain('after 7 days at the latest');
    expect(en.legal.trust.security.keys).toContain('after 7 days at the latest');
  });

  it('declare the backups, the audit right and the e-mail notice the same way everywhere', () => {
    const dpa = read('dpa.mdx');
    const dpaDe = read('de/dpa.mdx');
    const privacy = read('privacy.mdx');
    const privacyDe = read('de/privacy.mdx');
    // Backups: nightly at Infomaniak for 30 days, monthly copies on the
    // operator's computer, the last three kept; a deleted address ages out of
    // them within 90 days. The restore cannot leave an erased address out,
    // so nothing may promise that it does; nothing calls the copies encrypted.
    for (const text of [dpa, privacy]) {
      expect(text).toContain('backed up every night to a server of Infomaniak in Switzerland');
      expect(text).toContain('monthly copies, the last three kept');
      expect(text).toContain('age out within 90 days');
      expect(text).not.toMatch(/never restored|encrypted backup|backups? (?:are|is) encrypted/i);
    }
    for (const text of [dpaDe, privacyDe]) {
      expect(text).toContain('jede Nacht auf einen Server von Infomaniak in der Schweiz gesichert');
      expect(text).toContain('von denen die letzten drei aufbewahrt werden');
      expect(text).toContain('innerhalb von 90 Tagen aus');
    }
    expect(dpa).toContain('**4.8** **Backup:**');
    expect(dpa).toContain('The restore is tested.');
    expect(dpaDe).toContain('**4.8** **Sicherung:**');
    // Infomaniak's role says it in all four tables and on the page.
    for (const [rel, heading] of [
      ['dpa.mdx', '## Annex II'],
      ['de/dpa.mdx', '## Anhang II'],
      ['privacy.mdx', '## 3. Processors we use'],
      ['de/privacy.mdx', '## 3. Unsere Auftragsverarbeiter'],
    ] as const) {
      const row = tableRows(read(rel), heading).find((r) => r.includes('Infomaniak'));
      expect(row, rel).toMatch(/backup of the account state|Sicherung des Kontostands/);
    }
    expect(en.legal.trust.processors.rows.infomaniak.role).toContain('nightly backup');
    expect(en.legal.trust.retention.rows['5'].keep).toContain('age out within 90 days');
    expect(en.legal.trust.retention.rows['6'].keep).toContain('the last three kept');
    // Audit and inspection, and the e-mail before a new sub-processor.
    expect(dpa).toContain('may carry out an audit, including an inspection, once per calendar year at most');
    expect(dpa).not.toContain('on-site audits are replaced');
    expect(dpaDe).toContain('eine Prüfung einschließlich einer Inspektion durchführen');
    expect(dpa).toContain('(keys without an address: the changelog only)');
    expect(dpaDe).toContain('(Schlüssel ohne Adresse: nur über das Changelog)');
    expect(en.legal.trust.processors.changes).toContain('by e-mail to the address of each active key');
    expect(en.legal.trust.documents.dpaNote).toContain('including an inspection');
  });

  it('is written without long dashes in German and French', () => {
    for (const catalogue of [de, fr]) {
      expect(JSON.stringify(catalogue.legal.trust)).not.toContain('—');
      expect(JSON.stringify(catalogue.legal.translation)).not.toContain('—');
    }
  });

  it('describes the CI and the data refreshes as the workflow files run them', () => {
    // The sentence on tests is checkable by anyone in the public repository,
    // so it must stay true of the files: ci.yml on pull requests and pushes to
    // main (the robots push with GITHUB_TOKEN, which triggers no other
    // workflow, hence "the operator"), the BIC, Czech and Italian refreshes
    // behind `npm run test` and the quality diff, the compliance refresh
    // behind its claims test only.
    const wf = (name: string) =>
      readFileSync(join(process.cwd(), '..', '.github', 'workflows', name), 'utf8');
    const ci = wf('ci.yml');
    expect(ci).toMatch(/push:\s*\n\s*branches: \[main\]/);
    expect(ci).toMatch(/pull_request:\s*\n\s*branches: \[main\]/);
    expect(ci).toMatch(/\n {2}docker:/);
    for (const name of ['refresh-bic.yml', 'refresh-cz-register.yml', 'refresh-it-register.yml']) {
      const w = wf(name);
      expect(w, name).toContain('npm run test');
      expect(w, name).toContain('scripts/refresh-diff.ts');
      expect(w.indexOf('npm run test'), name).toBeLessThan(w.indexOf('git push'));
    }
    const compliance = wf('refresh-compliance.yml');
    expect(compliance).toContain('src/routes/sanctions-claims.test.ts');
    expect(compliance).not.toContain('npm run test');
    expect(en.legal.trust.security.tests).toContain('the operator pushes');
    expect(en.legal.trust.security.tests).toContain('the weekly compliance refresh checks');
  });

  it('is linked from the Legal Notice in both languages', () => {
    expect(read('imprint.mdx')).toContain('](/trust)');
    expect(read('de/imprint.mdx')).toContain('](/de/trust)');
  });
});
