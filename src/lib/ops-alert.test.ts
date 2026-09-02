/**
 * La machine à états de l'alerting — la seule chose qui empêche une sonde de
 * devenir du bruit.
 *
 * Dix alertes par jour, et au bout d'une semaine plus personne n'en lit une
 * seule. Tout le design tient donc sur trois règles, et ce fichier les garde :
 *
 * 1. **On alerte sur une TRANSITION, jamais sur une condition.** Le message part
 *    au passage du seuil d'échecs consécutifs, et UNE SEULE FOIS tant que
 *    l'alerte reste ouverte.
 * 2. **La guérison se dit.** Sans le « ✅ », un silence retrouvé est
 *    indistinguable d'une sonde morte. Mais on n'annonce jamais la résolution
 *    d'une alerte que personne n'a reçue.
 * 3. **Une alerte non partie reste à envoyer.** Telegram muet ou fenêtre
 *    anti-tempête fermée : le prochain tick réessaie, il ne perd pas l'alerte.
 *
 * Les clés utilisées ici sont synthétiques (`e5test:*`) : ce module écrit dans
 * la vraie `kv_state`, et un test qui toucherait `ops:beat:refresh-bic` ferait
 * mentir l'homme mort de la prochaine session.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  opsFail,
  opsOk,
  notifyOps,
  checkHeartbeats,
  HEARTBEATS,
  RADAR_BEATS,
} from './ops-alert.js';
import { kvGet, kvSet } from './forum-radar-server.js';
import { getStatsDB } from './db.js';

let sent: string[] = [];
const ENV = {
  tok: process.env.TELEGRAM_BOT_TOKEN,
  chat: process.env.TELEGRAM_CHAT_ID,
  off: process.env.OPS_ALERTS_DISABLED,
};

/** Une clé neuve par test : aucune interférence, aucun état hérité. */
let KEY = '';

function telegramUp(ok = true): void {
  vi.stubGlobal('fetch', async (url: string) => {
    sent.push(String(url));
    return { ok, status: ok ? 200 : 500 } as Response;
  });
}

beforeEach(() => {
  sent = [];
  KEY = `e5test:${Math.random().toString(36).slice(2, 10)}`;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token';
  process.env.TELEGRAM_CHAT_ID = '42';
  delete process.env.OPS_ALERTS_DISABLED;
  telegramUp();
});

afterEach(() => {
  vi.unstubAllGlobals();
  // Les clés synthétiques ne survivent pas au test qui les a créées : sans ça,
  // chaque exécution de la suite laisserait deux lignes de plus dans kv_state.
  try {
    getStatsDB().prepare("DELETE FROM kv_state WHERE key LIKE 'ops:%:e5test:%'").run();
  } catch {
    /* la table n'existe pas encore : rien à nettoyer */
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

describe('opsFail — le message part au seuil, et une seule fois', () => {
  it('se tait sous le seuil, parle au passage, puis se tait tant que ça dure', async () => {
    await opsFail(KEY, 'détail', 3);
    await opsFail(KEY, 'détail', 3);
    expect(sent, "l'alerte est partie avant son seuil").toHaveLength(0);

    await opsFail(KEY, 'détail', 3);
    expect(sent, "l'alerte n'est pas partie au passage du seuil").toHaveLength(1);

    // Le point entier : la panne dure, la sonde ne répète pas.
    await opsFail(KEY, 'détail', 3);
    await opsFail(KEY, 'détail', 3);
    expect(
      sent,
      'la sonde répète son alerte à chaque tick — exactement le bruit à éviter',
    ).toHaveLength(1);
  });

  it('avec un seuil de 1, parle au premier échec', async () => {
    await opsFail(KEY, 'détail');
    expect(sent).toHaveLength(1);
  });
});

describe('opsOk — la guérison se dit, mais seulement si quelqu’un a vu la panne', () => {
  it('annonce la résolution après une alerte reçue', async () => {
    await opsFail(KEY, 'détail');
    expect(sent).toHaveLength(1);
    await opsOk(KEY, 'a repointé');
    expect(
      sent,
      'aucune ligne de résolution — un problème réglé et une sonde morte se ressemblent alors',
    ).toHaveLength(2);
  });

  it('ne dit rien quand rien ne s’était déclenché', async () => {
    await opsOk(KEY);
    expect(sent).toHaveLength(0);
  });

  it('ne dit rien pour une alerte comptée mais jamais émise', async () => {
    // Deux échecs sur un seuil de 3 : le compteur a bougé, personne n'a été
    // prévenu. Annoncer « résolu » ici parlerait d'un problème inconnu.
    await opsFail(KEY, 'détail', 3);
    await opsFail(KEY, 'détail', 3);
    await opsOk(KEY);
    expect(sent).toHaveLength(0);
  });

  it('ré-arme la sonde : après guérison, la panne suivante réalerte', async () => {
    await opsFail(KEY, 'détail');
    await opsOk(KEY);
    expect(sent).toHaveLength(2);
    // …mais la fenêtre anti-tempête tient toujours (voir le bloc suivant).
    await opsFail(KEY, 'détail');
    expect(sent, 'la deuxième alerte a percé la fenêtre de 6 h').toHaveLength(2);
    // Fenêtre écoulée : la même panne peut de nouveau parler.
    kvSet(`ops:sent:${KEY}`, String(Date.now() - 7 * 3600_000));
    await opsOk(KEY);
    await opsFail(KEY, 'détail');
    expect(sent).toHaveLength(3);
  });
});

describe('une alerte qui n’est pas partie reste à envoyer', () => {
  it('Telegram muet : le prochain tick réessaie au lieu de perdre l’alerte', async () => {
    telegramUp(false); // Telegram répond 500
    await opsFail(KEY, 'détail');
    expect(sent).toHaveLength(1); // tentée
    telegramUp(true);
    await opsFail(KEY, 'détail');
    expect(
      sent,
      "l'alerte a été considérée comme émise alors que Telegram l'avait refusée",
    ).toHaveLength(2);
  });

  it('secrets absents : ne jette pas, ne prétend pas avoir envoyé', async () => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect(await notifyOps('coucou')).toBe(false);
    await expect(opsFail(KEY, 'détail')).resolves.toBeUndefined();
  });

  it('OPS_ALERTS_DISABLED=1 étouffe l’envoi sans casser la sonde', async () => {
    process.env.OPS_ALERTS_DISABLED = '1';
    expect(await notifyOps('coucou')).toBe(false);
    expect(sent).toHaveLength(0);
  });
});

describe('homme mort — un cron muet finit par crier, un cron vivant se tait', () => {
  it('alerte quand un battement se périme, et se tait quand il repointe', async () => {
    const cron = HEARTBEATS.find((h) => h.name === 'refresh-bic');
    if (!cron) throw new Error('refresh-bic absent de HEARTBEATS');
    const beatKey = `ops:beat:${cron.name}`;
    const alertKey = `heartbeat:${cron.name}`;
    const savedBeat = kvGet(beatKey);
    const savedState = kvGet(`ops:state:${alertKey}`);
    const savedSent = kvGet(`ops:sent:${alertKey}`);

    try {
      /**
       * 🚨 Les comptes ci-dessous portent sur TOUT ce que la sonde a envoyé,
       * alors que `checkHeartbeats()` parcourt CHAQUE cron et CHAQUE radar.
       * Ne remettre à neuf que `refresh-bic` laissait donc les autres décider
       * du résultat : sur une base locale où plus rien ne bat, ils alertaient
       * au premier passage — le compte montait et le test échouait — puis se
       * taisaient aux suivants, puisque l'alerte se déclenche sur une
       * TRANSITION et qu'ils étaient désormais ouverts. D'où un test qui
       * échouait une fois puis passait : la pire forme d'échec, celle qu'on
       * apprend à relancer au lieu de lire.
       *
       * Ce passage à vide les fait toutes transiter une bonne fois. Après lui,
       * seule notre sonde peut encore parler. On ne touche aucun battement
       * étranger : en fabriquer un ferait mentir l'homme mort de la prochaine
       * session, ce que l'en-tête de ce fichier interdit.
       */
      await checkHeartbeats();
      sent.length = 0;

      // Repartir d'une sonde neuve, sinon l'état d'une session précédente décide.
      kvSet(`ops:state:${alertKey}`, JSON.stringify({ fails: 0, firing: false }));
      kvSet(`ops:sent:${alertKey}`, '0');

      // Le cron n'a pas tourné depuis bien plus que son seuil.
      kvSet(beatKey, String(Date.now() - cron.maxAgeMs - 3600_000));
      await checkHeartbeats();
      expect(sent, "un cron périmé n'a réveillé personne").toHaveLength(1);

      // Il repointe : la sonde annonce la résolution, puis se tait.
      kvSet(beatKey, String(Date.now()));
      await checkHeartbeats();
      expect(sent, 'aucune ligne de résolution après le retour du cron').toHaveLength(2);
      await checkHeartbeats();
      expect(sent, 'la sonde parle alors que tout va bien').toHaveLength(2);
    } finally {
      if (savedBeat === undefined) kvSet(beatKey, String(Date.now()));
      else kvSet(beatKey, savedBeat);
      kvSet(`ops:state:${alertKey}`, savedState ?? JSON.stringify({ fails: 0, firing: false }));
      kvSet(`ops:sent:${alertKey}`, savedSent ?? '0');
    }
  });

  it('les radars sont LUS, jamais écrits — la sonde ne peut pas fabriquer un battement', () => {
    // C'est la contrainte de conception la plus importante du design B3 : leur
    // faire écrire un SECOND horodatage du même fait créerait deux états qui
    // peuvent diverger, et l'homme mort se mettrait à confirmer la vie d'un
    // radar mort. Les clés lues sont donc celles que les radars écrivent déjà.
    expect(RADAR_BEATS.map((r) => r.key).sort()).toEqual([
      'cohort_radar_last_run',
      'forum_radar_last_scan_at',
      'lifecycle_radar_state',
      'prospect_radar_last_run',
    ]);
    // Et leurs formes de stockage ne sont pas les mêmes : celle du lifecycle est
    // un objet JSON, les trois autres des chaînes ISO nues. Uniformiser côté
    // sonde reviendrait à réécrire l'état des radars.
    const lifecycle = RADAR_BEATS.find((r) => r.key === 'lifecycle_radar_state');
    expect(lifecycle?.parse('{"last_run_at":"2026-08-20T10:00:00.000Z"}')).toBe(
      Date.parse('2026-08-20T10:00:00.000Z'),
    );
    const cohort = RADAR_BEATS.find((r) => r.key === 'cohort_radar_last_run');
    expect(cohort?.parse('2026-08-20T10:00:00.000Z')).toBe(Date.parse('2026-08-20T10:00:00.000Z'));
  });

  it('une clé de radar illisible ne fait ni crier ni tomber la sonde', async () => {
    // Au premier démarrage rien n'a pointé, et une clé peut être corrompue.
    // Dans les deux cas la bonne réponse est le SILENCE : alerter sur toute la
    // liste d'un coup est la meilleure façon de faire couper les alertes le
    // jour même, et inventer un battement serait mentir sur un run qui n'a pas
    // eu lieu. `parse` a le droit de jeter (celui du lifecycle fait un
    // JSON.parse) — c'est checkHeartbeats qui doit encaisser.
    const radar = RADAR_BEATS.find((r) => r.key === 'lifecycle_radar_state');
    if (!radar) throw new Error('lifecycle_radar_state absent de RADAR_BEATS');
    expect(() => radar.parse('pas du JSON')).toThrow();

    const saved = kvGet(radar.key);
    try {
      kvSet(radar.key, 'pas du JSON');
      await expect(checkHeartbeats()).resolves.toBeUndefined();
      expect(sent, 'une clé illisible a produit une alerte').toHaveLength(0);
    } finally {
      if (saved === undefined)
        kvSet(radar.key, JSON.stringify({ last_run_at: new Date().toISOString() }));
      else kvSet(radar.key, saved);
    }
  });
});
