import { describe, expect, it } from 'vitest';
import type { DemandGapSummary } from './demand-gaps.js';
import {
  MIN_HITS_TO_PROPOSE,
  REGISTER_HINTS,
  formatProposalTelegram,
  monthEndedBefore,
  proposeFromDemand,
} from './demand-proposal.js';

function summary(top: DemandGapSummary['top']): DemandGapSummary {
  return { period_days: 30, by_country: [], top, outages: [] };
}
const row = (
  kind: string,
  country: string | null,
  code: string,
  outcome: string,
  hits: number,
): DemandGapSummary['top'][number] => ({
  kind,
  country,
  code,
  outcome,
  hits,
  first_seen: '2026-09-01 00:00:00',
  last_seen: '2026-09-03 00:00:00',
});

describe('monthEndedBefore', () => {
  it('names the month that just ended, whatever the day', () => {
    expect(monthEndedBefore(new Date('2026-10-01T03:15:00Z'))).toBe('2026-09');
    expect(monthEndedBefore(new Date('2026-09-30T23:59:00Z'))).toBe('2026-08');
    expect(monthEndedBefore(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12');
  });
});

describe('proposeFromDemand', () => {
  it('null when the window holds no real demand (outages do not count)', () => {
    expect(proposeFromDemand(summary([]), '2026-09')).toBeNull();
    expect(
      proposeFromDemand(
        summary([row('bank_code', 'DE', '37040044', 'unavailable:lookup_failed', 40)]),
        '2026-09',
      ),
    ).toBeNull();
  });

  it('proposes the register of the country whose codes no source knows, aggregated per country', () => {
    const p = proposeFromDemand(
      summary([
        row('bank_code', 'TR', '00205', 'not_in_register:absent_from_reference_data', 6),
        row('bank_code', 'TR', '00062', 'not_in_register:absent_from_reference_data', 4),
        row('bank_code', 'CH', '00762', 'not_in_register:not_allocated', 13),
        row('bic', 'CN', 'CIBKCNBI200', 'not_found', 3),
      ]),
      '2026-09',
    );
    expect(p?.kind).toBe('register');
    expect(p?.country).toBe('TR');
    expect(p?.hits).toBe(10);
    expect(p?.codes).toBe(2);
    expect(p?.share_pct).toBe(38.5);
    expect(p?.source_hint).toBe(REGISTER_HINTS.TR);
    expect(p?.action_fr).toContain('TCMB');
  });

  it('proposes the composite map when a BIC out-asks every register gap', () => {
    const p = proposeFromDemand(
      summary([
        row('bic', 'CN', 'CIBKCNBI200', 'not_found', 9),
        row('bank_code', 'TR', '00205', 'not_in_register:absent_from_reference_data', 6),
      ]),
      '2026-09',
    );
    expect(p?.kind).toBe('composite');
    expect(p?.code).toBe('CIBKCNBI200');
  });

  it('says too early under the threshold, naming the strongest demand', () => {
    const p = proposeFromDemand(
      summary([
        row(
          'bank_code',
          'LT',
          '10000',
          'not_in_register:absent_from_reference_data',
          MIN_HITS_TO_PROPOSE - 1,
        ),
      ]),
      '2026-09',
    );
    expect(p?.kind).toBe('too_early');
    expect(p?.action_fr).toContain('LT 10000');
  });

  it('says nothing to plug when only unallocated codes were asked', () => {
    const p = proposeFromDemand(
      summary([row('bank_code', 'CH', '00762', 'not_in_register:not_allocated', 13)]),
      '2026-09',
    );
    expect(p?.kind).toBe('none');
    expect(p?.action_fr).toContain('00762');
  });

  it('falls back to a generic search for a country without a hint', () => {
    const p = proposeFromDemand(
      summary([row('bank_code', 'ZZ', '12345', 'not_in_register:absent_from_reference_data', 7)]),
      '2026-09',
    );
    expect(p?.kind).toBe('register');
    expect(p?.source_hint).toBeNull();
    expect(p?.action_fr).toContain('ZZ');
  });

  it('formats one plain Telegram line', () => {
    const p = proposeFromDemand(
      summary([row('bank_code', 'TR', '00205', 'not_in_register:absent_from_reference_data', 6)]),
      '2026-09',
    );
    const line = formatProposalTelegram(p!);
    expect(line.startsWith('🌱 Registre de la demande, 2026-09')).toBe(true);
    expect(line).toContain('TR 00205');
    expect(line).toContain('tableau de bord');
  });
});
