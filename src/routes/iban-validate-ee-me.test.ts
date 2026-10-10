import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { ibanValidate } from './iban-validate.js';
import type { HonoEnv } from '../types.js';
import {
  EE_FIXTURE,
  ME_FIXTURE,
  RS_FIXTURE,
  writePrivateFixture,
} from '../test-support/ee-me-fixtures.js';

/**
 * Le chemin complet de POST /v1/iban/validate pour l'Estonie, le Monténégro
 * (08/10/2026) et la Serbie (10/10/2026) : ce que le client lit dans le corps JSON, la source comprise, avec
 * les deux fichiers privés d'essai (quelques lignes, dates inventées) et sans eux.
 * Les IBAN sont celui du registre officiel pour l'Estonie, et un IBAN monténégrin
 * construit sur le code 510 (clés mod-97 et nationale vérifiées).
 */

const removers: Array<() => void> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  removers.splice(0).forEach((remove) => remove());
});

function installBoth(): void {
  const ee = writePrivateFixture('ee-register.json', EE_FIXTURE);
  const me = writePrivateFixture('me-register.json', ME_FIXTURE);
  const rs = writePrivateFixture('rs-register.json', RS_FIXTURE);
  removers.push(ee.remove, me.remove, rs.remove);
  vi.stubEnv('EE_REGISTER_PATH', ee.path);
  vi.stubEnv('ME_REGISTER_PATH', me.path);
  vi.stubEnv('RS_REGISTER_PATH', rs.path);
}

interface Answer {
  valid: boolean;
  bank_code_holder: string;
  bank_code_check: {
    value: string;
    status: string;
    match: string | null;
    register: string | null;
    authoritative: boolean;
    as_of: string;
    reason?: string;
    institution?: { name: string; country: string };
  };
  bic: { code: string; basis: string; authoritative: boolean; source: string } | null;
}

async function post(iban: string): Promise<Answer> {
  const app = new Hono<HonoEnv>();
  app.route('/', ibanValidate);
  const res = await app.request('/v1/iban/validate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ iban }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Answer;
}

describe('POST /v1/iban/validate, Estonie, Monténégro et Serbie', () => {
  it('reconnaît une banque estonienne et cite la Finantsinspektsioon', async () => {
    installBoth();
    const json = await post('EE382200221020145685');
    expect(json.valid).toBe(true);
    expect(json.bank_code_holder).toBe('confirmed');
    expect(json.bank_code_check).toMatchObject({
      value: '22',
      status: 'verified',
      match: 'register',
      authoritative: false,
      institution: { name: 'Swedbank AS', country: 'EE' },
    });
    expect(json.bank_code_check.register).toMatch(/^Source: Finantsinspektsioon/);
    expect(json.bic).toMatchObject({
      code: 'HABAEE2X',
      basis: 'curated_map',
      authoritative: false,
    });
    expect(json.bic?.source).toContain('Eesti Pangaliit');
  });

  it('reconnaît une banque monténégrine et cite la Banque centrale', async () => {
    installBoth();
    const json = await post('ME25510000012345678920');
    expect(json.valid).toBe(true);
    expect(json.bank_code_holder).toBe('confirmed');
    expect(json.bank_code_check).toMatchObject({
      value: '510',
      status: 'verified',
      match: 'register',
      authoritative: false,
      institution: { name: 'Crnogorska komercijalna banka AD', country: 'ME' },
    });
    expect(json.bank_code_check.register).toMatch(/^Source: Central Bank of Montenegro/);
    expect(json.bic).toMatchObject({
      code: 'CKBCMEPG',
      basis: 'national_register',
      authoritative: true,
    });
    expect(json.bic?.source).toMatch(/^Source: Central Bank of Montenegro/);
  });

  it('reconnaît deux banques serbes et cite la Banque nationale de Serbie, sans le matični broj', async () => {
    installBoth();
    const intesa = await post('RS35160000012345678956');
    expect(intesa.valid).toBe(true);
    expect(intesa.bank_code_holder).toBe('confirmed');
    expect(intesa.bank_code_check).toMatchObject({
      value: '160',
      status: 'verified',
      match: 'register',
      authoritative: false,
      institution: { name: 'BANCA INTESA AKCIONARSKO DRUŠTVO BEOGRAD', country: 'RS' },
    });
    expect(intesa.bank_code_check.register).toMatch(/^Source: National Bank of Serbia/);
    expect(intesa.bank_code_check.register).toContain('list dated 2099-01-02');
    expect(intesa.bic).toMatchObject({
      code: 'DBDBRSBGXXX',
      basis: 'national_register',
      authoritative: true,
    });
    expect(intesa.bic?.source).toMatch(/^Source: National Bank of Serbia/);
    expect(JSON.stringify(intesa)).not.toContain('07759231');
    const raiffeisen = await post('RS35265000012345678984');
    expect(raiffeisen.bank_code_check.institution?.name).toBe('RAIFFEISEN BANKA A.D. BEOGRAD');
    expect(raiffeisen.bic?.code).toBe('RZBSRSBGXXX');
  });

  it('garde la réponse d’avant pour un code que la liste ne porte pas', async () => {
    installBoth();
    const json = await post('EE113300221020145685');
    expect(json.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'no_reference_data_for_country',
      match: null,
      register: null,
      authoritative: false,
    });
    expect(json.bic).toBeNull();
  });

  it('sans fichier privé, répond comme avant : aucune banque nommée, aucune erreur', async () => {
    vi.stubEnv('EE_REGISTER_PATH', '');
    vi.stubEnv('ME_REGISTER_PATH', '');
    vi.stubEnv('RS_REGISTER_PATH', '');
    const ee = await post('EE382200221020145685');
    expect(ee.valid).toBe(true);
    expect(ee.bic).toBeNull();
    expect(ee.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'no_reference_data_for_country',
      register: null,
    });
    const me = await post('ME25510000012345678920');
    expect(me.valid).toBe(true);
    // La carte composite répond, comme avant ; aucune source du registre n'y figure.
    expect(me.bank_code_check.register ?? '').not.toContain('Central Bank of Montenegro');
    expect(me.bic?.source ?? '').not.toContain('Central Bank of Montenegro');
    const rs = await post('RS35160000012345678956');
    expect(rs.valid).toBe(true);
    expect(rs.bic).toBeNull();
    expect(rs.bank_code_check).toMatchObject({
      status: 'unavailable',
      reason: 'no_reference_data_for_country',
      register: null,
    });
  });
});
