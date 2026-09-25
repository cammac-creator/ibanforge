import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notifyOps, sendOpsMessage } from './ops-alert.js';

/**
 * Ce qu'un envoi sur le canal d'exploitation a pu constater : une réponse de
 * Telegram (statut) ou aucune (`null`). Le résumé du lundi ne retente qu'un
 * refus explicite ; une coupure a pu laisser arriver le message. `notifyOps`
 * reste la forme booléenne du même envoi. Rien ne part vers Telegram : `fetch`
 * est simulé, le jeton est factice.
 */
const ENV = {
  tok: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
  off: process.env.OPS_ALERTS_DISABLED,
};

beforeEach(() => {
  process.env.TELEGRAM_BOT_TOKEN = 'jeton-factice';
  process.env.TELEGRAM_CHAT_ID = 'canal-factice';
  delete process.env.OPS_ALERTS_DISABLED;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const [name, value] of [
    ['TELEGRAM_BOT_TOKEN', ENV.tok],
    ['TELEGRAM_CHAT_ID', ENV.chat],
    ['OPS_ALERTS_DISABLED', ENV.off],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('sendOpsMessage', () => {
  it('dit le statut quand Telegram a répondu, accepté ou refusé', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200 }) as Response);
    expect(await sendOpsMessage('essai')).toEqual({ sent: true, httpStatus: 200 });
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 429 }) as Response);
    expect(await sendOpsMessage('essai')).toEqual({ sent: false, httpStatus: 429 });
  });

  it('ne dit aucun statut quand la réponse n’est pas revenue', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('connexion coupée');
    });
    expect(await sendOpsMessage('essai')).toEqual({ sent: false, httpStatus: null });
  });

  it('ne dit aucun statut quand le canal est absent ou coupé, sans rien envoyer', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    process.env.OPS_ALERTS_DISABLED = '1';
    expect(await sendOpsMessage('essai')).toEqual({ sent: false, httpStatus: null });
    delete process.env.OPS_ALERTS_DISABLED;
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await sendOpsMessage('essai')).toEqual({ sent: false, httpStatus: null });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('laisse notifyOps rendre la même chose en booléen', async () => {
    vi.stubGlobal('fetch', async () => ({ ok: true, status: 200 }) as Response);
    expect(await notifyOps('essai')).toBe(true);
    vi.stubGlobal('fetch', async () => ({ ok: false, status: 500 }) as Response);
    expect(await notifyOps('essai')).toBe(false);
  });
});
