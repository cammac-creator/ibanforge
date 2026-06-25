import { describe, it, expect } from 'vitest';
import { extractGleifAddress, addressMatchesBic, hasNonLatinScript } from './gleif-address.js';

// Real-shaped GLEIF payloads (trimmed) verified against api.gleif.org.
const ABC = {
  legalAddress: {
    language: 'zh',
    addressLines: ['东城区建国门内大街69号'],
    city: '东城区',
    region: 'CN-BJ',
    country: 'CN',
    postalCode: '100005',
  },
  otherAddresses: [
    {
      fieldType: 'OtherAddress',
      language: 'en',
      type: 'ALTERNATIVE_LANGUAGE_LEGAL_ADDRESS',
      addressLines: ['No 69, Jianguomen Nei Avenue, Dongcheng District'],
      city: 'Dongcheng Qu',
      region: 'CN-BJ',
      country: 'CN',
      postalCode: '100005',
    },
  ],
};

const ING = {
  legalAddress: {
    language: 'en',
    addressLines: ['BIJLMERDREEF 106'],
    city: 'AMSTERDAM',
    region: 'NL-NH',
    country: 'NL',
    postalCode: '1102 CT',
  },
};

describe('extractGleifAddress', () => {
  it('returns the Chinese street AND an English romanization for a non-Latin entity', () => {
    const a = extractGleifAddress(ABC)!;
    expect(a.street).toBe('东城区建国门内大街69号');
    expect(a.post_code).toBe('100005');
    expect(a.region).toBe('CN-BJ');
    expect(a.country).toBe('CN');
    expect(a.language).toBe('zh');
    expect(a.romanized).toBe('No 69, Jianguomen Nei Avenue, Dongcheng District');
  });

  it('uses the legal address as the romanization for a Latin-script entity', () => {
    const a = extractGleifAddress(ING)!;
    expect(a.street).toBe('BIJLMERDREEF 106');
    expect(a.post_code).toBe('1102 CT');
    expect(a.country).toBe('NL');
    expect(a.romanized).toBe('BIJLMERDREEF 106');
  });

  it('returns null romanization for a non-Latin entity with no English variant', () => {
    const a = extractGleifAddress({
      legalAddress: { language: 'ru', addressLines: ['ул. Тверская, 7'], country: 'RU' },
    })!;
    expect(a.street).toBe('ул. Тверская, 7');
    expect(a.romanized).toBeNull();
  });

  it('returns null when no legal address is present', () => {
    expect(extractGleifAddress({})).toBeNull();
  });
});

describe('addressMatchesBic (same-country guard)', () => {
  it('matches when the BIC country equals the entity country', () => {
    expect(addressMatchesBic('ABOCCNBJXXX', 'CN')).toBe(true);
    expect(addressMatchesBic('INGBNL2AXXX', 'NL')).toBe(true);
  });

  it('rejects a foreign-branch BIC (parent HQ in another country)', () => {
    // First Abu Dhabi Bank Shanghai branch: BIC country CN, entity country AE.
    expect(addressMatchesBic('FABMCNSHXXX', 'AE')).toBe(false);
    // ING France branch: BIC country FR, entity (ING) country NL.
    expect(addressMatchesBic('INGBFRPPXXX', 'NL')).toBe(false);
  });

  it('rejects when entity country is missing', () => {
    expect(addressMatchesBic('INGBNL2AXXX', null)).toBe(false);
  });
});

describe('hasNonLatinScript', () => {
  it('detects genuinely non-Latin scripts', () => {
    expect(hasNonLatinScript('东城区建国门内大街69号')).toBe(true); // Chinese
    expect(hasNonLatinScript('ул. Тверская, 7')).toBe(true); // Cyrillic
    expect(hasNonLatinScript('Λεωφόρος Συγγρού 12')).toBe(true); // Greek
    expect(hasNonLatinScript('شارع كورنيش النيل')).toBe(true); // Arabic
    expect(hasNonLatinScript('東京都')).toBe(true); // Japanese kanji/kana
  });

  it('treats Latin (incl. diacritics and transliterations) as readable', () => {
    // GLEIF tags these 'el'/'ar' but the filed text is already Latin — the bug
    // that mislabeled 254 readable addresses as "romanization unavailable".
    expect(hasNonLatinScript('VALAORITOU 17')).toBe(false);
    expect(hasNonLatinScript('306 CORNICHE EL NIL, MAADI')).toBe(false);
    expect(hasNonLatinScript('München')).toBe(false);
    expect(hasNonLatinScript('BUCUREȘTI, SECTORUL 2')).toBe(false);
    expect(hasNonLatinScript('Zürich')).toBe(false);
  });

  it('is false for empty / null input', () => {
    expect(hasNonLatinScript('')).toBe(false);
    expect(hasNonLatinScript(null)).toBe(false);
    expect(hasNonLatinScript(undefined)).toBe(false);
  });
});
