import { describe, it, expect } from 'vitest';
import { audienceFixture } from './audience-fixture';
import {
  ENTRY_PAGES,
  ENTRY_REFERRERS,
  readAudienceFunnel,
  readEntryBuckets,
  TRIAL_INDICATORS,
  type AudienceBucket,
} from './audience-model';

function fixture() {
  const funnel = audienceFixture();
  const partition = (names: readonly string[]): AudienceBucket[] =>
    names.map((name) => ({
      name,
      lineages: name === 'unknown' ? 24 : 0,
      ...Object.fromEntries(
        TRIAL_INDICATORS.map((key) => [
          key,
          name === 'unknown'
            ? { ...funnel.indicators[key] }
            : { numerator: 0, denominator: 0, pending: 0, value: null, coverage: null },
        ]),
      ),
    })) as AudienceBucket[];
  return {
    ...funnel,
    by_entry_referrer: partition(ENTRY_REFERRERS),
    by_entry_page: partition(ENTRY_PAGES),
  };
}

describe('Lecture des origines sans faux taux', () => {
  it('préserve les anciennes réponses et signale seulement la nouvelle lecture absente', () => {
    expect(readAudienceFunnel(audienceFixture())).not.toBeNull();
    expect(
      readEntryBuckets({ ...audienceFixture(), by_entry_referrer: undefined }, 'referrer'),
    ).toBeNull();
  });
  it('lit une API qui n’envoie pas encore la catégorie des assistants IA, jamais un doublon', () => {
    const sans = fixture();
    sans.by_entry_referrer = sans.by_entry_referrer.filter((row) => row.name !== 'ai_assistant');
    expect(readEntryBuckets(sans, 'referrer')?.map((row) => row.name)).not.toContain('ai_assistant');
    const double = fixture();
    double.by_entry_referrer.push({ ...double.by_entry_referrer[1] });
    expect(double.by_entry_referrer[1].name).toBe('ai_assistant');
    expect(readEntryBuckets(double, 'referrer')).toBeNull();
  });
  it.each(['referrer', 'page'] as const)('retrouve la cohorte entière par %s', (dimension) => {
    const result = readEntryBuckets(fixture(), dimension);
    expect(result?.find((row) => row.name === 'unknown')?.lineages).toBe(24);
    expect(result?.find((row) => row.name === 'unknown')?.return_week_2.pending).toBe(4);
  });
  it.each(['doublon', 'manquant', 'total', 'taux', 'attente', 'hors-cohorte', 'domaine libre'])(
    'refuse une partition invalide : %s',
    (fault) => {
      const f = fixture();
      const rows = f.by_entry_referrer;
      const last = rows.at(-1)!;
      if (fault === 'doublon') rows[0].name = 'unknown';
      if (fault === 'manquant') rows.pop();
      if (fault === 'total') last.lineages = 23;
      if (fault === 'taux') last.first_result_24h.value = 0.99;
      if (fault === 'attente')
        last.return_week_2 = {
          numerator: 3,
          denominator: 8,
          pending: 0,
          value: 0.375,
          coverage: 1,
        };
      if (fault === 'hors-cohorte') {
        rows[0].lineages = 23;
        last.lineages = 1;
      }
      if (fault === 'domaine libre') rows[0].name = 'alpha.example.net';
      expect(readEntryBuckets(f, 'referrer')).toBeNull();
      expect(readEntryBuckets(f, 'page')).not.toBeNull();
    },
  );
});
