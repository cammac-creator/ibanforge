/**
 * The probe that watches the measurement (QUA-12, 2026-09-01).
 *
 * `./ops-alert.js` is mocked rather than exercised: the real one writes
 * `ops:state:*` / `ops:sent:*` rows into `kv_state`, which lives inside
 * `stats.sqlite`. A latched `firing: true` or a timestamp inside the 6 h
 * anti-storm window would make the SECOND run of this suite behave differently
 * from the first, which is the classic way a green test stops meaning anything.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const opsFail = vi.fn(async () => {});
const opsOk = vi.fn(async () => {});
vi.mock('./ops-alert.js', () => ({
  opsFail: (...args: unknown[]) => opsFail(...(args as [])),
  opsOk: (...args: unknown[]) => opsOk(...(args as [])),
}));

const { recordSafely, resetRecordSafely, recordSafelyFailures, RECORD_FAIL_THRESHOLD } = await import(
  './record-safely.js'
);

beforeEach(() => {
  resetRecordSafely();
  opsFail.mockClear();
  opsOk.mockClear();
});

describe('recordSafely never lets a stats write reach the caller', () => {
  it('swallows a throw', () => {
    expect(() =>
      recordSafely(() => {
        throw new Error('SQLITE_READONLY');
      }, 'iban_validate'),
    ).not.toThrow();
  });

  it('runs the function it is handed', () => {
    let ran = 0;
    recordSafely(() => {
      ran++;
    }, 'iban_validate');
    expect(ran).toBe(1);
  });
});

describe('the consecutive-failure counter', () => {
  it('counts a throw and a literal false, per label', () => {
    recordSafely(() => {
      throw new Error('boom');
    }, 'iban_validate');
    recordSafely(() => false, 'iban_validate');
    recordSafely(() => false, 'bic_lookup');
    expect(recordSafelyFailures('iban_validate')).toBe(2);
    expect(recordSafelyFailures('bic_lookup')).toBe(1);
  });

  /**
   * `undefined` is what a void recorder returns on its happy path, and today
   * also on its unhappy one (see the module header). Treating it as a failure
   * would alert on every single served call.
   */
  it('treats undefined and true as success', () => {
    recordSafely(() => undefined, 'iban_validate');
    recordSafely(() => true, 'iban_validate');
    expect(recordSafelyFailures('iban_validate')).toBe(0);
  });

  it('resets the streak on the first success', () => {
    for (let i = 0; i < 3; i++) recordSafely(() => false, 'iban_validate');
    expect(recordSafelyFailures('iban_validate')).toBe(3);
    recordSafely(() => undefined, 'iban_validate');
    expect(recordSafelyFailures('iban_validate')).toBe(0);
  });
});

describe('the alert threshold', () => {
  it('stays silent below the threshold', () => {
    for (let i = 0; i < RECORD_FAIL_THRESHOLD - 1; i++) recordSafely(() => false, 'iban_validate');
    expect(opsFail).not.toHaveBeenCalled();
  });

  it('fires once at the threshold, then not on every following call', () => {
    for (let i = 0; i < RECORD_FAIL_THRESHOLD + 20; i++) recordSafely(() => false, 'iban_validate');
    expect(opsFail).toHaveBeenCalledTimes(1);
    const [key, detail, threshold] = opsFail.mock.calls[0] as unknown as [string, string, number];
    expect(key).toBe('stats:record');
    expect(threshold).toBe(1);
    expect(detail).toContain('iban_validate');
    // Technical only: never an address, an IBAN or a key (ops-alert.ts rule 3).
    expect(detail).not.toContain('@');
  });

  it('says the healing once the writes land again', () => {
    for (let i = 0; i < RECORD_FAIL_THRESHOLD; i++) recordSafely(() => false, 'iban_validate');
    expect(opsFail).toHaveBeenCalledTimes(1);
    recordSafely(() => undefined, 'iban_validate');
    expect(opsOk).toHaveBeenCalledTimes(1);
    expect((opsOk.mock.calls[0] as unknown as [string])[0]).toBe('stats:record');
  });

  it('does not announce a resolution nobody was told about', () => {
    recordSafely(() => false, 'iban_validate');
    recordSafely(() => undefined, 'iban_validate');
    expect(opsOk).not.toHaveBeenCalled();
  });

  /**
   * One key for the whole family: a broken stats DB is one incident, not one
   * per operation type, and a second label must not re-open a message that is
   * already on the owner's phone.
   */
  it('does not re-alert for a second label while the first is still open', () => {
    for (let i = 0; i < RECORD_FAIL_THRESHOLD; i++) recordSafely(() => false, 'iban_validate');
    for (let i = 0; i < RECORD_FAIL_THRESHOLD; i++) recordSafely(() => false, 'bic_lookup');
    expect(opsFail).toHaveBeenCalledTimes(1);
  });

  it('keeps the alert open while any label is still failing', () => {
    for (let i = 0; i < RECORD_FAIL_THRESHOLD; i++) recordSafely(() => false, 'iban_validate');
    for (let i = 0; i < RECORD_FAIL_THRESHOLD; i++) recordSafely(() => false, 'bic_lookup');
    recordSafely(() => undefined, 'iban_validate');
    expect(opsOk).not.toHaveBeenCalled();
    recordSafely(() => undefined, 'bic_lookup');
    expect(opsOk).toHaveBeenCalledTimes(1);
  });
});
