import { describe, expect, it } from 'vitest';
import { businessFixture } from './business-pulse.fixture';
import { completeWeekChange, readBusinessPulse, shortDay } from './business-pulse';

describe('synthèse de pilotage : confiance dans la lecture', () => {
  it('accepte un calendrier complet et cohérent', () => {
    const p = businessFixture();
    expect(readBusinessPulse(p)).toEqual(p);
  });
  it.each([null, undefined, {}, { version: 1 }, [], 'indisponible'])(
    'ne remplace jamais %j par zéro',
    (value) => {
      expect(readBusinessPulse(value)).toBeNull();
    },
  );
  it('refuse compte négatif, semaine non rapprochée, trou et doublon dans les jours', () => {
    for (const change of [
      (p: ReturnType<typeof businessFixture>) => {
        p.days[4].active_accounts = -1;
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.weeks[7].new_accounts++;
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.days.splice(4, 1);
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.days[4] = p.days[3];
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.totals.active_7d = 500;
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.totals.returning_7d = 19;
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.weeks[7].partial = false;
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.weeks[0].start = p.weeks[1].start;
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.generated_at = '2026-11-06';
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.totals.known_accounts = 50;
      },
      (p: ReturnType<typeof businessFixture>) => {
        p.totals.buyer_accounts = 5;
      },
    ]) {
      const p = businessFixture();
      change(p);
      expect(readBusinessPulse(p)).toBeNull();
    }
  });
  it('accepte un zéro observé sans inventer d’activité', () => {
    const p = businessFixture();
    p.days.forEach((d) => {
      d.active_accounts = 0;
      d.new_accounts = 0;
      d.new_buyers = 0;
    });
    p.weeks.forEach((w) => {
      w.new_accounts = 0;
      w.new_buyers = 0;
    });
    p.totals = {
      known_accounts: 0,
      buyer_accounts: 0,
      active_7d: 0,
      active_30d: 0,
      returning_7d: 0,
    };
    expect(readBusinessPulse(p)).not.toBeNull();
  });
  it('une variation ne compare jamais une semaine partielle à une semaine complète', () => {
    const p = businessFixture();
    p.weeks[5].new_accounts = 6;
    p.weeks[6].new_accounts = 9;
    p.weeks[7].new_accounts = 1;
    expect(completeWeekChange(p, 'new_accounts')).toBe(3);
    p.weeks[7].new_accounts = 200;
    expect(completeWeekChange(p, 'new_accounts')).toBe(3);
  });
  it('garde le repère UTC autour du changement de semaine et d’année', () => {
    const p = businessFixture(new Date('2027-01-04T00:00:00.000Z'));
    expect(readBusinessPulse(p)).not.toBeNull();
    expect(p.weeks[7].start).toBe('2027-01-04');
    expect(p.weeks[6].end).toBe('2027-01-03');
    expect(shortDay('2027-01-04', 'fr')).toBe('04/01');
    expect(shortDay('2027-01-04', 'en')).toBe('01/04');
  });
});
