import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  groupIban,
  hasCode,
  ibanChecksumPasses,
  normaliseIban,
  readBankCode,
  type FinderRegisters,
} from './iban-bank-finder';

// Invented lists in the shape the page passes: real codes, a handful of them.
const REGISTERS: FinderRegisters = {
  deCodes: ['37040044', '10060198', '10070000'].join(''),
  deRetired: { '10060198': '37060193' },
  chCodes: ['00230', '30000', '30172'].join(''),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readBankCode: a German IBAN gives its Bankleitzahl', () => {
  it('a valid German IBAN, typed with spaces: the BLZ, the register verdict and its page', () => {
    const r = readBankCode('DE89 3704 0044 0532 0130 00', REGISTERS);
    expect(r).toEqual({
      kind: 'code',
      country: 'DE',
      checkDigits: '89',
      code: '37040044',
      status: 'allocated',
      successor: null,
      checksum: 'pass',
      path: '/blz/37040044',
    });
  });

  it('lower case, dashes and dots are how people paste: they read the same', () => {
    expect(readBankCode('de89-3704.0044 0532013000', REGISTERS)).toMatchObject({ code: '37040044', checksum: 'pass' });
  });

  it('a retired code names its successor', () => {
    const r = readBankCode('DE84100601980123456789', REGISTERS);
    expect(r).toMatchObject({ status: 'retired', successor: '37060193', path: '/blz/10060198', checksum: 'pass' });
  });

  it('a code the register does not hold: no page to open, and it is said', () => {
    const r = readBankCode('DE37999999990123456789', REGISTERS);
    expect(r).toMatchObject({ kind: 'code', code: '99999999', status: 'not-in-register', path: null, checksum: 'pass' });
  });

  it('a typo: the check digits fail, the code is still read', () => {
    const r = readBankCode('DE89370400440532013001', REGISTERS);
    expect(r).toMatchObject({ code: '37040044', checksum: 'fail' });
  });

  it('cut after the BLZ: the code is read, the check digits are not judged yet', () => {
    const r = readBankCode('DE55 1005 0000', REGISTERS);
    expect(r).toMatchObject({ kind: 'code', checkDigits: '55', code: '10050000', checksum: 'incomplete', status: 'not-in-register' });
  });

  it('eight digits alone are a Bankleitzahl typed without its IBAN', () => {
    expect(readBankCode('37040044', REGISTERS)).toMatchObject({ kind: 'code', country: 'DE', checksum: 'none', path: '/blz/37040044' });
  });
});

describe('readBankCode: the "DE55" case', () => {
  it('four characters: the two digits are named as check digits, and what is missing is counted', () => {
    expect(readBankCode('DE55', REGISTERS)).toEqual({ kind: 'partial', country: 'DE', checkDigits: '55', needed: 12 });
  });

  it('the country alone, or one digit more, is still partial', () => {
    expect(readBankCode('DE', REGISTERS)).toMatchObject({ kind: 'partial', checkDigits: '' });
    expect(readBankCode('de5', REGISTERS)).toMatchObject({ kind: 'partial', checkDigits: '5' });
  });

  it('nothing, or a single letter, says nothing yet', () => {
    expect(readBankCode('', REGISTERS)).toEqual({ kind: 'empty' });
    expect(readBankCode('   ', REGISTERS)).toEqual({ kind: 'empty' });
    expect(readBankCode('D', REGISTERS)).toEqual({ kind: 'empty' });
  });
});

describe('readBankCode: Austria, Switzerland, Liechtenstein', () => {
  it('Austria: the five-digit code and its page, never a claim about the register', () => {
    const r = readBankCode('AT61 1904 3002 3457 3201', REGISTERS);
    expect(r).toEqual({
      kind: 'code',
      country: 'AT',
      checkDigits: '61',
      code: '19043',
      status: 'unchecked',
      successor: null,
      checksum: 'pass',
      path: '/at/19043',
    });
  });

  it('Switzerland: the IID, checked against the SIX list', () => {
    expect(readBankCode('CH31 3000 0000 0000 0000 1', REGISTERS)).toMatchObject({
      country: 'CH',
      code: '30000',
      status: 'allocated',
      path: '/iid/30000',
      checksum: 'pass',
    });
  });

  it('the official Swiss example: correct check digits, an IID nobody holds', () => {
    expect(readBankCode('CH93 0076 2011 6238 5295 7', REGISTERS)).toMatchObject({
      code: '00762',
      status: 'not-in-register',
      path: null,
      checksum: 'pass',
    });
  });

  it('Liechtenstein reads the same SIX list', () => {
    expect(readBankCode('LI21 3017 2', REGISTERS)).toMatchObject({ country: 'LI', code: '30172', status: 'allocated', path: '/iid/30172' });
  });
});

describe('readBankCode: a wrong input gets a clear answer', () => {
  it('another country is said plainly, never guessed', () => {
    expect(readBankCode('FR76 3000 6000 0112 3456 7890 189', REGISTERS)).toEqual({ kind: 'unsupported', country: 'FR' });
  });

  it('characters an IBAN cannot hold', () => {
    expect(readBankCode('DE89 3704 0044 €', REGISTERS)).toEqual({ kind: 'error', reason: 'characters' });
    expect(readBankCode('DEAB37040044', REGISTERS)).toMatchObject({ kind: 'error', reason: 'characters' });
    expect(readBankCode('DE893704X044', REGISTERS)).toMatchObject({ kind: 'error', reason: 'characters' });
  });

  it('digits that are not a Bankleitzahl, with no country in front', () => {
    expect(readBankCode('19001', REGISTERS)).toEqual({ kind: 'error', reason: 'country' });
    expect(readBankCode('1234567890', REGISTERS)).toEqual({ kind: 'error', reason: 'country' });
  });

  it('longer than an IBAN of that country', () => {
    expect(readBankCode('DE89370400440532013000123', REGISTERS)).toEqual({ kind: 'error', reason: 'too-long', country: 'DE' });
  });
});

describe('the reading makes no network call', () => {
  it('fetch, XMLHttpRequest and sendBeacon are never touched', () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network call');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('XMLHttpRequest', vi.fn(() => {
      throw new Error('network call');
    }));
    for (const input of ['DE89370400440532013000', 'DE55', 'AT611904300234573201', 'CH9300762011623852957', 'FR76', '37040044']) {
      readBankCode(input, REGISTERS);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('helpers', () => {
  it('mod 97 on real and broken IBANs', () => {
    expect(ibanChecksumPasses('DE89370400440532013000')).toBe(true);
    expect(ibanChecksumPasses('DE89370400440532013001')).toBe(false);
    expect(ibanChecksumPasses('GB29NWBK60161331926819')).toBe(true);
    expect(ibanChecksumPasses('not an iban')).toBe(false);
  });

  it('a code is found only on its own boundary', () => {
    // "70400440" straddles two codes of the joined string: it must not match.
    expect(hasCode('3704004410060198', '70400441')).toBe(false);
    expect(hasCode('3704004410060198', '10060198')).toBe(true);
    expect(hasCode('123', '12')).toBe(false);
  });

  it('normalises and groups without Intl', () => {
    expect(normaliseIban(' de89 3704-0044.0532 0130 00 ')).toBe('DE89370400440532013000');
    expect(groupIban('DE89370400440532013000')).toBe('DE89 3704 0044 0532 0130 00');
  });
});
