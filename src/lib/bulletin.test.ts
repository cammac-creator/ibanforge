import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStatsDB } from './db.js';
import { normalizeEmail } from './email-norm.js';
import { kvSet } from './forum-radar-server.js';
import { heartbeat, opsFail, opsOk } from './ops-alert.js';
import { resetMergedPullsCache } from './bulletin-github.js';
import {
  BULLETIN_MAX_WEEKS_BACK,
  BULLETIN_NOT_YET,
  MISSING_BICS_SQL,
  getBulletin,
  resolveBulletinWeek,
  swissWeekFromLabel,
} from './bulletin.js';
import { swissWeekOf, swissWeekShift } from './swiss-week.js';

/**
 * Le bulletin du lundi sur une base SYNTHÉTIQUE et une horloge fixée.
 *
 * Horloge : mercredi 07.10.2026 à 12:00, heure suisse (été). La semaine en cours
 * est la 41 ; la dernière semaine close, celle du bulletin par défaut, la 40
 * (28.09 au 04.10, soit 27.09 22:00 UTC au 04.10 22:00 UTC). Fixtures inventées :
 * adresses en `alpha.example.net` (externes pour les deux règles du dépôt) et
 * `acme@example.com` pour une clé interne. Codes BIC de forme valide, inventés.
 * Aucun appel ne part : `fetch` est simulé pour GitHub et pour Telegram.
 */
const NOW = Date.parse('2026-10-07T10:00:00Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const ENV = {
  tok: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
  off: process.env.OPS_ALERTS_DISABLED,
};

let seq = 0;

function stamp(iso: string): string {
  return new Date(Date.parse(iso)).toISOString().slice(0, 19).replace('T', ' ');
}

function key(f: { created: string; source?: string; email?: string }): {
  hash: string;
  prefix: string;
} {
  seq += 1;
  const hash = `bulletin-hash-${seq}`;
  const prefix = `ifk_bl${String(seq).padStart(6, '0')}`;
  const email = f.email ?? `person${seq}@alpha.example.net`;
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier,
                             lineage_hash)
       VALUES (?, ?, ?, ?, ?, ?, 'email', ?)`,
    )
    .run(
      hash,
      prefix,
      email,
      normalizeEmail(email),
      stamp(f.created),
      f.source ?? 'site-signup',
      hash,
    );
  return { hash, prefix };
}

function firstSuccess(lineage: string, iso: string): void {
  getStatsDB()
    .prepare(
      `INSERT INTO lineage_facts (lineage_hash, birth_at, backfilled, first_success_at)
       VALUES (?, ?, 0, ?)`,
    )
    .run(lineage, stamp(iso), stamp(iso));
}

function bicLookup(f: {
  iso: string;
  code?: string | null;
  country?: string | null;
  success?: number;
  prefix?: string | null;
  reject?: string | null;
  type?: string;
}): void {
  getStatsDB()
    .prepare(
      `INSERT INTO operations (operation_type, country_code, success, created_at, error_detail,
                               reject_reason, key_prefix)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      f.type ?? 'bic_lookup',
      f.country === undefined ? (f.code ? f.code.slice(4, 6) : null) : f.country,
      f.success ?? 0,
      stamp(f.iso),
      f.code ?? null,
      f.reject ?? null,
      f.prefix ?? null,
    );
}

function thread(f: { url: string; source: string; status: string; firstSeen: string }): void {
  getStatsDB()
    .prepare(
      `INSERT INTO forum_threads (url, source, title, status, first_seen)
       VALUES (?, ?, 'Question inventée', ?, ?)`,
    )
    .run(f.url, f.source, f.status, stamp(f.firstSeen));
}

function githubPage(): Response {
  return new Response(JSON.stringify([]), { status: 200 });
}

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'jeton-factice';
  process.env.TELEGRAM_CHAT_ID = 'canal-factice';
  delete process.env.OPS_ALERTS_DISABLED;
});

beforeEach(() => {
  resetMergedPullsCache();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      String(url).includes('api.telegram.org') ? new Response('{}', { status: 200 }) : githubPage(),
    ),
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

afterAll(() => {
  for (const [name, value] of [
    ['TELEGRAM_BOT_TOKEN', ENV.tok],
    ['TELEGRAM_CHAT_ID', ENV.chat],
    ['OPS_ALERTS_DISABLED', ENV.off],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('la semaine du bulletin', () => {
  it('lit une étiquette ISO en semaine suisse, et refuse ce qui n’en nomme pas une', () => {
    expect(swissWeekFromLabel('2026-W40')).toMatchObject({
      label: '2026-W40',
      monday: '2026-09-28',
      sunday: '2026-10-04',
      startMs: Date.parse('2026-09-27T22:00:00Z'),
      endMs: Date.parse('2026-10-04T22:00:00Z'),
    });
    // 2026 commence un jeudi : elle a 53 semaines ; 2025 n'en a que 52.
    expect(swissWeekFromLabel('2026-W53')).toMatchObject({ monday: '2026-12-28' });
    expect(swissWeekFromLabel('2027-W01')).toMatchObject({ monday: '2027-01-04' });
    for (const bad of ['2025-W53', '2026-W00', '2026-W54', '2026-40', '2026-W4', 'semaine']) {
      expect(swissWeekFromLabel(bad), bad).toBeNull();
    }
  });

  it('prend la dernière semaine close par défaut, et une semaine demandée si elle est close', () => {
    expect(resolveBulletinWeek(null, NOW)).toMatchObject({
      week: { label: '2026-W40' },
      weeksBack: 1,
    });
    expect(resolveBulletinWeek('2026-W39', NOW)).toMatchObject({
      week: { label: '2026-W39' },
      weeksBack: 2,
    });
    const current = swissWeekOf(NOW);
    const oldest = swissWeekShift(current, BULLETIN_MAX_WEEKS_BACK).label;
    expect(resolveBulletinWeek(oldest, NOW).weeksBack).toBe(BULLETIN_MAX_WEEKS_BACK);
    // La semaine en cours, une semaine à venir, une semaine hors du tableau des
    // portes et une valeur illisible reviennent à la semaine par défaut.
    for (const raw of [
      '2026-W41',
      '2026-W42',
      swissWeekShift(current, BULLETIN_MAX_WEEKS_BACK + 1).label,
      'beaucoup',
    ]) {
      expect(resolveBulletinWeek(raw, NOW).week.label, raw).toBe('2026-W40');
    }
  });
});

describe('une base où rien n’a encore été écrit', () => {
  it('ne montre aucune alerte et aucun battement, sans rien inventer', async () => {
    const b = await getBulletin({ now: NOW });
    expect(b.moved.alerts).toEqual({ state: 'read', open: [], failing: [] });
    expect(b.moved.heartbeats.state).toBe('read');
    if (b.moved.heartbeats.state !== 'read') return;
    expect(b.moved.heartbeats.items.every((i) => i.state === 'never')).toBe(true);
    expect(b.moved.heartbeats.items.every((i) => i.last_beat_at === null)).toBe(true);
    expect(b.needs.missing_bics).toMatchObject({ state: 'read', total_lookups: 0, top: [] });
    expect(b.needs.forum_threads).toEqual({ state: 'read', found: 0, still_new: 0 });
    expect(b.not_yet.map((n) => n.key)).toEqual(BULLETIN_NOT_YET.map((n) => n.key));
  });
});

describe('les chiffres, pris dans le tableau des portes', () => {
  beforeAll(() => {
    // Semaine 40 : trois clés, dont une prise depuis l'accueil, et un premier appel.
    const a = key({ created: '2026-09-29T08:00:00Z', source: 'site-docs' });
    key({ created: '2026-09-30T08:00:00Z', source: 'site-docs' });
    key({ created: '2026-10-01T08:00:00Z', source: 'site-home' });
    firstSuccess(a.hash, '2026-09-29T09:00:00Z');
    // Semaine 39 : une clé, le jeudi.
    key({ created: '2026-09-24T08:00:00Z', source: 'site-signup' });
    // Une clé interne n'entre dans aucun nombre.
    key({ created: '2026-09-29T10:00:00Z', source: 'site-home', email: 'acme@example.com' });
  });

  it('donne la semaine par défaut, la semaine d’avant et la porte de l’accueil', async () => {
    const b = await getBulletin({ now: NOW });
    expect(b.week).toMatchObject({
      label: '2026-W40',
      title: 'Semaine 40 · 28.09 au 04.10',
      last_complete: true,
      previous: '2026-W39',
      next: null,
    });
    expect(b.numbers.state).toBe('read');
    if (b.numbers.state !== 'read') return;
    expect(b.numbers.totals).toMatchObject({ created: 3, first_success: 1, paid: 0 });
    expect(b.numbers.previous).toEqual({
      week: '2026-W39',
      created: 1,
      first_success: 0,
      paid: 0,
    });
    expect(b.numbers.free_active).toMatchObject({ threshold: 50, window: { to: '2026-10-04' } });
    expect(b.numbers.site_home).toEqual({
      since: '2026-09-27 08:49:01',
      coverage: 'full',
      created: 1,
      first_success: 0,
      paid: 0,
    });
    expect(b.numbers.doors[0]).toMatchObject({ door: 'site-docs', created: 2 });
    expect(b.numbers.sentence).toBe(
      'La porte « Documentation » a donné le plus de clés (2 sur 3).',
    );
  });

  it('ne donne les gratuits actifs et la phrase du lundi que pour la dernière semaine close', async () => {
    const b = await getBulletin({ now: NOW, week: '2026-W39' });
    expect(b.week).toMatchObject({
      label: '2026-W39',
      last_complete: false,
      previous: '2026-W38',
      next: '2026-W40',
    });
    expect(b.requested).toEqual({ week: '2026-W39' });
    if (b.numbers.state !== 'read') throw new Error('numbers unread');
    expect(b.numbers.totals.created).toBe(1);
    expect(b.numbers.free_active).toBeNull();
    expect(b.numbers.sentence).toBeNull();
    // L'accueil neuf est en ligne depuis le dimanche 27.09 : la semaine 39 n'en a
    // qu'un bout, la 38 rien du tout, et son absence n'est pas un zéro.
    expect(b.numbers.site_home).toMatchObject({ coverage: 'partial', created: 0 });
    const w38 = await getBulletin({ now: NOW, week: '2026-W38' });
    if (w38.numbers.state !== 'read') throw new Error('numbers unread');
    expect(w38.numbers.site_home).toMatchObject({ coverage: 'none', created: null });
  });
});

describe('ce qu’on cherche sans trouver : les BIC introuvables par pays', () => {
  beforeAll(() => {
    const external = key({ created: '2026-08-01T08:00:00Z' });
    const internal = key({ created: '2026-08-01T08:00:00Z', email: 'acme@example.com' });
    // Dans la semaine 40.
    bicLookup({ iso: '2026-09-28T08:00:00Z', code: 'ALPHITMMXXX', prefix: external.prefix });
    bicLookup({ iso: '2026-09-29T08:00:00Z', code: 'ALPHITMMXXX', prefix: external.prefix });
    bicLookup({ iso: '2026-09-30T08:00:00Z', code: 'BETAITMM', prefix: external.prefix });
    bicLookup({ iso: '2026-10-01T08:00:00Z', code: 'GAMMDEFF' });
    bicLookup({ iso: '2026-10-01T09:00:00Z', code: 'GAMMDEFF' });
    // Pays illisible dans la colonne : les 5e et 6e lettres du BIC le donnent.
    bicLookup({ iso: '2026-10-02T08:00:00Z', code: 'DELTFRPP', country: null });
    for (const code of ['EPSIESMM', 'ZETANL2A', 'ETAAPTPL', 'THETBEBB']) {
      bicLookup({ iso: '2026-10-03T08:00:00Z', code });
    }
    // Écartés : une clé interne, un BIC trouvé, une saisie rejetée, une autre
    // opération, et deux recherches juste hors de la semaine.
    bicLookup({ iso: '2026-10-01T10:00:00Z', code: 'ALPHITMMXXX', prefix: internal.prefix });
    bicLookup({ iso: '2026-10-01T11:00:00Z', code: 'ALPHITMM', success: 1 });
    bicLookup({
      iso: '2026-10-01T12:00:00Z',
      code: null,
      country: null,
      reject: 'invalid_bic_shape',
    });
    bicLookup({ iso: '2026-10-01T13:00:00Z', code: 'CH93', country: null, type: 'iban_validate' });
    bicLookup({ iso: '2026-09-27T21:59:59Z', code: 'ALPHITMM' });
    bicLookup({ iso: '2026-10-04T22:00:00Z', code: 'ALPHITMM' });
  });

  it('regroupe par pays, garde les cinq premiers et écarte nos propres clés', async () => {
    const b = await getBulletin({ now: NOW });
    expect(b.needs.missing_bics).toEqual({
      state: 'read',
      source: 'operations',
      total_lookups: 10,
      total_countries: 7,
      top: [
        { country: 'IT', lookups: 3, distinct_codes: 2 },
        { country: 'DE', lookups: 2, distinct_codes: 1 },
        { country: 'BE', lookups: 1, distinct_codes: 1 },
        { country: 'ES', lookups: 1, distinct_codes: 1 },
        { country: 'FR', lookups: 1, distinct_codes: 1 },
      ],
      excluded_internal: 1,
    });
  });

  it('ne lit que la semaine, par l’index des dates', () => {
    const plan = (
      getStatsDB()
        .prepare(`EXPLAIN QUERY PLAN ${MISSING_BICS_SQL}`)
        .all('2026-09-27 22:00:00', '2026-10-04 22:00:00') as Array<{ detail: string }>
    )
      .map((r) => r.detail)
      .join(' | ');
    expect(plan).toContain('idx_operations_created');
    for (const other of [
      'idx_operations_type',
      'idx_operations_reject',
      'idx_operations_key',
      'idx_operations_country',
    ]) {
      expect(plan).not.toContain(other);
    }
  });
});

describe('ce qu’on cherche sans trouver : le radar des forums', () => {
  it('compte les fils entrés pendant la semaine, hors ajouts à la main', async () => {
    thread({
      url: 'https://alpha.example.net/f/1',
      source: 'github',
      status: 'new',
      firstSeen: '2026-09-29T08:00:00Z',
    });
    thread({
      url: 'https://alpha.example.net/f/2',
      source: 'reddit',
      status: 'dismissed',
      firstSeen: '2026-10-02T08:00:00Z',
    });
    thread({
      url: 'https://alpha.example.net/f/3',
      source: 'manual',
      status: 'new',
      firstSeen: '2026-09-30T08:00:00Z',
    });
    thread({
      url: 'https://alpha.example.net/f/4',
      source: 'github',
      status: 'new',
      firstSeen: '2026-09-20T08:00:00Z',
    });
    const b = await getBulletin({ now: NOW });
    expect(b.needs.forum_threads).toEqual({ state: 'read', found: 2, still_new: 1 });
  });
});

describe('les signes de vie et les alertes, lus dans les clés d’ops-alert', () => {
  it('lit les battements écrits par heartbeat() et les radars, en ce moment', async () => {
    heartbeat('weekly-veille');
    vi.setSystemTime(NOW - 10 * DAY);
    heartbeat('refresh-compliance');
    vi.setSystemTime(NOW);
    kvSet('cohort_radar_last_run', new Date(NOW - HOUR).toISOString());
    kvSet(
      'lifecycle_radar_state',
      JSON.stringify({ last_run_at: new Date(NOW - 2 * DAY).toISOString() }),
    );
    kvSet('prospect_radar_last_run', 'pas une date');

    const b = await getBulletin({ now: NOW });
    if (b.moved.heartbeats.state !== 'read') throw new Error('heartbeats unread');
    const by = new Map(b.moved.heartbeats.items.map((i) => [i.name, i]));
    expect(by.get('weekly-veille')).toMatchObject({
      kind: 'cron',
      state: 'on_time',
      last_beat_at: '2026-10-07 10:00:00',
      age_hours: 0,
      max_age_hours: 216,
    });
    expect(by.get('refresh-compliance')).toMatchObject({ state: 'late', age_hours: 240 });
    expect(by.get('indexnow')).toMatchObject({ state: 'never', last_beat_at: null });
    expect(by.get('cohort_radar_last_run')).toMatchObject({
      kind: 'radar',
      state: 'on_time',
      age_hours: 1,
    });
    expect(by.get('lifecycle_radar_state')).toMatchObject({ state: 'late', age_hours: 48 });
    expect(by.get('prospect_radar_last_run')).toMatchObject({
      state: 'unreadable',
      last_beat_at: null,
    });
    expect(by.get('forum_radar_last_scan_at')).toMatchObject({ state: 'never' });
    expect(b.moved.heartbeats).toMatchObject({ late: 2 });
  });

  it('montre les alertes ouvertes par opsFail(), et celles en échec sans message parti', async () => {
    await opsFail('x402:facilitator', 'panne inventée');
    vi.setSystemTime(NOW + 5 * 60_000);
    await opsFail('heartbeat:weekly-reco-baseline', 'battement inventé');
    await opsFail('trial:sweep', 'lenteur inventée', 3);
    await opsFail('db:stats', 'refermée ensuite');
    await opsOk('db:stats');
    const later = NOW + 10 * 60_000;
    const b = await getBulletin({ now: later });
    if (b.moved.alerts.state !== 'read') throw new Error('alerts unread');
    // `updated_at` is written by SQLite's own clock, which the fake timers do not move.
    const sqliteStamp = expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(b.moved.alerts.open).toEqual([
      {
        key: 'heartbeat:weekly-reco-baseline',
        label: 'baseline reco-IA',
        fails: 1,
        opened_at: '2026-10-07 10:05:00',
        last_failure_at: sqliteStamp,
      },
      {
        key: 'x402:facilitator',
        label: null,
        fails: 1,
        opened_at: '2026-10-07 10:00:00',
        last_failure_at: sqliteStamp,
      },
    ]);
    expect(b.moved.alerts.failing).toEqual([
      { key: 'trial:sweep', label: null, fails: 1, opened_at: null, last_failure_at: sqliteStamp },
    ]);
    if (b.moved.heartbeats.state !== 'read') throw new Error('heartbeats unread');
    const reco = b.moved.heartbeats.items.find((i) => i.name === 'weekly-reco-baseline');
    expect(reco?.alert_open).toBe(true);
  });
});

describe('un bloc illisible ne fait pas tomber les autres', () => {
  it('dit « non lu » pour ce bloc seulement', async () => {
    const db = getStatsDB();
    db.exec('ALTER TABLE forum_threads RENAME TO forum_threads_hors_champ');
    try {
      const b = await getBulletin({ now: NOW });
      expect(b.needs.forum_threads).toEqual({ state: 'unread', reason: 'read_failed' });
      expect(b.needs.missing_bics.state).toBe('read');
      expect(b.numbers.state).toBe('read');
    } finally {
      db.exec('ALTER TABLE forum_threads_hors_champ RENAME TO forum_threads');
    }
  });

  it('ne met aucune adresse, aucune clé ni aucun hachage dans la réponse', async () => {
    const text = JSON.stringify(await getBulletin({ now: NOW }));
    expect(text).not.toMatch(/example\.(net|com)|ifk_|bulletin-hash/);
  });
});
