import { beforeEach, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import {
  DOOR_LABELS_FR,
  FREE_USERS_THRESHOLD,
  LOG_FIRST_ID_AT_OR_AFTER_SQL,
  LOG_PREFIX_BETWEEN_IDS_SQL,
  LOG_PREFIX_FROM_ID_SQL,
  OTHER_DOOR,
  PAID_OUTCOMES,
  UNKNOWN_DOOR,
  getDoorBoard,
  isExternalKeyRow,
} from './door-board.js';
import { knownOrigins } from './key-origins.js';
import { isSaleOutcome, type PurchaseOutcome } from './key-purchases.js';
import { normalizeEmail } from './email-norm.js';

/**
 * Le tableau des portes sur une base SYNTHÉTIQUE et une horloge fixée.
 *
 * Horloge : mercredi 07.10.2026 à 12:00, heure suisse (été). La semaine en
 * cours est la 41 (05.10 au 11.10), la semaine passée la 40 (28.09 au 04.10).
 * Fixtures inventées, ce dépôt est public : adresses en `alpha.example.net`,
 * qui n'est interne pour aucune des deux règles du dépôt (au contraire de
 * `example.com`).
 *
 * `request_log` : chaque test insère ses appels dans l'ORDRE CHRONOLOGIQUE,
 * comme la production, où chaque ligne est datée à son insertion. La recherche
 * bornée du tableau traduit la fenêtre en bornes d'`id` et s'y appuie.
 */
const NOW = Date.parse('2026-10-07T10:00:00Z');
const DAY = 86_400_000;

let seq = 0;

function stamp(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 19).replace('T', ' ');
}

interface KeyFixture {
  email?: string;
  /** Instant UTC ISO. */
  created: string;
  source?: string | null;
  tier?: string;
  monthlyLimit?: number | null;
  issuedByUs?: number;
  noRecredit?: number;
  /** Rattache la clé à une lignée existante (rotation). */
  lineage?: string;
  /** L'adresse normalisée écrite ; par défaut celle de `normalizeEmail`, `null` pour la laisser vide. */
  emailNorm?: string | null;
}

function key(f: KeyFixture): { hash: string; prefix: string; lineage: string } {
  seq += 1;
  const hash = `door-hash-${seq}`;
  const prefix = `ifk_dr${String(seq).padStart(6, '0')}`;
  const lineage = f.lineage ?? hash;
  const email = f.email ?? `person${seq}@alpha.example.net`;
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier,
                             monthly_limit, issued_by_us, no_recredit, lineage_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hash,
      prefix,
      email,
      f.emailNorm === undefined ? normalizeEmail(email) : f.emailNorm,
      stamp(f.created),
      f.source === undefined ? 'site-signup' : f.source,
      f.tier ?? 'email',
      f.monthlyLimit === undefined ? null : f.monthlyLimit,
      f.issuedByUs ?? 0,
      f.noRecredit ?? 0,
      lineage,
    );
  return { hash, prefix, lineage };
}

function firstSuccess(lineage: string, iso: string): void {
  getStatsDB()
    .prepare(
      `INSERT INTO lineage_facts (lineage_hash, birth_at, backfilled, first_success_at)
       VALUES (?, ?, 0, ?)
       ON CONFLICT(lineage_hash) DO UPDATE SET first_success_at = excluded.first_success_at`,
    )
    .run(lineage, stamp(iso), stamp(iso));
}

function nudge(prefix: string, iso: string, delivered = 1): void {
  getStatsDB()
    .prepare(
      `INSERT INTO activation_nudges (key_prefix, email, sent_at, delivered) VALUES (?, ?, ?, ?)`,
    )
    .run(prefix, `nudge-${prefix}@alpha.example.net`, stamp(iso), delivered);
}

function call(prefix: string, iso: string, status = 200): void {
  getStatsDB()
    .prepare(
      `INSERT INTO request_log (method, path, status, created_at, key_prefix)
       VALUES ('POST', '/v1/iban/validate', ?, ?, ?)`,
    )
    .run(status, stamp(iso), prefix);
}

function purchase(
  k: { hash: string; prefix: string; lineage: string },
  p: { iso: string; kind?: string; rail?: string; outcome?: string; issuedByUs?: number },
): void {
  seq += 1;
  getStatsDB()
    .prepare(
      `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash,
                                  key_prefix, issued_by_us, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      `stripe:cs_door_${seq}`,
      p.rail ?? 'card',
      p.kind ?? 'pack',
      p.outcome ?? 'credited',
      k.lineage,
      k.hash,
      k.prefix,
      p.issuedByUs ?? 0,
      stamp(p.iso),
    );
}

function usage(hash: string, month: string, count: number): void {
  getStatsDB()
    .prepare(`INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)`)
    .run(hash, month, count);
}

const week = (board: ReturnType<typeof getDoorBoard>, key: string) => {
  const row = board.weeks.find((w) => w.key === key);
  if (!row) throw new Error(`semaine absente : ${key}`);
  return row;
};

beforeEach(() => {
  const db = getStatsDB();
  for (const table of [
    'api_keys',
    'lineage_facts',
    'activation_nudges',
    'request_log',
    'key_purchases',
    'api_usage',
  ]) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
});

describe('la définition du parc externe', () => {
  it('écarte nos clés, les comptes internes, de test, de sonde et de ferme', () => {
    expect(isExternalKeyRow({ email: 'client@alpha.example.net', issued_by_us: 0 })).toBe(true);
    expect(isExternalKeyRow({ email: 'client@alpha.example.net', issued_by_us: 1 })).toBe(false);
    for (const email of [
      'ops@ibanforge.com',
      'acme@example.com',
      'grp-1@cohorte.invalid',
      'test-signup@alpha.example.net',
      'x-probe@alpha.example.net',
      'playground',
    ]) {
      expect(isExternalKeyRow({ email, issued_by_us: 0 }), email).toBe(false);
    }
  });

  it('garde les acheteurs sans adresse et les clés anonymes comme clients', () => {
    expect(isExternalKeyRow({ email: 'credits-buyer', issued_by_us: 0 })).toBe(true);
    expect(isExternalKeyRow({ email: 'stripe-buyer', issued_by_us: 0 })).toBe(true);
    expect(isExternalKeyRow({ email: 'anonymous', issued_by_us: 0 })).toBe(true);
  });

  it('compte une issue de paiement exactement quand le registre dit que la lignée a payé', () => {
    const all: PurchaseOutcome[] = [
      'pending',
      'credited',
      'minted',
      'minted_fallback',
      'attached',
      'failed',
      'refunded',
      'disputed',
    ];
    for (const o of all) {
      expect(PAID_OUTCOMES.includes(o), o).toBe(isSaleOutcome(o) || o === 'attached');
    }
  });

  it('nomme en français chaque porte et chaque étiquette connues', () => {
    for (const origin of [...knownOrigins(), UNKNOWN_DOOR, OTHER_DOOR]) {
      expect(DOOR_LABELS_FR[origin], origin).toBeTruthy();
    }
  });
});

describe('les semaines, en heure suisse', () => {
  it('range un dimanche 23:30 dans sa semaine et un lundi 00:30 dans la suivante', () => {
    key({ created: '2026-10-04T21:30:00Z' }); // dimanche 04.10, 23:30 heure suisse
    key({ created: '2026-10-04T22:30:00Z' }); // lundi 05.10, 00:30 heure suisse
    const board = getDoorBoard({ now: NOW });
    expect(week(board, '2026-W40').totals.created).toBe(1);
    expect(week(board, '2026-W41').totals.created).toBe(1);
    expect(board.weeks[0]).toMatchObject({ key: '2026-W41', kind: 'current' });
    expect(board.weeks[1]).toMatchObject({
      key: '2026-W40',
      kind: 'complete',
      monday: '2026-09-28',
      sunday: '2026-10-04',
      title: 'Semaine 40 · 28.09 au 04.10',
    });
  });

  it('montre la semaine en cours, les semaines closes demandées, puis « avant »', () => {
    key({ created: '2026-07-01T10:00:00Z' });
    const board = getDoorBoard({ now: NOW, weeks: 4 });
    expect(board.weeks.map((w) => w.key)).toEqual([
      '2026-W41',
      '2026-W40',
      '2026-W39',
      '2026-W38',
      'before',
    ]);
    expect(week(board, 'before')).toMatchObject({ title: 'Avant le 14.09' });
    expect(week(board, 'before').totals.created).toBe(1);
    expect(board.weeks_shown).toBe(4);
  });

  it('borne le nombre de semaines demandées', () => {
    expect(getDoorBoard({ now: NOW, weeks: 1 }).weeks_shown).toBe(2);
    expect(getDoorBoard({ now: NOW, weeks: 500 }).weeks_shown).toBe(52);
    expect(getDoorBoard({ now: NOW, weeks: null }).weeks_shown).toBe(10);
  });
});

describe('les portes', () => {
  it('range chaque clé dans la porte écrite à sa naissance, et l’inconnue à part', () => {
    key({ created: '2026-09-29T08:00:00Z', source: 'site-docs' });
    key({ created: '2026-09-29T09:00:00Z', source: 'site-docs' });
    key({ created: '2026-09-30T09:00:00Z', source: 'mcp-device' });
    key({ created: '2026-09-30T10:00:00Z', source: null });
    key({ created: '2026-09-30T11:00:00Z', source: 'une-campagne-inventee' });
    const w = week(getDoorBoard({ now: NOW }), '2026-W40');
    expect(w.totals.created).toBe(5);
    const byDoor = Object.fromEntries(w.doors.map((d) => [d.door, d.created]));
    expect(byDoor).toEqual({
      'site-docs': 2,
      'mcp-device': 1,
      [UNKNOWN_DOOR]: 1,
      [OTHER_DOOR]: 1,
    });
    expect(w.doors[0]).toMatchObject({ door: 'site-docs', label: 'Documentation' });
  });

  it('ne compte pas une rotation comme une clé créée', () => {
    const born = key({ created: '2026-09-29T08:00:00Z', source: 'site-pricing' });
    key({ created: '2026-10-06T08:00:00Z', source: 'site-pricing', lineage: born.lineage });
    const board = getDoorBoard({ now: NOW });
    expect(week(board, '2026-W40').totals.created).toBe(1);
    expect(week(board, '2026-W41').totals.created).toBe(0);
    expect(board.control).toMatchObject({ external_fleet: 1, external_key_rows: 2, equal: true });
  });

  it('exclut les clés internes du tableau comme du parc', () => {
    key({ created: '2026-09-29T08:00:00Z' });
    key({ created: '2026-09-29T08:00:00Z', issuedByUs: 1 });
    key({ created: '2026-09-29T08:00:00Z', email: 'ops@ibanforge.com' });
    key({ created: '2026-09-29T08:00:00Z', email: 'grp-7@cohorte.invalid' });
    const born = key({ created: '2026-09-29T08:00:00Z' });
    // Une seule ligne interne dans la lignée suffit à l'écarter.
    key({ created: '2026-10-06T08:00:00Z', email: 'grp-8@cohorte.invalid', lineage: born.lineage });
    const board = getDoorBoard({ now: NOW });
    expect(week(board, '2026-W40').totals.created).toBe(1);
    expect(board.control).toMatchObject({ created_total: 1, external_fleet: 1, equal: true });
  });
});

describe('les cinq colonnes', () => {
  it('compte le premier appel réussi à la semaine où il arrive', () => {
    const early = key({ created: '2026-09-22T08:00:00Z' });
    firstSuccess(early.lineage, '2026-09-30T08:00:00Z');
    const late = key({ created: '2026-09-30T08:00:00Z' });
    firstSuccess(late.lineage, '2026-10-06T08:00:00Z');
    key({ created: '2026-09-30T09:00:00Z' });
    const board = getDoorBoard({ now: NOW });
    expect(week(board, '2026-W39').totals).toMatchObject({ created: 1, first_success: 0 });
    expect(week(board, '2026-W40').totals).toMatchObject({ created: 2, first_success: 1 });
    expect(week(board, '2026-W41').totals).toMatchObject({ created: 0, first_success: 1 });
  });

  it('suit une relance remise : appel sous sept jours, en attente, ou rien', () => {
    const answered = key({ created: '2026-09-20T08:00:00Z' });
    nudge(answered.prefix, '2026-09-29T08:00:00Z');
    call(answered.prefix, '2026-10-02T08:00:00Z', 401);
    const tooLate = key({ created: '2026-09-20T08:00:00Z' });
    nudge(tooLate.prefix, '2026-09-29T08:00:00Z');
    call(tooLate.prefix, '2026-10-07T08:00:00Z');
    const waiting = key({ created: '2026-09-20T08:00:00Z' });
    nudge(waiting.prefix, '2026-10-02T08:00:00Z');
    const failed = key({ created: '2026-09-20T08:00:00Z' });
    nudge(failed.prefix, '2026-09-30T08:00:00Z', 0);
    const w = week(getDoorBoard({ now: NOW }), '2026-W40');
    expect(w.totals).toMatchObject({ nudged: 3, called_after_nudge: 1, followup_pending: 1 });
  });

  it('compte le premier paiement : pack par carte, abonnement, USDC, sur une clé existante', () => {
    const card = key({ created: '2026-09-20T08:00:00Z' });
    purchase(card, { iso: '2026-09-29T08:00:00Z' });
    purchase(card, { iso: '2026-10-06T08:00:00Z' });
    const pro = key({ created: '2026-09-29T09:00:00Z', source: 'stripe-subscription' });
    purchase(pro, { iso: '2026-09-29T09:00:00Z', kind: 'subscription', outcome: 'minted' });
    const agent = key({ created: '2026-09-30T09:00:00Z', email: 'credits-buyer', tier: 'paid' });
    purchase(agent, { iso: '2026-09-30T09:00:00Z', rail: 'usdc', outcome: 'minted' });
    const attached = key({ created: '2026-09-10T08:00:00Z' });
    purchase(attached, { iso: '2026-10-01T08:00:00Z', kind: 'subscription', outcome: 'attached' });
    const board = getDoorBoard({ now: NOW });
    expect(week(board, '2026-W40').totals.paid).toBe(4);
    expect(week(board, '2026-W41').totals.paid).toBe(0);
    expect(board.totals.paid).toBe(4);
  });

  it('ne compte ni un paiement remboursé, contesté, en attente, ni un pack offert', () => {
    for (const outcome of ['refunded', 'disputed', 'pending', 'failed']) {
      purchase(key({ created: '2026-09-20T08:00:00Z' }), { iso: '2026-09-29T08:00:00Z', outcome });
    }
    purchase(key({ created: '2026-09-20T08:00:00Z' }), {
      iso: '2026-09-29T08:00:00Z',
      issuedByUs: 1,
    });
    expect(getDoorBoard({ now: NOW }).totals.paid).toBe(0);
  });
});

describe('le contrôle du parc', () => {
  it('égale la colonne « créées », avant et sans date comprises', () => {
    key({ created: '2026-10-06T08:00:00Z' });
    key({ created: '2026-09-29T08:00:00Z' });
    key({ created: '2025-01-15T08:00:00Z' });
    getStatsDB()
      .prepare(
        `INSERT INTO api_keys (key_hash, key_prefix, email, created_at) VALUES (?, ?, ?, NULL)`,
      )
      .run('door-hash-undated', 'ifk_drundated', 'undated@alpha.example.net');
    const board = getDoorBoard({ now: NOW });
    expect(week(board, 'undated').totals.created).toBe(1);
    expect(board.control).toEqual({
      created_total: 4,
      external_fleet: 4,
      equal: true,
      gap: 0,
      external_key_rows: 4,
    });
  });
});

describe('les utilisateurs gratuits actifs à 200 par mois', () => {
  it('compte ceux à l’allocation gratuite qui ont appelé sur les 30 jours finissant dimanche', () => {
    const active = key({ created: '2026-08-01T08:00:00Z' });
    const claimed = key({ created: '2026-08-01T08:00:00Z', tier: 'claimed', monthlyLimit: 200 });
    const afterSunday = key({ created: '2026-08-01T08:00:00Z' });
    const beforeWindow = key({ created: '2026-08-01T08:00:00Z' });
    const pro = key({ created: '2026-08-01T08:00:00Z', monthlyLimit: 10_000 });
    const anon = key({ created: '2026-08-01T08:00:00Z', tier: 'anonymous', monthlyLimit: 25 });
    const ours = key({ created: '2026-08-01T08:00:00Z', issuedByUs: 1 });
    // Dans l'ordre chronologique, comme la production.
    call(beforeWindow.prefix, '2026-09-04T08:00:00Z');
    call(active.prefix, '2026-09-10T08:00:00Z');
    call(pro.prefix, '2026-09-20T08:00:00Z');
    call(anon.prefix, '2026-09-20T08:00:00Z');
    call(ours.prefix, '2026-09-20T08:00:00Z');
    call(claimed.prefix, '2026-10-04T21:00:00Z'); // dimanche 23:00, dernier jour de la fenêtre
    call(afterSunday.prefix, '2026-10-05T08:00:00Z');
    const board = getDoorBoard({ now: NOW });
    expect(board.free_users).toMatchObject({
      threshold: FREE_USERS_THRESHOLD,
      threshold_counts: 'people',
      window_days: 30,
      window: { from: '2026-09-05', to: '2026-10-04' },
      active_people: 2,
      active_keys: 2,
      crossed: false,
    });
    expect(board.last_week.numbers).toMatchObject({ free_active: 2, free_active_keys: 2 });
  });

  it('compte une personne une fois, quelles que soient ses clés et l’écriture de son adresse', () => {
    // Deux clés gratuites d'une même personne, l'une notée avec une étiquette
    // « + » et sans adresse normalisée écrite : la règle du dépôt la retrouve.
    const first = key({ created: '2026-08-01T08:00:00Z', email: 'jeanne@alpha.example.net' });
    const second = key({
      created: '2026-08-02T08:00:00Z',
      email: 'Jeanne+veille@alpha.example.net',
      emailNorm: null,
    });
    const other = key({ created: '2026-08-03T08:00:00Z', email: 'paul@beta.example.net' });
    call(first.prefix, '2026-09-10T08:00:00Z');
    call(second.prefix, '2026-09-11T08:00:00Z');
    call(other.prefix, '2026-09-12T08:00:00Z');
    usage(first.hash, '2026-09', 2);
    usage(second.hash, '2026-09', 5);
    const board = getDoorBoard({ now: NOW });
    expect(board.free_users).toMatchObject({ active_people: 2, active_keys: 3 });
    expect(board.free_users.calendar[0]).toEqual({
      month: '2026-09',
      people: 1,
      keys: 2,
      to_date: false,
    });
    expect(board.last_week.numbers).toMatchObject({ free_active: 2, free_active_keys: 3 });
  });

  it('ne franchit pas le seuil sur des clés : il compte des personnes', () => {
    // 51 clés actives, tenues par 26 personnes.
    for (let i = 0; i < FREE_USERS_THRESHOLD + 1; i++) {
      const k = key({
        created: '2026-08-01T08:00:00Z',
        email: `duo${Math.floor(i / 2)}@alpha.example.net`,
      });
      call(k.prefix, '2026-09-20T08:00:00Z');
      usage(k.hash, '2026-09', 3);
    }
    const board = getDoorBoard({ now: NOW });
    expect(board.free_users).toMatchObject({
      active_people: 26,
      active_keys: 51,
      crossed: false,
    });
    expect(board.last_week.sentence).not.toContain('seuil franchi');
  });

  it('donne le mois civil à côté, et dit quand le seuil est franchi', () => {
    for (let i = 0; i < FREE_USERS_THRESHOLD + 1; i++) {
      const k = key({ created: '2026-08-01T08:00:00Z' });
      call(k.prefix, '2026-09-20T08:00:00Z');
      usage(k.hash, '2026-09', 3);
    }
    const quiet = key({ created: '2026-08-01T08:00:00Z' });
    usage(quiet.hash, '2026-10', 0);
    const board = getDoorBoard({ now: NOW });
    expect(board.free_users).toMatchObject({ active_people: 51, active_keys: 51 });
    expect(board.free_users.calendar).toEqual([
      { month: '2026-09', people: 51, keys: 51, to_date: false },
      { month: '2026-10', people: 0, keys: 0, to_date: true },
    ]);
    expect(board.free_users.crossed).toBe(true);
    expect(board.last_week.sentence).toContain(
      'seuil franchi : 51 utilisateurs gratuits actifs à 200 par mois (des personnes, pas des clés)',
    );
    expect(board.last_week.sentence).toContain('sur les 30 jours finissant dimanche, plus de 50');
  });
});

describe('la recherche dans le journal des appels, bornée à la fenêtre', () => {
  it('passe par les index existants : dates pour les bornes, préfixes entre deux id', () => {
    const plan = (sql: string, params: unknown[]): string =>
      (
        getStatsDB()
          .prepare(`EXPLAIN QUERY PLAN ${sql}`)
          .all(...params) as Array<{ detail: string }>
      )
        .map((r) => r.detail)
        .join(' | ');
    const first = plan(LOG_FIRST_ID_AT_OR_AFTER_SQL, ['2026-09-01 00:00:00']);
    expect(first).toContain('idx_request_log_date');
    expect(first).not.toContain('TEMP B-TREE');
    const between = plan(LOG_PREFIX_BETWEEN_IDS_SQL, ['p', 1, 9, 'a', 'b']);
    expect(between).toContain('idx_request_log_key_prefix (key_prefix=? AND rowid>? AND rowid<?)');
    const open = plan(LOG_PREFIX_FROM_ID_SQL, ['p', 1, 'a', 'b']);
    expect(open).toContain('idx_request_log_key_prefix (key_prefix=? AND rowid>?)');
  });

  it('ne voit ni l’historique d’avant la fenêtre ni les appels d’après', () => {
    const busy = key({ created: '2026-06-01T08:00:00Z' });
    const quiet = key({ created: '2026-06-01T08:00:00Z' });
    // Un long historique avant la fenêtre, puis des appels après elle.
    for (let d = 1; d <= 30; d++) {
      call(busy.prefix, `2026-07-${String(d).padStart(2, '0')}T08:00:00Z`);
      call(quiet.prefix, `2026-07-${String(d).padStart(2, '0')}T09:00:00Z`);
    }
    call(busy.prefix, '2026-09-15T08:00:00Z');
    call(quiet.prefix, '2026-10-06T08:00:00Z');
    const board = getDoorBoard({ now: NOW });
    expect(board.free_users).toMatchObject({ active_people: 1, active_keys: 1 });
  });
});

describe('la semaine passée, telle que le résumé du lundi la dira', () => {
  it('porte les quatre nombres de la ligne de la semaine passée et une seule phrase', () => {
    const a = key({ created: '2026-09-29T08:00:00Z', source: 'site-docs' });
    firstSuccess(a.lineage, '2026-09-29T09:00:00Z');
    key({ created: '2026-09-29T09:00:00Z', source: 'site-docs' });
    const b = key({ created: '2026-09-30T08:00:00Z', source: 'npm-mcp' });
    purchase(b, { iso: '2026-10-01T08:00:00Z' });
    const old = key({ created: '2026-09-01T08:00:00Z' });
    // Jeudi 01.10 : ses sept jours courent encore le mercredi 07.10.
    nudge(old.prefix, '2026-10-01T08:00:00Z');
    const board = getDoorBoard({ now: NOW });
    const row = week(board, '2026-W40');
    expect(board.last_week).toMatchObject({
      week: '2026-W40',
      title: 'Semaine 40 · 28.09 au 04.10',
      numbers: {
        created: row.totals.created,
        first_success: row.totals.first_success,
        paid: row.totals.paid,
        free_active: board.free_users.active_people,
        free_active_keys: board.free_users.active_keys,
      },
      nudged: 1,
    });
    expect(board.last_week.numbers).toEqual({
      created: 3,
      first_success: 1,
      paid: 1,
      free_active: 0,
      free_active_keys: 0,
    });
    expect(board.last_week.sentence).toBe(
      'La porte « Documentation » a donné le plus de clés (2 sur 3), 1 relance partie ' +
        '(0 suivie d’un appel sous sept jours, 1 encore dans ce délai).',
    );
    expect(board.last_week.sentence).not.toMatch(/[—–]/);
  });

  it('dit une semaine sans clé et une égalité entre portes sans rien inventer', () => {
    expect(getDoorBoard({ now: NOW }).last_week.sentence).toBe(
      'Aucune clé externe n’a été créée la semaine passée.',
    );
    key({ created: '2026-09-29T08:00:00Z', source: 'site-docs' });
    key({ created: '2026-09-29T09:00:00Z', source: 'glama' });
    expect(getDoorBoard({ now: NOW }).last_week.sentence).toBe(
      'Les portes « Documentation » et « Glama » ont donné le plus de clés (1 chacune sur 2).',
    );
    key({ created: '2026-09-30T09:00:00Z', source: 'n8n' });
    expect(getDoorBoard({ now: NOW }).last_week.sentence).toBe(
      '3 portes sont à égalité en tête, avec 1 clé chacune sur 3.',
    );
  });
});

describe('ce que la réponse ne dit jamais', () => {
  it('ne porte aucune adresse, aucun hachage, aucun préfixe de clé', () => {
    const k = key({ created: '2026-09-29T08:00:00Z', email: 'jeanne@alpha.example.net' });
    firstSuccess(k.lineage, '2026-09-29T09:00:00Z');
    nudge(k.prefix, '2026-09-30T08:00:00Z');
    purchase(k, { iso: '2026-10-01T08:00:00Z' });
    const body = JSON.stringify(getDoorBoard({ now: NOW }));
    expect(body).not.toContain('alpha.example.net');
    expect(body).not.toContain(k.hash);
    expect(body).not.toContain(k.prefix);
    expect(body).not.toContain('ifk_');
  });

  it('reste lisible sans aucune clé', () => {
    const board = getDoorBoard({ now: NOW + 3 * DAY });
    expect(board.control).toMatchObject({ created_total: 0, external_fleet: 0, equal: true });
    expect(board.by_door).toEqual([]);
  });
});
