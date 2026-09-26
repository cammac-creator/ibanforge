import { describe, expect, it } from 'vitest';
import {
  parseDbUtc,
  sqliteUtc,
  swissWeekOf,
  swissWeekShift,
  zurichDayTime,
  zurichLocalToUtcMs,
  zurichOffsetMinutes,
  zurichParts,
} from './swiss-week.js';

const utc = (iso: string) => Date.parse(iso);

describe('l’heure suisse sans Intl', () => {
  it.each([
    ['2026-01-15T08:22:00Z', 60],
    ['2026-07-15T08:22:00Z', 120],
    ['2026-03-29T00:59:59Z', 60],
    ['2026-03-29T01:00:00Z', 120],
    ['2026-10-25T00:59:59Z', 120],
    ['2026-10-25T01:00:00Z', 60],
  ])('%s est à UTC+%i minutes', (iso, offset) => {
    expect(zurichOffsetMinutes(utc(iso))).toBe(offset);
  });

  it('donne le même jour et la même heure que la règle du site', () => {
    expect(zurichParts(utc('2026-10-04T22:30:00Z'))).toMatchObject({
      year: 2026,
      month: 10,
      day: 5,
      hour: 0,
      minute: 30,
      weekday: 1,
    });
    expect(zurichDayTime(utc('2026-12-06T22:30:00Z'))).toBe('06.12 à 23:30');
  });

  it('retrouve l’instant UTC d’une heure suisse, l’été comme l’hiver', () => {
    expect(new Date(zurichLocalToUtcMs(2026, 10, 5, 8, 0)).toISOString()).toBe(
      '2026-10-05T06:00:00.000Z',
    );
    expect(new Date(zurichLocalToUtcMs(2026, 10, 26, 8, 0)).toISOString()).toBe(
      '2026-10-26T07:00:00.000Z',
    );
    expect(new Date(zurichLocalToUtcMs(2026, 3, 30, 10, 59)).toISOString()).toBe(
      '2026-03-30T08:59:00.000Z',
    );
  });
});

describe('la semaine ISO suisse, du lundi 00:00 au dimanche 23:59', () => {
  it('range un dimanche 23:30 et un lundi 00:30 dans deux semaines différentes (été)', () => {
    const sunday = swissWeekOf(utc('2026-10-04T21:30:00Z'));
    const monday = swissWeekOf(utc('2026-10-04T22:30:00Z'));
    expect(sunday.label).toBe('2026-W40');
    expect(monday.label).toBe('2026-W41');
    expect(sunday.monday).toBe('2026-09-28');
    expect(sunday.sunday).toBe('2026-10-04');
    expect(new Date(sunday.startMs).toISOString()).toBe('2026-09-27T22:00:00.000Z');
    expect(new Date(sunday.endMs).toISOString()).toBe('2026-10-04T22:00:00.000Z');
  });

  it('fait de même l’hiver, à une heure d’écart', () => {
    expect(swissWeekOf(utc('2026-12-06T22:30:00Z')).label).toBe('2026-W49');
    expect(swissWeekOf(utc('2026-12-06T23:30:00Z')).label).toBe('2026-W50');
  });

  it('garde ses bornes justes la semaine du passage à l’heure d’hiver', () => {
    const w = swissWeekOf(utc('2026-10-25T22:30:00Z'));
    expect(w.label).toBe('2026-W43');
    expect(new Date(w.startMs).toISOString()).toBe('2026-10-18T22:00:00.000Z');
    expect(new Date(w.endMs).toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(swissWeekOf(utc('2026-10-25T23:10:00Z')).label).toBe('2026-W44');
  });

  it('et la semaine du passage à l’heure d’été', () => {
    const w = swissWeekOf(utc('2026-03-29T12:00:00Z'));
    expect(w.label).toBe('2026-W13');
    expect(new Date(w.startMs).toISOString()).toBe('2026-03-22T23:00:00.000Z');
    expect(new Date(w.endMs).toISOString()).toBe('2026-03-29T22:00:00.000Z');
  });

  it('porte l’année ISO de son jeudi au tournant de l’année', () => {
    expect(swissWeekOf(utc('2026-12-31T12:00:00Z')).label).toBe('2026-W53');
    expect(swissWeekOf(utc('2027-01-04T12:00:00Z')).label).toBe('2027-W01');
    expect(swissWeekOf(utc('2025-12-29T12:00:00Z')).label).toBe('2026-W01');
  });

  it('recule et avance d’une semaine sans perdre le fil des lundis', () => {
    const w = swissWeekOf(utc('2026-10-07T10:00:00Z'));
    expect(swissWeekShift(w, 1).label).toBe('2026-W40');
    expect(swissWeekShift(w, 3).monday).toBe('2026-09-14');
    expect(swissWeekShift(w, -3).label).toBe('2026-W44');
    expect(swissWeekShift(w, -3).startMs).toBe(utc('2026-10-25T23:00:00Z'));
  });
});

describe('les horodatages de la base', () => {
  it('lit la forme de datetime(now) et l’ISO complet comme de l’UTC', () => {
    expect(parseDbUtc('2026-10-04 21:30:00')).toBe(utc('2026-10-04T21:30:00Z'));
    expect(parseDbUtc('2026-10-04T21:30:00.000Z')).toBe(utc('2026-10-04T21:30:00Z'));
    expect(parseDbUtc('2026-10-04')).toBe(utc('2026-10-04T00:00:00Z'));
    expect(parseDbUtc('pas une date')).toBeNull();
    expect(parseDbUtc(null)).toBeNull();
    expect(sqliteUtc(utc('2026-10-04T21:30:05Z'))).toBe('2026-10-04 21:30:05');
  });
});
