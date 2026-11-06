import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { restrictedTable } from './restricted-family.js';

/**
 * Le champ `compliance.finma_register`, sur la base publique avec et sans la table :
 * une absence dit toujours « non vérifié », jamais « non autorisé », et le score ne
 * bouge pas d'un point. L'IID et le libellé des lignes d'essai sont des valeurs
 * inventées, posées sur le numéro de banque public de l'exemple suisse.
 */

// Un IBAN suisse inventé, sur un numéro de banque public du fichier de SIX.
const CH_IBAN = 'CH2500700012345678901';
const CH_IID = '00700';
const DE_IBAN = 'DE89370400440532013000';
const NOW = new Date('2026-11-06T12:00:00Z');

const ROOT = resolve(import.meta.dirname, '../..');
let dir: string;

async function modules(dbPath: string) {
  vi.resetModules();
  vi.stubEnv('COMPLIANCE_DB_PATH', dbPath);
  vi.stubEnv('RESTRICTED_COMPLIANCE_OVERLAY_PATH', '');
  const db = await import('./compliance-db.js');
  db.closeComplianceDB();
  return {
    check: await import('./finma-register.js'),
    response: await import('./compliance-response.js'),
    closeDb: db.closeComplianceDB,
  };
}

function base(name: string, asOf?: string, withRow = true): string {
  const path = join(dir, name);
  copyFileSync(join(ROOT, 'data/compliance.sqlite'), path);
  if (asOf) {
    const db = new Database(path);
    for (const statement of restrictedTable('compliance', 'finma_register').ddl) db.exec(statement);
    db.prepare('INSERT INTO finma_register VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      '99999',
      'CHE-333.333.333',
      'Other',
      null,
      null,
      null,
      'lei_to_uid',
      asOf,
    );
    if (withRow) {
      const insert = db.prepare('INSERT INTO finma_register VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const type of ['Bank', 'Custodian bank']) {
        insert.run(CH_IID, 'CHE-111.111.111', type, 'de', 'fr', 'it', 'lei_to_uid', asOf);
      }
    }
    db.close();
  }
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'ibanforge-finma-register-'));
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('checkFinmaRegister', () => {
  it('sans la table : non vérifié, registre non chargé', async () => {
    const { check, closeDb } = await modules(base('sans.sqlite'));
    expect(check.checkFinmaRegister(CH_IID, NOW)).toMatchObject({
      status: 'not_verified',
      reason: 'register_not_loaded',
      as_of: null,
    });
    closeDb();
  });

  it('listé : les libellés tels quels, l’IDE, la source et la date', async () => {
    const { check, closeDb } = await modules(base('avec.sqlite', '2026-11-04'));
    expect(check.checkFinmaRegister(CH_IID, NOW)).toEqual({
      status: 'listed',
      licence_types: [
        { en: 'Bank', de: 'de', fr: 'fr', it: 'it' },
        { en: 'Custodian bank', de: 'de', fr: 'fr', it: 'it' },
      ],
      uid: 'CHE-111.111.111',
      matched_by: 'lei_to_uid',
      as_of: '2026-11-04',
      source: check.FINMA_REGISTER_SOURCE,
      source_url: check.FINMA_REGISTER_SOURCE_URL,
      note: check.FINMA_REGISTER_NOTE,
    });
    closeDb();
  });

  it('un numéro absent : non vérifié, jamais un refus', async () => {
    const { check, closeDb } = await modules(base('absent.sqlite', '2026-11-04'));
    const answer = check.checkFinmaRegister('00001', NOW);
    expect(answer).toMatchObject({ status: 'not_verified', reason: 'no_common_identifier' });
    expect(answer.as_of).toBe('2026-11-04');
    expect(check.checkFinmaRegister(null, NOW).status).toBe('not_verified');
    closeDb();
  });

  it('une copie trop vieille n’est plus une réponse, même pour un numéro listé', async () => {
    const { check, closeDb } = await modules(base('vieille.sqlite', '2026-10-01'));
    expect(check.checkFinmaRegister(CH_IID, NOW)).toMatchObject({
      status: 'not_verified',
      reason: 'copy_too_old',
      as_of: '2026-10-01',
    });
    closeDb();
  });

  it('une copie à la limite reste une réponse', async () => {
    const { check, closeDb } = await modules(base('limite.sqlite', '2026-10-24'));
    expect(check.checkFinmaRegister(CH_IID, NOW).status).toBe('listed');
    closeDb();
  });

  it('ne promet jamais une absence d’autorisation et ne nomme pas la liste d’alerte', async () => {
    const { check, closeDb } = await modules(base('texte.sqlite'));
    const text = JSON.stringify(check.checkFinmaRegister(CH_IID, NOW)).toLowerCase();
    expect(text).not.toMatch(/not authorised|unauthori[sz]ed|warning list|blacklist/);
    closeDb();
  });
});

describe('le schéma de sortie MCP', () => {
  // `structuredContent` est validé par le SDK : un champ non déclaré disparaît, un champ
  // mal typé fait tomber l'appel. Les deux états doivent donc passer le schéma tels quels.
  it('laisse passer les deux états sans rien retirer', async () => {
    const { check, closeDb } = await modules(base('schema.sqlite', '2026-11-04'));
    const { TOOL_OUTPUT_SCHEMAS } = await import('../mcp/output-schemas.js');
    const shape = TOOL_OUTPUT_SCHEMAS.check_compliance.compliance;
    for (const iid of [CH_IID, '00001']) {
      const answer = check.checkFinmaRegister(iid, NOW);
      const compliance = {
        sanctions: {
          country_sanctioned: false,
          bank_sanctioned: false,
          matched_lists: [],
          fatf_status: 'member',
          bank_screened: true,
        },
        reachability: { sepa_instant: true, sct: true, sdd: true, screened: true },
        vop: { participant: false, status: 'not_found', screened: true },
        risk_score: 0,
        risk_level: 'low',
        flags: [],
        finma_register: answer,
      };
      const parsed = shape.parse(compliance) as { finma_register: unknown };
      expect(parsed.finma_register).toEqual(answer);
    }
    closeDb();
  });
});

describe('buildComplianceResponse', () => {
  it('ajoute le champ sur un IBAN suisse, sans toucher au score ni aux drapeaux', async () => {
    const without = await modules(base('reponse-sans.sqlite'));
    const before = without.response.buildComplianceResponse(CH_IBAN);
    without.closeDb();
    const today = new Date().toISOString().slice(0, 10);
    const withIt = await modules(base('reponse-avec.sqlite', today));
    const after = withIt.response.buildComplianceResponse(CH_IBAN);
    withIt.closeDb();

    expect(before.compliance.finma_register?.status).toBe('not_verified');
    expect(after.compliance.finma_register?.status).toBe('listed');
    expect(after.compliance.risk_score).toBe(before.compliance.risk_score);
    expect(after.compliance.risk_level).toBe(before.compliance.risk_level);
    expect(after.compliance.flags).toEqual(before.compliance.flags);
  });

  it('n’ajoute rien à un IBAN d’un autre pays ni à un IBAN invalide', async () => {
    const { response, closeDb } = await modules(base('autres.sqlite', '2026-11-04'));
    expect(response.buildComplianceResponse(DE_IBAN).compliance.finma_register).toBeUndefined();
    expect(
      response.buildComplianceResponse('CH0000000000000000000').compliance.finma_register,
    ).toBeUndefined();
    closeDb();
  });

  it('n’ajoute rien au contrôle direct par BIC', async () => {
    const { response, closeDb } = await modules(base('bic.sqlite', '2026-11-04'));
    const screened = response.buildBicComplianceResponse('UBSWCHZH');
    expect('compliance' in screened && screened.compliance.finma_register).toBeFalsy();
    closeDb();
  });
});
