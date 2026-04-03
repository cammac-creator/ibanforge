import { describe, it, expect } from 'vitest';
import { getSepaInfo, getCountryRisk, getCountryName } from './countries.js';

describe('getSepaInfo', () => {
  it('DE is eurozone with SCT_INST and VoP', () => {
    const info = getSepaInfo('DE');
    expect(info.member).toBe(true);
    expect(info.schemes).toEqual(['SCT', 'SDD', 'SCT_INST']);
    expect(info.vop_required).toBe(true);
  });

  it('CH is SEPA but not eurozone, no VoP', () => {
    const info = getSepaInfo('CH');
    expect(info.member).toBe(true);
    expect(info.schemes).toEqual(['SCT', 'SDD']);
    expect(info.vop_required).toBe(false);
  });

  it('GB is SEPA but no VoP (not EU)', () => {
    const info = getSepaInfo('GB');
    expect(info.member).toBe(true);
    expect(info.vop_required).toBe(false);
  });

  it('SE is non-eurozone EU with VoP', () => {
    const info = getSepaInfo('SE');
    expect(info.member).toBe(true);
    expect(info.schemes).toEqual(['SCT', 'SDD']);
    expect(info.vop_required).toBe(true);
  });

  it('BR is not SEPA', () => {
    const info = getSepaInfo('BR');
    expect(info.member).toBe(false);
    expect(info.schemes).toEqual([]);
    expect(info.vop_required).toBe(false);
  });

  it('AD is eurozone (microstate)', () => {
    const info = getSepaInfo('AD');
    expect(info.member).toBe(true);
    expect(info.schemes).toContain('SCT_INST');
  });
});

describe('getCountryRisk', () => {
  it('DE is standard', () => {
    expect(getCountryRisk('DE')).toBe('standard');
  });

  it('CH is standard', () => {
    expect(getCountryRisk('CH')).toBe('standard');
  });

  it('RU is high risk', () => {
    expect(getCountryRisk('RU')).toBe('high');
  });

  it('BY is high risk', () => {
    expect(getCountryRisk('BY')).toBe('high');
  });

  it('TR is elevated', () => {
    expect(getCountryRisk('TR')).toBe('elevated');
  });

  it('PK is elevated', () => {
    expect(getCountryRisk('PK')).toBe('elevated');
  });

  it('unknown country is standard', () => {
    expect(getCountryRisk('XX')).toBe('standard');
  });
});

describe('getCountryName', () => {
  it('returns hardcoded name for IBAN countries', () => {
    expect(getCountryName('CH')).toBe('Switzerland');
    expect(getCountryName('DE')).toBe('Germany');
  });

  it('falls back to Intl API for non-IBAN countries', () => {
    const name = getCountryName('US');
    expect(name).toBeTruthy();
  });

  it('returns null for invalid code', () => {
    expect(getCountryName('')).toBeNull();
    expect(getCountryName('XYZ')).toBeNull();
  });
});
