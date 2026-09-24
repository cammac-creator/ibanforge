import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import {
  bumpTrialDayShieldMinutes,
  countDailyUnits,
  countTrialActivitySince,
  countTrialBucketsSince,
  countTrialBucketsToday,
  countTrialWeek,
  countWeeklyTrialUnits,
  getTrialDaily,
  refundWeeklyTrialUnits,
  refundDailyUnits,
  resetDailyLedger,
  resetDailyLedgerStatements,
  reviewLedgerVolume,
  snapshotTrialDay,
  sweepDailyLedger,
} from './daily-ip-ledger.js';
import { ledgerBucket } from './ledger-bucket.js';
import { closeAll, getStatsDB } from './db.js';
import { REST_TRIAL_WEEKLY_LIMIT, trialResetsAt, trialWeekStart } from './trial.js';

/**
 * Le compteur que trois franchises gratuites partagent (appels d'outils MCP,
 * ouvertures de session MCP, essai REST sans clé).
 *
 * Porté de la mémoire vers `trial_ledger` le 15/09/2026. Les fixtures ne sont
 * plus des adresses : un seau est `rest:` + 16 hexadécimaux, et un test qui
 * écrirait `rest:1.2.3.4` ferait croire à son lecteur que le seau est une
 * adresse. Les adresses de fixture viennent de TEST-NET-3 (203.0.113.0/24) et
 * de 2001:db8::/32, qui ne sont routables ni l'une ni l'autre.
 */

/** Un vrai seau, produit par la fonction que le middleware appelle. */
const BUCKET = ledgerBucket('203.0.113.7', 'rest:');
const OTHER = ledgerBucket('203.0.113.8', 'rest:');

function rows(): number {
  return (getStatsDB().prepare('SELECT COUNT(*) AS n FROM trial_ledger').get() as { n: number }).n;
}

function writes(): number {
  return (getStatsDB().prepare('SELECT total_changes() AS n').get() as { n: number }).n;
}

/**
 * Lance `fn` et compte les instructions SQLite qu'il a exécutées (`run`, `get`,
 * `all`, `iterate`) et compilées (`prepare`) sur la base des statistiques.
 */
function countStatements(fn: () => void): { executed: number; compiled: number } {
  const db = getStatsDB();
  const statement = Object.getPrototypeOf(db.prepare('SELECT 1')) as Record<
    'run' | 'get' | 'all' | 'iterate',
    (...args: unknown[]) => unknown
  >;
  const executions = (['run', 'get', 'all', 'iterate'] as const).map((method) =>
    vi.spyOn(statement, method),
  );
  const compilations = vi.spyOn(db, 'prepare');
  try {
    fn();
    return {
      executed: executions.reduce((n, spy) => n + spy.mock.calls.length, 0),
      compiled: compilations.mock.calls.length,
    };
  } finally {
    for (const spy of executions) spy.mockRestore();
    compilations.mockRestore();
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Une ligne posée à la main, pour choisir ses horodatages. */
function seed(
  bucket: string,
  opts: { day?: string; units?: number; firstAgoMin?: number; lastAgoMin?: number },
): void {
  getStatsDB()
    .prepare(
      `INSERT INTO trial_ledger (day, bucket, units, first_seen, last_seen)
       VALUES (?, ?, ?, datetime('now', ?), datetime('now', ?))`,
    )
    .run(
      opts.day ?? today(),
      bucket,
      opts.units ?? 1,
      `-${opts.firstAgoMin ?? 0} minutes`,
      `-${opts.lastAgoMin ?? opts.firstAgoMin ?? 0} minutes`,
    );
}

/**
 * Rendre la base illisible pour le registre, sans toucher au fichier.
 *
 * `DROP TABLE` puis oubli des requêtes mémoïsées : la préparation suivante jette
 * « no such table », c'est-à-dire exactement la forme qu'une base corrompue
 * prend pour ce module (scénario PERF-03). `restoreLedger()` referme la
 * connexion, et la réouverture recrée le schéma comme au démarrage.
 */
function breakLedger(): void {
  getStatsDB().exec('DROP TABLE IF EXISTS trial_ledger; DROP TABLE IF EXISTS trial_daily');
  resetDailyLedgerStatements();
}

function restoreLedger(): void {
  closeAll();
  resetDailyLedger();
}

afterAll(() => closeAll());

describe('countDailyUnits', () => {
  beforeEach(() => resetDailyLedger());

  it('spends one unit at a time and says what is left', () => {
    expect(countDailyUnits(BUCKET, 1, 3)).toEqual({ allowed: true, used: 1, remaining: 2 });
    expect(countDailyUnits(BUCKET, 1, 3)).toEqual({ allowed: true, used: 2, remaining: 1 });
  });

  it('spends a batch in one go, and refuses the batch that does not fit', () => {
    // Le lot MCP facture une unité par IBAN ; un appel de 100 IBAN contre une
    // franchise de 10 doit être refusé en entier, pas servi aux dix onzièmes.
    expect(countDailyUnits(BUCKET, 100, 10).allowed).toBe(false);
  });

  it('keeps counting past the ceiling so a refusal cannot be retried for free', () => {
    countDailyUnits(BUCKET, 10, 10);
    expect(countDailyUnits(BUCKET, 1, 10)).toEqual({ allowed: false, used: 11, remaining: 0 });
    expect(countDailyUnits(BUCKET, 1, 10).used).toBe(12);
  });

  it('gives each namespace its own budget', () => {
    countDailyUnits(BUCKET, 10, 10);
    const bare = ledgerBucket('203.0.113.7', '');
    const init = ledgerBucket('203.0.113.7', 'init:');
    expect(countDailyUnits(bare, 1, 10).allowed).toBe(true);
    expect(countDailyUnits(init, 1, 30).allowed).toBe(true);
  });

  it('never lets one source spend another source budget', () => {
    countDailyUnits(BUCKET, 10, 10);
    expect(countDailyUnits(OTHER, 1, 10)).toEqual({ allowed: true, used: 1, remaining: 9 });
  });

  it('survives a redeploy — the one property the port exists for', () => {
    // 🚨 Ce cas échoue si `resetDailyLedgerStatements()` n'est pas câblée dans
    // `closeAll()` : la requête préparée répondrait depuis une connexion morte.
    // C'est voulu, c'est ce test qui attrape l'oubli.
    countDailyUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
    closeAll();
    expect(countDailyUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).used).toBe(2);
  });

  it('counts fifty calls of one tick as exactly fifty', () => {
    // L'UPSERT avec RETURNING rend le nouveau total dans la même instruction :
    // pas de lecture puis écriture, donc pas de fenêtre de concurrence.
    for (let i = 0; i < 50; i += 1) countDailyUnits(BUCKET, 1, 1000);
    expect(countDailyUnits(BUCKET, 0, 1000).used).toBe(50);
  });

  it('writes SQLite timestamps, with a space and not a T', () => {
    // 🚨 Le seul test qui attrape le retour de toISOString(). 'T' (0x54) est
    // supérieur à l'espace (0x20) en comparaison lexicographique, donc une
    // fenêtre glissante écrite à la main serait TOUJOURS VRAIE.
    countDailyUnits(BUCKET, 1, 10);
    const row = getStatsDB()
      .prepare('SELECT first_seen, last_seen FROM trial_ledger WHERE bucket = ?')
      .get(BUCKET) as { first_seen: string; last_seen: string };
    expect(row.first_seen).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row.last_seen).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    const n = (
      getStatsDB()
        .prepare(
          `SELECT COUNT(*) AS n FROM trial_ledger WHERE last_seen >= datetime('now', '-1 minutes')`,
        )
        .get() as { n: number }
    ).n;
    expect(n).toBe(1);
  });

  it('keeps the JS day and the SQLite day equal under any machine timezone', () => {
    // 🚨 Le cas de fuseau. Le `day` est calculé en JS (le court-circuit mémoire
    // en a besoin sans toucher la base) et doit rester égal à date('now'), qui
    // est UTC. Sous UTC+14, une date LOCALE serait déjà demain une partie de la
    // journée : la ligne partirait dans une journée que ni l'agrégat ni la
    // purge ne regardent au même moment, et aucun autre test ne rougirait.
    //
    // Patron imposé : sauvegarder, poser, restaurer DANS le test.
    const saved = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      countDailyUnits(BUCKET, 1, 10);
      const row = getStatsDB()
        .prepare(`SELECT day, date('now') AS sqlite_day FROM trial_ledger WHERE bucket = ?`)
        .get(BUCKET) as { day: string; sqlite_day: string };
      expect(row.day).toBe(row.sqlite_day);
      // Et la dépense suivante retombe bien sur la MÊME ligne.
      expect(countDailyUnits(BUCKET, 1, 10).used).toBe(2);
      expect(rows()).toBe(1);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});

describe('the buckets that never reach the table', () => {
  beforeEach(() => resetDailyLedger());

  it('keeps telemetry dedup and the unknown buckets in memory', () => {
    // Les `evt:*` ne servent qu'à ne compter un événement qu'une fois par
    // adresse et par jour : une perte au redéploiement coûte un doublon sur un
    // tableau de bord. Les `unknown` sont plus importants : en base, ce serait
    // un verrou durable jusqu'à minuit pour tous les appelants non plaçables.
    countDailyUnits('evt:trial:203.0.113.9', 1, 1);
    countDailyUnits('evt:trial-exhausted:203.0.113.9', 1, 1);
    countDailyUnits('rest:unknown', 1, REST_TRIAL_WEEKLY_LIMIT);
    countDailyUnits('unknown', 1, 10);
    countDailyUnits('init:unknown', 1, 30);
    expect(rows()).toBe(0);
    countDailyUnits(BUCKET, 1, 10);
    expect(rows()).toBe(1);
  });

  it('does NOT exempt a bucket that merely starts with unknown', () => {
    // Le `$` du motif : sans lui, cette clé échapperait à la base.
    countDailyUnits('rest:unknown-host.example', 1, 10);
    expect(rows()).toBe(1);
  });

  it('refunds a memory-only bucket too', () => {
    // 🚨 Sans la branche mémoire dans refundDailyUnits, l'UPDATE porterait sur
    // une ligne qui n'existe pas : sans erreur, sans effet, et le seau partagé
    // des non plaçables ne serait jamais remboursé — alors que le middleware
    // rembourse sur tout 4xx du handler.
    countDailyUnits('rest:unknown', 1, REST_TRIAL_WEEKLY_LIMIT);
    refundDailyUnits('rest:unknown', 1);
    expect(countDailyUnits('rest:unknown', 1, REST_TRIAL_WEEKLY_LIMIT).used).toBe(1);
    expect(rows()).toBe(0);
  });
});

describe('refundDailyUnits', () => {
  beforeEach(() => resetDailyLedger());

  it('hands the slot back so a refused request costs nothing', () => {
    countDailyUnits(BUCKET, 1, 10);
    refundDailyUnits(BUCKET, 1);
    expect(countDailyUnits(BUCKET, 1, 10).used).toBe(1);
  });

  it('floors at zero rather than lending an allowance', () => {
    countDailyUnits(BUCKET, 1, 10);
    refundDailyUnits(BUCKET, 5);
    expect(countDailyUnits(BUCKET, 1, 10).used).toBe(1);
  });

  it('is a no-op on a source that spent nothing today', () => {
    refundDailyUnits(OTHER, 1);
    expect(countDailyUnits(OTHER, 1, 10).used).toBe(1);
  });

  it('never resurrects yesterday — a refund after midnight belongs to nobody', () => {
    seed(BUCKET, { day: '2000-01-01', units: 4 });
    refundDailyUnits(BUCKET, 4);
    const kept = (
      getStatsDB()
        .prepare('SELECT units FROM trial_ledger WHERE day = ? AND bucket = ?')
        .get('2000-01-01', BUCKET) as { units: number }
    ).units;
    expect(kept).toBe(4);
  });

  it('does not keep a bucket artificially active', () => {
    // last_seen n'est PAS réécrit par un remboursement : un remboursement n'est
    // pas une dépense, et la mesure d'activité ne doit pas le voir comme telle.
    seed(BUCKET, { units: 3, firstAgoMin: 400, lastAgoMin: 400 });
    refundDailyUnits(BUCKET, 1);
    expect(countTrialActivitySince(60).buckets).toBe(0);
  });
});

describe('the refused bucket costs nothing', () => {
  beforeEach(() => resetDailyLedger());

  it('short-circuits in memory, and a refund reopens the door', () => {
    // 🚨 Les 206 appels tiennent dans UN SEUL cas : `resetDailyLedger()` vide
    // `overLimit`, donc un beforeEach entre l'amorçage et la suite effacerait la
    // marque. La même limite est passée aux 206 appels.
    for (let i = 0; i < 6; i += 1) countDailyUnits(BUCKET, 1, 5);
    const before = writes();
    let last = countDailyUnits(BUCKET, 1, 5);
    for (let i = 1; i < 200; i += 1) last = countDailyUnits(BUCKET, 1, 5);
    expect(writes()).toBe(before);
    expect(last.allowed).toBe(false);
    // `used` continue de croître en mémoire pour que le message du 402 reste
    // vrai au premier ordre : 6 comptés, puis 200 court-circuités.
    expect(last.used).toBe(206);
    expect(last.degraded).toBeUndefined();
    // La base a gelé au franchissement : c'est le sens de rest_units_counted.
    const stored = (
      getStatsDB().prepare('SELECT units FROM trial_ledger WHERE bucket = ?').get(BUCKET) as {
        units: number;
      }
    ).units;
    expect(stored).toBe(6);
    // Un remboursement retire la marque, donc l'appel suivant RELIT la base.
    refundDailyUnits(BUCKET, 3);
    expect(countDailyUnits(BUCKET, 1, 5)).toEqual({ allowed: true, used: 4, remaining: 1 });
  });

  it('stops short-circuiting when the effective limit changes', () => {
    // ⚠️ Inerte tant que la limite effective est constante, et c'est le bug du
    // jour où le disjoncteur la fera varier : un seau marqué sous une limite de
    // 5 resterait refusé après le retour à 25.
    for (let i = 0; i < 6; i += 1) countDailyUnits(BUCKET, 1, 5);
    expect(countDailyUnits(BUCKET, 1, 5).allowed).toBe(false);
    expect(countDailyUnits(BUCKET, 1, 25).allowed).toBe(true);
  });
});

describe('the ledger never throws, whatever happens to the database', () => {
  beforeEach(() => resetDailyLedger());
  // La restauration passe par afterEach et pas par la fin du corps : une
  // assertion qui échoue laisserait sinon la base sans ses tables pour tous les
  // fichiers suivants, et la vraie panne se lirait comme dix pannes ailleurs.
  afterEach(() => restoreLedger());

  it('answers degraded instead of a fabricated ceiling', () => {
    breakLedger();
    const spent = countDailyUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
    expect(spent.allowed).toBe(false);
    expect(spent.degraded).toBe(true);
  });

  it('keeps an exact refusal exact during an outage', () => {
    // 🚨 Le court-circuit reste inconditionnel : ce seau a réellement dépassé
    // son plafond aujourd'hui, le refus est vrai, et le transformer en
    // « indisponible » rendrait les journaux moins lisibles, pas plus. Cette
    // assertion tient le choix ; sans elle il se perd au premier refactor.
    for (let i = 0; i < 6; i += 1) countDailyUnits(BUCKET, 1, 5);
    breakLedger();
    const spent = countDailyUnits(BUCKET, 1, 5);
    expect(spent.allowed).toBe(false);
    expect(spent.degraded).toBeUndefined();
  });

  it('swallows every other call rather than throwing into a tick', () => {
    breakLedger();
    expect(() => refundDailyUnits(BUCKET, 1)).not.toThrow();
    expect(sweepDailyLedger()).toBe(0);
    expect(countTrialBucketsSince(60)).toEqual({ buckets: 0, units: 0 });
    expect(countTrialActivitySince(60)).toEqual({ buckets: 0, units: 0 });
    expect(countTrialBucketsToday()).toEqual({ buckets: 0, units: 0 });
    expect(() => snapshotTrialDay(today())).not.toThrow();
    expect(() => bumpTrialDayShieldMinutes(today(), 5)).not.toThrow();
    expect(() => reviewLedgerVolume()).not.toThrow();
    expect(getTrialDaily(7)).toEqual([]);
  });
});

describe('the sweep', () => {
  beforeEach(() => resetDailyLedger());

  it('purges in bounded batches and keeps today', () => {
    const insert = getStatsDB().prepare(
      `INSERT INTO trial_ledger (day, bucket, units, first_seen, last_seen)
       VALUES ('2000-01-01', ?, 1, datetime('now'), datetime('now'))`,
    );
    getStatsDB().transaction(() => {
      for (let i = 0; i < 12_000; i += 1) insert.run(`rest:${i.toString(16).padStart(16, '0')}`);
    })();
    countDailyUnits(BUCKET, 1, 10);
    // Trois passes au moins : c'est la forme IN (SELECT … LIMIT 5000) qui est
    // vérifiée, et avec elle la promesse qu'un tick ne dure pas indéfiniment.
    expect(sweepDailyLedger()).toBe(12_000);
    expect(rows()).toBe(1);
  });

  it('empties the memory supports as well as the table', () => {
    // Le portage aurait introduit une fuite non bornée : un `sweepDailyLedger`
    // réduit à un DELETE ne toucherait plus les entrées `evt:*`, qui
    // s'accumulent sur un conteneur qui vit des semaines.
    countDailyUnits('evt:trial:203.0.113.9', 1, 1);
    countDailyUnits('rest:unknown', 1, 10);
    resetDailyLedger();
    expect(countDailyUnits('evt:trial:203.0.113.9', 1, 1).used).toBe(1);
    expect(countDailyUnits('rest:unknown', 1, 10).used).toBe(1);
  });
});

describe('the two sliding windows', () => {
  beforeEach(() => resetDailyLedger());

  it('counts sources that APPEARED in the window, and only rest ones', () => {
    seed(BUCKET, { firstAgoMin: 90 });
    seed(OTHER, { firstAgoMin: 30 });
    seed(ledgerBucket('203.0.113.9', 'rest:'), { firstAgoMin: 1 });
    seed(ledgerBucket('203.0.113.9', 'init:'), { firstAgoMin: 1 });
    seed(ledgerBucket('203.0.113.9', ''), { firstAgoMin: 1 });
    expect(countTrialBucketsSince(60).buckets).toBe(2);
  });

  it('sees a slow warm-up released at once, which the appearance window cannot', () => {
    // 🚨 Le test qui prouve que l'amorçage lent ne contourne plus rien. Trois
    // sources apparues il y a six heures, dépensant depuis deux minutes :
    // invisibles à la mesure d'apparition, visibles à la mesure d'activité.
    // C'est le MAX des deux que le disjoncteur lira.
    for (const ip of ['203.0.113.11', '203.0.113.12', '203.0.113.13']) {
      seed(ledgerBucket(ip, 'rest:'), { units: 24, firstAgoMin: 360, lastAgoMin: 2 });
    }
    expect(countTrialActivitySince(60).buckets).toBe(3);
    expect(countTrialBucketsSince(60).buckets).toBe(0);
  });
});

describe('the daily trace', () => {
  beforeEach(() => resetDailyLedger());

  it('aggregates a day without keeping any source', () => {
    const day = today();
    seed(BUCKET, { units: REST_TRIAL_WEEKLY_LIMIT + 1 });
    seed(OTHER, { units: REST_TRIAL_WEEKLY_LIMIT + 4 });
    seed(ledgerBucket('203.0.113.21', 'rest:'), { units: 2 });
    seed(ledgerBucket('203.0.113.22', 'rest:'), { units: 1 });
    seed(ledgerBucket('203.0.113.23', ''), { units: 3 });
    seed(ledgerBucket('203.0.113.24', 'init:'), { units: 1 });
    snapshotTrialDay(day);
    const row = getTrialDaily(1)[0];
    expect(row.day).toBe(day);
    expect(row.rest_buckets).toBe(4);
    expect(row.rest_over_limit).toBe(2);
    expect(row.mcp_buckets).toBe(1);
    expect(row.mcp_units).toBe(3);
    expect(row.init_buckets).toBe(1);
    // 🚨 Aucune source, même hachée : cette table n'a aucune politique de
    // rétention, donc tout ce qui n'est pas une date y est un NOMBRE. Une
    // colonne « top 20 des seaux » ferait rougir cette boucle.
    for (const [column, value] of Object.entries(row)) {
      if (column === 'day' || column === 'created_at') continue;
      expect(typeof value, `colonne ${column}`).toBe('number');
    }
    // 🚨 Assertion symétrique sur le registre : un seau non mémoire est
    // exactement un préfixe d'espace de noms plus 16 hexadécimaux. C'est le
    // test qui attrape le jour où quelqu'un « simplifie » le hachage.
    const buckets = (
      getStatsDB().prepare('SELECT bucket FROM trial_ledger').all() as Array<{ bucket: string }>
    ).map((r) => r.bucket);
    for (const bucket of buckets) expect(bucket).toMatch(/^(rest:|init:)?[0-9a-f]{16}$/);
  });

  it('measures the real sliding peak, not a calendar hour', () => {
    // Une rafale à cheval sur deux heures rondes se compterait deux fois à
    // moitié avec un maximum par heure calendaire. Ici : trois sources en
    // quarante minutes, une quatrième bien plus tard.
    const day = today();
    seed(ledgerBucket('203.0.113.31', 'rest:'), { firstAgoMin: 200 });
    seed(ledgerBucket('203.0.113.32', 'rest:'), { firstAgoMin: 180 });
    seed(ledgerBucket('203.0.113.33', 'rest:'), { firstAgoMin: 160 });
    seed(ledgerBucket('203.0.113.34', 'rest:'), { firstAgoMin: 10 });
    snapshotTrialDay(day);
    expect(getTrialDaily(1)[0].peak_hour_buckets).toBe(3);
  });

  it('is idempotent, and does not overwrite what the breaker pushed', () => {
    // 🚨 Sans ce cas, la trace que la table existe pour préserver serait
    // écrasée par des zéros une heure après avoir été écrite, sans aucun
    // attaquant : la fonction tourne toutes les heures et la purge efface la
    // matière juste après.
    const day = '2000-01-02';
    seed(BUCKET, { day, units: 3 });
    bumpTrialDayShieldMinutes(day, 12);
    snapshotTrialDay(day);
    const first = getTrialDaily(90).find((r) => r.day === day);
    expect(first?.rest_buckets).toBe(1);
    expect(first?.shield_minutes).toBe(12);
    sweepDailyLedger();
    snapshotTrialDay(day);
    const second = getTrialDaily(90).find((r) => r.day === day);
    expect(second).toEqual(first);
  });

  it('reads the current day from the live ledger', () => {
    seed(BUCKET, { units: 2 });
    seed(OTHER, { units: 5 });
    expect(countTrialBucketsToday()).toEqual({ buckets: 2, units: 7 });
  });
});

describe('the volume back-pressure', () => {
  beforeEach(() => resetDailyLedger());

  it('stops inserting new sources, keeps serving the known ones', () => {
    for (let i = 0; i < 10; i += 1) {
      countDailyUnits(ledgerBucket(`203.0.113.${100 + i}`, 'rest:'), 1, 10);
    }
    reviewLedgerVolume(10);
    const eleventh = ledgerBucket('203.0.113.200', 'rest:');
    expect(countDailyUnits(eleventh, 1, 10)).toEqual({ allowed: true, used: 1, remaining: 9 });
    // Aucune ligne de plus : le onzième est compté en mémoire, c'est-à-dire
    // exactement le comportement d'avant le portage. On ne dégrade pas en
    // dessous de l'existant.
    expect(rows()).toBe(10);
    // Et un seau déjà connu reste servi PAR LA BASE.
    expect(countDailyUnits(ledgerBucket('203.0.113.100', 'rest:'), 1, 10).used).toBe(2);
    reviewLedgerVolume();
  });
});

describe('the cost of the hot path', () => {
  beforeEach(() => resetDailyLedger());

  it('absorbs a thousand distinct sources', () => {
    // ⚠️ Ce qui est vérifié ici : qu'un UPSERT sur une table WITHOUT ROWID
    // reste de l'ordre du coût d'une écriture, pas d'un balayage. Compté et
    // non plus chronométré : un budget de deux secondes tombait dès que la
    // machine était occupée, sans rien dire du code.
    const keys = Array.from({ length: 1000 }, (_, i) =>
      ledgerBucket(`203.0.113.${i % 250}`, i % 2 ? 'rest:' : 'init:'),
    );
    // La requête préparée se compile au premier appel : celui-ci, hors du compte.
    countDailyUnits(ledgerBucket('198.51.100.1', 'rest:'), 1, 10_000);
    const writesBefore = writes();
    const { executed, compiled } = countStatements(() => {
      for (const key of keys) countDailyUnits(key, 1, 10_000);
    });
    // UNE instruction par appel, l'UPSERT, et aucune compilée : la requête est
    // mémoïsée et rien d'autre ne tourne sur le chemin chaud.
    expect(executed).toBe(keys.length);
    expect(compiled).toBe(0);
    // UNE ligne écrite par appel, et une ligne par source.
    expect(writes() - writesBefore).toBe(keys.length);
    expect(rows()).toBe(new Set(keys).size + 1);
    // Et la ligne visée se trouve par la clé primaire : une recherche, jamais
    // un balayage de la table.
    const plan = getStatsDB()
      .prepare('EXPLAIN QUERY PLAN SELECT units FROM trial_ledger WHERE day = ? AND bucket = ?')
      .all(today(), keys[0]) as Array<{ detail: string }>;
    expect(plan.map((step) => step.detail).join(' | ')).toMatch(
      /^SEARCH trial_ledger USING PRIMARY KEY \(day=\? AND bucket=\?\)$/,
    );
  });
});

describe('one /64, one bucket', () => {
  it('collapses an IPv6 prefix, whatever the notation', () => {
    expect(ledgerBucket('2001:db8::1', 'rest:')).toBe(ledgerBucket('2001:db8::2', 'rest:'));
    expect(ledgerBucket('2001:0db8:0000:0000:0000:0000:0000:0002', 'rest:')).toBe(
      ledgerBucket('2001:db8::1', 'rest:'),
    );
    expect(ledgerBucket('2001:db8:1::1', 'rest:')).not.toBe(ledgerBucket('2001:db8:2::1', 'rest:'));
  });

  it('buckets an IPv4-mapped address on its IPv4', () => {
    // Ses quatre premiers hextets sont des zéros pour TOUTE adresse de cette
    // forme : les étendre ferait tomber tout appelant IPv4 dans un seul seau
    // partagé et transformerait un plafond par source en plafond global.
    expect(ledgerBucket('::ffff:192.0.2.1', 'rest:')).toBe(ledgerBucket('192.0.2.1', 'rest:'));
    expect(ledgerBucket('::ffff:192.0.2.1', 'rest:')).not.toBe(
      ledgerBucket('::ffff:192.0.2.2', 'rest:'),
    );
  });

  it('never produces the string null for an unplaceable caller', () => {
    // 🚨 `hashIp` rend null pour une adresse vide ET pour 'unknown' : sans
    // garde, la clé serait « rest:null », un seau DURABLE partagé par tout ce
    // qu'on ne sait pas placer.
    expect(ledgerBucket('unknown', 'rest:')).toBe('rest:unknown');
    expect(ledgerBucket('', 'rest:')).toBe('rest:unknown');
    expect(ledgerBucket('unknown', '')).toBe('unknown');
    expect(ledgerBucket('unknown', 'init:')).toBe('init:unknown');
  });

  it('gives the same source a different bucket per door', () => {
    const ip = '2001:db8:abcd:1234::9';
    expect(ledgerBucket(ip, 'rest:')).not.toBe(ledgerBucket(ip, ''));
    expect(ledgerBucket(ip, 'init:')).not.toBe(ledgerBucket(ip, ''));
    // Même source, trois franchises : l'agent qui a dépensé ses appels MCP
    // garde son essai REST.
    expect(ledgerBucket(ip, 'rest:').slice(5)).toBe(ledgerBucket(ip, ''));
  });
});

/**
 * La semaine de l'essai REST (24/09/2026) : 25 appels par semaine ISO en UTC,
 * décidés dans `trial_weekly`, pendant que la ligne du jour `rest:<h>` continue
 * d'alimenter la trace, les fenêtres et l'administration comme avant.
 *
 * Seul `Date` est simulé : SQLite lit sa propre horloge, que ces tests ne
 * consultent pas (ils ne portent que sur des colonnes `day` et `week` posées
 * par le JS).
 */
describe('the week of the keyless REST trial', () => {
  beforeEach(() => resetDailyLedger());
  afterEach(() => vi.useRealTimers());

  function at(iso: string): void {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
  }

  function weeklyRows(): Array<{ week: string; bucket: string; units: number }> {
    return getStatsDB()
      .prepare('SELECT week, bucket, units FROM trial_weekly ORDER BY week')
      .all() as Array<{
      week: string;
      bucket: string;
      units: number;
    }>;
  }

  it('opens the week on Monday 00:00 UTC and announces the next one', () => {
    expect(trialWeekStart(new Date('2026-09-24T12:00:00Z'))).toBe('2026-09-21');
    expect(trialWeekStart(new Date('2026-09-27T23:59:59Z'))).toBe('2026-09-21');
    expect(trialWeekStart(new Date('2026-09-28T00:00:00Z'))).toBe('2026-09-28');
    expect(trialResetsAt(new Date('2026-09-24T12:00:00Z'))).toBe('2026-09-28T00:00:00Z');
    // Une semaine à cheval sur deux années : la clé reste le lundi, en date.
    expect(trialWeekStart(new Date('2027-01-01T08:00:00Z'))).toBe('2026-12-28');
    expect(trialResetsAt(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-04T00:00:00Z');
  });

  it('keeps the week in UTC under any machine timezone', () => {
    // Sous UTC+14, dimanche 23:30 UTC est déjà lundi à l'heure locale : une
    // semaine LOCALE rouvrirait l'essai dix heures et demie trop tôt.
    const saved = process.env.TZ;
    try {
      process.env.TZ = 'Pacific/Kiritimati';
      expect(trialWeekStart(new Date('2026-10-04T23:30:00Z'))).toBe('2026-09-28');
      expect(trialResetsAt(new Date('2026-10-04T23:30:00Z'))).toBe('2026-10-05T00:00:00Z');
      process.env.TZ = 'America/Los_Angeles';
      expect(trialWeekStart(new Date('2026-09-28T02:00:00Z'))).toBe('2026-09-28');
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });

  it(`counts ${REST_TRIAL_WEEKLY_LIMIT} calls spread over four days as one allowance`, () => {
    const days = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
    for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT; i += 1) {
      at(`${days[i % days.length]}T10:00:00Z`);
      expect(
        countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).allowed,
        `call ${i + 1}`,
      ).toBe(true);
    }
    at('2026-10-01T18:00:00Z');
    expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT)).toEqual({
      allowed: false,
      used: REST_TRIAL_WEEKLY_LIMIT + 1,
      remaining: 0,
    });
    expect(weeklyRows()).toEqual([
      { week: '2026-09-28', bucket: BUCKET, units: REST_TRIAL_WEEKLY_LIMIT + 1 },
    ]);
  });

  it('refuses on Sunday 23:59:59 UTC and reopens on Monday 00:00:00 UTC', () => {
    at('2026-10-02T09:00:00Z');
    countWeeklyTrialUnits(BUCKET, REST_TRIAL_WEEKLY_LIMIT, REST_TRIAL_WEEKLY_LIMIT);
    at('2026-10-04T23:59:59Z');
    expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).allowed).toBe(false);
    at('2026-10-05T00:00:00Z');
    expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT)).toEqual({
      allowed: true,
      used: 1,
      remaining: REST_TRIAL_WEEKLY_LIMIT - 1,
    });
  });

  it('counts the call in the week of the instant it is given', () => {
    // Le middleware passe le même instant au compteur et à l'annonce de la
    // remise à zéro : une horloge qui passe lundi entre les deux ne doit pas
    // compter l'appel dans une semaine et annoncer la fin de l'autre.
    at('2026-10-05T00:00:01Z');
    countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT, new Date('2026-10-04T23:59:59Z'));
    expect(weeklyRows()).toEqual([{ week: '2026-09-28', bucket: BUCKET, units: 1 }]);
  });

  it('writes the day row as before, so the daily trace does not move', () => {
    at('2026-09-29T08:00:00Z');
    for (let i = 0; i < 3; i += 1) countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
    countWeeklyTrialUnits(OTHER, 1, REST_TRIAL_WEEKLY_LIMIT);
    const day = getStatsDB()
      .prepare('SELECT bucket, units FROM trial_ledger WHERE day = ? ORDER BY units DESC')
      .all('2026-09-29') as Array<{ bucket: string; units: number }>;
    expect(day).toEqual([
      { bucket: BUCKET, units: 3 },
      { bucket: OTHER, units: 1 },
    ]);
    snapshotTrialDay('2026-09-29');
    const row = getTrialDaily(90).find((r) => r.day === '2026-09-29');
    expect(row?.rest_buckets).toBe(2);
    expect(row?.rest_units_counted).toBe(4);
  });

  it('does not let the next ticks overwrite the trace of a day with zeros', () => {
    // 🚨 Le scénario qui a fait choisir une table à part : la trace d'hier est
    // écrite au premier tick, puis la purge passe ; les ticks suivants de la
    // journée ne doivent rien réécrire.
    at('2026-09-29T08:00:00Z');
    countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
    countDailyUnits(ledgerBucket('203.0.113.40', ''), 2, 10);
    at('2026-09-30T00:30:00Z');
    snapshotTrialDay('2026-09-29');
    const first = getTrialDaily(90).find((r) => r.day === '2026-09-29');
    expect(first?.mcp_buckets).toBe(1);
    sweepDailyLedger();
    at('2026-09-30T01:30:00Z');
    snapshotTrialDay('2026-09-29');
    expect(getTrialDaily(90).find((r) => r.day === '2026-09-29')).toEqual(first);
    // Et la semaine, elle, a survécu au changement de jour.
    expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).used).toBe(2);
  });

  it('costs nothing to a source refused for the week, day after day', () => {
    at('2026-09-28T09:00:00Z');
    countWeeklyTrialUnits(BUCKET, REST_TRIAL_WEEKLY_LIMIT + 1, REST_TRIAL_WEEKLY_LIMIT);
    at('2026-09-30T09:00:00Z');
    const before = writes();
    for (let i = 0; i < 20; i += 1) {
      expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).allowed).toBe(false);
    }
    expect(writes() - before).toBe(0);
  });

  it('hands a slot back on a refund, in the week and in the day', () => {
    at('2026-09-29T08:00:00Z');
    countWeeklyTrialUnits(BUCKET, 2, REST_TRIAL_WEEKLY_LIMIT);
    refundWeeklyTrialUnits(BUCKET, 1);
    expect(countWeeklyTrialUnits(BUCKET, 0, REST_TRIAL_WEEKLY_LIMIT).used).toBe(1);
    const day = getStatsDB()
      .prepare('SELECT units FROM trial_ledger WHERE day = ? AND bucket = ?')
      .get('2026-09-29', BUCKET) as { units: number };
    expect(day.units).toBe(1);
  });

  it('reopens a source whose refund brings it back under the ceiling', () => {
    at('2026-09-29T08:00:00Z');
    countWeeklyTrialUnits(BUCKET, REST_TRIAL_WEEKLY_LIMIT + 1, REST_TRIAL_WEEKLY_LIMIT);
    refundWeeklyTrialUnits(BUCKET, 1);
    expect(countWeeklyTrialUnits(BUCKET, 0, REST_TRIAL_WEEKLY_LIMIT).allowed).toBe(true);
  });

  it('keeps the unknown bucket in memory, by the week', () => {
    at('2026-09-29T08:00:00Z');
    countWeeklyTrialUnits('rest:unknown', REST_TRIAL_WEEKLY_LIMIT, REST_TRIAL_WEEKLY_LIMIT);
    expect(weeklyRows()).toEqual([]);
    at('2026-10-02T08:00:00Z');
    expect(countWeeklyTrialUnits('rest:unknown', 1, REST_TRIAL_WEEKLY_LIMIT).allowed).toBe(false);
    at('2026-10-05T08:00:00Z');
    expect(countWeeklyTrialUnits('rest:unknown', 1, REST_TRIAL_WEEKLY_LIMIT).used).toBe(1);
  });

  it('survives a redeploy', () => {
    countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
    closeAll();
    expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).used).toBe(2);
  });

  it('purges the weeks that are over, and only those, in bounded batches', () => {
    const insert = getStatsDB().prepare(
      "INSERT INTO trial_weekly (week, bucket, units) VALUES ('2000-01-03', ?, 1)",
    );
    getStatsDB().transaction(() => {
      for (let i = 0; i < 12_000; i += 1) insert.run(`rest:${i.toString(16).padStart(16, '0')}`);
    })();
    countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
    expect(sweepDailyLedger()).toBeGreaterThanOrEqual(12_000);
    expect(weeklyRows()).toEqual([{ week: trialWeekStart(), bucket: BUCKET, units: 1 }]);
  });

  it('stops inserting new sources when the week is full, keeps serving the known ones', () => {
    for (let i = 0; i < 10; i += 1) {
      countWeeklyTrialUnits(
        ledgerBucket(`203.0.113.${100 + i}`, 'rest:'),
        1,
        REST_TRIAL_WEEKLY_LIMIT,
      );
    }
    reviewLedgerVolume(Number.MAX_SAFE_INTEGER, 10);
    const eleventh = ledgerBucket('203.0.113.200', 'rest:');
    expect(countWeeklyTrialUnits(eleventh, 1, REST_TRIAL_WEEKLY_LIMIT)).toEqual({
      allowed: true,
      used: 1,
      remaining: REST_TRIAL_WEEKLY_LIMIT - 1,
    });
    expect(weeklyRows()).toHaveLength(10);
    expect(
      countWeeklyTrialUnits(ledgerBucket('203.0.113.100', 'rest:'), 1, REST_TRIAL_WEEKLY_LIMIT)
        .used,
    ).toBe(2);
    reviewLedgerVolume();
  });

  it('keeps a new source in the day trace when only the week is full', () => {
    // Relecture du 24/09/2026 (D3) : la source comptée en mémoire sortait
    // avant d'écrire la ligne du jour et disparaissait de toute la surface
    // d'administration, précisément pendant une rotation de sources.
    at('2026-09-29T08:00:00Z');
    countWeeklyTrialUnits(OTHER, 1, REST_TRIAL_WEEKLY_LIMIT);
    reviewLedgerVolume(Number.MAX_SAFE_INTEGER, 1);
    try {
      for (let i = 0; i < REST_TRIAL_WEEKLY_LIMIT; i += 1) {
        expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).allowed).toBe(true);
      }
      // L'appel qui franchit le plafond est encore écrit, comme en base ; les
      // suivants ne coûtent aucune écriture et vont dans les tentatives.
      expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).allowed).toBe(false);
      const before = writes();
      for (let i = 0; i < 4; i += 1) countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
      expect(writes() - before).toBe(0);
      expect(weeklyRows().map((r) => r.bucket)).toEqual([OTHER]);
      expect(countTrialBucketsToday()).toEqual({
        buckets: 2,
        units: 1 + REST_TRIAL_WEEKLY_LIMIT + 1,
      });
      snapshotTrialDay('2026-09-29');
      const row = getTrialDaily(90).find((r) => r.day === '2026-09-29');
      expect(row?.rest_buckets).toBe(2);
      expect(row?.rest_attempts_uncounted).toBe(4);
    } finally {
      reviewLedgerVolume();
    }
  });

  it('answers degraded, never a fabricated ceiling, when its table is gone', () => {
    getStatsDB().exec('DROP TABLE IF EXISTS trial_weekly');
    resetDailyLedgerStatements();
    try {
      expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).degraded).toBe(true);
      expect(() => refundWeeklyTrialUnits(BUCKET, 1)).not.toThrow();
      expect(countTrialWeek().buckets).toBe(0);
    } finally {
      restoreLedger();
    }
  });

  it('reads the week for the administration surface', () => {
    countWeeklyTrialUnits(BUCKET, REST_TRIAL_WEEKLY_LIMIT + 1, REST_TRIAL_WEEKLY_LIMIT);
    countWeeklyTrialUnits(OTHER, 2, REST_TRIAL_WEEKLY_LIMIT);
    expect(countTrialWeek()).toEqual({
      week: trialWeekStart(),
      buckets: 2,
      units: REST_TRIAL_WEEKLY_LIMIT + 3,
      over_limit: 1,
    });
  });

  it('finds its row by the primary key, one lookup and never a scan', () => {
    countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT);
    const plan = getStatsDB()
      .prepare('EXPLAIN QUERY PLAN SELECT units FROM trial_weekly WHERE week = ? AND bucket = ?')
      .all(trialWeekStart(), BUCKET) as Array<{ detail: string }>;
    expect(plan.map((step) => step.detail).join(' | ')).toMatch(
      /^SEARCH trial_weekly USING PRIMARY KEY \(week=\? AND bucket=\?\)$/,
    );
  });

  it('leaves the MCP daily ceilings exactly where they were', () => {
    // La franchise MCP reste au jour : un nouveau jour la rouvre, alors que
    // celle de l'essai REST reste fermée jusqu'au lundi.
    const mcp = ledgerBucket('203.0.113.7', '');
    at('2026-09-29T08:00:00Z');
    countDailyUnits(mcp, 10, 10);
    countWeeklyTrialUnits(BUCKET, REST_TRIAL_WEEKLY_LIMIT, REST_TRIAL_WEEKLY_LIMIT);
    at('2026-09-30T08:00:00Z');
    expect(countDailyUnits(mcp, 1, 10).allowed).toBe(true);
    expect(countWeeklyTrialUnits(BUCKET, 1, REST_TRIAL_WEEKLY_LIMIT).allowed).toBe(false);
  });
});
