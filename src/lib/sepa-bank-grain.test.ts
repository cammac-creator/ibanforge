/**
 * SEPA au grain de la BANQUE, jamais emprunté au pays (25/09/2026).
 *
 * `sepa.schemes`, `basis` et `member` restent ce qu'ils étaient ; les champs
 * ajoutés disent ce que les registres EPC savent de la banque elle-même. Les cas
 * qui dépendent des registres EPC (restreints) vivent dans
 * restricted-data-absent.test.ts, sur des lignes inventées ; ici, seulement des
 * cas qui n'en lisent aucune ligne, et un double pour le pays hors SEPA.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReachabilityCheck } from '../types.js';

const forced = { listedEverywhere: false };

// Le double : les registres EPC répondent « listée, trois schémas » pour
// n'importe quel BIC8. Sert à prouver qu'un pays hors SEPA n'en reçoit rien.
vi.mock('./compliance.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./compliance.js')>();
  return {
    ...actual,
    checkReachability: (bic8: string | null, cc?: string): ReachabilityCheck =>
      forced.listedEverywhere
        ? { sepa_instant: true, sct: true, sdd: true, screened: true }
        : actual.checkReachability(bic8, cc),
  };
});

const { enrichResult } = await import('./enrich.js');
const { validateIBAN } = await import('./iban.js');
const { getSepaInfo, EXAMPLE_IBANS } = await import('./countries.js');

function enriched(iban: string) {
  const r = validateIBAN(iban);
  enrichResult(r);
  return r;
}

beforeEach(() => {
  forced.listedEverywhere = false;
});

describe('sepa.bank_reachability', () => {
  it('a fabricated DE IBAN with an unallocated BLZ answers not_allocated and bank_code_not_allocated reachability, and keeps sepa.schemes unchanged', () => {
    const r = enriched('DE23999999990000000000');
    expect(r.valid).toBe(true);
    expect(r.bank_code_holder).toBe('not_allocated');
    expect(r.bic).toBeNull();
    expect(r.sepa?.bank_reachability).toBe('bank_code_not_allocated');
    expect(r.sepa?.bank_schemes).toEqual([]);
    expect(r.sepa?.vop_register_status).toBeNull();
    // Le pays, inchangé : un intégrateur qui ne lit que lui voit ce qu'il voyait.
    expect(r.sepa?.schemes).toEqual(getSepaInfo('DE').schemes);
    expect((r.sepa as { basis?: string }).basis).toBe('country_default');
    expect(r.checks).toMatchObject({
      bank_code: 'fail',
      bic: 'not_applicable',
      sepa_reachability: 'fail',
    });
    expect(r.next_steps?.map((s) => s.code)).toContain('bank_code_not_allocated');
  });

  it('an unresolved code answers no_bank reachability and null bank_schemes', () => {
    const r = enriched('FR1499999000010123456789A42');
    expect(r.bic ?? null).toBeNull();
    expect(r.bank_code_holder).toBe('unknown');
    expect(r.sepa?.bank_reachability).toBe('no_bank');
    expect(r.sepa?.bank_schemes).toBeNull();
    expect(r.sepa?.vop_register_status).toBeNull();
    expect(r.checks?.sepa_reachability).toBe('unknown');
  });

  it('a non-SEPA country never gets bank_reachability, even when its BIC8 is in an EPC register', () => {
    forced.listedEverywhere = true;
    const r = enriched('AE070331234567890123456');
    expect(r.sepa?.member).toBe(false);
    expect(r.bic?.code).toBeTruthy();
    expect(r.sepa).not.toHaveProperty('bank_reachability');
    expect(r.sepa).not.toHaveProperty('bank_schemes');
    expect(r.sepa).not.toHaveProperty('vop_register_status');
    expect(r.sepa?.schemes).toEqual([]);
    expect(r.checks?.sepa_reachability).toBe('not_applicable');
  });

  it('a member country whose bank the registers list answers listed, the same registers as schemes', () => {
    forced.listedEverywhere = true;
    const r = enriched('NL19BICK0123456789');
    expect(r.sepa?.bank_reachability).toBe('listed');
    expect(r.sepa?.bank_schemes).toEqual(['SCT', 'SDD', 'SCT_INST']);
    expect(r.sepa?.bank_schemes).toEqual(r.sepa?.schemes);
    expect(r.checks?.sepa_reachability).toBe('pass');
  });
});

describe('sepa.vop_register_status', () => {
  it('mirrors vop_participant (active iff true, null iff null)', () => {
    for (const iban of Object.values(EXAMPLE_IBANS)) {
      const r = enriched(iban);
      if (!r.valid || !r.sepa?.member || !r.bank_code_check) continue;
      expect(r.sepa.vop_register_status === 'active', iban).toBe(r.sepa.vop_participant === true);
      expect(r.sepa.vop_register_status === null, iban).toBe(r.sepa.vop_participant === null);
    }
  });
});
