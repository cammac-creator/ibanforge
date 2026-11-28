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
  decrementQuota,
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

const operator = vi.fn();
vi.mock('./admin-alerts.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, adminEventAlert: (kind: string, text: string) => operator(kind, text) };
});

describe('ancre illisible : seul l’abonné vivant passe sans refus, compté, avec une alerte', () => {
  it('l’abonné est servi au-delà du plafond civil et compté ; la clé gratuite est refusée comme avant ; une alerte', () => {
    const sub = subscriber(10);
    const freeKey = generateApiKey(`${uid('gratuit')}@alpha.example.net`)!;
    const db = getStatsDB();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    operator.mockClear();
    db.exec('ALTER TABLE subscription_periods RENAME TO subscription_periods_off');
    try {
      expect(currentPeriodFor(sub.keyHash).degraded).toBe(true);
      // Abonné : 50 sur un plafond de 10, servi, compté, jamais refusé.
      const q = checkAndIncrementQuota(sub.keyHash, 10, 50);
      expect(q.allowed).toBe(true);
      expect(q.periodStart).toBeNull();
      expect(getUsage(sub.keyHash, 10).used).toBe(50);
      expect(checkAndIncrementQuota(sub.keyHash, 10, 5).allowed).toBe(true);
      expect(operator).toHaveBeenCalledTimes(1);
      expect(operator.mock.calls[0][0]).toBe('quota:anchor-unreadable');
      // Clé gratuite : comportement d'avant, mesurée sur le mois civil.
      expect(checkAndIncrementQuota(freeKey.key_hash, 25, 20).allowed).toBe(true);
      const refused = checkAndIncrementQuota(freeKey.key_hash, 25, 20);
      expect(refused.allowed).toBe(false);
      expect(getUsage(freeKey.key_hash, 25).used).toBe(20);
      // Un 4xx rembourse l'unité ajoutée, pas davantage.
      decrementQuota(freeKey.key_hash, 20, q.month, null);
      expect(getUsage(freeKey.key_hash, 25).used).toBe(0);
      expect(error).toHaveBeenCalled();
    } finally {
      db.exec('ALTER TABLE subscription_periods_off RENAME TO subscription_periods');
      error.mockRestore();
    }
    expect(currentPeriodFor(sub.keyHash).degraded).toBeUndefined();
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
    db.prepare(
      "UPDATE api_keys SET subscription_ended_at = datetime('now', '-41 days') WHERE key_hash = ?",
    ).run(keyHash);
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

describe('la purge laisse 40 jours entre une résiliation et un réabonnement', () => {
  it('résiliation, purge (au démarrage), réabonnement le lendemain : servi sur une période neuve', () => {
    const { keyHash, sub } = subscriber(10_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-10T08:05:00Z'));
    anchor(keyHash, sub, '2026-11-10T08:00:00Z');
    const db = getStatsDB();
    vi.setSystemTime(at('2026-12-14T12:00:00Z'));
    db.transaction(() =>
      endSubscriptionOnKeyInTx(db, keyHash, sub, { monthlyLimit: 200, noRecredit: 0 }),
    )();
    purgeSettingsOfDeadKeys();
    expect(
      db.prepare('SELECT 1 FROM subscription_periods WHERE key_hash = ?').get(keyHash),
    ).toBeTruthy();
    vi.setSystemTime(at('2026-12-15T12:00:00Z'));
    db.transaction(() => attachSubscriptionInTx(db, keyHash, uid('sub_deux'), 10_000))();
    expect(currentPeriodFor(keyHash).anchored).toBe(true);
    expect(checkAndIncrementQuota(keyHash, 10_000, 10_000).allowed).toBe(true);
    // Une résiliation vieille de 40 jours, jamais reprise : l'ancre part.
    db.prepare(
      "UPDATE api_keys SET subscription_ended_at = datetime('now', '-41 days') WHERE key_hash = ?",
    ).run(keyHash);
    db.prepare(
      "UPDATE api_keys SET subscription_ended_at = datetime('now', '-41 days') WHERE key_hash = ?",
    ).run(keyHash);
    purgeSettingsOfDeadKeys();
    expect(
      db.prepare('SELECT 1 FROM subscription_periods WHERE key_hash = ?').get(keyHash),
    ).toBeUndefined();
  });
});

describe('le réabonnement prend l’heure de l’évènement Stripe', () => {
  it('la période s’ouvre à l’instant donné, pas à celui du traitement', () => {
    const { keyHash, sub } = subscriber(100);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at('2026-11-10T08:05:00Z'));
    anchor(keyHash, sub, '2026-11-10T08:00:00Z');
    const db = getStatsDB();
    vi.setSystemTime(at('2026-12-15T09:00:00Z'));
    // Le webhook est traité le 15 à 09:00 pour un évènement du 14 à 23:30 UTC.
    db.transaction(() =>
      attachSubscriptionInTx(db, keyHash, uid('sub_t'), 100, at('2026-12-14T23:30:00Z')),
    )();
    const p = currentPeriodFor(keyHash);
    expect(p.start).toBe('2026-12-14T23:00:00.000Z');
    expect(p.resetsAt).toBe('2027-01-14T23:00:00.000Z');
  });
});
