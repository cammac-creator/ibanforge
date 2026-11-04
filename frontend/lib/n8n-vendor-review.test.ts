import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const directory = join(process.cwd(), 'public/integrations');
const names = readdirSync(directory).filter(name => /^ibanforge-n8n-revue-[a-f0-9]{12}\.json$/.test(name));
if (names.length !== 1) throw new Error('Un modèle de revue courant est attendu.');
const raw = readFileSync(join(directory, names[0]), 'utf8');
const workflow = JSON.parse(raw);
const byId = (id: string) => workflow.nodes.find((node: { id: string }) => node.id === id);

type Row = Record<string, unknown>;
type Result = {
  iban: string;
  valid: boolean;
  bank_code_holder?: string;
  checks?: Record<string, unknown>;
  bank_code_check?: Record<string, unknown>;
  bic?: Record<string, unknown>;
};

// Exécuter le code du fichier réellement téléchargeable, sans en recopier la logique.
function execute(id: string, input: Row[], lot?: Row) {
  const context = {
    $input: { all: () => input.map(json => ({ json })), first: () => ({ json: input[0] }) },
    $: (name: string) => {
      if (name !== 'Préparer le lot' || !lot) throw new Error('Source de lot inattendue.');
      return { first: () => ({ json: lot }) };
    },
  };
  return JSON.parse(JSON.stringify(runInNewContext(`(function () {\n${byId(id).parameters.jsCode}\n})()`, context, { timeout: 1000 })));
}

const iban = 'DE09000000000000000001';
const otherIban = 'DE79000000000000000002';
function verified(value = iban): Result {
  return {
    iban: value, valid: true, bank_code_holder: 'confirmed',
    checks: { bank_code: 'pass', bic: 'pass', national_check_digits: 'pass' },
    bank_code_check: { status: 'verified', authoritative: true, register: 'Registre fictif', as_of: '2026-01' },
    bic: { code: 'TSTTZZ00XXX', bank_name: 'Banque fictive', authoritative: true, basis: 'national_register', source: 'Source fictive', as_of: '2026-01' },
  };
}
function review(rows: Row[], results: unknown[]) {
  const lot = execute('ibf-preparer', rows)[0].json;
  return execute('ibf-rapport', [{ statusCode: 200, body: { results } }], lot).map((item: { json: Row }) => item.json);
}

describe('modèle n8n téléchargeable de revue fournisseurs', () => {
  it('porte une empreinte de contenu et aucun identifiant de compte ou secret', () => {
    expect(names[0]).toContain(createHash('sha256').update(raw).digest('hex').slice(0, 12));
    expect(workflow.active).toBe(false);
    expect(workflow.pinData).toEqual({});
    expect(workflow).not.toHaveProperty('id');
    for (const node of workflow.nodes) {
      expect(node.type).toMatch(/^n8n-nodes-base\./);
      expect(node).not.toHaveProperty('credentials');
    }
    expect(raw).not.toMatch(/ifk_[a-f0-9]{64}/);
  });

  it('envoie uniquement les IBAN, avec authentification séparée, sans relance ni redirection', () => {
    const http = byId('ibf-http');
    expect(http.parameters.url).toBe('https://api.ibanforge.com/v1/iban/batch');
    expect(http.parameters.genericAuthType).toBe('httpHeaderAuth');
    expect(http.retryOnFail).not.toBe(true);
    expect(http.continueOnFail).not.toBe(true);
    expect(http.parameters.options.redirect.redirect.followRedirects).toBe(false);
    expect(http.parameters.options.response.response.neverError).toBe(false);
    const lot = execute('ibf-preparer', [{ iban, reference: 'F-001', note: 'Valeur fictive à garder localement' }])[0].json;
    const expression = http.parameters.jsonBody.slice(3, -2).trim();
    const body = JSON.parse(runInNewContext(expression, { $json: lot }));
    expect(body).toEqual({ ibans: [iban] });
  });

  it('conserve l’ordre, les colonnes et les lignes vides sans inventer de résultat API', () => {
    const rows = [{ reference: 'F-001', iban }, { reference: 'F-002', iban: '' }, { reference: 'F-003' }];
    const output = review(rows, [verified()]);
    expect(output.map((row: Row) => row.original)).toEqual(rows);
    expect(output.map((row: Row) => row.record)).toEqual([1, 2, 3]);
    expect(output[0].review).toMatchObject({ decision: 'enrichment_proposal', proposal: { bic: 'TSTTZZ00XXX', bank_name: 'Banque fictive' }, payment_authorized: false });
    expect(output[1].review).toMatchObject({ reason: 'missing_iban', result: null, payment_authorized: false });
    expect(output[2].review).toMatchObject({ reason: 'missing_iban', result: null });
  });

  it('préserve les doublons et les adresse à la revue même avec une référence confirmée', () => {
    const output = review([{ iban }, { iban: 'DE09 0000 0000 0000 0000 01' }], [verified(), verified()]);
    expect(output).toHaveLength(2);
    for (const row of output) expect(row.review).toMatchObject({ decision: 'review', reason: 'duplicate_iban_in_batch', duplicate_in_batch: true, proposal: null });
  });

  it.each([
    ['unknown', false, undefined],
    ['not_in_register', false, 'not_allocated'],
    ['verified', false, undefined],
  ])('ne traite pas %s avec autorité %s comme une preuve suffisante', (status, authoritative, reason) => {
    const result = verified();
    result.bank_code_check = { ...result.bank_code_check, status, authoritative, reason };
    expect(review([{ iban }], [result])[0].review).toMatchObject({ decision: 'review', proposal: null });
  });

  it('sépare les anomalies précises des références à revoir', () => {
    const absent = verified();
    absent.bank_code_check = { ...absent.bank_code_check, status: 'not_in_register', authoritative: true, reason: 'not_allocated' };
    expect(review([{ iban }], [absent])[0].review).toMatchObject({ decision: 'ask_supplier', reason: 'bank_code_not_allocated' });
    const retired = verified();
    retired.bank_code_check = { ...retired.bank_code_check, retired: true, successor_bic: 'AUTRZZ00XXX' };
    expect(review([{ iban }], [retired])[0].review).toMatchObject({ decision: 'review', reason: 'retired_code_no_automatic_replacement', proposal: null });
    const national = verified();
    national.checks = { ...national.checks, national_check_digits: 'fail' };
    expect(review([{ iban }], [national])[0].review).toMatchObject({ decision: 'ask_supplier', reason: 'national_check_failed' });
  });

  it('exige des sources datées et conserve les valeurs bancaires déjà présentes', () => {
    const result = verified();
    delete result.bic!.as_of;
    expect(review([{ iban }], [result])[0].review).toMatchObject({ reason: 'missing_source_or_date', proposal: null });
    expect(review([{ iban, bic: 'AUTRZZ00XXX' }], [verified()])[0].review).toMatchObject({ reason: 'existing_bic_differs', proposal: null });
    expect(review([{ iban, bank_name: 123 }], [verified()])[0].review).toMatchObject({ reason: 'existing_field_requires_review', proposal: null });
  });

  it('refuse un lot trop grand avant l’appel et conserve les entrées qui ne sont pas du texte', () => {
    expect(() => execute('ibf-preparer', Array.from({ length: 101 }, () => ({ iban })))).toThrow('1 à 100');
    const lot = execute('ibf-preparer', [{ iban: 123 }, { iban: 'A'.repeat(65) }, { iban: ' - ' }])[0].json;
    expect(lot.ibans).toEqual([]);
    const output = execute('ibf-rapport', [lot], lot);
    expect(output.map((row: { json: { review: { reason: string } } }) => row.json.review.reason)).toEqual(['iban_must_be_text', 'input_too_long', 'missing_iban']);
  });

  it('interrompt la restitution sur une réponse incomplète ou attribuée aux mauvaises lignes', () => {
    const rows = [{ iban }, { iban: otherIban }];
    expect(() => review(rows, [verified()])).toThrow('Nombre de résultats');
    expect(() => review(rows, [verified(otherIban), verified()])).toThrow('Correspondance');
    expect(() => review([{ iban }], [{ ...verified(), valid: 'true' }])).toThrow('verdict');
    expect(() => review([{ iban }], [{ ...verified(), checks: [] }])).toThrow('Structure de référence');
  });
});
