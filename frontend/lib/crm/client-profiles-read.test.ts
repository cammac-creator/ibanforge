import { describe, expect, it } from 'vitest';
import { decodeClientProfiles } from './client-profiles-read';
import { callsToday, calendarDaysSince } from './client-dossiers';

const empty = () => ({ period_days: 30, generated_at: '2026-11-06T12:00:00Z', window_end: '2026-11-06T12:00:00Z', window_start: '2026-10-08T00:00:00Z', timezone: 'UTC', profiles: {}, months_by_key: {}, quota_warned_by_key: {} });
const profile = () => ({ key_prefix: 'ifk_fictif', first_seen: '2026-11-06 10:00:00', last_seen: '2026-11-06 10:00:00', total: 1, ok: 1, paywall: 0, bad_input: 0, auth_or_quota: 0, server_error: 0, avg_ms: 12, p95_ms: 12, last_success_at: '2026-11-06 10:00:00', last_refusal_at: null, endpoints: [{ path: '/v1/iban/validate', count: 1 }], countries: [{ code: 'CH', count: 3 }], user_agents: [], client_kinds: [], distinct_ips: 1, hours: Array.from({ length: 24 }, (_, i) => i === 10 ? 1 : 0), days: [{ day: '2026-11-06', count: 1, bad: 0 }], reject_reasons: [] });

describe('Lecture des profils', () => {
  it('distingue un vrai vide de l’absence du contrat', () => {
    expect(decodeClientProfiles(empty(), 30).readable).toBe(true);
    for (const raw of [null, {}, [], { profiles: {} }, { ...empty(), profiles: null }, { ...empty(), period_days: 90 }, { ...empty(), window_start: '2026-10-07T00:00:00Z' }]) expect(decodeClientProfiles(raw, 30).readable).toBe(false);
  });
  it('accepte des opérations de lot plus nombreuses que les requêtes', () => {
    const read = decodeClientProfiles({ ...empty(), profiles: { ifk_fictif: profile() } }, 30);
    expect(read.readable).toBe(true);
    expect(read.profiles.ifk_fictif.countries[0].count).toBe(3);
  });
  it.each([
    { total: -1 }, { p95_ms: Infinity }, { days: [] }, { hours: [0] }, { countries: null },
    { days: [{ day: '2026-11-07', count: 1 }] }, { days: [{ day: '2026-10-07', count: 1 }] },
    { days: [{ day: '2026-11-06', count: 1, bad: 2 }] }, { last_seen: 'inconnue' },
  ])('refuse des compteurs illisibles ou une courbe incohérente : %j', patch => {
    expect(decodeClientProfiles({ ...empty(), profiles: { ifk_fictif: { ...profile(), ...patch } } }, 30).readable).toBe(false);
  });
  it('refuse un mauvais historique mensuel ou des avis non mensuels', () => {
    expect(decodeClientProfiles({ ...empty(), months_by_key: { ifk_fictif: [{ month: '2026-13', count: 1 }] } }, 30).readable).toBe(false);
    expect(decodeClientProfiles({ ...empty(), quota_warned_by_key: { ifk_fictif: ['credits-notice'] } }, 30).readable).toBe(false);
  });
});

describe('Jour des appels et calendrier de relation', () => {
  it.each(['2026-11-06T23:30:00Z', '2026-07-06T22:30:00Z'])('garde le jour UTC après minuit suisse : %s', stamp => {
    const now = new Date(stamp);
    expect(callsToday([{ day: stamp.slice(0, 10), count: 7 }], now)).toBe(7);
  });
  it('change de bucket seulement à minuit UTC', () => {
    expect(callsToday([{ day: '2026-11-06', count: 7 }], new Date('2026-11-07T00:00:00Z'))).toBe(0);
  });
  it('garde les jours de relation suisses pendant le passage à l’heure d’été', () => {
    expect(calendarDaysSince(new Date('2026-03-28T23:30:00Z'), new Date('2026-03-29T22:30:00Z'))).toBe(1);
    expect(calendarDaysSince(new Date('2026-11-06T22:30:00Z'), new Date('2026-11-06T23:30:00Z'))).toBe(1);
  });
});
