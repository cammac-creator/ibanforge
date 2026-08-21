import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getComplianceDB } from '../lib/compliance-db.js';

/**
 * No served surface may claim a sanctions list we do not screen.
 *
 * ## Why this test exists rather than another round of find-and-replace
 *
 * On 26/07/2026 commit 923413e removed the "OFAC/EU/UN/SECO" claim from 65
 * places across 37 files: three languages of UI copy, the docs, the playground,
 * the MCP descriptors, llms.txt, both SDK READMEs and the served database
 * metadata. It added no test. Two days later the claim was still live at
 * https://ibanforge.com/.well-known/mcp.json, a machine-readable descriptor
 * that agents and catalogues read, because a static file in frontend/public
 * was not in anyone's head at the time.
 *
 * That is the whole argument for this file. A claim spread over 37 files
 * cannot be held by memory; it needs something that fails.
 *
 * ## Why it matters more than an ordinary copy mistake
 *
 * This is a compliance product, so the promise IS the thing being bought, and
 * SECO is the Swiss authority — the jurisdiction the entire positioning rests
 * on. An assistant reading the descriptor would recommend IBANforge for UN or
 * SECO screening; the buyer discovers otherwise on a false negative, which is
 * the most expensive moment possible.
 *
 * ## What the test asserts
 *
 * First, the ground truth: which source lists the shipped database actually
 * holds. Then that no served text names a sanctions authority absent from it.
 * If a UN or SECO feed is ever genuinely wired in, this test starts passing on
 * its own and the copy may be updated — which is the correct order.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/** Directories that never reach a customer. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage',
  '.superpowers', '.claude', 'docs', 'data', 'tmp',
]);

/** Extensions worth scanning: served code, copy, descriptors and manifests. */
const EXTS = /\.(ts|tsx|js|mjs|json|md|mdx|txt|html)$/;

/** Files whose mention of a list is a description of the pipeline, not a promise to a customer. */
const ALLOWED = new Set([
  'scripts/refresh-compliance.ts', // the fetcher: it may name a feed it attempts
  'CHANGELOG.md',                  // history, and it documents this very removal
  'src/routes/sanctions-claims.test.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue; // a broken symlink is not a served surface
    }
    if (s.isDirectory()) walk(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

describe('sanctions coverage claims match the shipped database', () => {
  const shipped = new Set(
    (getComplianceDB().prepare('SELECT DISTINCT source_list FROM sanctioned_entities').all() as Array<{ source_list: string }>)
      .map((r) => r.source_list.toUpperCase()),
  );

  it('the database holds OFAC, EU and UN, and not SECO', () => {
    // Pinned as ground truth so the rest of the file has something to compare
    // against. If a feed is genuinely added, this is the assertion to change
    // first, before any copy.
    //
    // UN joined on 21/08/2026, and not because a feed was added: the refresh
    // script used to discard any listed BIC absent from our own directory, and
    // all 5 the UN list carries were in that case. Lifting that filter — the
    // fix for the EU list losing half its coverage the same way — made the UN
    // rows appear. The claim string is now derived from this table rather than
    // retyped, so the two cannot drift apart again.
    expect([...shipped].sort()).toEqual(['EU', 'OFAC', 'UN']);
  });

  it('no served surface names a sanctions authority we do not screen', () => {
    // Only forms that assert screening. "SECONDARY", "UNITED KINGDOM" and the
    // like must not trip it, so the pattern requires the authority to sit in a
    // list of sanctions bodies rather than merely appear as letters.
    const CLAIM = /\b(OFAC|EU)\s*[/,]\s*(EU|UN|SECO)(\s*[/,]\s*(UN|SECO|EU))*/i;
    const NAMED = /\b(UN|SECO)\b/;

    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        const m = CLAIM.exec(line);
        if (!m) continue;
        // The matched run lists authorities; flag any that is not shipped.
        for (const authority of m[0].split(/[/,]/).map((s) => s.trim().toUpperCase())) {
          if (NAMED.test(authority) && !shipped.has(authority)) {
            offenders.push(`${rel}: ${line.trim().slice(0, 140)}`);
            break;
          }
        }
      }
    }

    expect(offenders, `Surfaces claiming a sanctions list that is not in the database:\n${offenders.join('\n')}`).toEqual([]);
  });
});

describe('served copy claims only what the product can prove', () => {
  it('no served surface promises account-level verification', () => {
    // The API validates an IBAN and identifies the bank behind it. It cannot
    // see accounts or account holders. Copy that promises more sells a check
    // we do not perform — the exact wording that turned the NL composite-map
    // gap into a liability (src/lib/nl-psp.ts: a fabricated IBAN came back
    // "verified" naming a corporate treasury as the bank). Same audit trail
    // as the sanctions guard above: the phrasing lived on eleven surfaces,
    // so it needs something that fails, not another sweep.
    const FORBIDDEN: Array<[RegExp, string]> = [
      [/vet a counterparty/i, 'promises payee vetting; we screen the bank'],
      [/\bbank exists\b/i, 'a composite-map hit is not proof of existence'],
      [/banque existante/i, 'French variant of the same promise'],
      [/Bank existiert/i, 'German variant of the same promise'],
      [/verify a bank account number/i, 'we validate IBANs, not accounts'],
      [/payment will go through/i, 'we answer bank reachability, not payment outcome'],
      [/is a real bank\b/i, 'issuer classification, not proof of life'],
    ];

    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        for (const [pattern, why] of FORBIDDEN) {
          if (pattern.test(line)) {
            offenders.push(`${rel} (${why}): ${line.trim().slice(0, 140)}`);
          }
        }
      }
    }

    expect(offenders, `Surfaces promising a check we do not perform:\n${offenders.join('\n')}`).toEqual([]);
  });
});
