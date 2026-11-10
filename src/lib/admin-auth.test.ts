import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BACKUP_ROUTE,
  isAdminAuthorized,
  isBackupAuthorized,
  isStatsAuthorized,
} from './admin-auth.js';

/**
 * Les trois portes d'administration, sans application montée autour : ce qui
 * s'ouvre, ce qui reste fermé, et surtout que la clé de la sauvegarde n'ouvre
 * jamais la porte du secret complet.
 */
const NOMS = ['ADMIN_SECRET', 'BACKUP_TOKEN', 'STATS_TOKEN'] as const;
const avant: Record<string, string | undefined> = {};

const ADMIN = 'admin-secret-for-tests-0123456789';
const BACKUP = 'backup-token-for-tests-0123456789';

beforeEach(() => {
  for (const nom of NOMS) {
    avant[nom] = process.env[nom];
    delete process.env[nom];
  }
});
afterEach(() => {
  for (const nom of NOMS) {
    if (avant[nom] === undefined) delete process.env[nom];
    else process.env[nom] = avant[nom];
  }
});

describe('isAdminAuthorized', () => {
  it('accepts the full secret, and only it', () => {
    process.env.ADMIN_SECRET = ADMIN;
    expect(isAdminAuthorized(ADMIN)).toBe(true);
    expect(isAdminAuthorized(ADMIN.slice(0, -1) + 'X')).toBe(false);
    expect(isAdminAuthorized('short')).toBe(false);
    expect(isAdminAuthorized('')).toBe(false);
    expect(isAdminAuthorized(undefined)).toBe(false);
  });

  it('never accepts the backup token', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.BACKUP_TOKEN = BACKUP;
    expect(isAdminAuthorized(BACKUP)).toBe(false);
  });

  it('opens nothing when ADMIN_SECRET is unset or empty', () => {
    expect(isAdminAuthorized('')).toBe(false);
    expect(isAdminAuthorized('anything')).toBe(false);
    process.env.ADMIN_SECRET = '';
    expect(isAdminAuthorized('')).toBe(false);
  });
});

describe('isBackupAuthorized', () => {
  it('accepts the backup token and the full secret', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.BACKUP_TOKEN = BACKUP;
    expect(isBackupAuthorized(BACKUP)).toBe(true);
    expect(isBackupAuthorized(ADMIN)).toBe(true);
    expect(isBackupAuthorized(BACKUP.slice(0, -1) + 'X')).toBe(false);
    expect(isBackupAuthorized(undefined)).toBe(false);
  });

  it('without BACKUP_TOKEN, behaves exactly like the full secret', () => {
    process.env.ADMIN_SECRET = ADMIN;
    expect(isBackupAuthorized(ADMIN)).toBe(true);
    expect(isBackupAuthorized(BACKUP)).toBe(false);
    expect(isBackupAuthorized('')).toBe(false);
  });

  it('never accepts an empty or blank token, whatever is presented', () => {
    for (const blank of ['', ' ', '\t', '  \n']) {
      process.env.BACKUP_TOKEN = blank;
      for (const presented of [blank, '', ' ', undefined]) {
        expect(isBackupAuthorized(presented), JSON.stringify({ blank, presented })).toBe(false);
      }
    }
  });

  it('opens nothing at all when neither variable is set', () => {
    expect(isBackupAuthorized('')).toBe(false);
    expect(isBackupAuthorized(BACKUP)).toBe(false);
  });

  it('names the one route it opens', () => {
    expect(BACKUP_ROUTE).toBe('/v1/admin/backup');
  });
});

describe('isStatsAuthorized', () => {
  it('accepts the Bearer form of STATS_TOKEN, and only it', () => {
    process.env.STATS_TOKEN = 'stats-token-for-tests';
    expect(isStatsAuthorized('Bearer stats-token-for-tests')).toBe(true);
    expect(isStatsAuthorized('stats-token-for-tests')).toBe(false);
    expect(isStatsAuthorized('Bearer stats-token-for-testX')).toBe(false);
    expect(isStatsAuthorized(undefined)).toBe(false);
  });

  it('opens nothing when STATS_TOKEN is unset or empty', () => {
    expect(isStatsAuthorized('Bearer ')).toBe(false);
    expect(isStatsAuthorized('Bearer undefined')).toBe(false);
    process.env.STATS_TOKEN = '';
    expect(isStatsAuthorized('Bearer ')).toBe(false);
  });
});
