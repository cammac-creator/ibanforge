/**
 * La décision du disjoncteur, PURE et sans base (lot 5).
 *
 * Tout passe par `decideBreaker(reading, prev, now)` : aucune horloge lue,
 * aucune table touchée. C'est ce qui rend ces cas reproductibles, et c'est ce
 * qui permet de tester des heures qu'on ne peut pas attendre (T + 3 h 01).
 *
 * 🚨 CE FICHIER GARDE TROIS CORRECTIFS DE DÉFAUT, pas trois conforts :
 *   - la clause de DIVERSITÉ, sans laquelle cinq machines détruisent le palier
 *     de départ pour tout le monde ;
 *   - la BORNE DE DURÉE, sans laquelle un attaquant entretient l'alerte pour le
 *     prix de quelques créations par heure ;
 *   - la FRONTIÈRE DES DATES SQLite, qui ne rougit dans aucun autre test : une
 *     fenêtre décalée d'un fuseau arme ou désarme au mauvais moment, en
 *     silence.
 *
 * Ne jamais relâcher une assertion de ce fichier en `toBeGreaterThanOrEqual`
 * pour la faire passer : chacune est une frontière, et une frontière molle ne
 * garde rien.
 */

import { describe, it, expect } from 'vitest';
import {
  decideBreaker,
  windowFloorSql,
  BREAKER_THRESHOLD,
  BREAKER_CALM_MINUTES,
  BREAKER_EPISODE_MAX_HOURS,
  type BreakerState,
} from './creation-breaker.js';
import { BREAKER_MIN_DISTINCT_SOURCES, BREAKER_WINDOW_MINUTES } from './cohort-radar.js';

const T = new Date('2026-09-15T12:00:00.000Z');

function at(minutes: number): Date {
  return new Date(T.getTime() + minutes * 60_000);
}

const PEACE: BreakerState = {
  armed: false,
  episode_id: null,
  armed_at: null,
  last_exceeded_at: null,
  disarmed_at: null,
  blind_streak: 0,
};

/** Un épisode armé à `T`, avec son dernier dépassement à `T + exceededAt`. */
function armedAt(exceededAtMinutes = 0): BreakerState {
  return {
    armed: true,
    episode_id: T.toISOString(),
    armed_at: T.toISOString(),
    last_exceeded_at: at(exceededAtMinutes).toISOString(),
    disarmed_at: null,
    blind_streak: 0,
  };
}

describe('decideBreaker — le seuil', () => {
  it("juste sous le seuil, rien ne s'arme", () => {
    const out = decideBreaker({ count: BREAKER_THRESHOLD - 1, distinctSources: 9 }, PEACE, T);
    expect(out.next.armed).toBe(false);
    expect(out.transition).toBe(null);
    expect(out.changed).toBe(false);
  });

  it("au seuil exact, l'alerte s'arme et l'épisode porte son instant", () => {
    const out = decideBreaker({ count: BREAKER_THRESHOLD, distinctSources: 9 }, PEACE, T);
    expect(out.transition).toBe('armed');
    expect(out.next.armed).toBe(true);
    // L'identifiant d'un épisode EST son instant d'armement : pas de table de
    // correspondance à tenir entre `api_keys.shield_episode` et le journal.
    expect(out.next.episode_id).toBe(T.toISOString());
    expect(out.next.armed_at).toBe(T.toISOString());
    expect(out.next.last_exceeded_at).toBe(T.toISOString());
    expect(out.next.disarmed_at).toBe(null);
  });

  it('un dépassement de plus repousse la sortie sans franchir de transition', () => {
    const out = decideBreaker(
      { count: BREAKER_THRESHOLD + 1, distinctSources: 9 },
      armedAt(0),
      at(10),
    );
    expect(out.next.armed).toBe(true);
    expect(out.transition).toBe(null);
    // `changed` est RENDU par la décision : rester armé en repoussant la sortie
    // est un changement d'état à persister, alors qu'aucune bascule n'a lieu.
    expect(out.changed).toBe(true);
    expect(out.next.last_exceeded_at).toBe(at(10).toISOString());
  });
});

describe('decideBreaker — la clause de diversité', () => {
  it("un gros volume depuis trop peu de réseaux n'arme PAS", () => {
    // 🚨 Le test du défaut le plus coûteux du module : sans cette clause, le
    // plafond de trois clés par réseau et par jour permet à quelques machines
    // de poser assez de créations pour armer l'alerte, et toute clé honnête de
    // l'heure suivante naît dégradée POUR LA VIE. Il échoue immédiatement si
    // quelqu'un « simplifie » le compteur en COUNT(*) nu.
    const out = decideBreaker(
      { count: BREAKER_THRESHOLD * 3, distinctSources: BREAKER_MIN_DISTINCT_SOURCES - 1 },
      PEACE,
      T,
    );
    expect(out.next.armed).toBe(false);
    expect(out.transition).toBe(null);
  });

  it('au seuil de diversité exact, il arme', () => {
    const out = decideBreaker(
      { count: BREAKER_THRESHOLD * 3, distinctSources: BREAKER_MIN_DISTINCT_SOURCES },
      PEACE,
      T,
    );
    expect(out.transition).toBe('armed');
  });

  it('le volume seul ne suffit pas, la diversité seule non plus', () => {
    const volumeOnly = decideBreaker(
      { count: BREAKER_THRESHOLD, distinctSources: BREAKER_MIN_DISTINCT_SOURCES - 1 },
      PEACE,
      T,
    );
    const diversityOnly = decideBreaker(
      { count: BREAKER_THRESHOLD - 1, distinctSources: BREAKER_MIN_DISTINCT_SOURCES + 40 },
      PEACE,
      T,
    );
    expect(volumeOnly.transition).toBe(null);
    expect(diversityOnly.transition).toBe(null);
  });
});

describe('decideBreaker — la sortie d’alerte', () => {
  it("juste avant la fin du calme, l'alerte tient", () => {
    const out = decideBreaker(
      { count: 0, distinctSources: 0 },
      armedAt(0),
      at(BREAKER_CALM_MINUTES - 1),
    );
    expect(out.next.armed).toBe(true);
    expect(out.transition).toBe(null);
    expect(out.changed).toBe(false);
  });

  it('au terme du calme, elle retombe', () => {
    const out = decideBreaker(
      { count: 0, distinctSources: 0 },
      armedAt(0),
      at(BREAKER_CALM_MINUTES),
    );
    expect(out.transition).toBe('disarmed');
    expect(out.next.armed).toBe(false);
    expect(out.next.disarmed_at).toBe(at(BREAKER_CALM_MINUTES).toISOString());
  });

  it('le calme se compte depuis le DERNIER dépassement, pas depuis l’armement', () => {
    // Dernier dépassement à T+30 : à T+60, seules 30 minutes de calme ont couru.
    const out = decideBreaker(
      { count: 0, distinctSources: 0 },
      armedAt(30),
      at(BREAKER_CALM_MINUTES),
    );
    expect(out.next.armed).toBe(true);
    expect(out.transition).toBe(null);
  });

  it('un dernier dépassement illisible rend la liberté, il ne l’enferme pas', () => {
    const corrupt = { ...armedAt(0), last_exceeded_at: 'pas-une-date' };
    const out = decideBreaker({ count: 0, distinctSources: 0 }, corrupt, at(1));
    expect(out.transition).toBe('disarmed');
  });

  it('deux dépassements séparés par plus que le calme donnent DEUX épisodes', () => {
    const first = decideBreaker({ count: BREAKER_THRESHOLD, distinctSources: 9 }, PEACE, T);
    const quiet = decideBreaker(
      { count: 0, distinctSources: 0 },
      first.next,
      at(BREAKER_CALM_MINUTES),
    );
    const second = decideBreaker(
      { count: BREAKER_THRESHOLD, distinctSources: 9 },
      quiet.next,
      at(BREAKER_CALM_MINUTES + 10),
    );
    expect(quiet.transition).toBe('disarmed');
    expect(second.transition).toBe('armed');
    expect(second.next.episode_id).not.toBe(first.next.episode_id);
  });
});

describe('decideBreaker — la borne de durée', () => {
  it('juste avant la borne, l’épisode tient malgré le dépassement', () => {
    const out = decideBreaker(
      { count: BREAKER_THRESHOLD * 5, distinctSources: 40 },
      armedAt(0),
      at(BREAKER_EPISODE_MAX_HOURS * 60 - 1),
    );
    expect(out.next.armed).toBe(true);
    expect(out.transition).toBe(null);
  });

  it('au-delà de la borne, il se désarme ALORS QUE LE DÉPASSEMENT CONTINUE', () => {
    // 🚨 C'est le test du défaut « alerte perpétuelle ». Un état armé qui
    // dégrade tous les nouveaux venus sans borne de durée est un déni de
    // service que l'attaquant entretient à quelques créations par heure : la
    // borne est ce qui transforme un blocage en cycle, et un cycle se voit.
    const out = decideBreaker(
      { count: BREAKER_THRESHOLD * 5, distinctSources: 40 },
      armedAt(0),
      at(BREAKER_EPISODE_MAX_HOURS * 60 + 1),
    );
    expect(out.transition).toBe('disarmed_capped');
    expect(out.next.armed).toBe(false);
  });

  it('la borne passe AVANT le dépassement, jamais après', () => {
    // Le dépassement, évalué d'abord, aurait repoussé la sortie sans fin.
    const out = decideBreaker(
      { count: BREAKER_THRESHOLD, distinctSources: BREAKER_MIN_DISTINCT_SOURCES },
      armedAt(BREAKER_EPISODE_MAX_HOURS * 60),
      at(BREAKER_EPISODE_MAX_HOURS * 60),
    );
    expect(out.transition).toBe('disarmed_capped');
  });

  it('un armed_at illisible retire la borne, mais le calme désarme quand même', () => {
    const corrupt = { ...armedAt(0), armed_at: 'pas-une-date' };
    const tenu = decideBreaker({ count: 0, distinctSources: 0 }, corrupt, at(1));
    expect(tenu.next.armed).toBe(true);
    const leve = decideBreaker({ count: 0, distinctSources: 0 }, corrupt, at(BREAKER_CALM_MINUTES));
    expect(leve.transition).toBe('disarmed');
  });
});

describe('windowFloorSql — la frontière des dates SQLite', () => {
  /**
   * 🚨 LE PIÈGE QUE CE BLOC GARDE, ET QUI NE ROUGIT NULLE PART AILLEURS.
   *
   * `datetime('now')` écrit « YYYY-MM-DD HH:MM:SS » en UTC, SANS zone. Une
   * borne de fenêtre fabriquée avec un formateur LOCAL (getHours, ou n'importe
   * quel `toLocale*`) tombe alors du décalage de la machine : la fenêtre de
   * soixante minutes en couvre quatorze heures de trop ou de moins, le
   * disjoncteur arme ou désarme au mauvais moment, et aucune assertion de
   * comportement ne le voit.
   *
   * Les deux cas ci-dessous se complètent : le premier fige la forme attendue,
   * le second la vérifie sous un fuseau volontairement lointain — le seul
   * moyen qu'un runner déjà réglé sur UTC ne rende pas la garde muette.
   */
  it('rend la borne en UTC, au format exact de SQLite', () => {
    const floor = windowFloorSql(new Date('2026-09-15T00:30:00.000Z'), BREAKER_WINDOW_MINUTES);
    expect(floor).toBe('2026-09-14 23:30:00');
    // Ni « T » ni « Z » : la colonne comparée ne les porte pas non plus.
    expect(floor).not.toContain('T');
    expect(floor).not.toContain('Z');
  });

  it('ne glisse pas quand la machine est loin d’UTC', () => {
    const before = process.env.TZ;
    try {
      // UTC+14 : un formateur local daterait la borne du LENDEMAIN.
      process.env.TZ = 'Pacific/Kiritimati';
      expect(windowFloorSql(new Date('2026-09-15T00:30:00.000Z'), BREAKER_WINDOW_MINUTES)).toBe(
        '2026-09-14 23:30:00',
      );
      // UTC-10 : il la daterait de treize heures trop tôt.
      process.env.TZ = 'Pacific/Honolulu';
      expect(windowFloorSql(new Date('2026-09-15T00:30:00.000Z'), BREAKER_WINDOW_MINUTES)).toBe(
        '2026-09-14 23:30:00',
      );
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });

  it('la fenêtre par défaut est celle du radar, pas une copie locale', () => {
    const now = new Date('2026-09-15T12:00:00.000Z');
    expect(windowFloorSql(now)).toBe(windowFloorSql(now, BREAKER_WINDOW_MINUTES));
    expect(BREAKER_CALM_MINUTES).toBe(BREAKER_WINDOW_MINUTES);
  });
});
