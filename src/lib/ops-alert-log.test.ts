import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStatsDB } from './db.js';
import { opsFail, opsOk } from './ops-alert.js';
import { logAlertClosed, logAlertOpened } from './ops-alert-log.js';

/**
 * L'historique des alertes (bulletin du lundi, étape A2) : une ligne quand le message
 * d'une alerte part, refermée par le succès qui la referme. Telegram est simulé ;
 * clés d'alerte inventées.
 */
const ENV = {
  tok: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
  off: process.env.OPS_ALERTS_DISABLED,
};

let telegramOk = true;

function rows(
  key: string,
): Array<{ opened_at: string | null; closed_at: string | null; fails: number }> {
  return getStatsDB()
    .prepare(
      `SELECT opened_at, closed_at, fails FROM ops_alert_log WHERE alert_key = ? ORDER BY id`,
    )
    .all(key) as Array<{ opened_at: string | null; closed_at: string | null; fails: number }>;
}

beforeAll(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'jeton-factice';
  process.env.TELEGRAM_CHAT_ID = 'canal-factice';
  delete process.env.OPS_ALERTS_DISABLED;
});

beforeEach(() => {
  telegramOk = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { status: telegramOk ? 200 : 502 })),
  );
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
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

describe('ops_alert_log, écrit aux transitions d’ops-alert', () => {
  it('ouvre une ligne quand le message part, la referme au retour', async () => {
    await opsFail('test:log-a', 'panne inventée');
    expect(rows('test:log-a')).toEqual([expect.objectContaining({ closed_at: null, fails: 1 })]);
    expect(rows('test:log-a')[0].opened_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    // Un second échec, l'alerte déjà ouverte : aucune ligne de plus.
    await opsFail('test:log-a', 'panne qui dure');
    expect(rows('test:log-a')).toHaveLength(1);
    await opsOk('test:log-a');
    const [row] = rows('test:log-a');
    expect(row.closed_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(row.fails).toBe(2);
    // Une nouvelle panne dans les six heures de la fenêtre anti-tempête : le message
    // ne part pas, donc rien n'est ouvert ; après la fenêtre, un second épisode.
    await opsFail('test:log-a', 'nouvelle panne');
    expect(rows('test:log-a')).toHaveLength(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 7 * 3_600_000);
      await opsFail('test:log-a', 'nouvelle panne, plus tard');
    } finally {
      vi.useRealTimers();
    }
    expect(rows('test:log-a')).toHaveLength(2);
    expect(rows('test:log-a')[1]).toMatchObject({ closed_at: null, fails: 2 });
  });

  it('n’écrit rien sous le seuil, ni quand le message n’est pas parti', async () => {
    await opsFail('test:log-b', 'lenteur inventée', 3);
    await opsOk('test:log-b');
    expect(rows('test:log-b')).toEqual([]);
    telegramOk = false;
    await opsFail('test:log-c', 'Telegram muet');
    expect(rows('test:log-c')).toEqual([]);
  });

  it('referme une alerte ouverte avant l’historique par une ligne à ouverture inconnue', () => {
    logAlertClosed('test:log-d', 4);
    expect(rows('test:log-d')).toEqual([expect.objectContaining({ opened_at: null, fails: 4 })]);
    expect(rows('test:log-d')[0].closed_at).not.toBeNull();
  });

  it('ne jette jamais, même sans la table', () => {
    const db = getStatsDB();
    db.exec('ALTER TABLE ops_alert_log RENAME TO ops_alert_log_hors_champ');
    try {
      expect(() => logAlertOpened('test:log-e', 1)).not.toThrow();
      expect(() => logAlertClosed('test:log-e', 1)).not.toThrow();
    } finally {
      db.exec('ALTER TABLE ops_alert_log_hors_champ RENAME TO ops_alert_log');
    }
  });

  it('ne garde que la clé et un nombre, jamais le texte du message', async () => {
    await opsFail('test:log-f', 'détail technique inventé 42');
    const columns = (
      getStatsDB().prepare(`PRAGMA table_info(ops_alert_log)`).all() as Array<{ name: string }>
    ).map((c) => c.name);
    expect(columns.sort()).toEqual(['alert_key', 'closed_at', 'fails', 'id', 'opened_at']);
    const dump = JSON.stringify(getStatsDB().prepare(`SELECT * FROM ops_alert_log`).all());
    expect(dump).not.toContain('détail technique inventé');
  });
});
