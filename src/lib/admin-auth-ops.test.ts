import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCOPED_ADMIN_KEYS, adminDecision, scopedKeyConflicts } from './admin-auth.js';

/**
 * C08 partie 2, réserve de la relecture de la partie 1 : une clé à portée posée à
 * la valeur d'ADMIN_SECRET ou d'une autre clé à portée (copier-coller pendant la
 * bascule) est ignorée, et le démarrage le dit par UNE alerte d'exploitation, qui
 * nomme les variables et jamais leur valeur.
 */
const ops = vi.hoisted(() => ({ opsFail: vi.fn(), opsOk: vi.fn() }));
vi.mock('./ops-alert.js', () => ops);

const { SCOPED_KEY_REUSE_ALERT, reportScopedKeyConflicts } = await import('./admin-auth-ops.js');

const NOMS = ['ADMIN_SECRET', ...Object.keys(SCOPED_ADMIN_KEYS)];
const avant: Record<string, string | undefined> = {};

const ADMIN = 'admin-secret-value-for-the-reuse-test-0123456789';
const SYNC = 'mail-sync-value-for-the-reuse-test-0123456789';
const SHARED = 'shared-value-for-the-reuse-test-0123456789';

beforeEach(() => {
  ops.opsFail.mockReset();
  ops.opsOk.mockReset();
  for (const nom of NOMS) {
    avant[nom] = process.env[nom];
    delete process.env[nom];
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const nom of NOMS) {
    if (avant[nom] === undefined) delete process.env[nom];
    else process.env[nom] = avant[nom];
  }
});

describe('a scoped key that copies another value', () => {
  it('finds nothing when every key has its own value', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.MAIL_SYNC_TOKEN = SYNC;
    process.env.ADMIN_READ_TOKEN = SHARED;
    expect(scopedKeyConflicts()).toEqual([]);
  });

  it('names a key copied from ADMIN_SECRET, even with a pasted newline', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.MAIL_SYNC_TOKEN = `${ADMIN}\n`;
    expect(scopedKeyConflicts()).toEqual([
      { name: 'MAIL_SYNC_TOKEN', sameValueAs: ['ADMIN_SECRET'] },
    ]);
  });

  it('names BOTH keys when two scoped keys share a value', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.PROSPECTING_TOKEN = SHARED;
    process.env.INDICATORS_TOKEN = ` ${SHARED}`;
    expect(scopedKeyConflicts()).toEqual([
      { name: 'PROSPECTING_TOKEN', sameValueAs: ['INDICATORS_TOKEN'] },
      { name: 'INDICATORS_TOKEN', sameValueAs: ['PROSPECTING_TOKEN'] },
    ]);
  });

  it('ignores both copies at the gate: the shared value opens neither list (401, not the union)', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.PROSPECTING_TOKEN = SHARED;
    process.env.INDICATORS_TOKEN = SHARED;
    expect(adminDecision(SHARED, 'GET', '/v1/admin/prospects')).toBe('none');
    expect(adminDecision(SHARED, 'POST', '/v1/admin/digest')).toBe('none');
    // Une clé saine à côté continue de marcher.
    process.env.MAIL_SYNC_TOKEN = SYNC;
    expect(adminDecision(SYNC, 'GET', '/v1/admin/email-messages')).toBe('scoped');
  });

  it('a key copied from ADMIN_SECRET is ignored as a key, and the value keeps the full door', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.ADMIN_READ_TOKEN = ADMIN;
    expect(scopedKeyConflicts().map((c) => c.name)).toEqual(['ADMIN_READ_TOKEN']);
    // Ce que l'alerte rend visible : la valeur EST le secret complet.
    expect(adminDecision(ADMIN, 'POST', '/v1/admin/keys')).toBe('full');
  });

  it('a blank or unset variable is never a conflict', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.MAIL_SYNC_TOKEN = ' ';
    process.env.PROSPECTING_TOKEN = '';
    process.env.INDICATORS_TOKEN = ' ';
    expect(scopedKeyConflicts()).toEqual([]);
  });
});

describe('reportScopedKeyConflicts, at start-up', () => {
  it('raises ONE alert naming every variable, without any value', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.ADMIN_SECRET = ADMIN;
    process.env.MAIL_SYNC_TOKEN = ADMIN;
    process.env.PROSPECTING_TOKEN = SHARED;
    process.env.ADMIN_READ_TOKEN = SHARED;
    reportScopedKeyConflicts();

    expect(ops.opsFail).toHaveBeenCalledTimes(1);
    expect(ops.opsOk).not.toHaveBeenCalled();
    const [key, detail] = ops.opsFail.mock.calls[0] as [string, string];
    expect(key).toBe(SCOPED_KEY_REUSE_ALERT);
    for (const name of ['MAIL_SYNC_TOKEN', 'PROSPECTING_TOKEN', 'ADMIN_READ_TOKEN', 'ADMIN_SECRET'])
      expect(detail).toContain(name);

    const printed = logged.mock.calls.flat().join(' ');
    expect(printed).toContain('MAIL_SYNC_TOKEN');
    for (const value of [ADMIN, SHARED]) {
      expect(detail).not.toContain(value);
      expect(printed).not.toContain(value);
    }
  });

  it('closes the alert of a previous start when every key has its own value', () => {
    process.env.ADMIN_SECRET = ADMIN;
    process.env.MAIL_SYNC_TOKEN = SYNC;
    reportScopedKeyConflicts();
    expect(ops.opsFail).not.toHaveBeenCalled();
    expect(ops.opsOk).toHaveBeenCalledTimes(1);
    expect(ops.opsOk.mock.calls[0]?.[0]).toBe(SCOPED_KEY_REUSE_ALERT);
  });
});
