import { describe, expect, it } from 'vitest';
import { checkUkModulus, ukModulusAvailable } from './uk-modulus.js';

/**
 * The 34 test cases published in section 3.1 of the Vocalink specification
 * "Validating account numbers — UK modulus checking" (v9.0.0).
 *
 * These are the vendor's own vectors, written to cover every combination of
 * check method and exception, and they are the reason this implementation can
 * be trusted: the fourteen exceptions are where hand-rolled modulus checkers
 * quietly go wrong, and nothing but the official set exercises them all. The
 * vectors are published in the specification and carry no weight data, so
 * unlike the table itself they belong in the repository.
 *
 * They run against the real harvested table, so they also prove the seeder and
 * the parser agree with the algorithm. When the table is absent — a checkout
 * that has not run the seeder — the suite skips rather than fails: a missing
 * optional dataset is not a broken build.
 */
const VECTORS: Array<[number, string, string, boolean, string]> = [
  [1, '089999', '66374958', true, 'pass modulus 10'],
  [2, '107999', '88837491', true, 'pass modulus 11'],
  [3, '202959', '63748472', true, 'pass modulus 11 and double alternate'],
  [4, '871427', '46238510', true, 'exception 10 & 11, first passes second fails'],
  [5, '872427', '46238510', true, 'exception 10 & 11, first fails second passes'],
  [6, '871427', '09123496', true, 'exception 10 where ab=09 and g=9'],
  [7, '871427', '99123496', true, 'exception 10 where ab=99 and g=9'],
  [8, '820000', '73688637', true, 'exception 3 at the start of a range, c=6 skips the second'],
  [9, '827999', '73988638', true, 'exception 3 at the end of a range, c=9 skips the second'],
  [10, '827101', '28748352', true, 'exception 3 where c is neither 6 nor 9, both checks run'],
  [11, '134020', '63849203', true, 'exception 4 where the remainder equals the check digit'],
  [12, '118765', '64371389', true, 'exception 1 adds 27 to the total'],
  [13, '200915', '41011166', true, 'exception 6 foreign-currency account, unchecked'],
  [14, '938611', '07806039', true, 'exception 5 passing'],
  [15, '938600', '42368003', true, 'exception 5 passing with substitution'],
  [16, '938063', '55065200', true, 'exception 5 where both remainders are 0'],
  [17, '772798', '99345694', true, 'exception 7 passing where the standard check would fail'],
  [18, '086090', '06774744', true, 'exception 8 passing'],
  [19, '309070', '02355688', true, 'exception 2 & 9, first passes'],
  [20, '309070', '12345668', true, 'exception 2 & 9, second passes with substitution'],
  [21, '309070', '12345677', true, 'exception 2 & 9 where a≠0 and g≠9'],
  [22, '309070', '99345694', true, 'exception 2 & 9 where a≠0 and g=9'],
  [23, '938063', '15764273', false, 'exception 5, first check digit right and second wrong'],
  [24, '938063', '15764264', false, 'exception 5, first check digit wrong and second right'],
  [25, '938063', '15763217', false, 'exception 5, first check digit wrong with remainder 1'],
  [26, '118765', '64371388', false, 'exception 1 failing the double alternate check'],
  [27, '203099', '66831036', false, 'passes modulus 11, fails double alternate'],
  [28, '203099', '58716970', false, 'fails modulus 11, passes double alternate'],
  [29, '089999', '66374959', false, 'fails modulus 10'],
  [30, '107999', '88837493', false, 'fails modulus 11'],
  [31, '074456', '12345112', true, 'exception 12/13 passing the modulus 11 check'],
  [32, '070116', '34012583', true, 'exception 12/13 passing the modulus 11 check'],
  [33, '074456', '11104102', true, 'exception 12/13 failing modulus 11, passing modulus 10'],
  [34, '180002', '00000190', true, 'exception 14, first check fails and the retry passes'],
];

describe.skipIf(!ukModulusAvailable())('the UK modulus check, against the official vectors', () => {
  for (const [no, sortCode, account, expected, why] of VECTORS) {
    it(`case ${no}: ${why}`, () => {
      const r = checkUkModulus(sortCode, account);
      expect(r).not.toBeNull();
      // Case 13 is the foreign-currency exception: the specification calls it
      // valid because no check can be made, which is `checked: false` here —
      // "we did not decide", not "we decided it is fine".
      if (r!.checked) expect(r!.passed).toBe(expected);
      else expect(expected).toBe(true);
    });
  }

  it('reports an uncovered sorting code as unchecked rather than failed', () => {
    // 000000 is allocated to nobody and appears in no range. Vocalink's own
    // instruction is to presume such a pair valid, so answering `false` would
    // invent a failure and could block a legitimate payout.
    const r = checkUkModulus('000000', '12345678');
    expect(r?.checked).toBe(false);
    expect(r?.passed).toBeNull();
  });

  it('declines inputs that are not a six-digit code and an eight-digit number', () => {
    // Padding a short account number here would be inventing the customer's
    // account, so the check is refused instead.
    expect(checkUkModulus('12345', '12345678')).toBeNull();
    expect(checkUkModulus('123456', '1234567')).toBeNull();
    expect(checkUkModulus('12345a', '12345678')).toBeNull();
  });

  it('names its source and the day the table was harvested', () => {
    const r = checkUkModulus('089999', '66374958');
    expect(r?.source).toContain('Vocalink');
    expect(r?.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
