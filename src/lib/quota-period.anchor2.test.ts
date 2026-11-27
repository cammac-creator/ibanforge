/**
 * Corrections du lot 2 après relecture (27.11.2026) : l'ancre se lit en UTC comme
 * Stripe avance, le repli sur erreur laisse passer, le réabonnement ouvre une
 * période neuve, la purge garde l'ancre d'un abonné, la sauvegarde porte les
 * deux tables. Fixtures inventées.
 */
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  anchoredPeriodAt,
  currentPeriodFor,
  recordSubscriptionAnchorInTx,
  resetsOnOf,
} from './quota-period.js';
import {
  attachSubscriptionInTx,
  checkAndIncrementQuota,
  endSubscriptionOnKeyInTx,
  generateApiKey,
  getUsage,
} from './api-keys.js';
import { purgeSettingsOfDeadKeys } from './quota-alerts.js';
import { exportPaidState, restorePaidState } from './backup.js';
import { closeAll, getStatsDB } from './db.js';

afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => closeAll());

let seq = 0;
const uid = (t: string) => `${t}_${Date.now()}_${++seq}`;
const at = (iso: string) => new Date(iso);
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

function subscriber(limit: number) {
  const key = generateApiKey(`${uid('ab2')}@alpha.example.net`);
  if (!key) throw new Error('frappe impossible');
  const sub = uid('sub');
  const db = getStatsDB();
  db.transaction(() => attachSubscriptionInTx(db, key.key_hash, sub, limit))();
  return { keyHash: key.key_hash, sub };
}

function anchor(keyHash: string, sub: string, startIso: string, paidIso: string = startIso) {
  const db = getStatsDB();
  return db
    .transaction(() =>
      recordSubscriptionAnchorInTx(db, {
        keyHash,
        subscriptionId: sub,
        periodStartUnix: unix(startIso),
        nowMs: Date.parse(paidIso),
      }),
    )
    .immediate();
}

/** Les débuts de période de Stripe : même heure UTC, même quantième UTC, jour ramené en fin de mois. */
function stripeStarts(firstIso: string, n: number): string[] {
  const f = new Date(firstIso);
  const out: string[] = [];
  for (let k = 0; k < n; k++) {
    const total = f.getUTCFullYear() * 12 + f.getUTCMonth() + k;
    const y = Math.floor(total / 12);
    const m = total % 12;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    out.push(
      new Date(
        Date.UTC(y, m, Math.min(f.getUTCDate(), last), f.getUTCHours(), f.getUTCMinutes()),
      ).toISOString(),
    );
  }
  return out;
}

describe('l’ancre suit Stripe en UTC : aucun déplacement, aucune période d’un jour', () => {
  const anchors = [
    '2026-07-15T22:15:00Z', // ancre d'été, 00:15 à Zurich le lendemain
    '2026-07-15T22:30:00Z',
    '2026-07-15T23:30:00Z',
    '2026-07-30T22:30:00Z',
    '2026-01-30T23:30:00Z',
    '2026-03-31T22:15:00Z',
    '2026-01-31T23:59:00Z',
    '2026-01-29T22:45:00Z',
    '2027-12-31T23:10:00Z', // vers le 29 février 2028
    '2028-01-29T23:10:00Z',
  ];
  for (const first of anchors) {
    it(`ancre ${first} : 24 factures, vérifiées été comme hiver`, () => {
      const { keyHash, sub } = subscriber(100);
      const starts = stripeStarts(first, 24);
      expect(anchor(keyHash, sub, starts[0], starts[0])).toBe('anchored');
      for (let i = 1; i < starts.length; i++) {
        // Chaque facture suivante : même calendrier, rien ne bouge.
        expect(anchor(keyHash, sub, starts[i], starts[i]), `${starts[i]}`).toBe('unchanged');
      }
      const anchorRow = getStatsDB()
        .prepare('SELECT anchor_start FROM subscription_periods WHERE key_hash = ?')
        .get(keyHash) as { anchor_start: string };
      expect(anchorRow.anchor_start).toBe(new Date(starts[0]).toISOString());
      // Chaque limite est au plus tard l'instant de Stripe, jamais une période de moins de 28 jours.
      let previous = anchoredPeriodAt(first, at(starts[0]))!;
      for (let i = 1; i < starts.length; i++) {
        const p = anchoredPeriodAt(first, at(starts[i]))!;
        expect(Date.parse(p.start), starts[i]).toBeLessThanOrEqual(Date.parse(starts[i]));
        expect(Date.parse(p.start) - Date.parse(previous.start)).toBeGreaterThanOrEqual(
          28 * 86_400_000 - 3_600_000,
        );
        expect(p.renewalDay).toBe(new Date(first).getUTCDate());
        previous = p;
      }
    });
  }

  it('le jour affiché ne saute pas d’un mois à l’autre', () => {
    const first = '2026-07-15T22:30:00Z';
    const days = new Set(
      stripeStarts(first, 12).map((s) => anchoredPeriodAt(first, at(s))!.renewalDay),
    );
    expect([...days]).toEqual([15]);
  });
});

describe('ancre illisible : l’appel passe, il n’est pas mesuré sur le mois civil', () => {
  it('fail-open, sans compter, avec une erreur au journal', () => {
    const { keyHash } = subscriber(10);
    const db = getStatsDB();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    db.exec('ALTER TABLE subscription_periods RENAME TO subscription_periods_off');
    try {
      expect(currentPeriodFor(keyHash).degraded).toBe(true);
      // Plus que le plafond : sur le mois civil, ce serait un refus.
      const q = checkAndIncrementQuota(keyHash, 10, 50);
      expect(q.allowed).toBe(true);
      expect(error).toHaveBeenCalled();
      const row = db
        .prepare('SELECT COUNT(*) n FROM api_usage WHERE key_hash = ?')
        .get(keyHash) as { n: number };
      expect(row.n).toBe(0);
    } finally {
      db.exec('ALTER TABLE subscription_periods_off RENAME TO subscription_periods');
      error.mockRestore();
    }
    expect(currentPeriodFor(keyHash).degraded).toBeUndefined();
  });
});

describe('résiliation immédiate puis réabonnement dans le même mois', () => {
  it('la période s’ouvre au rattachement avec un compteur neuf : le client qui vient de payer n’est pas refusé', () => {
    const { keyHash, sub } = subscriber(10_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-10T08:05:00Z'));
    expect(anchor(keyHash, sub, '2026-11-10T08:00:00Z')).toBe('anchored');
    vi.setSystemTime(at('2026-12-12T12:00:00Z'));
    expect(checkAndIncrementQuota(keyHash, 10_000, 9_000).allowed).toBe(true);
    vi.setSystemTime(at('2026-12-14T12:00:00Z'));
    const db = getStatsDB();
    db.transaction(() =>
      endSubscriptionOnKeyInTx(db, keyHash, sub, { monthlyLimit: 200, noRecredit: 0 }),
    )();
    expect(currentPeriodFor(keyHash).anchored).toBe(false);
    vi.setSystemTime(at('2026-12-15T12:00:00Z'));
    db.transaction(() => attachSubscriptionInTx(db, keyHash, uid('sub_deux'), 10_000))();
    const p = currentPeriodFor(keyHash);
    expect(p.anchored).toBe(true);
    expect(getUsage(keyHash, 10_000).used).toBe(0);
    expect(checkAndIncrementQuota(keyHash, 10_000, 10_000).allowed).toBe(true);
    expect(resetsOnOf(p)).toBe('2027-01-15');
  });
});

describe('la purge garde l’ancre d’un abonné, même au plafond mis à 0 à la main', () => {
  it('seule la fin de l’abonnement retire l’ancre et le compteur', () => {
    const { keyHash, sub } = subscriber(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:05:00Z'));
    anchor(keyHash, sub, '2026-12-10T08:00:00Z');
    checkAndIncrementQuota(keyHash, 100, 5);
    const db = getStatsDB();
    db.prepare('UPDATE api_keys SET monthly_limit = 0 WHERE key_hash = ?').run(keyHash);
    purgeSettingsOfDeadKeys();
    const has = () => ({
      anchor: !!db.prepare('SELECT 1 FROM subscription_periods WHERE key_hash = ?').get(keyHash),
      counter: !!db.prepare('SELECT 1 FROM api_usage_period WHERE key_hash = ?').get(keyHash),
    });
    expect(has()).toEqual({ anchor: true, counter: true });
    db.transaction(() =>
      endSubscriptionOnKeyInTx(db, keyHash, sub, { monthlyLimit: 0, noRecredit: 0 }),
    )();
    purgeSettingsOfDeadKeys();
    expect(has()).toEqual({ anchor: false, counter: false });
  });
});

describe('la sauvegarde porte l’ancre et le compteur par période', () => {
  it('restaurée avec les deux tables, la clé reste sur sa période ; sans elles (dump d’avant), au mois civil', () => {
    const { keyHash, sub } = subscriber(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-12-10T08:05:00Z'));
    anchor(keyHash, sub, '2026-12-10T08:00:00Z');
    checkAndIncrementQuota(keyHash, 100, 30);
    const dump = exportPaidState('2026-12-11T00:00:00Z');
    expect(dump.format).toBe(9);
    expect(dump.subscription_periods?.some((r) => r.key_hash === keyHash)).toBe(true);
    expect(dump.api_usage_period?.some((r) => r.key_hash === keyHash)).toBe(true);
    const db = getStatsDB();
    const wipe = () => {
      db.prepare('DELETE FROM subscription_periods WHERE key_hash = ?').run(keyHash);
      db.prepare('DELETE FROM api_usage_period WHERE key_hash = ?').run(keyHash);
    };
    wipe();
    expect(currentPeriodFor(keyHash).anchored).toBe(false);
    const report = restorePaidState(dump);
    expect(report.periods_inserted).toBeGreaterThan(0);
    expect(report.period_counters_inserted).toBeGreaterThan(0);
    expect(currentPeriodFor(keyHash).anchored).toBe(true);
    expect(getUsage(keyHash, 100).used).toBe(30);
    // Un dump au format 8 (sans les deux tables) se lit toujours.
    wipe();
    const old = { ...dump, format: 8 };
    delete old.subscription_periods;
    delete old.api_usage_period;
    expect(() => restorePaidState(old)).not.toThrow();
    expect(currentPeriodFor(keyHash).anchored).toBe(false);
  });
});
