import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStatsDB } from './db.js';
import { getDoorBoard } from './door-board.js';
import {
  DIGEST_MAX_ATTEMPTS,
  DOORS_PAGE_URL,
  attemptDigest,
  buildDigestMessage,
  channelBlock,
  digestTick,
  drawFirstDeparture,
  isRoundMinute,
  nextNonRoundDeparture,
  readDigestState,
  startDoorBoardDigest,
  type DigestDeps,
} from './door-board-digest.js';
import type { OpsSendResult } from './ops-alert.js';
import { zurichParts } from './swiss-week.js';

/** Ce que l'envoi factice peut constater : accepté, refusé par Telegram, ou sans réponse. */
const ACCEPTED: OpsSendResult = { sent: true, httpStatus: 200 };
const refused = (status: number): OpsSendResult => ({ sent: false, httpStatus: status });
const UNCONFIRMED: OpsSendResult = { sent: false, httpStatus: null };

/**
 * Le résumé du lundi, sur une horloge et un tirage injectés, et un envoi
 * factice : rien ne part vers Telegram. Base synthétique, fixtures inventées.
 *
 * Lundi 05.10.2026 : semaine 41, le résumé porte sur la semaine 40. Heure
 * d'été : 08:00 heure suisse = 06:00 UTC.
 */
const MONDAY_0800 = Date.parse('2026-10-05T06:00:00Z');
const MINUTE = 60_000;
const TELEGRAM = { TELEGRAM_BOT_TOKEN: 'jeton-factice', TELEGRAM_CHAT_ID: 'canal-factice' };

/** Un tirage déterministe qui parcourt une suite donnée, en boucle. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

interface Harness {
  deps: DigestDeps;
  sent: string[];
  clock: { now: number };
}

function harness(
  opts: {
    now?: number;
    env?: NodeJS.ProcessEnv;
    rng?: () => number;
    send?: (text: string, clock: { now: number }) => Promise<OpsSendResult>;
  } = {},
): Harness {
  const clock = { now: opts.now ?? MONDAY_0800 };
  const sent: string[] = [];
  const deps: DigestDeps = {
    now: () => clock.now,
    rng: opts.rng ?? sequence([0.37, 0.61, 0.13, 0.88]),
    env: opts.env ?? { ...TELEGRAM },
    board: (now) => getDoorBoard({ now }),
    send: async (text) => {
      sent.push(text);
      return opts.send ? opts.send(text, clock) : ACCEPTED;
    },
  };
  return { deps, sent, clock };
}

function row(week = '2026-W41') {
  // La table n'existe qu'après le premier battement du module.
  const exists = getStatsDB()
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'door_board_digest'`)
    .get();
  if (!exists) return undefined;
  return getStatsDB().prepare('SELECT * FROM door_board_digest WHERE week = ?').get(week) as
    | {
        status: string;
        attempts: number;
        planned_at: string;
        next_attempt_at: string;
        claimed_at: string | null;
        skip_reason: string | null;
        last_error: string | null;
        numbers_json: string | null;
      }
    | undefined;
}

function msOf(stamp: string): number {
  return Date.parse(`${stamp.replace(' ', 'T')}Z`);
}

function seedKeys(): void {
  const db = getStatsDB();
  const insert = db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier)
     VALUES (?, ?, ?, ?, ?, ?, 'email')`,
  );
  insert.run(
    'dg-1',
    'ifk_dg000001',
    'one@beta.example.net',
    'one@beta.example.net',
    '2026-09-29 08:00:00',
    'site-docs',
  );
  insert.run(
    'dg-2',
    'ifk_dg000002',
    'two@beta.example.net',
    'two@beta.example.net',
    '2026-09-30 08:00:00',
    'npm-mcp',
  );
}

beforeEach(() => {
  const db = getStatsDB();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM request_log').run();
  // La table du résumé est créée par le module au premier battement.
  const exists = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'door_board_digest'`)
    .get();
  if (exists) db.prepare('DELETE FROM door_board_digest').run();
  seedKeys();
});

describe('la minute tirée', () => {
  it('tombe toujours le lundi entre 08:00 et 10:59, heure suisse, jamais ronde', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 144; i++) {
      for (const second of [0, 0.999]) {
        const at = drawFirstDeparture('2026-10-05', sequence([(i + 0.5) / 144, second]));
        const local = zurichParts(at);
        expect(local.weekday).toBe(1);
        expect(local.hour).toBeGreaterThanOrEqual(8);
        expect(local.hour).toBeLessThan(11);
        expect(isRoundMinute(local.minute), `${local.hour}:${local.minute}`).toBe(false);
        expect(local.second).toBeGreaterThanOrEqual(5);
        expect(local.second).toBeLessThanOrEqual(50);
        seen.add(local.hour * 60 + local.minute);
      }
    }
    // Les 144 minutes permises sont toutes atteignables : 3 heures × 48.
    expect(seen.size).toBe(144);
  });

  it('se place juste en UTC les deux lundis qui suivent un changement d’heure', () => {
    const spring = drawFirstDeparture('2026-03-30', sequence([0, 0]));
    const springLast = drawFirstDeparture('2026-03-30', sequence([0.9999, 0.9999]));
    expect(new Date(spring).toISOString()).toBe('2026-03-30T06:01:05.000Z');
    expect(new Date(springLast).toISOString()).toBe('2026-03-30T08:59:50.000Z');
    const autumn = drawFirstDeparture('2026-10-26', sequence([0, 0]));
    const autumnLast = drawFirstDeparture('2026-10-26', sequence([0.9999, 0.9999]));
    expect(new Date(autumn).toISOString()).toBe('2026-10-26T07:01:05.000Z');
    expect(new Date(autumnLast).toISOString()).toBe('2026-10-26T09:59:50.000Z');
  });

  it('ne tombe jamais ronde non plus en retard ou en nouvelle tentative', () => {
    for (let i = 0; i < 400; i++) {
      const from = MONDAY_0800 + i * 17_321;
      const rng = sequence([(i % 37) / 37, (i % 11) / 11]);
      const late = nextNonRoundDeparture(from, 61_000, 240_000, rng);
      expect(late).toBeGreaterThanOrEqual(from + 61_000);
      expect(late).toBeLessThan(from + 240_000 + 2 * MINUTE);
      expect(isRoundMinute(new Date(late).getUTCMinutes())).toBe(false);
      const s = new Date(late).getUTCSeconds();
      expect(s).toBeGreaterThanOrEqual(5);
      expect(s).toBeLessThanOrEqual(50);
    }
  });
});

describe('une fois par semaine ISO, jamais deux', () => {
  it('garde la minute tirée à travers un redémarrage, part une fois, puis se tait', async () => {
    const first = harness();
    const plan = digestTick(first.deps);
    expect(plan.action).toBe('arm');
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    expect(row()?.planned_at).toBeDefined();

    // Redémarrage : un autre processus, un autre tirage. La minute ne bouge pas.
    const second = harness({ rng: sequence([0.02, 0.97]) });
    const replan = digestTick(second.deps);
    expect(replan).toEqual({ action: 'arm', week: '2026-W41', dueMs: due });

    second.clock.now = due;
    expect(await attemptDigest('2026-W41', due, second.deps)).toEqual({
      result: 'sent',
      departedAt: due,
    });
    expect(second.sent).toHaveLength(1);
    expect(isRoundMinute(zurichParts(due).minute)).toBe(false);

    // Tout ce qui suit ce lundi-là ne renvoie rien.
    second.clock.now = due + 30 * MINUTE;
    expect(digestTick(second.deps)).toEqual({ action: 'idle', reason: 'done' });
    expect(await attemptDigest('2026-W41', due, second.deps)).toEqual({ result: 'not_claimed' });
    expect(second.sent).toHaveLength(1);
    expect(row()).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('part en retard, à une minute non ronde, quand le processus dormait à la minute tirée', async () => {
    const h = harness();
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due + 3 * MINUTE;
    const late = digestTick(h.deps);
    expect(late.action).toBe('arm');
    const lateDue = late.action === 'arm' ? late.dueMs : 0;
    expect(lateDue).toBeGreaterThanOrEqual(h.clock.now + 61_000);
    expect(lateDue).toBeLessThanOrEqual(h.clock.now + 240_000 + 2 * MINUTE);
    expect(isRoundMinute(zurichParts(lateDue).minute)).toBe(false);
    // L'ancienne minuterie, si elle se réveillait, ne prend plus rien.
    h.clock.now = due;
    expect(await attemptDigest('2026-W41', due, h.deps)).toEqual({ result: 'not_claimed' });
    h.clock.now = lateDue;
    expect((await attemptDigest('2026-W41', lateDue, h.deps)).result).toBe('sent');
    expect(h.sent).toHaveLength(1);
  });

  it('ne part pas d’une minuterie réveillée trop tard, et replanifie un départ non rond', async () => {
    const h = harness();
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due + 6_000;
    expect(await attemptDigest('2026-W41', due, h.deps)).toEqual({ result: 'late' });
    expect(h.sent).toHaveLength(0);
    expect(row()).toMatchObject({ status: 'planned', attempts: 0 });
    const again = digestTick(h.deps);
    expect(again.action).toBe('arm');
  });

  it('ne renvoie jamais un envoi interrompu entre la réservation et la réponse', async () => {
    const h = harness();
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    // Le processus réserve le départ, puis meurt avant la réponse de Telegram.
    getStatsDB()
      .prepare(
        `UPDATE door_board_digest SET status = 'sending', attempts = 1, claimed_at = ? WHERE week = ?`,
      )
      .run(new Date(due).toISOString().slice(0, 19).replace('T', ' '), '2026-W41');
    h.clock.now = due + 4 * MINUTE;
    expect(digestTick(h.deps)).toEqual({ action: 'idle', reason: 'in_flight' });
    h.clock.now = due + 11 * MINUTE;
    expect(digestTick(h.deps)).toEqual({ action: 'idle', reason: 'done' });
    expect(row()).toMatchObject({ status: 'interrupted', last_error: 'process_stopped_mid_send' });
    expect(await attemptDigest('2026-W41', due, h.deps)).toEqual({ result: 'not_claimed' });
    expect(h.sent).toHaveLength(0);
  });

  it('laisse partir un seul de deux processus qui tentent à la même minute', async () => {
    const release: Array<() => void> = [];
    const slow = (): Promise<OpsSendResult> =>
      new Promise((resolve) => release.push(() => resolve(ACCEPTED)));
    const a = harness({ send: slow });
    const plan = digestTick(a.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    const b = harness({ send: slow, now: due });
    a.clock.now = due;
    const first = attemptDigest('2026-W41', due, a.deps);
    const second = attemptDigest('2026-W41', due, b.deps);
    expect(await second).toEqual({ result: 'not_claimed' });
    release.forEach((r) => r());
    expect((await first).result).toBe('sent');
    expect(a.sent.length + b.sent.length).toBe(1);
  });

  it('planifie un lundi nouveau la semaine suivante', async () => {
    const h = harness();
    const plan = digestTick(h.deps);
    h.clock.now = plan.action === 'arm' ? plan.dueMs : 0;
    await attemptDigest('2026-W41', h.clock.now, h.deps);
    h.clock.now = MONDAY_0800 + 7 * 24 * 60 * MINUTE;
    const next = digestTick(h.deps);
    expect(next).toMatchObject({ action: 'arm', week: '2026-W42' });
    expect(row('2026-W42')).toMatchObject({ status: 'planned' });
  });

  it('ne fait rien les autres jours', () => {
    const h = harness({ now: Date.parse('2026-10-06T08:00:00Z') });
    expect(digestTick(h.deps)).toEqual({ action: 'idle', reason: 'not_monday' });
    expect(row()).toBeUndefined();
  });
});

describe('rien n’est réservé tant que le message ne peut pas partir', () => {
  it.each([
    [{}, 'telegram_not_configured'],
    [{ ...TELEGRAM, OPS_ALERTS_DISABLED: '1' }, 'ops_alerts_disabled'],
    [{ ...TELEGRAM, DOOR_BOARD_DIGEST_DISABLED: '1' }, 'kill_switch'],
  ] as Array<[NodeJS.ProcessEnv, string]>)('%o : %s', async (env, reason) => {
    expect(channelBlock(env)).toBe(reason);
    const h = harness({ env });
    expect(digestTick(h.deps)).toEqual({ action: 'idle', reason: 'blocked' });
    const planned = row();
    expect(planned).toMatchObject({ status: 'planned', attempts: 0, skip_reason: reason });
    const due = msOf(planned?.next_attempt_at ?? '');
    h.clock.now = due;
    expect(await attemptDigest('2026-W41', due, h.deps)).toEqual({ result: 'blocked', reason });
    expect(row()).toMatchObject({ status: 'planned', attempts: 0 });
    // Passé 17:00, heure suisse, le lundi finit « sauté », avec sa raison.
    h.clock.now = Date.parse('2026-10-05T15:00:00Z');
    digestTick(h.deps);
    expect(row()).toMatchObject({ status: 'skipped', skip_reason: reason });
    expect(h.sent).toHaveLength(0);
  });

  it('repart normalement quand le canal revient dans la journée', async () => {
    const h = harness({ env: {} });
    digestTick(h.deps);
    h.deps.env = { ...TELEGRAM };
    h.clock.now = Date.parse('2026-10-05T12:00:00Z');
    const plan = digestTick(h.deps);
    expect(plan.action).toBe('arm');
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due;
    expect((await attemptDigest('2026-W41', due, h.deps)).result).toBe('sent');
    expect(row()).toMatchObject({ status: 'sent', skip_reason: null });
  });
});

describe('un refus de Telegram se retente, un envoi sans réponse jamais', () => {
  it('retente après un refus explicite, à une minute non ronde, puis part', async () => {
    let refuse = true;
    const h = harness({ send: async () => (refuse ? refused(429) : ACCEPTED) });
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due;
    const failed = await attemptDigest('2026-W41', due, h.deps);
    expect(failed.result).toBe('retry');
    const next = failed.result === 'retry' ? failed.nextMs : 0;
    expect(next - due).toBeGreaterThanOrEqual(17 * MINUTE);
    expect(isRoundMinute(zurichParts(next).minute)).toBe(false);
    expect(row()).toMatchObject({
      status: 'planned',
      attempts: 1,
      last_error: 'telegram_refused_429',
    });
    refuse = false;
    h.clock.now = next;
    expect((await attemptDigest('2026-W41', next, h.deps)).result).toBe('sent');
    expect(row()).toMatchObject({ status: 'sent', attempts: 2, last_error: null });
    expect(h.sent).toHaveLength(2);
  });

  it(`s’arrête après ${DIGEST_MAX_ATTEMPTS} tentatives`, async () => {
    const h = harness({ send: async () => refused(500) });
    let plan = digestTick(h.deps);
    for (let i = 0; i < DIGEST_MAX_ATTEMPTS; i++) {
      const due = plan.action === 'arm' ? plan.dueMs : 0;
      h.clock.now = due;
      await attemptDigest('2026-W41', due, h.deps);
      plan = digestTick(h.deps);
    }
    expect(row()).toMatchObject({ status: 'failed', attempts: DIGEST_MAX_ATTEMPTS });
    expect(h.sent).toHaveLength(DIGEST_MAX_ATTEMPTS);
  });

  it('ne retente pas un envoi resté sans réponse de Telegram, même rapide : il a pu arriver', async () => {
    // Une coupure juste après le départ de la requête revient vite, sans statut :
    // le message a pu arriver. Jamais de second essai.
    const h = harness({ send: async () => UNCONFIRMED });
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due;
    expect(await attemptDigest('2026-W41', due, h.deps)).toEqual({
      result: 'failed',
      error: 'send_unconfirmed',
    });
    h.clock.now += 20 * MINUTE;
    expect(digestTick(h.deps)).toEqual({ action: 'idle', reason: 'done' });
    expect(h.sent).toHaveLength(1);
  });
});

describe('l’heure limite de 17:00', () => {
  it('manque le lundi plutôt que de partir après 17:00', () => {
    const h = harness();
    digestTick(h.deps);
    // 16:59:30 heure suisse : un départ en retard tomberait à 17:00 ou après.
    h.clock.now = Date.parse('2026-10-05T14:59:30Z');
    expect(digestTick(h.deps)).toEqual({ action: 'idle', reason: 'closed' });
    expect(row()).toMatchObject({ status: 'missed' });
  });

  it('ferme un lundi resté planifié quand le processus revient mardi', () => {
    const h = harness();
    digestTick(h.deps);
    h.clock.now = Date.parse('2026-10-06T07:00:00Z');
    expect(digestTick(h.deps)).toEqual({ action: 'idle', reason: 'not_monday' });
    expect(row()).toMatchObject({ status: 'missed' });
  });
});

describe('le message et la page disent les mêmes nombres', () => {
  it('porte les quatre nombres de la semaine passée, la phrase et le lien, sans rien de personnel', async () => {
    const h = harness();
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due;
    await attemptDigest('2026-W41', due, h.deps);
    const text = h.sent[0];
    const board = getDoorBoard({ now: due });
    expect(buildDigestMessage(board).text).toBe(text);
    expect(text.split('\n')).toEqual([
      'IBANforge · Portes du lundi · semaine 40 · 28.09 au 04.10',
      'Clés créées : 2',
      'Premier appel réussi : 0',
      'Ont payé : 0',
      'Gratuits actifs à 200/mois sur 30 jours : 0 personne, 0 clé (seuil : plus de 50 personnes)',
      board.last_week.sentence,
      DOORS_PAGE_URL,
    ]);
    expect(text).not.toMatch(/example\.net|ifk_|dg-\d/);
    expect(text).not.toMatch(/[—–]/);
    expect(JSON.parse(row()?.numbers_json ?? '{}')).toEqual({
      week: '2026-W40',
      ...board.last_week.numbers,
    });
    const state = readDigestState(board, 6, { ...TELEGRAM });
    expect(state.latest_matches_page).toBe(true);
    expect(state.recent[0]).toMatchObject({
      week: '2026-W41',
      summary_week: '2026-W40',
      status: 'sent',
      numbers: { week: '2026-W40', ...board.last_week.numbers },
    });
    expect(state.window).toEqual({ first: '08:00', last: '10:59', deadline: '17:00' });
    expect(state.this_monday).toEqual({
      week: '2026-W41',
      monday: '2026-10-05',
      deadline_passed: false,
    });
  });

  it('sait, le mardi, que le lundi de la semaine est passé', () => {
    const state = readDigestState(getDoorBoard({ now: Date.parse('2026-10-06T08:00:00Z') }), 6, {
      ...TELEGRAM,
    });
    expect(state.this_monday).toEqual({
      week: '2026-W41',
      monday: '2026-10-05',
      deadline_passed: true,
    });
    expect(state.recent).toEqual([]);
  });

  it('dit un écart quand la page ne dit plus la même chose que le résumé envoyé', async () => {
    const h = harness();
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due;
    await attemptDigest('2026-W41', due, h.deps);
    // Une clé arrivée en retard dans la base, datée de la semaine passée.
    getStatsDB()
      .prepare(
        `INSERT INTO api_keys (key_hash, key_prefix, email, created_at, source)
         VALUES ('dg-3', 'ifk_dg000003', 'three@beta.example.net', '2026-10-01 08:00:00', 'glama')`,
      )
      .run();
    const state = readDigestState(getDoorBoard({ now: due + MINUTE }), 6, { ...TELEGRAM });
    expect(state.latest_matches_page).toBe(false);
  });
});

describe('la minuterie du processus', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ne jette jamais vers le serveur, et ne retente pas un envoi qui a levé une erreur', async () => {
    const h = harness({
      send: async () => {
        throw new Error('réseau coupé');
      },
    });
    const plan = digestTick(h.deps);
    const due = plan.action === 'arm' ? plan.dueMs : 0;
    h.clock.now = due;
    await expect(attemptDigest('2026-W41', due, h.deps)).resolves.toEqual({
      result: 'failed',
      error: 'send_unconfirmed',
    });
    expect(row()).toMatchObject({ status: 'failed', last_error: 'send_unconfirmed' });
  });

  it('bat pour la première fois huit minutes après le démarrage, pas cinq', () => {
    // Lundi 07:00 heure suisse : le premier battement planifie le lundi.
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'Date'] });
    vi.setSystemTime(Date.parse('2026-10-05T05:00:00Z'));
    startDoorBoardDigest();
    vi.advanceTimersByTime(5 * MINUTE + 1000);
    expect(row()).toBeUndefined();
    vi.advanceTimersByTime(3 * MINUTE);
    expect(row()).toMatchObject({ status: 'planned' });
  });
});
