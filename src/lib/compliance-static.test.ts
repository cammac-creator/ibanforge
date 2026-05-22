import { describe, it, expect } from 'vitest';
import {
  FATF_AS_OF,
  FATF_BLACK_LIST,
  FATF_GREY_LIST,
  FATF_MEMBERS,
  SANCTIONED_COUNTRIES_COMPREHENSIVE,
  SANCTIONED_COUNTRIES_SECTORAL,
} from './compliance-static.js';

const ALL_LISTS = [
  FATF_BLACK_LIST,
  FATF_GREY_LIST,
  FATF_MEMBERS,
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

  it('FATF black list reflects the Feb 2026 plenary (IR, KP, MM)', () => {
    expect([...FATF_BLACK_LIST].sort()).toEqual(['IR', 'KP', 'MM']);
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
