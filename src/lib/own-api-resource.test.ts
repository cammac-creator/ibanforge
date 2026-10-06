import { describe, expect, it } from 'vitest';
import { isOwnApiResource } from './own-api-resource.js';

describe('isOwnApiResource', () => {
  it('accepts a resource of our API', () => {
    expect(isOwnApiResource('https://api.ibanforge.com/v1/iban/validate')).toBe(true);
    expect(isOwnApiResource('https://api.ibanforge.com')).toBe(true);
    expect(isOwnApiResource('https://API.ibanforge.com/v1/bic/DEUTDEFF')).toBe(true);
    expect(isOwnApiResource('https://api.ibanforge.com:443/v1/demo')).toBe(true);
  });

  it('refuses a foreign host that only starts with our name', () => {
    expect(isOwnApiResource('https://api.ibanforge.com.attacker.example/v1/x')).toBe(false);
    expect(isOwnApiResource('https://api.ibanforge.com@attacker.example/v1/x')).toBe(false);
    expect(isOwnApiResource('https://api.ibanforge.community/v1/x')).toBe(false);
    expect(isOwnApiResource('https://x.api.ibanforge.com/v1/x')).toBe(false);
  });

  it('refuses another scheme, another port, credentials and non-URLs', () => {
    expect(isOwnApiResource('http://api.ibanforge.com/v1/iban/validate')).toBe(false);
    expect(isOwnApiResource('https://api.ibanforge.com:8443/v1/iban/validate')).toBe(false);
    expect(isOwnApiResource('https://user:pw@api.ibanforge.com/v1/iban/validate')).toBe(false);
    expect(isOwnApiResource('api.ibanforge.com/v1/iban/validate')).toBe(false);
    expect(isOwnApiResource('')).toBe(false);
    expect(isOwnApiResource(42)).toBe(false);
    expect(isOwnApiResource(null)).toBe(false);
  });
});
