/**
 * L'index des traces courantes, sur de petites bases inventées en mémoire.
 *
 * Aucun compte de la vraie base n'est figé ici : il bouge chaque mois. Les BIC
 * ci-dessous sont inventés (préfixes XMPL, ZZTR), sauf celui lu à l'exécution
 * dans la carte composite publique pour prouver qu'elle n'est pas une trace.
 */
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type DatabaseType from 'better-sqlite3';
import { listedIn, measureFrozenTrace, measureTraceIndex, traceIndex } from './bic-trace.js';
import { RESTRICTED_FAMILY } from './restricted-family.js';
import { frozenSources } from './source-vintage.js';
import { resetStatements } from './bic-lookup.js';
import { resetComplianceStatements } from './compliance.js';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3') as typeof DatabaseType;
const HERE = dirname(fileURLToPath(import.meta.url));

const FROZEN = frozenSources()[0]!.source;

/** Deux bases vides à la forme des vraies, avec chaque table que lit la trace. */
function emptyDbs(opts: { withoutVop?: boolean } = {}): {
  bic: DatabaseType.Database;
  compliance: DatabaseType.Database;
} {
  const bic = new Database(':memory:');
  bic.exec(`
    CREATE TABLE bic_entries (bic8 TEXT NOT NULL, bic11 TEXT NOT NULL, source TEXT);
    CREATE TABLE de_blz (blz TEXT, bic TEXT);
    CREATE TABLE national_bank_codes (country TEXT, code TEXT, bic TEXT);
    CREATE TABLE bg_bae (bae TEXT, bic TEXT);
    CREATE TABLE ch_clearing (iid TEXT, bic TEXT);
  `);
  const compliance = new Database(':memory:');
  compliance.exec('CREATE TABLE sepa_participants (bic8 TEXT, scheme TEXT, status TEXT);');
  if (!opts.withoutVop) compliance.exec('CREATE TABLE vop_participants (bic8 TEXT, status TEXT);');
  return { bic, compliance };
}

/**
 * Une ligne inventée par membre de la famille sous conditions que lit la trace,
 * lue dans la constante : sans elles, l'index se dit à raison incomplet.
 */
function seedRestrictedMembers(
  bic: DatabaseType.Database,
  compliance: DatabaseType.Database,
  skip: string[] = [],
): void {
  let n = 0;
  for (const m of RESTRICTED_FAMILY) {
    if (skip.includes(m.id) || m.minRows <= 0) continue;
    const bic8 = `ZZTR${String(n++).padStart(2, '0')}XX`;
    if (m.table === 'bic_entries' && m.where) {
      bic
        .prepare('INSERT INTO bic_entries (bic8, bic11, source) VALUES (?, ?, ?)')
        .run(bic8, `${bic8}XXX`, m.where.value);
    } else if (m.table === 'national_bank_codes' && m.where) {
      bic
        .prepare('INSERT INTO national_bank_codes (country, code, bic) VALUES (?, ?, ?)')
        .run(m.where.value, String(n), `${bic8}XXX`);
    } else if (m.table === 'sepa_participants') {
      compliance
        .prepare("INSERT INTO sepa_participants (bic8, scheme, status) VALUES (?, 'SCT', 'active')")
        .run(bic8);
    } else if (m.table === 'vop_participants') {
      try {
        compliance
          .prepare("INSERT INTO vop_participants (bic8, status) VALUES (?, 'active')")
          .run(bic8);
      } catch {
        // Table volontairement absente dans ce cas de test.
      }
    }
  }
}

function frozenRow(bic: DatabaseType.Database, bic8: string): void {
  bic
    .prepare('INSERT INTO bic_entries (bic8, bic11, source) VALUES (?, ?, ?)')
    .run(bic8, `${bic8}XXX`, FROZEN);
}

describe('measureTraceIndex', () => {
  const traces: Array<[label: string, write: (d: ReturnType<typeof emptyDbs>, b: string) => void]> =
    [
      [
        'a directory row from a source without a vintage (gleif)',
        (d, b) =>
          d.bic
            .prepare("INSERT INTO bic_entries (bic8, bic11, source) VALUES (?, ?, 'gleif')")
            .run(b, `${b}XXX`),
      ],
      [
        'the Bundesbank register (de_blz)',
        (d, b) => d.bic.prepare("INSERT INTO de_blz VALUES ('10000000', ?)").run(`${b}XXX`),
      ],
      [
        'a national register (national_bank_codes)',
        (d, b) => d.bic.prepare("INSERT INTO national_bank_codes VALUES ('SK', '9999', ?)").run(b),
      ],
      [
        'the Bulgarian register (bg_bae)',
        (d, b) => d.bic.prepare("INSERT INTO bg_bae VALUES ('XMPL9001', ?)").run(b),
      ],
      [
        'SIX BankMaster (ch_clearing)',
        (d, b) => d.bic.prepare("INSERT INTO ch_clearing VALUES ('99999', ?)").run(`${b}XXX`),
      ],
      [
        'the EPC SEPA registers (sepa_participants)',
        (d, b) =>
          d.compliance.prepare("INSERT INTO sepa_participants VALUES (?, 'SCT', 'active')").run(b),
      ],
      [
        'the EPC VoP register (vop_participants)',
        (d, b) => d.compliance.prepare("INSERT INTO vop_participants VALUES (?, 'active')").run(b),
      ],
    ];

  for (const [label, write] of traces) {
    it(`counts a frozen row as traced when ${label} carries its BIC8`, () => {
      const dbs = emptyDbs();
      seedRestrictedMembers(dbs.bic, dbs.compliance);
      frozenRow(dbs.bic, 'XMPLDEFF');
      write(dbs, 'XMPLDEFF');
      const index = measureTraceIndex(dbs.bic, dbs.compliance);
      expect(index.complete).toBe(true);
      expect(listedIn(index, 'XMPLDEFF')).toBe(true);
      const [frozen] = measureFrozenTrace(dbs.bic, dbs.compliance);
      expect(frozen!.rows_without_current_trace).toBe(0);
    });
  }

  it('counts a frozen row as untraced when only the frozen source carries it', () => {
    const dbs = emptyDbs();
    seedRestrictedMembers(dbs.bic, dbs.compliance);
    frozenRow(dbs.bic, 'XMPLNL2A');
    const index = measureTraceIndex(dbs.bic, dbs.compliance);
    expect(listedIn(index, 'XMPLNL2A')).toBe(false);
    const [frozen] = measureFrozenTrace(dbs.bic, dbs.compliance);
    expect(frozen).toMatchObject({
      source: FROZEN,
      rows: 1,
      bic8: 1,
      rows_without_current_trace: 1,
      bic8_without_current_trace: 1,
      complete: true,
    });
  });

  it('does not count static transcriptions as a trace', () => {
    // Un BIC que la carte composite publique porte bel et bien : la carte n'est
    // pas lue par l'index, sa seule présence ne rend donc aucun BIC tracé.
    const map = JSON.parse(readFileSync(resolve(HERE, '../db/bic_data.json'), 'utf8')) as Record<
      string,
      { bic: string }
    >;
    const curated = Object.values(map)[0]!.bic.slice(0, 8);
    const dbs = emptyDbs();
    seedRestrictedMembers(dbs.bic, dbs.compliance);
    frozenRow(dbs.bic, curated);
    expect(listedIn(measureTraceIndex(dbs.bic, dbs.compliance), curated)).toBe(false);
  });

  it('reports complete=false and null counts when a trace table is missing', () => {
    const dbs = emptyDbs({ withoutVop: true });
    seedRestrictedMembers(dbs.bic, dbs.compliance);
    frozenRow(dbs.bic, 'XMPLITMM');
    const index = measureTraceIndex(dbs.bic, dbs.compliance);
    expect(index.complete).toBe(false);
    expect(index.sources_read).not.toContain('vop_participants');
    const [frozen] = measureFrozenTrace(dbs.bic, dbs.compliance);
    expect(frozen!.complete).toBe(false);
    expect(frozen!.rows_without_current_trace).toBeNull();
    expect(frozen!.bic8_without_current_trace).toBeNull();
  });

  it('listedIn returns null, never false, on an incomplete index', () => {
    const dbs = emptyDbs({ withoutVop: true });
    seedRestrictedMembers(dbs.bic, dbs.compliance);
    frozenRow(dbs.bic, 'XMPLITMM');
    const index = measureTraceIndex(dbs.bic, dbs.compliance);
    expect(listedIn(index, 'XMPLITMM')).toBeNull();
    // Une trace trouvée reste une trace, même sur un index incomplet.
    dbs.bic.prepare("INSERT INTO de_blz VALUES ('10000000', 'XMPLDEFFXXX')").run();
    expect(listedIn(measureTraceIndex(dbs.bic, dbs.compliance), 'XMPLDEFF')).toBe(true);
  });

  it('is incomplete when a restricted member the trace reads is served without a single row', () => {
    const member = RESTRICTED_FAMILY.find((m) => m.table === 'bic_entries' && m.minRows > 0)!;
    const dbs = emptyDbs();
    seedRestrictedMembers(dbs.bic, dbs.compliance, [member.id]);
    frozenRow(dbs.bic, 'XMPLITMM');
    const index = measureTraceIndex(dbs.bic, dbs.compliance);
    expect(index.complete).toBe(false);
    expect(listedIn(index, 'XMPLITMM')).toBeNull();
  });

  it('reads the frozen sources from source-vintage, not from a literal', () => {
    const dbs = emptyDbs();
    seedRestrictedMembers(dbs.bic, dbs.compliance);
    // Une source millésimée de test, injectée : ses lignes cessent d'être une
    // trace et elle reçoit sa propre entrée.
    dbs.bic
      .prepare(
        "INSERT INTO bic_entries (bic8, bic11, source) VALUES ('XMPLFRPP', 'XMPLFRPPXXX', 'test_frozen')",
      )
      .run();
    const frozen = [...frozenSources(), { source: 'test_frozen', as_of: '2001-01' }];
    const index = measureTraceIndex(
      dbs.bic,
      dbs.compliance,
      frozen.map((f) => f.source),
    );
    expect(listedIn(index, 'XMPLFRPP')).toBe(false);
    const out = measureFrozenTrace(dbs.bic, dbs.compliance, frozen, index);
    expect(out.map((f) => f.source)).toEqual(frozen.map((f) => f.source));
    expect(out.at(-1)).toMatchObject({ source_as_of: '2001-01', rows: 1 });
    // Sans injection, la liste par défaut est exactement celle de source-vintage.
    expect(measureFrozenTrace(dbs.bic, dbs.compliance).map((f) => f.source)).toEqual(
      frozenSources().map((f) => f.source),
    );
  });
});

describe('traceIndex (the served databases, memoised)', () => {
  it('is recomputed after resetStatements and after resetComplianceStatements', () => {
    const first = traceIndex();
    expect(traceIndex()).toBe(first);
    resetStatements();
    const second = traceIndex();
    expect(second).not.toBe(first);
    resetComplianceStatements();
    expect(traceIndex()).not.toBe(second);
  });
});
