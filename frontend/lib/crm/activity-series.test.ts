import { describe, expect, it } from 'vitest';
import { dailyActivity, weeklyActivity, monthlyActivity, hourlyActivity, decodeHours } from './activity-series';
const at = '2026-11-06T23:30:00Z';
const email = 'contact@alpha.example.net';
const hours = () => ({ email, timezone: 'UTC', generated_at: at, window_start: '2026-11-05T23:30:00Z', hours: [{ hour: '2026-11-05T23:00', count: 2, bad: 1 }, { hour: '2026-11-06T23:00', count: 3, bad: 0 }] });

describe('Échelles de l’activité', () => {
  it('reste sur l’instant lu et remplit les journées absentes', () => {
    const bars = dailyActivity([{ day: '2026-11-06', count: 7, bad: 1 }], 7, at);
    expect(bars).toHaveLength(7);
    expect(bars[0].key).toBe('2026-10-31');
    expect(bars[0].count).toBe(0);
    expect(bars.at(-1)).toMatchObject({ key: '2026-11-06', count: 7, bad: 1, partial: true });
  });
  it('ne présente pas les semaines hors du périmètre comme des zéros', () => {
    const days = dailyActivity([], 30, at).map(b => ({ day: b.key, count: 1 }));
    const bars = weeklyActivity(days, at);
    expect(bars[0]).toMatchObject({ key: '2026-10-05', count: 4, partial: true });
    expect(bars.at(-1)).toMatchObject({ key: '2026-11-02', count: 5, partial: true });
    expect(bars.reduce((sum, b) => sum + b.count, 0)).toBe(30);
    expect(bars.slice(1, -1).every(b => !b.partial)).toBe(true);
  });
  it('regroupe les clés dans les compteurs mensuels séparés', () => {
    const bars = monthlyActivity([{ month: '2026-11', count: 2 }, { month: '2026-11', count: 3 }], at);
    expect(bars).toHaveLength(12);
    expect(bars.at(-1)).toMatchObject({ key: '2026-11', count: 5, partial: true });
  });
  it('conserve les deux heures partielles des 24 heures glissantes', () => {
    const data = decodeHours(hours(), email);
    expect(data).not.toBeNull();
    const bars = hourlyActivity(data!);
    expect(bars).toHaveLength(25);
    expect(bars[0]).toMatchObject({ count: 2, bad: 1, partial: true });
    expect(bars.at(-1)).toMatchObject({ count: 3, partial: true });
    expect(bars.reduce((sum, b) => sum + b.count, 0)).toBe(5);
  });
  it('distingue les heures illisibles des heures sans activité', () => {
    expect(decodeHours({ ...hours(), hours: [] }, email)).not.toBeNull();
    for (const raw of [{}, { ...hours(), hours: null }, { ...hours(), email: 'autre@alpha.example.net' }, { ...hours(), window_start: '2026-11-06T00:00:00Z' }, { ...hours(), hours: [{ hour: '2026-11-06T23:00', count: 1, bad: 2 }] }, { ...hours(), hours: [{ hour: '2026-11-07T00:00', count: 1, bad: 0 }] }]) expect(decodeHours(raw, email)).toBeNull();
  });
});
