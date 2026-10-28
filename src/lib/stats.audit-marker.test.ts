import { afterAll, describe, expect, it } from 'vitest';
import { closeAll, getStatsDB } from './db.js';
import { getHourlyStats, getQuickStats, getStats, recordOperation } from './stats.js';

afterAll(closeAll);

describe('un fichier suisse reste une seule opération', () => {
  it('conserve le marqueur suisse sans doubler les compteurs ni le taux de succès', () => {
    recordOperation('audit_upload', null, true, 0);
    recordOperation('audit_upload', null, false, 0);
    const before = getQuickStats();
    expect(recordOperation('audit_upload_ch', 'CH', true, 0)).toBe(true);
    expect(getQuickStats()).toEqual(before);
    expect(before.total_operations).toBe(2);
    expect(before.success_rate).toBe(50);
    const db = getStatsDB();
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM operations WHERE operation_type = 'audit_upload_ch'")
        .get(),
    ).toEqual({ n: 1 });
    for (const table of ['daily_stats', 'hourly_stats']) {
      expect(db.prepare(`SELECT SUM(total) AS n FROM ${table}`).get()).toEqual({ n: 2 });
      expect(
        db
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE operation_type = 'audit_upload_ch'`)
          .get(),
      ).toEqual({ n: 0 });
    }
  });

  it('écarte aussi les anciens agrégats suisses sans les effacer', () => {
    const db = getStatsDB();
    const daily = getStats().last_7_days;
    const hourly = getHourlyStats();
    db.exec(`
      INSERT INTO daily_stats (date, operation_type, total, success_count, revenue_usdc)
      VALUES (date('now'), 'audit_upload_ch', 3, 3, 0);
      INSERT INTO hourly_stats (date, hour, day_of_week, operation_type, total, success_count)
      VALUES (date('now'), 12, 2, 'audit_upload_ch', 3, 3);
    `);
    expect(getStats().last_7_days).toEqual(daily);
    expect(getHourlyStats()).toEqual(hourly);
    expect(
      db.prepare("SELECT total FROM daily_stats WHERE operation_type = 'audit_upload_ch'").get(),
    ).toEqual({ total: 3 });
  });
});
