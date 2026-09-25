import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OVERLAY_FILE_NAMES, commandSeed, runCommand } from './restricted-overlay.js';
import {
  CARRY_OVER_MAX_AGE_DAYS,
  utcInstant,
  type CarriedMember,
} from './restricted-carry-over.js';
import { reportSeedMember } from './seed-report.js';
import {
  RESTRICTED_BIC_INSERT_ORDER,
  RESTRICTED_TABLES,
  membersOf,
  restrictedBicSources,
} from '../src/lib/restricted-family.js';
import { extractOverlay, inspectOverlay, sha256File } from '../src/lib/restricted-overlay.js';
import { parseManifest, type OverlayManifest } from '../src/lib/restricted-overlay-manifest.js';
import {
  installRestrictedFixture,
  type RestrictedFixture,
} from '../src/test-support/restricted-fixtures.js';
import {
  completeRestrictedFamily,
  type InventedFamily,
} from '../src/test-support/restricted-overlay-fixtures.js';

/**
 * La reprise membre par membre du passage mensuel BIC (`overlay seed --kind bic`)
 * quand une source est en panne. Aucun réseau : les seeders sont remplacés par
 * une doublure qui lit les lignes INVENTÉES de la base d'essai (préfixes XMP…,
 * src/test-support/) comme si c'était la source, sauf pour les membres « en
 * panne », et qui écrit le vrai rapport (reportSeedMember). Les vrais seeders,
 * lancés sans réseau, sont éprouvés dans restricted-seeders-offline.test.ts.
 */

/** L'expression exacte du masquage du dépôt privé (scripts/rafraichir.sh, `masquer`). */
const BIC_SHAPE = /\b[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/;

const BIC_COLUMNS = RESTRICTED_TABLES.bic
  .find((t) => t.name === 'bic_entries')!
  .columns.filter((c) => c !== 'id' && c !== 'updated_at')
  .join(', ');
const NATIONAL_COLUMNS = 'country, code, name, bic, street, post_code, town, lei, source';

interface Network {
  /** Les membres dont la source ne répond pas. */
  down?: readonly string[];
  /** L'horodatage que la reconstruction pose sur les lignes fraîches (SQLite, UTC). */
  stamp: string;
  /** Le mois de la liste PRA fraîche. */
  praMonth?: string;
  /** Des BIC11 qu'EBA STEP2 publie en plus, pour éprouver la préséance. */
  ebaExtra?: readonly string[];
  /** Des membres dont le seeder ne dit rien (faute de code simulée). */
  silent?: readonly string[];
}

/**
 * Les trois seeders sans réseau : même ordre, mêmes INSERT OR IGNORE que les
 * vrais, et le vrai rapport. La « source » d'un membre est la base d'essai.
 */
function fakeSeeders(sourcePath: string, net: Network) {
  const down = new Set(net.down ?? []);
  const silent = new Set(net.silent ?? []);
  return (script: string, env: Record<string, string>): void => {
    const note = (member: string, processed: number): void => {
      if (silent.has(member)) return;
      reportSeedMember(
        down.has(member)
          ? { member, state: 'failed', cause: 'http_503' }
          : { member, state: 'loaded', processed },
        env,
      );
    };
    const db = new Database(env.BIC_DB_PATH);
    try {
      db.prepare('ATTACH DATABASE ? AS src').run(sourcePath);
      if (script === 'enrich-bic-database.ts') {
        for (const source of RESTRICTED_BIC_INSERT_ORDER) {
          if (down.has(source)) {
            note(source, 0);
            continue;
          }
          let processed = db
            .prepare(
              `INSERT OR IGNORE INTO main.bic_entries (${BIC_COLUMNS}, updated_at)
               SELECT ${BIC_COLUMNS}, ? FROM src.bic_entries WHERE source = ? ORDER BY id`,
            )
            .run(net.stamp, source).changes;
          if (source === 'eba_step2')
            for (const bic11 of net.ebaExtra ?? []) {
              db.prepare(
                `INSERT OR IGNORE INTO main.bic_entries
                   (bic8, bic11, institution, country_code, country_name, city, branch_code, source, updated_at)
                 VALUES (?, ?, 'Remplissage EBA commun', 'PL', 'Poland', '', 'XXX', 'eba_step2', ?)`,
              ).run(bic11.slice(0, 8), bic11, net.stamp);
              processed++;
            }
          note(source, processed);
        }
      } else if (script === 'seed-national.ts') {
        for (const [cc, member] of [
          ['AT', 'register_at'],
          ['BE', 'register_be'],
          ['SM', 'register_sm'],
        ] as const) {
          if (down.has(member)) {
            note(member, 0);
            continue;
          }
          // Saint-Marin est daté du jour de lecture, comme le vrai seeder le fait.
          const n = db
            .prepare(
              `INSERT INTO main.national_bank_codes (${NATIONAL_COLUMNS}, as_of)
               SELECT ${NATIONAL_COLUMNS}, CASE WHEN country = 'SM' THEN ? ELSE as_of END
               FROM src.national_bank_codes WHERE country = ? ORDER BY rowid`,
            )
            .run(net.stamp.slice(0, 10), cc).changes;
          note(member, n);
        }
      } else if (script === 'seed-pra-banks.ts') {
        if (down.has('pra')) {
          note('pra', 0);
          return;
        }
        const n = db
          .prepare(
            `INSERT INTO main.pra_banks (frn, firm_name, lei, section, lei_basis, list_month, source, updated_at)
             SELECT frn, firm_name, lei, section, lei_basis, ?, source, ? FROM src.pra_banks ORDER BY rowid`,
          )
          .run(net.praMonth ?? '2026-09', net.stamp).changes;
        note('pra', n);
      } else throw new Error(`Seeder inattendu : ${script}`);
    } finally {
      db.close();
    }
  };
}

interface SeedOutput {
  path: string;
  sha256: string;
  members: Array<{ id: string; rows: number }>;
  carried_over: CarriedMember[];
}

/** Les lignes d'un membre, toutes colonnes sauf l'identifiant, dans leur ordre. */
function rowsOf(path: string, table: string, where: string, value: string): unknown[][] {
  const db = new Database(path, { readonly: true });
  try {
    const columns = RESTRICTED_TABLES.bic
      .find((t) => t.name === table)!
      .columns.filter((c) => c !== 'id');
    return db
      .prepare(`SELECT ${columns.join(', ')} FROM ${table} WHERE ${where} = ? ORDER BY rowid`)
      .raw(true)
      .all(value) as unknown[][];
  } finally {
    db.close();
  }
}

function metaOf(path: string): Record<string, string> {
  return inspectOverlay(path, 'bic').meta ?? {};
}

/** Tout ce qu'un passage montre : la sortie JSON (sans les chemins) et le journal. */
function shownText(output: SeedOutput | null, logs: string[], error?: unknown): string {
  const { path: _path, ...rest } = output ?? { path: '' };
  void _path;
  return [JSON.stringify(rest), ...logs, error instanceof Error ? error.message : ''].join('\n');
}

describe('overlay seed --kind bic : reprise membre par membre', () => {
  let fixture: RestrictedFixture;
  let family: InventedFamily;
  let root: string;
  /** La release de septembre : toutes les sources ont répondu. */
  let september: string;

  const SEPTEMBER = '2026-09-01T07:30:00.000Z';
  const OCTOBER = '2026-10-01T07:30:00.000Z';

  /** Un passage : la surcouche précédente posée à la sortie, comme le fait le dépôt privé. */
  function passage(
    name: string,
    options: { previous?: string; now: string; net: Network },
  ): { out: string; output: SeedOutput | null; logs: string[]; error?: unknown } {
    const dir = join(root, name);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, OVERLAY_FILE_NAMES.bic);
    if (options.previous) copyFileSync(options.previous, out);
    const logs: string[] = [];
    try {
      const output = commandSeed(
        new Map<string, string | true>([
          ['kind', 'bic'],
          ['out', out],
          ['public', fixture.bicPath],
        ]),
        {
          runSeeder: fakeSeeders(fixture.bicPath, options.net),
          now: () => new Date(options.now),
          log: (line) => logs.push(line),
        },
      ) as SeedOutput;
      return { out, output, logs };
    } catch (error) {
      return { out, output: null, logs, error };
    }
  }

  function manifestOf(dir: string, previous?: string): { code: number; manifest: OverlayManifest } {
    const out = join(dir, 'manifest.json');
    const { code } = runCommand([
      'manifest',
      '--dir',
      dir,
      '--out',
      out,
      '--commit',
      '0123456789abcdef0123456789abcdef01234567',
      ...(previous ? ['--previous', previous] : []),
    ]);
    const parsed = parseManifest(readFileSync(out, 'utf8'));
    if (!parsed.ok) throw new Error(parsed.error);
    return { code, manifest: parsed.manifest };
  }

  beforeAll(() => {
    fixture = installRestrictedFixture();
    family = completeRestrictedFamily(fixture.bicPath, fixture.compliancePath);
    root = mkdtempSync(join(tmpdir(), 'ibf-reprise-'));
    const first = passage('septembre', { now: SEPTEMBER, net: { stamp: '2026-09-01 07:31:00' } });
    if (!first.output) throw first.error;
    september = first.out;
  }, 120_000);

  afterAll(async () => {
    rmSync(root, { recursive: true, force: true });
    await fixture.restore();
  });

  it("l'ordre d'insertion partagé couvre exactement les sources de bic_entries", () => {
    expect([...RESTRICTED_BIC_INSERT_ORDER].sort()).toEqual([...restrictedBicSources()].sort());
  });

  it('toutes les sources répondent : rien de repris, le début du passage est noté', () => {
    const meta = metaOf(september);
    expect(meta.seed_started_at).toBe(SEPTEMBER);
    expect(meta.carried_over).toBeUndefined();
    expect(inspectOverlay(september, 'bic').members.every((m) => m.state === 'applied')).toBe(true);
  });

  it('EBA STEP2 en panne : repris tel quel avec sa date, les autres frais, check et manifest --previous acceptent', () => {
    const { out, output, logs, error } = passage('octobre-eba', {
      previous: september,
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', down: ['eba_step2'] },
    });
    expect(error).toBeUndefined();
    expect(output!.carried_over).toEqual([
      { member: 'eba_step2', source_date: SEPTEMBER, age_days: 30, cause: 'http_503' },
    ]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/^::warning title=Surcouche bic membre repris::eba_step2 repris/);
    expect(logs[0]).toContain(`donnée du ${SEPTEMBER}, 30 jours, cause http_503`);

    // Les lignes reprises sont celles de septembre, updated_at compris : jamais rajeunies.
    const eba = rowsOf(out, 'bic_entries', 'source', 'eba_step2');
    expect(eba).toEqual(rowsOf(september, 'bic_entries', 'source', 'eba_step2'));
    expect(eba.length).toBe(family.eba.length);
    const ebaUpdated = new Set(eba.map((r) => r[r.length - 1]));
    expect([...ebaUpdated]).toEqual(['2026-09-01 07:31:00']);
    // Les autres sont frais.
    const nbp = rowsOf(out, 'bic_entries', 'source', 'nbp');
    expect(new Set(nbp.map((r) => r[r.length - 1]))).toEqual(new Set(['2026-10-01 07:31:00']));
    expect(
      rowsOf(out, 'pra_banks', 'source', 'Bank of England').every((r) => r[5] === '2026-09'),
    ).toBe(true);

    // Le fichier le dit ; le chargeur de l'API l'accepte.
    const meta = metaOf(out);
    expect(meta.seed_started_at).toBe(OCTOBER);
    expect(JSON.parse(meta.carried_over)).toEqual({
      eba_step2: { source_date: SEPTEMBER, cause: 'http_503' },
    });
    expect(runCommand(['check', '--kind', 'bic', '--overlay', out]).code).toBe(0);

    // La porte de qualité face à la release de septembre, et le manifeste qui le dit.
    const previousManifest = manifestOf(join(root, 'septembre'));
    const { code, manifest } = manifestOf(
      join(root, 'octobre-eba'),
      join(root, 'septembre', 'manifest.json'),
    );
    expect(previousManifest.code).toBe(0);
    expect(code).toBe(0);
    expect(manifest.files.bic!.carried_over).toEqual({
      eba_step2: { source_date: SEPTEMBER, cause: 'http_503' },
    });
    expect(previousManifest.manifest.files.bic!.carried_over).toBeUndefined();

    // Le passage hebdomadaire reprend ce fichier tel quel : la liste le suit.
    const weekly = join(root, 'semaine-suivante');
    mkdirSync(weekly);
    copyFileSync(out, join(weekly, OVERLAY_FILE_NAMES.bic));
    const next = manifestOf(weekly, join(root, 'octobre-eba', 'manifest.json'));
    expect(next.code).toBe(0);
    expect(next.manifest.files.bic).toEqual(manifest.files.bic);

    // Un membre sorti de la famille depuis l'écriture du fichier n'entre pas dans
    // le manifeste : le lecteur refuserait le manifeste entier.
    const stale = join(root, 'membre-sorti');
    mkdirSync(stale);
    const staleFile = join(stale, OVERLAY_FILE_NAMES.bic);
    copyFileSync(out, staleFile);
    const db = new Database(staleFile);
    db.prepare("UPDATE overlay_meta SET value = ? WHERE key = 'carried_over'").run(
      JSON.stringify({
        eba_step2: { source_date: SEPTEMBER, cause: 'http_503' },
        membre_sorti: { source_date: SEPTEMBER, cause: 'network' },
      }),
    );
    db.close();
    expect(manifestOf(stale).manifest.files.bic!.carried_over).toEqual({
      eba_step2: { source_date: SEPTEMBER, cause: 'http_503' },
    });

    expect(shownText(output, logs)).not.toMatch(BIC_SHAPE);
  });

  it("NBP en panne : l'ordre OeNB, NBP, EBA STEP2 est gardé, un BIC11 commun reste à NBP", () => {
    const shared = family.nbp[0];
    const { out, output, error } = passage('octobre-nbp', {
      previous: september,
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', down: ['nbp'], ebaExtra: [shared] },
    });
    expect(error).toBeUndefined();
    expect(output!.carried_over.map((c) => c.member)).toEqual(['nbp']);
    const db = new Database(out, { readonly: true });
    try {
      expect(
        (
          db.prepare('SELECT source FROM bic_entries WHERE bic11 = ?').get(shared) as {
            source: string;
          }
        ).source,
      ).toBe('nbp');
      const ranges = db
        .prepare(
          'SELECT source, MIN(id) AS first, MAX(id) AS last FROM bic_entries GROUP BY source',
        )
        .all() as Array<{ source: string; first: number; last: number }>;
      const at = (s: string) => ranges.find((r) => r.source === s)!;
      expect(at('oenb').last).toBeLessThan(at('nbp').first);
      expect(at('nbp').last).toBeLessThan(at('eba_step2').first);
    } finally {
      db.close();
    }
    expect(rowsOf(out, 'bic_entries', 'source', 'nbp')).toEqual(
      rowsOf(september, 'bic_entries', 'source', 'nbp'),
    );
  });

  it('registre autrichien en panne (non daté) : repris avec la date du passage qui l’a lu', () => {
    const { out, output, error } = passage('octobre-at', {
      previous: september,
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', down: ['register_at'] },
    });
    expect(error).toBeUndefined();
    expect(output!.carried_over).toEqual([
      { member: 'register_at', source_date: SEPTEMBER, age_days: 30, cause: 'http_503' },
    ]);
    expect(rowsOf(out, 'national_bank_codes', 'country', 'AT')).toEqual(
      rowsOf(september, 'national_bank_codes', 'country', 'AT'),
    );
    expect(runCommand(['check', '--kind', 'bic', '--overlay', out]).code).toBe(0);
  });

  it('une seconde reprise garde la date d’origine ; au-delà de 45 jours, refus', () => {
    const second = passage('reprise-2', {
      previous: join(root, 'octobre-at', OVERLAY_FILE_NAMES.bic),
      now: '2026-10-10T07:30:00.000Z',
      net: { stamp: '2026-10-10 07:31:00', down: ['register_at'] },
    });
    expect(second.error).toBeUndefined();
    expect(second.output!.carried_over).toEqual([
      { member: 'register_at', source_date: SEPTEMBER, age_days: 39, cause: 'http_503' },
    ]);
    const third = passage('reprise-3', {
      previous: second.out,
      now: '2026-10-20T07:30:00.000Z',
      net: { stamp: '2026-10-20 07:31:00', down: ['register_at'] },
    });
    expect((third.error as Error).message).toMatch(
      /register_at : donnée du 2026-09-01T07:30:00.000Z, 49 jours, au-delà de la borne de 45 jours/,
    );
    // Rien d'écrit : la sortie est encore la surcouche précédente.
    expect(sha256File(third.out)).toBe(sha256File(second.out));
    expect(CARRY_OVER_MAX_AGE_DAYS).toBe(45);
  });

  it('aucun membre rafraîchi : refus, la surcouche précédente reste intacte', () => {
    const everything = membersOf('bic').map((m) => m.id);
    const { out, error, logs } = passage('tout-en-panne', {
      previous: september,
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', down: everything },
    });
    expect((error as Error).message).toMatch(
      /Reprise impossible, rien n’est écrit : aucun membre rafraîchi/,
    );
    expect(sha256File(out)).toBe(sha256File(september));
    expect(shownText(null, logs, error)).not.toMatch(BIC_SHAPE);
  });

  it('première publication sans surcouche précédente : refus, comme avant', () => {
    const { out, error } = passage('premiere', {
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', down: ['eba_step2'] },
    });
    expect((error as Error).message).toMatch(
      /aucune surcouche précédente à reprendre, première publication \(eba_step2 http_503\)/,
    );
    expect(existsSync(out)).toBe(false);
  });

  it('la liste PRA reprise doit tenir dans la fenêtre du seeder (le mois et les deux précédents)', () => {
    // Une précédente dont la liste est de juin, lue le 1er septembre.
    const june = passage('pra-juin', {
      now: SEPTEMBER,
      net: { stamp: '2026-09-01 07:31:00', praMonth: '2026-06' },
    });
    expect(june.error).toBeUndefined();
    const refused = passage('pra-refus', {
      previous: june.out,
      now: '2026-09-20T07:30:00.000Z',
      net: { stamp: '2026-09-20 07:31:00', down: ['pra'] },
    });
    expect((refused.error as Error).message).toMatch(
      /pra : liste de 2026-06, hors de la fenêtre du seeder \(le mois du passage et les 2 précédents\)/,
    );
    const july = passage('pra-juillet', {
      now: SEPTEMBER,
      net: { stamp: '2026-09-01 07:31:00', praMonth: '2026-07' },
    });
    const accepted = passage('pra-accepte', {
      previous: july.out,
      now: '2026-09-20T07:30:00.000Z',
      net: { stamp: '2026-09-20 07:31:00', down: ['pra'] },
    });
    expect(accepted.error).toBeUndefined();
    expect(accepted.output!.carried_over).toEqual([
      { member: 'pra', source_date: SEPTEMBER, age_days: 19, cause: 'http_503' },
    ]);
    // Le mois de la liste, condition de la permission, reste le vrai.
    const months = new Set(
      rowsOf(accepted.out, 'pra_banks', 'source', 'Bank of England').map((r) => r[5]),
    );
    expect([...months]).toEqual(['2026-07']);
  });

  it('un membre refusé dans la surcouche précédente ne se reprend pas', () => {
    const dir = join(root, 'precedente-abimee');
    mkdirSync(dir);
    const tampered = join(dir, 'restricted-bic.sqlite');
    copyFileSync(september, tampered);
    const db = new Database(tampered);
    db.prepare(
      `UPDATE national_bank_codes SET name = name || ' modifié'
       WHERE rowid = (SELECT MIN(rowid) FROM national_bank_codes WHERE country = 'BE')`,
    ).run();
    db.close();
    const { error } = passage('reprise-abimee', {
      previous: tampered,
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', down: ['register_be'] },
    });
    expect((error as Error).message).toMatch(
      /register_be refusé dans la surcouche précédente \(content_hash_mismatch\)/,
    );
  });

  it('un seeder qui ne dit rien est une faute de code : refus', () => {
    const { error } = passage('silence', {
      previous: september,
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', silent: ['register_sm'] },
    });
    expect((error as Error).message).toMatch(
      /Rapport des seeders incomplet.*register_sm sans rapport/,
    );
  });

  it('précédente écrite avant la reprise : dates des lignes, sinon création si `seed`, sinon refus', () => {
    // La forme de la release du 25/09/2026 : ni seed_started_at ni carried_over.
    const legacyDir = join(root, 'ancienne');
    mkdirSync(legacyDir);
    const copy = join(legacyDir, 'base.sqlite');
    copyFileSync(fixture.bicPath, copy);
    const legacy = join(legacyDir, 'restricted-bic.sqlite');
    extractOverlay({ kind: 'bic', sourcePath: copy, outPath: legacy, generator: 'seed' });
    const meta = metaOf(legacy);
    expect(meta.seed_started_at).toBeUndefined();

    // EBA STEP2 : la date de ses lignes (2026-01-01 00:00:00 en SQLite), lue en UTC.
    const eba = passage('ancienne-eba', {
      previous: legacy,
      now: '2026-01-20T00:00:00.000Z',
      net: { stamp: '2026-01-20 00:01:00', down: ['eba_step2'] },
    });
    expect(eba.error).toBeUndefined();
    expect(eba.output!.carried_over).toEqual([
      {
        member: 'eba_step2',
        source_date: '2026-01-01T00:00:00.000Z',
        age_days: 19,
        cause: 'http_503',
      },
    ]);

    // L'Autriche ne date rien : la création du fichier écrit par un passage `seed`.
    const created = new Date(meta.created_at).toISOString();
    const at = passage('ancienne-at', {
      previous: legacy,
      now: new Date(Date.parse(created) + 10 * 86_400_000).toISOString(),
      net: { stamp: '2026-10-01 07:31:00', down: ['register_at'] },
    });
    expect(at.error).toBeUndefined();
    expect(at.output!.carried_over).toEqual([
      { member: 'register_at', source_date: created, age_days: 10, cause: 'http_503' },
    ]);

    // Écrite par `extract` (Geste 4) : la date de lecture de l'Autriche est inconnue.
    const extracted = join(legacyDir, 'extrait', 'restricted-bic.sqlite');
    mkdirSync(join(legacyDir, 'extrait'));
    extractOverlay({ kind: 'bic', sourcePath: copy, outPath: extracted, generator: 'extract' });
    const unknown = passage('ancienne-extract', {
      previous: extracted,
      now: OCTOBER,
      net: { stamp: '2026-10-01 07:31:00', down: ['register_at'] },
    });
    expect((unknown.error as Error).message).toMatch(
      /register_at : date d'origine inconnue dans la surcouche précédente/,
    );
  });
});

describe('utcInstant', () => {
  it('lit les dates SQLite en UTC, quel que soit le fuseau de la machine', () => {
    const before = process.env.TZ;
    try {
      for (const tz of ['UTC', 'Europe/Zurich', 'Pacific/Kiritimati', 'America/Los_Angeles']) {
        process.env.TZ = tz;
        expect(utcInstant('2026-09-01 07:31:00'), tz).toBe('2026-09-01T07:31:00.000Z');
        // SQLite lit aussi en UTC la forme à « T » sans fuseau : même règle ici.
        expect(utcInstant('2026-09-01T07:31:00'), tz).toBe('2026-09-01T07:31:00.000Z');
        expect(utcInstant('2026-01-15'), tz).toBe('2026-01-15T00:00:00.000Z');
        expect(utcInstant('2026-09-01T07:31:00+02:00'), tz).toBe('2026-09-01T05:31:00.000Z');
        expect(utcInstant('2026-09-01T07:31:00.123Z'), tz).toBe('2026-09-01T07:31:00.123Z');
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
    // Toute autre forme est refusée, jamais devinée.
    expect(utcInstant('01.09.2026')).toBeNull();
    expect(utcInstant('2026-09-01 07:31')).toBeNull();
    expect(utcInstant(null)).toBeNull();
  });
});
