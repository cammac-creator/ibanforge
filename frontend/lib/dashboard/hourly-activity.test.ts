import { describe, expect, it } from 'vitest';
import { hourRange, hourlyDate, readHourlyActivity } from './hourly-activity';
const fixture = () => ({ source: 'hourly_stats', unit: 'operations', timezone: 'UTC', period_days: 7, window_start: '2026-08-24', window_end: '2026-08-30', heatmap: [{ day: 0, hour: 9, total: 12 }, { day: 6, hour: 23, total: 4 }] });
describe('activité horaire', () => {
  it('remplit la grille seulement après validation de la lecture', () => {
    const d = readHourlyActivity(fixture(), 7)!;
    expect(d.total).toBe(16);expect(d.grid).toHaveLength(7);expect(d.grid.every((v) => v.length === 24)).toBe(true);
    expect(d.byDay).toEqual([12,0,0,0,0,0,4]);expect(d.grid[0][8]).toBe(0);expect(d.peak).toEqual({ day:0,hour:9,count:12 });
  });
  it('sépare une vraie lecture vide de son absence', () => {
    expect(readHourlyActivity({ ...fixture(), heatmap:[] },7)?.total).toBe(0);
    expect(readHourlyActivity({ ...fixture(), heatmap:[] },7)?.peak).toBeNull();
    expect(readHourlyActivity(null,7)).toBeNull();expect(readHourlyActivity({},7)).toBeNull();
  });
  it.each(['source','unit','timezone','period_days','window_start','window_end','heatmap'])('refuse %s absent', (key) => {
    const v: Record<string, unknown> = fixture();delete v[key];expect(readHourlyActivity(v,7)).toBeNull();
  });
  it.each([{day:0.5,hour:0,total:1},{day:7,hour:0,total:1},{day:-1,hour:0,total:1},{day:0,hour:24,total:1},{day:0,hour:1.5,total:1},{day:0,hour:0,total:-1},{day:0,hour:0,total:'1'},{day:0,hour:0,total:NaN},null])('refuse une case invalide : %j', (row) => {
    expect(readHourlyActivity({...fixture(),heatmap:[row]},7)).toBeNull();
  });
  it('refuse un doublon au lieu de doubler le volume', () => {
    const f=fixture();f.heatmap.push(f.heatmap[0]);expect(readHourlyActivity(f,7)).toBeNull();
  });
  it('refuse les fenêtres fausses ou une période différente', () => {
    for(const over of [{window_start:'2026-08-23'},{window_end:'2026-02-30'},{period_days:30},{timezone:'Europe/Zurich'},{unit:'requests'}])expect(readHourlyActivity({...fixture(),...over},7)).toBeNull();
    expect(readHourlyActivity(fixture(),30)).toBeNull();
  });
  it('refuse une somme hors précision entière sûre', () => {
    const f=fixture();f.heatmap[0].total=Number.MAX_SAFE_INTEGER;expect(readHourlyActivity(f,7)).toBeNull();
  });
  it('ne fabrique pas un pic à partir de zéros et tranche une égalité dans l’ordre du calendrier', () => {
    const f=fixture();f.heatmap[1].total=12;expect(readHourlyActivity(f,7)?.peak?.day).toBe(0);
    f.heatmap.forEach(r=>r.total=0);expect(readHourlyActivity(f,7)?.peak).toBeNull();
  });
  it('nomme les créneaux UTC jusqu’à la fin du jour', () => {
    expect(hourRange(0)).toBe('00:00–01:00');expect(hourRange(23)).toBe('23:00–24:00');expect(hourlyDate('2026-08-30')).toBe('30.08.2026');
  });
});
