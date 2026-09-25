import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SEED_REPORT_ENV,
  failureCause,
  readSeedReport,
  reportSeedMember,
  seedReportActive,
} from './seed-report.js';

/**
 * Le rapport des seeders de la chaîne privée de la surcouche : des codes, jamais
 * un message ; rien du tout sans la variable (les robots publics).
 */
describe('seed-report', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ibf-rapport-seeders-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('sans SEED_REPORT_PATH, rien n’est écrit (les robots publics ne changent pas)', () => {
    const env = {};
    expect(seedReportActive(env)).toBe(false);
    reportSeedMember({ member: 'nbp', state: 'failed', cause: 'network' }, env);
    expect(readSeedReport(join(dir, 'absent.jsonl')).size).toBe(0);
  });

  it('écrit une ligne par membre, la dernière l’emporte', () => {
    const path = join(dir, 'rapport.jsonl');
    const env = { [SEED_REPORT_ENV]: path };
    expect(seedReportActive(env)).toBe(true);
    reportSeedMember({ member: 'nbp', state: 'failed', cause: 'network' }, env);
    reportSeedMember({ member: 'register_at', state: 'loaded', processed: 870 }, env);
    reportSeedMember({ member: 'nbp', state: 'loaded', processed: 21 }, env);
    const report = readSeedReport(path);
    expect([...report.values()]).toEqual([
      { member: 'nbp', state: 'loaded', processed: 21 },
      { member: 'register_at', state: 'loaded', processed: 870 },
    ]);
    expect(existsSync(path)).toBe(true);
  });

  it('refuse un rapport mal formé, à l’écriture comme à la lecture', () => {
    const env = { [SEED_REPORT_ENV]: join(dir, 'refus.jsonl') };
    expect(() =>
      reportSeedMember({ member: 'nbp', state: 'failed', cause: 'HTTP 503 for https://x' }, env),
    ).toThrow(/mal formé/);
    expect(() => reportSeedMember({ member: 'nbp', state: 'failed' }, env)).toThrow(/mal formé/);
    expect(() => reportSeedMember({ member: 'Membre', state: 'loaded' }, env)).toThrow(/mal formé/);
    const path = join(dir, 'illisible.jsonl');
    writeFileSync(path, '{"member":"nbp","state":"perdu"}\n');
    expect(() => readSeedReport(path)).toThrow(/illisible/);
    writeFileSync(path, 'pas du JSON\n');
    expect(() => readSeedReport(path)).toThrow(/illisible/);
  });

  it('failureCause rend un code court, jamais le texte de l’erreur', () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const cases: Array<[unknown, string]> = [
      [timeout, 'timeout'],
      [new Error('HTTP 503 for https://example.net/liste.csv'), 'http_503'],
      [new Error('https://example.net/registre.csv -> HTTP 404'), 'http_404'],
      [new TypeError('fetch failed'), 'network'],
      [new Error('EBA Step2 download failed (tried 48 candidate URLs)'), 'download_failed'],
      [new Error('AT: only 12 codes parsed, expected at least 700. Refusing.'), 'below_floor'],
      [new Error('AT: header row not found, format changed'), 'error'],
      ['une chaîne', 'error'],
      [null, 'error'],
    ];
    for (const [err, code] of cases) expect(failureCause(err), String(err)).toBe(code);
  });
});
