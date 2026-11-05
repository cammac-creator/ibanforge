import { describe, expect, it } from 'vitest';
import { entryPageCategory, entryReferrerCategory } from './entry-categories.js';

describe('catégories d’arrivée sans identifiant libre', () => {
  it.each([
    [null, 'unknown'],
    ['', 'unknown'],
    ['https://google.com/search?q=test', 'unknown'],
    ['WWW.GOOGLE.CH', 'search'],
    ['www.bing.com', 'search'],
    ['duckduckgo.com', 'search'],
    ['google.com.alpha.example.net', 'external'],
    ['github.com', 'developer_platform'],
    ['alpha.example.net', 'external'],
    ['ibanforge.com', 'internal'],
    ['api.ibanforge.com', 'internal'],
    ['ibanforge.com.alpha.example.net', 'external'],
  ])('classe le référent %s en %s', (value, expected) => {
    expect(entryReferrerCategory(value)).toBe(expected);
  });

  it.each([
    [null, 'unknown'],
    ['', 'unknown'],
    ['/audit?email=alpha', 'unknown'],
    ['/fr/blz/37040044', 'bank_lookup'],
    ['/de/iban-welche-bank', 'bank_lookup'],
    ['/en/iban/DE', 'bank_lookup'],
    ['/it/12345', 'bank_lookup'],
    ['/fr/tools/generator', 'tool'],
    ['/playground', 'tool'],
    ['/sheets', 'tool'],
    ['/fr/docs/onboarding', 'docs'],
    ['/de/blog/article', 'blog'],
    ['/vendors', 'vendors'],
    ['/fr/audit', 'audit'],
    ['/en/pricing', 'pricing'],
    ['/pricing-extra', 'other'],
    ['/france/audit', 'other'],
    ['/', 'other'],
    ['/fr', 'other'],
  ])('classe la page %s en %s', (value, expected) => {
    expect(entryPageCategory(value)).toBe(expected);
  });
});
