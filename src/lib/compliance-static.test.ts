import { describe, it, expect } from 'vitest';
import {
  FATF_AS_OF,
  FATF_BLACK_LIST,
  FATF_GREY_LIST,
  FATF_MEMBERS,
  FATF_SUSPENDED,
  SANCTIONED_COUNTRIES_COMPREHENSIVE,
  SANCTIONED_COUNTRIES_SECTORAL,
} from './compliance-static.js';

const ALL_LISTS = [
  FATF_BLACK_LIST,
  FATF_GREY_LIST,
  FATF_MEMBERS,
  FATF_SUSPENDED,
  SANCTIONED_COUNTRIES_COMPREHENSIVE,
  SANCTIONED_COUNTRIES_SECTORAL,
];

describe('compliance-static', () => {
  it('FATF_AS_OF is a YYYY-MM string', () => {
    expect(FATF_AS_OF).toMatch(/^\d{4}-\d{2}$/);
  });

  it('all reference lists are non-empty', () => {
    for (const list of ALL_LISTS) {
      expect(list.length).toBeGreaterThan(0);
    }
  });

  it('all entries are ISO 3166-1 alpha-2 uppercase codes', () => {
    for (const list of ALL_LISTS) {
      for (const code of list) {
        expect(code).toMatch(/^[A-Z]{2}$/);
      }
    }
  });

  it('no country is on both the FATF black and grey lists', () => {
    const grey = new Set(FATF_GREY_LIST);
    for (const code of FATF_BLACK_LIST) {
      expect(grey.has(code)).toBe(false);
    }
  });

  it('FATF black list reflects the June 2026 plenary (IR, KP, MM — unchanged)', () => {
    expect([...FATF_BLACK_LIST].sort()).toEqual(['IR', 'KP', 'MM']);
  });

  it('FATF grey list reflects the June 2026 plenary (+BA +IQ, −DZ −NA, 22 total)', () => {
    expect(FATF_GREY_LIST).toContain('BA');
    expect(FATF_GREY_LIST).toContain('IQ');
    expect(FATF_GREY_LIST).not.toContain('DZ');
    expect(FATF_GREY_LIST).not.toContain('NA');
    expect(FATF_GREY_LIST).toHaveLength(22);
    expect(FATF_AS_OF).toBe('2026-06');
  });

  it('Russia is SUSPENDED from the FATF — never listed as a member', () => {
    expect(FATF_SUSPENDED).toContain('RU');
    expect(FATF_MEMBERS).not.toContain('RU');
  });

  it('no country is both a member and suspended', () => {
    const members = new Set(FATF_MEMBERS);
    for (const code of FATF_SUSPENDED) {
      expect(members.has(code)).toBe(false);
    }
  });

  it('no duplicate entries within any list', () => {
    for (const list of ALL_LISTS) {
      expect(new Set(list).size).toBe(list.length);
    }
  });

  it('FATF grey list includes Yemen (a registry-sync country added to countries.ts)', () => {
    expect(FATF_GREY_LIST).toContain('YE');
  });
});
