/**
 * La mesure du retard de la boucle d'événements (C18, ARCH-01#1).
 *
 * Trois choses tenues ici :
 *   - un vrai gel de 200 ms se lit, en millisecondes, avec la vraie mesure de Node ;
 *   - un gel collé à une remise à zéro n'échappe pas à la mesure (les deux histogrammes) ;
 *   - l'alerte, par un faux minuteur : rien sous la durée, UN message au passage, rien tant
 *     que ça dure, une résolution quand la boucle revient, par opsFail/opsOk.
 *
 * Les gels mesurés sont des bornes BASSES seulement : la machine des tests est partagée,
 * une charge voisine ne peut qu'allonger un intervalle, jamais le raccourcir.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LOOP_BLOCK_ALERT_KEY,
  LOOP_BLOCK_ALERT_MS,
  LOOP_BLOCK_ALERT_SNAPSHOTS,
  LOOP_LAG_RESOLUTION_MS,
  LOOP_LAG_ROTATE_MS,
  loopLagHealth,
  rotateLoopLagWindow,
  startLoopLagMonitor,
  stopLoopLagMonitor,
  timeBackgroundTask,
  type LoopHistogram,
} from './loop-lag.js';
import { getStatsDB } from './db.js';

/** Occupe la boucle `ms` millisecondes, sans jamais lui rendre la main. */
function block(ms: number): void {
  const until = performance.now() + ms;
  while (performance.now() < until) {
    /* gel voulu */
  }
}

/** Laisse la boucle tourner : au moins trois passages de la mesure. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LOOP_LAG_RESOLUTION_MS * 3));
}

afterEach(() => {
  stopLoopLagMonitor();
  vi.useRealTimers();
});

describe('la mesure réelle (perf_hooks.monitorEventLoopDelay)', () => {
  it('sans mesure démarrée, /health lit trois null', () => {
    expect(loopLagHealth()).toEqual({ p99_ms: null, max_ms: null, window_s: null });
  });

  it('un gel de 200 ms se lit : max_ms >= 200', async () => {
    startLoopLagMonitor();
    await settle();
    block(200);
    await settle();
    const lag = loopLagHealth();
    expect(lag.max_ms).not.toBeNull();
    expect(lag.max_ms as number).toBeGreaterThanOrEqual(200);
    expect(typeof lag.p99_ms).toBe('number');
    expect(typeof lag.window_s).toBe('number');
  });

  it('un gel collé à une remise à zéro se lit au relevé suivant', async () => {
    startLoopLagMonitor();
    await settle();
    rotateLoopLagWindow();
    // Aucun passage de la boucle entre la remise à zéro et le gel : Node jette le premier
    // intervalle qui suit un reset(), un histogramme seul ne verrait rien.
    block(200);
    await settle();
    const next = rotateLoopLagWindow();
    expect(next?.max_ms as number).toBeGreaterThanOrEqual(200);
    expect(loopLagHealth().max_ms as number).toBeGreaterThanOrEqual(200);
  });
});

/** Un histogramme factice, en nanosecondes comme celui de Node. */
function fakeHistogram(state: { maxMs: number }): LoopHistogram {
  return {
    get count() {
      return 100;
    },
    get max() {
      return state.maxMs * 1e6;
    },
    percentile: () => 12 * 1e6,
    reset: () => undefined,
    enable: () => true,
    disable: () => true,
  };
}

describe('l’alerte de blocage, par un faux minuteur', () => {
  const ENV = {
    tok: process.env.TELEGRAM_BOT_TOKEN,
    chat: process.env.TELEGRAM_CHAT_ID,
    off: process.env.OPS_ALERTS_DISABLED,
  };
  let sent: string[] = [];

  beforeEach(() => {
    sent = [];
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '42';
    delete process.env.OPS_ALERTS_DISABLED;
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      sent.push((JSON.parse(init.body) as { text: string }).text);
      return { ok: true, status: 200 } as Response;
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    try {
      getStatsDB()
        .prepare('DELETE FROM kv_state WHERE key LIKE ?')
        .run(`ops:%:${LOOP_BLOCK_ALERT_KEY}`);
    } catch {
      /* table absente : rien à nettoyer */
    }
    for (const [k, v] of [
      ['TELEGRAM_BOT_TOKEN', ENV.tok],
      ['TELEGRAM_CHAT_ID', ENV.chat],
      ['OPS_ALERTS_DISABLED', ENV.off],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** Un relevé du faux minuteur, puis les promesses d'opsFail/opsOk. */
  async function nextSnapshot(): Promise<void> {
    await vi.advanceTimersByTimeAsync(LOOP_LAG_ROTATE_MS);
    await new Promise((resolve) => setImmediate(resolve));
  }

  it('une alerte par épisode, au bout de la durée, refermée seule', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    const state = { maxMs: LOOP_BLOCK_ALERT_MS + 500 };
    startLoopLagMonitor({ createHistogram: () => fakeHistogram(state) });
    timeBackgroundTask('overlay-watch', () => block(5));

    // Sous la durée : on compte, on se tait.
    for (let i = 1; i < LOOP_BLOCK_ALERT_SNAPSHOTS; i++) await nextSnapshot();
    expect(sent).toEqual([]);
    expect(loopLagHealth()).toEqual({
      p99_ms: 12,
      max_ms: LOOP_BLOCK_ALERT_MS + 500,
      window_s: 60,
    });

    // Au relevé qui atteint la durée : un message, technique.
    await nextSnapshot();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain(LOOP_BLOCK_ALERT_KEY);
    expect(sent[0]).toContain(`${LOOP_BLOCK_ALERT_MS + 500} ms`);

    // Tant que ça dure : rien de plus.
    await nextSnapshot();
    await nextSnapshot();
    expect(sent).toHaveLength(1);

    // La boucle revient : la résolution part, une fois.
    state.maxMs = 15;
    await nextSnapshot();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatch(/résolu/);
    await nextSnapshot();
    expect(sent).toHaveLength(2);
  });

  it('un gel isolé, vu par deux relevés, ne réveille personne', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    const state = { maxMs: 2_100 };
    startLoopLagMonitor({ createHistogram: () => fakeHistogram(state) });
    await nextSnapshot();
    await nextSnapshot();
    state.maxMs = 15;
    for (let i = 0; i < LOOP_BLOCK_ALERT_SNAPSHOTS; i++) await nextSnapshot();
    expect(sent).toEqual([]);
  });

  it('la tâche de fond la plus longue de la fenêtre est nommée dans l’alerte', async () => {
    vi.useFakeTimers({
      toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'],
    });
    const state = { maxMs: LOOP_BLOCK_ALERT_MS * 3 };
    startLoopLagMonitor({ createHistogram: () => fakeHistogram(state) });
    for (let i = 1; i < LOOP_BLOCK_ALERT_SNAPSHOTS; i++) await nextSnapshot();
    timeBackgroundTask('retention', () => block(20));
    await nextSnapshot();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatch(/retention, \d+ ms/);
  });
});
