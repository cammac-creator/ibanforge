/**
 * Build one IBAN per country whose bank code is genuinely allocated.
 *
 * Why this file exists: EXAMPLE_IBANS carry invented bank codes. Austria,
 * Belgium and Switzerland all answered `not_in_register` on their example
 * IBAN while `authoritative: true` — the register exists, the code does not.
 * Measuring field coverage off those answers understates every register we
 * actually run.
 *
 * Method: keep the example IBAN's shape, swap in a real code of the same
 * width, recompute the check digits. Countries with no local table keep their
 * example IBAN and are marked so the two populations never get averaged
 * together.
 */
import Database from 'better-sqlite3';
import { validateIBAN } from '../../src/lib/iban.js';
import { EXAMPLE_IBANS } from 'iban-core';

const db = new Database('data/bic.sqlite', { readonly: true });

/** mod-97-10 over the rearranged IBAN, per ISO 13616. */
function checkDigits(cc: string, bban: string): string {
  const rearranged = `${bban}${cc}00`;
  let remainder = 0;
  for (const ch of rearranged) {
    const v = /[0-9]/.test(ch) ? ch : (ch.charCodeAt(0) - 55).toString();
    for (const d of v) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return String(98 - remainder).padStart(2, '0');
}

function realCode(cc: string): string | null {
  try {
    if (cc === 'AT' || cc === 'BE') {
      const r = db
        .prepare('SELECT code FROM national_bank_codes WHERE country = ? ORDER BY code LIMIT 1')
        .get(cc) as { code: string } | undefined;
      return r?.code ?? null;
    }
    if (cc === 'DE') {
      // The column is `blz`, not `code`: the Bundesbank table predates the
      // shared national_bank_codes shape and kept the register's own word.
      const r = db
        .prepare('SELECT blz AS code FROM de_blz WHERE retired = 0 ORDER BY blz LIMIT 1')
        .get() as { code: string } | undefined;
      return r?.code ?? null;
    }
    if (cc === 'CH' || cc === 'LI') {
      const col = db.prepare('PRAGMA table_info(ch_clearing)').all() as Array<{ name: string }>;
      const key = col.find((c) => /iid|bc_nummer|code/i.test(c.name))?.name;
      if (!key) return null;
      const r = db
        .prepare(`SELECT ${key} AS code FROM ch_clearing WHERE ${key} IS NOT NULL ORDER BY ${key} LIMIT 1`)
        .get() as { code: string | number } | undefined;
      return r ? String(r.code) : null;
    }
  } catch {
    return null;
  }
  return null;
}

export interface Probe {
  cc: string;
  iban: string;
  realCode: boolean;
}

export function probes(): Probe[] {
  const out: Probe[] = [];
  const examples = EXAMPLE_IBANS as unknown as Record<string, string>;
  for (const [cc, example] of Object.entries(examples).sort()) {
    const parsed = validateIBAN(example) as unknown as Record<string, unknown>;
    const bban = parsed.bban as Record<string, unknown> | undefined;
    const current = bban?.bank_code ? String(bban.bank_code) : null;
    const wanted = realCode(cc);

    if (!current || !wanted) {
      out.push({ cc, iban: example, realCode: false });
      continue;
    }
    const padded = wanted.padStart(current.length, '0');
    if (padded.length !== current.length) {
      out.push({ cc, iban: example, realCode: false });
      continue;
    }
    const body = example.slice(4);
    const at = body.indexOf(current);
    if (at < 0) {
      out.push({ cc, iban: example, realCode: false });
      continue;
    }
    const newBban = body.slice(0, at) + padded + body.slice(at + current.length);
    out.push({ cc, iban: `${cc}${checkDigits(cc, newBban)}${newBban}`, realCode: true });
  }
  return out;
}

if (process.argv[1]?.endsWith('real-codes.ts')) {
  const p = probes();
  const real = p.filter((x) => x.realCode);
  console.error(`${real.length} pays sondes avec un VRAI code, ${p.length - real.length} avec l'exemple`);
  for (const x of real) console.error(`  ${x.cc}  ${x.iban}`);
}
