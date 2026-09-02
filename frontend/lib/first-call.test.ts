import { describe, it, expect } from 'vitest';
import { buildSnippets, firstCallUrl, summarizeFirstCall, SAMPLE_IBAN } from './first-call';

const KEY = 'ifk_' + 'a1b2c3d4'.repeat(8);

describe('buildSnippets', () => {
  it('writes the same call in curl, Node and Python, key and IBAN included', () => {
    const s = buildSnippets('https://api.example.test/', KEY);
    for (const code of [s.curl, s.node, s.python]) {
      expect(code).toContain('https://api.example.test/v1/iban/validate');
      expect(code).toContain(KEY);
      expect(code).toContain(SAMPLE_IBAN);
    }
    expect(s.curl.startsWith('curl -X POST')).toBe(true);
    expect(s.node).toContain('fetch(');
    expect(s.python).toContain('import requests');
  });

  it('takes the IBAN the caller chose', () => {
    expect(buildSnippets('https://api.example.test', KEY, 'DE89370400440532013000').curl).toContain('DE89370400440532013000');
  });

  it('never doubles the slash between base and path', () => {
    expect(firstCallUrl('https://api.example.test///')).toBe('https://api.example.test/v1/iban/validate');
  });
});

describe('summarizeFirstCall', () => {
  const headers = new Headers({ 'x-quota-used': '1', 'x-quota-limit': '200' });

  it('reads the fields worth showing and the quota headers', () => {
    const s = summarizeFirstCall(
      {
        valid: true,
        country: { code: 'CH', name: 'Switzerland' },
        bic: { code: 'UBSWCHZH', bank_name: 'UBS Switzerland AG' },
        sepa: { member: true, schemes: ['SCT', 'SDD'] },
        bank_code_check: { status: 'verified' },
      },
      headers,
    );
    expect(s).toEqual({
      valid: true,
      countryName: 'Switzerland',
      bankName: 'UBS Switzerland AG',
      bic: 'UBSWCHZH',
      schemes: ['SCT', 'SDD'],
      bankCodeStatus: 'verified',
      quotaUsed: 1,
      quotaLimit: 200,
    });
  });

  it('degrades to nulls on a shape it does not know, instead of throwing', () => {
    expect(summarizeFirstCall('not json', null)).toEqual({
      valid: null,
      countryName: null,
      bankName: null,
      bic: null,
      schemes: [],
      bankCodeStatus: null,
      quotaUsed: null,
      quotaLimit: null,
    });
    expect(summarizeFirstCall({ valid: false, bic: null, sepa: { schemes: 'SCT' } }, null).schemes).toEqual([]);
  });
});
