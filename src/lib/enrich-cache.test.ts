import { describe, it, expect } from 'vitest';
import { createEnrichCache, enrichResult } from './enrich.js';
import { validateIBAN } from './iban.js';

/**
 * PERF-05, performance audit of 01/09/2026: a batch of 100 ran 100 independent
 * enrichments, and `enrichResult` is ~99% of the CPU of the two paid routes.
 * The batch now memoises the bank resolution per (country, bank code).
 *
 * The only thing worth testing about a cache is that it changed nothing. These
 * assertions are all forms of that one question.
 */

function enriched(iban: string, cache?: ReturnType<typeof createEnrichCache>) {
  const result = validateIBAN(iban);
  enrichResult(result, cache);
  return result;
}

/** Ten IBANs of one German bank, differing only in the account number. */
function sameBankBatch(): string[] {
  // Checksum recomputed for each account number, so every one is a genuinely
  // valid IBAN rather than a string the enricher would refuse to look at.
  return Array.from({ length: 10 }, (_, i) => {
    const bban = `37040044${String(1000000000 + i)}`;
    const rearranged = `${bban}DE00`;
    const numeric = [...rearranged]
      .map((ch) => (/[0-9]/.test(ch) ? ch : String(ch.charCodeAt(0) - 55)))
      .join('');
    let rem = 0;
    for (const d of numeric) rem = (rem * 10 + Number(d)) % 97;
    return `DE${String(98 - rem).padStart(2, '0')}${bban}`;
  });
}

describe('the per-batch enrichment cache', () => {
  it('serves the same payload, byte for byte, as no cache at all', () => {
    const cache = createEnrichCache();
    for (const iban of [
      ...sameBankBatch(),
      'DE89370400440532013000',
      'CH5604835012345678009',
      'GB29NWBK60161331926819',
      'NL02ABNA0123456789',
      'ES9121000418450200051332',
    ]) {
      expect(JSON.stringify(enriched(iban, cache)), iban).toBe(JSON.stringify(enriched(iban)));
    }
  });

  it('answers the account-level fields per IBAN, not once per bank', () => {
    // The trap a coarser cache would fall into: memoising the whole enrichment
    // by bank code would hand every account of a bank the first one's UK
    // modulus verdict and the first one's BBAN.
    const cache = createEnrichCache();
    const first = enriched('GB29NWBK60161331926819', cache);
    const second = enriched('GB94BARC10201530093459', cache);
    expect(second.bban!.account_number).not.toBe(first.bban!.account_number);
    expect(second.bic!.code).not.toBe(first.bic!.code);
  });

  it('resolves one bank once, whatever the batch size', () => {
    const cache = createEnrichCache();
    for (const iban of sameBankBatch()) enriched(iban, cache);
    expect(cache.bank.size).toBe(1);
  });

  it('hands each result its own bic object', () => {
    // Two results sharing one object is how a mutation on one answer ends up in
    // another's response.
    const cache = createEnrichCache();
    const batch = sameBankBatch();
    const a = enriched(batch[0], cache);
    const b = enriched(batch[1], cache);
    expect(a.bic).toEqual(b.bic);
    expect(a.bic).not.toBe(b.bic);
  });

  it('is optional — the same call without one still works', () => {
    const result = enriched('DE89370400440532013000');
    expect(result.bic!.bank_name).toBeTruthy();
  });
});
