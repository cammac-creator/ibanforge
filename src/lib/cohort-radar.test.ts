import { describe, it, expect } from 'vitest';
import {
  looksMachineMade,
  localPartOf,
  findCohorts,
  cohortAddress,
  COHORT_WINDOWS,
  type CreationRow,
} from './cohort-radar.js';

const NOW = new Date('2026-08-19T17:10:00Z');

/** Build a creation row at N minutes before NOW. */
function row(
  minutesAgo: number,
  ua: string | null,
  email: string | null,
  prefix = `ifk_${minutesAgo}${email ?? ''}`,
): CreationRow {
  const at = new Date(NOW.getTime() - minutesAgo * 60 * 1000);
  return {
    key_prefix: prefix,
    user_agent: ua,
    email,
    created_at: at.toISOString().slice(0, 19).replace('T', ' '),
  };
}

describe('looksMachineMade', () => {
  it('accepts the machine-made shapes: long consonant runs or almost no vowels', () => {
    expect(looksMachineMade('pwwhqjpghlvj')).toBe(true); // no vowel at all
    expect(looksMachineMade('koulnvwrgccu')).toBe(true); // six consonants in a row
    expect(looksMachineMade('ugmicpdrqxca')).toBe(true);
  });

  it('leaves ordinary human addresses alone', () => {
    expect(looksMachineMade('claudealainmartin')).toBe(false);
    expect(looksMachineMade('marie.duval')).toBe(false); // a separator is a human sign
    expect(looksMachineMade('heart1010')).toBe(false); // digits too
    expect(looksMachineMade('contact')).toBe(false); // too short to judge
    expect(looksMachineMade('solomon')).toBe(false);
  });

  it('never judges a short pseudonym — several paying customers use one', () => {
    expect(looksMachineMade('fuzzy')).toBe(false);
    expect(looksMachineMade('zeebrow')).toBe(false);
  });
});

describe('localPartOf', () => {
  it('splits on the first @', () => {
    expect(localPartOf('someone@alpha.example.net')).toBe('someone');
    expect(localPartOf('no-at-sign')).toBe('no-at-sign');
  });
});

describe('findCohorts', () => {
  it('groups a burst that shares one client library string', () => {
    const rows = [
      row(1, 'demo-http-client/9.9', 'pwwhqjpghlvj@gmail.com'),
      row(2, 'demo-http-client/9.9', 'koulnvwrgccu@yahoo.com'),
      row(3, 'demo-http-client/9.9', 'ugmicpdrqxca@outlook.com'),
      row(4, 'demo-http-client/9.9', 'gfdrroavihgz@icloud.com'),
      row(5, 'demo-http-client/9.9', 'mnbvpdxndxwv@proton.me'),
    ];
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].userAgent).toBe('demo-http-client/9.9');
    expect(cohorts[0].keyPrefixes).toHaveLength(5);
    expect(cohorts[0].machineShapeRatio).toBe(1);
  });

  it('leaves a busy but human client alone — the shape ratio is what decides', () => {
    const rows = [
      row(1, 'demo-http-client/9.9', 'marie.duval@alpha.example.net'),
      row(2, 'demo-http-client/9.9', 'jean.bernard@alpha.example.net'),
      row(3, 'demo-http-client/9.9', 'paul.henry@alpha.example.net'),
      row(4, 'demo-http-client/9.9', 'anne.moreau@alpha.example.net'),
      row(5, 'demo-http-client/9.9', 'luc.petit@alpha.example.net'),
    ];
    expect(findCohorts(rows, NOW)).toEqual([]);
  });

  it('regroups only the machine-shaped addresses, sparing the human minority', () => {
    const human = row(5, 'demo-http-client/9.9', 'marie.duval@alpha.example.net', 'ifk_human');
    const rows = [
      row(1, 'demo-http-client/9.9', 'pwwhqjpghlvj@gmail.com', 'ifk_m1'),
      row(2, 'demo-http-client/9.9', 'koulnvwrgccu@yahoo.com', 'ifk_m2'),
      row(3, 'demo-http-client/9.9', 'ugmicpdrqxca@outlook.com', 'ifk_m3'),
      row(4, 'demo-http-client/9.9', 'gfdrroavihgz@icloud.com', 'ifk_m4'),
      human,
    ];
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    // The group of 5 triggers (ratio 0.8), but only the 4 machine-shaped keys
    // are regrouped — the human's key is NOT in the cohort.
    expect(cohorts[0].keyPrefixes).toHaveLength(4);
    expect(cohorts[0].keyPrefixes).not.toContain('ifk_human');
    expect(cohorts[0].machineShapeRatio).toBe(0.8);
  });

  it('does not sweep a legitimate signup into a poisoned generic-client batch', () => {
    // An adversary reads the public repo and mints 8 machine-shaped keys under a
    // common client string; a real customer signs up under the same client in
    // the same window. Only the machine-shaped keys are regrouped.
    const legit = row(3, 'axios/1.6.0', 'nicolas.perret@alpha.example.net', 'ifk_legit');
    const rows = [
      ...Array.from({ length: 8 }, (_, i) =>
        row(
          i + 1,
          'axios/1.6.0',
          `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`,
          `ifk_p${i}`,
        ),
      ),
      legit,
    ];
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].keyPrefixes).not.toContain('ifk_legit');
    expect(cohorts[0].keyPrefixes).toHaveLength(8);
  });

  it('does not group different clients together', () => {
    const rows = [
      row(1, 'client-a/1.0', 'pwwhqjpghlvj@gmail.com'),
      row(2, 'client-a/1.0', 'koulnvwrgccu@yahoo.com'),
      row(3, 'client-b/1.0', 'ugmicpdrqxca@outlook.com'),
      row(4, 'client-b/1.0', 'gfdrroavihgz@icloud.com'),
      row(5, 'client-b/1.0', 'mnbvpdxndxwv@proton.me'),
    ];
    expect(findCohorts(rows, NOW)).toEqual([]); // neither reaches 5 in 15 min
  });

  it('catches the slow variant through the wider window', () => {
    // One signup every 90 minutes never trips the 15-minute rule, but eight of
    // them inside a day do.
    const rows = Array.from({ length: 8 }, (_, i) =>
      row(
        90 * (i + 1),
        'slow-client/1.0',
        `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`,
        `ifk_slow${i}`,
      ),
    );
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].windowHours).toBe(24);
    expect(cohorts[0].keyPrefixes).toHaveLength(8);
  });

  it('catches a tight burst that finished well before the tick (sliding window)', () => {
    // Five signups in ten minutes, but they ended three hours before this pass.
    // Anchored to now it would be invisible; a slide over the history sees it.
    const rows = Array.from({ length: 5 }, (_, i) =>
      row(
        180 + i * 2,
        'late-client/1.0',
        `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`,
        `ifk_late${i}`,
      ),
    );
    const cohorts = findCohorts(rows, NOW);
    expect(cohorts).toHaveLength(1);
    expect(cohorts[0].windowHours).toBe(0.25);
    expect(cohorts[0].keyPrefixes).toHaveLength(5);
  });

  it('ignores rows with nothing to link them by', () => {
    const rows = [
      row(1, null, 'pwwhqjpghlvj@gmail.com'),
      row(2, null, 'koulnvwrgccu@yahoo.com'),
      row(3, null, 'ugmicpdrqxca@outlook.com'),
      row(4, null, 'gfdrroavihgz@icloud.com'),
      row(5, null, 'mnbvpdxndxwv@proton.me'),
    ];
    expect(findCohorts(rows, NOW)).toEqual([]);
  });

  it('reads timestamps as UTC, whatever the machine timezone', () => {
    // Written the way SQLite does: a space, no zone marker. Parsed as local
    // time these would fall outside the 15-minute window west of Greenwich.
    const rows = [
      row(1, 'tz-client/1.0', 'pwwhqjpghlvj@gmail.com'),
      row(2, 'tz-client/1.0', 'koulnvwrgccu@yahoo.com'),
      row(3, 'tz-client/1.0', 'ugmicpdrqxca@outlook.com'),
      row(4, 'tz-client/1.0', 'gfdrroavihgz@icloud.com'),
      row(5, 'tz-client/1.0', 'mnbvpdxndxwv@proton.me'),
    ];
    expect(rows[0].created_at).not.toContain('T');
    expect(findCohorts(rows, NOW)[0].keyPrefixes).toHaveLength(5);
  });

  it('never forms a cohort below the smallest threshold', () => {
    const rows = Array.from({ length: COHORT_WINDOWS[0].minKeys - 1 }, (_, i) =>
      row(i + 1, 'tiny/1.0', `pwwhqjpghlv${String.fromCharCode(97 + i)}@gmail.com`, `ifk_tiny${i}`),
    );
    expect(findCohorts(rows, NOW)).toEqual([]);
  });
});

describe('cohortAddress', () => {
  it('builds an address on a top-level domain that can never receive mail', () => {
    expect(cohortAddress('demo-http-client/9.9', '2026-08-19')).toBe(
      'demo-http-client-9-9-2026-08-19@cohorte.invalid',
    );
  });

  it('survives a client string made only of punctuation', () => {
    expect(cohortAddress('///', '2026-08-19')).toBe('client-2026-08-19@cohorte.invalid');
  });
});
