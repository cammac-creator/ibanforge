/**
 * Le disjoncteur contre la base : armement, dégradation, remontée, journal.
 *
 * 🚨 CE FICHIER EST LE SEUL GARDE-FOU CONTRE LE MODE DE PANNE LE PLUS PROBABLE
 * DE CE LOT : une chaîne `kv_state` qui dérive d'un caractère, ou un
 * `markShieldBirth` appelé par préfixe. Dans les deux cas, la clé sort bien au
 * plafond réduit, la réponse HTTP est juste, aucun test de comportement ne
 * rougit — et pourtant le radar reste en cadence de paix, la remontée
 * automatique ne trouve plus personne, et la dégradation devient définitive.
 * Les assertions ci-dessous lisent donc la BASE, jamais seulement la réponse.
 *
 * FABRICATION DES FIXTURES : par SQL direct pour les lignes de naissance,
 * jamais par la route. Deux obstacles rendent la route inutilisable pour ces
 * volumes — une deuxième clé pour la même adresse dans les 24 h est refusée, et
 * le handler plafonne les créations par réseau et par jour. La forme de la
 * rafale suffit.
 *
 * 🚨 DÉPÔT PUBLIC : aucune vraie adresse IP, aucune vraie adresse e-mail, aucun
 * chiffre d'activité réelle. Les réseaux sont des chaînes inventées suffixées
 * par l'horodatage du run ; les volumes sont des multiples des constantes du
 * code, pas des relevés.
 *
 * 🚨 PATRON DES GARDES D'ENVIRONNEMENT : sauvegarder, poser, restaurer DANS LE
 * TEST. Jamais dans `test/hermetic-stats.ts` ni dans un `setupFiles` — un
 * drapeau posé globalement ferait passer au vert des tests qui n'exercent plus
 * la branche annoncée, et rien ne le signalerait.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { getStatsDB } from './db.js';
import { kvGet } from './forum-radar-server.js';
import {
  evaluateBreakerOnCreation,
  sweepBreaker,
  readBreakerState,
  readCreations,
  countRecentCreations,
  isBreakerArmed,
  listTransitions,
  forceDisarm,
  revocationEnabled,
  BREAKER_THRESHOLD,
  BREAKER_CALM_MINUTES,
  BREAKER_EPISODE_MAX_HOURS,
  BREAKER_BLIND_STREAK,
  KV_BLIND_STREAK,
} from './creation-breaker.js';
import { markShieldBirth, undegradeEpisode, generateApiKey, claimKey } from './api-keys.js';
import { createVerificationChallenge, keyCreationSource } from './key-creation-guard.js';
import { getTrialDaily, resetDailyLedgerStatements } from './daily-ip-ledger.js';
import { apiKeys } from '../routes/api-keys.js';
import { Hono } from 'hono';
import {
  KV_SHIELD_ARMED,
  KV_SHIELD_ARMED_AT,
  KV_SHIELD_EPISODE_ID,
  isShieldArmed,
  shieldArmedAtMs,
  shieldEpisodeId,
} from './shield-state.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT, SHIELD_MONTHLY_LIMIT } from './tiers.js';
import { BREAKER_MIN_DISTINCT_SOURCES, UNKNOWN_SOURCE, toSqliteUtc } from './cohort-radar.js';

const RUN = String(Date.now());

/**
 * La FORME de la ferme rejouée : beaucoup de créations, dans la même heure,
 * depuis presque autant de réseaux qu'il y a de clés.
 *
 * Les deux nombres sont dérivés des constantes du code, jamais d'un relevé
 * d'activité réelle : la seule chose que le test a besoin de savoir est
 * « largement au-dessus du seuil » et « largement au-dessus de la diversité
 * exigée ». Écrire les chiffres de l'incident dans un dépôt public serait une
 * fuite, et les relier aux constantes rend le test juste même si un seuil bouge.
 */
const FARM_KEYS = BREAKER_THRESHOLD * 16;
const FARM_SOURCES = BREAKER_MIN_DISTINCT_SOURCES * 32;

/** Un instant de référence, pour que rien ne dépende de l'heure du run. */
const T = new Date('2026-09-15T12:00:00.000Z');

function at(minutes: number): Date {
  return new Date(T.getTime() + minutes * 60_000);
}

/** Une ligne de naissance, à une minute donnée avant `T`. */
function creation(ipHash: string, minutesBefore: number): void {
  getStatsDB()
    .prepare(
      'INSERT INTO key_creations (ip_hash, user_agent, key_prefix, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(
      ipHash,
      'demo-http-client/1.0',
      `ifk_${randomBytes(4).toString('hex')}`,
      toSqliteUtc(T.getTime() - minutesBefore * 60_000),
    );
}

/** La rafale : `keys` créations réparties sur `sources` réseaux, dans la fenêtre. */
function farm(keys = FARM_KEYS, sources = FARM_SOURCES): void {
  for (let i = 0; i < keys; i++) {
    // Réparties dans la demi-heure qui précède T : toutes dans la fenêtre.
    creation(`net-${RUN}-${i % sources}`, (i % 30) + 1);
  }
}

/** Une clé en base, avec le palier et les colonnes qu'on veut lui donner. */
function mint(opts: {
  tier?: 'anonymous' | 'email' | 'claimed' | 'paid';
  monthlyLimit?: number | null;
  episode?: string | null;
  noRecredit?: 0 | 1;
  claimedAt?: string | null;
  active?: 0 | 1;
}): { prefix: string; hash: string } {
  const raw = `ifk_${randomBytes(24).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  getStatsDB()
    .prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, monthly_limit, tier, shield_episode,
                             no_recredit, claimed_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      hash,
      prefix,
      opts.tier === 'anonymous' || opts.tier === undefined
        ? 'anonymous'
        : `owner-${prefix}@alpha.example.net`,
      opts.monthlyLimit === undefined ? ANONYMOUS_MONTHLY_LIMIT : opts.monthlyLimit,
      opts.tier ?? 'anonymous',
      opts.episode ?? null,
      opts.noRecredit ?? 0,
      opts.claimedAt ?? null,
      opts.active ?? 1,
    );
  return { prefix, hash };
}

function keyRow(hash: string): {
  monthly_limit: number | null;
  no_recredit: number;
  shield_episode: string | null;
} {
  return getStatsDB()
    .prepare('SELECT monthly_limit, no_recredit, shield_episode FROM api_keys WHERE key_hash = ?')
    .get(hash) as {
    monthly_limit: number | null;
    no_recredit: number;
    shield_episode: string | null;
  };
}

/** Table rase : la fenêtre est GLOBALE, deux scénarios se fusionneraient. */
function reset(): void {
  const db = getStatsDB();
  // 🚨 `kv_state` est créée PARESSEUSEMENT, au premier accès clé-valeur : sur
  // une base de test neuve elle n'existe pas encore, et un DELETE dessus jette
  // « no such table ». Une lecture suffit à la faire exister.
  kvGet(KV_SHIELD_ARMED);
  db.prepare('DELETE FROM key_creations').run();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM key_revocations').run();
  db.prepare('DELETE FROM cohort_relabels').run();
  db.prepare('DELETE FROM breaker_transitions').run();
  db.prepare("DELETE FROM kv_state WHERE key LIKE 'creation_breaker:%'").run();
  db.prepare("DELETE FROM kv_state WHERE key = 'cohort_scan_due'").run();
  db.prepare('DELETE FROM trial_daily').run();
  // 🚨 Le registre de l'essai met ses requêtes en cache : après un DELETE,
  // c'est la seule façon de ne pas relire un état préparé sur l'ancien contenu.
  resetDailyLedgerStatements();
}

let envBefore: string | undefined;

beforeEach(() => {
  envBefore = process.env.IBANFORGE_BREAKER_DISABLED;
  delete process.env.IBANFORGE_BREAKER_DISABLED;
  reset();
});

afterEach(() => {
  if (envBefore === undefined) delete process.env.IBANFORGE_BREAKER_DISABLED;
  else process.env.IBANFORGE_BREAKER_DISABLED = envBefore;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Le compteur
// ---------------------------------------------------------------------------

describe('le compteur agrégé', () => {
  it('compte la fenêtre, et RIEN au-delà', () => {
    creation(`in-${RUN}-a`, 10);
    creation(`in-${RUN}-b`, 59);
    creation(`out-${RUN}-c`, 61);
    const reading = readCreations(T);
    expect(reading.count).toBe(2);
    expect(reading.distinctSources).toBe(2);
    expect(countRecentCreations(T)).toBe(2);
  });

  it('la sentinelle compte dans le VOLUME, jamais dans la diversité', () => {
    // 🚨 Le seau `unknown` est partagé par tous les chemins de frappe sans
    // empreinte réseau. Le compter comme un réseau distinct permettrait à une
    // source unique d'emprunter un chemin sans empreinte pour gonfler la
    // diversité, c'est-à-dire d'armer le bouclier depuis une seule machine.
    for (let i = 0; i < 20; i++) creation(UNKNOWN_SOURCE, 5);
    creation(`real-${RUN}-1`, 5);
    creation(`real-${RUN}-2`, 5);
    const reading = readCreations(T);
    expect(reading.count).toBe(22);
    expect(reading.distinctSources).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// L'armement, et le contrat avec le lot 6
// ---------------------------------------------------------------------------

describe('l’armement', () => {
  it('la rafale arme, et le journal porte la bascule', () => {
    farm();
    const st = evaluateBreakerOnCreation(T);
    expect(st.armed).toBe(true);
    expect(st.episode_id).toBe(T.toISOString());

    const rows = listTransitions();
    expect(rows).toHaveLength(1);
    expect(rows[0].direction).toBe('armed');
    expect(rows[0].reason).toBe('threshold');
    // `'creations'` est le seul déclencheur écrit ; `'claims'` et `'trial'`
    // restent RÉSERVÉS, et le jour où ils arriveront ce test dira lequel.
    expect(rows[0].trigger).toBe('creations');
    expect(rows[0].creations_in_window).toBe(FARM_KEYS);
    expect(rows[0].distinct_sources).toBe(FARM_SOURCES);
    expect(rows[0].threshold).toBe(BREAKER_THRESHOLD);
    expect(rows[0].episode_id).toBe(st.episode_id);
  });

  it('LE CONTRAT : les trois chaînes que le lot 6 lit, telles qu’il les lit', () => {
    // 🚨 L'assertion la plus importante du fichier. `shield-state.ts` (lot 6)
    // n'a AUCUN repli : si ce lot écrivait une autre forme — un objet JSON sous
    // une clé unique, par exemple — le radar resterait visiblement en cadence
    // de paix, sans erreur nulle part, exactement le jour d'un épisode.
    farm();
    const st = evaluateBreakerOnCreation(T);
    expect(kvGet(KV_SHIELD_ARMED)).toBe('1');
    expect(kvGet(KV_SHIELD_ARMED_AT)).toBe(st.armed_at);
    expect(kvGet(KV_SHIELD_EPISODE_ID)).toBe(st.episode_id);
    // Et vu depuis le lecteur du lot 6, sans passer par ce module.
    expect(isShieldArmed()).toBe(true);
    expect(shieldEpisodeId()).toBe(st.episode_id);
    expect(shieldArmedAtMs()).toBe(T.getTime());
  });

  it('l’armement réclame le premier scan du radar sans le lancer lui-même', () => {
    // Un scan lancé ici s'exécuterait dans le handler de l'inscription : le
    // pilote SQLite est synchrone, donc un `void` devant lui ne diffère rien.
    farm();
    evaluateBreakerOnCreation(T);
    expect(kvGet('cohort_scan_due')).toBe('1');
  });

  it('l’état survit à la relecture', () => {
    farm();
    evaluateBreakerOnCreation(T);
    expect(readBreakerState().armed).toBe(true);
    expect(isBreakerArmed()).toBe(true);
  });

  it('30 créations depuis trop peu de réseaux n’arment pas, et ne journalisent rien', () => {
    farm(BREAKER_THRESHOLD * 3, BREAKER_MIN_DISTINCT_SOURCES - 1);
    const st = evaluateBreakerOnCreation(T);
    expect(st.armed).toBe(false);
    expect(listTransitions()).toHaveLength(0);
    expect(kvGet(KV_SHIELD_ARMED)).toBeUndefined();
  });

  it('un gros volume noyé dans la sentinelle n’arme pas', () => {
    for (let i = 0; i < BREAKER_THRESHOLD * 2; i++) creation(UNKNOWN_SOURCE, 5);
    farm(BREAKER_THRESHOLD, BREAKER_MIN_DISTINCT_SOURCES - 1);
    const st = evaluateBreakerOnCreation(T);
    expect(st.armed).toBe(false);
  });

  it('la ferme LENTE passe, et le test le CONSTATE au lieu de le cacher', () => {
    // ⚠️ Stratégie silencieuse, assumée par écrit : sous le seuil, étalée sur
    // des heures, elle n'arme jamais. Le figer ici évite qu'on la redécouvre un
    // jour de panne en croyant à une régression.
    for (let i = 0; i < BREAKER_THRESHOLD - 1; i++) creation(`slow-${RUN}-${i}`, 5 + i);
    expect(evaluateBreakerOnCreation(T).armed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// La naissance sous bouclier
// ---------------------------------------------------------------------------

describe('la naissance sous bouclier', () => {
  it('le plafond réduit, le drapeau anti-recharge ET l’épisode sont écrits', () => {
    // 🚨 Un test qui ne vérifierait que `monthly_limit = 5` serait VERT dans le
    // cas cassé où l'appel se fait par préfixe : la clé sortirait bien au
    // plafond réduit (il vient d'ailleurs) mais sans `no_recredit` ni épisode,
    // donc elle se rechargerait tous les mois à 5 et serait invisible à la
    // remontée. Les trois colonnes se lisent, pas une.
    farm();
    const st = evaluateBreakerOnCreation(T);
    const k = mint({ monthlyLimit: SHIELD_MONTHLY_LIMIT });
    markShieldBirth({ keyHash: k.hash, episodeId: st.episode_id });
    const row = keyRow(k.hash);
    expect(row.monthly_limit).toBe(SHIELD_MONTHLY_LIMIT);
    expect(row.no_recredit).toBe(1);
    expect(row.shield_episode).toBe(st.episode_id);
  });

  it('une clé PAYANTE née sous alerte n’est pas touchée', () => {
    // Les rails payants ne passent pas par le chemin de frappe libre : aucune
    // ligne `key_creations`, aucun passage au disjoncteur. Une rafale d'achats
    // n'est pas un abus.
    farm();
    evaluateBreakerOnCreation(T);
    const paid = mint({ tier: 'paid', monthlyLimit: 10_000, claimedAt: '2026-09-15 11:00:00' });
    const row = keyRow(paid.hash);
    expect(row.monthly_limit).toBe(10_000);
    expect(row.no_recredit).toBe(0);
    expect(row.shield_episode).toBe(null);
  });

  it('une clé frappée hors dégradation garde le plafond de son palier', () => {
    const k = generateApiKey(null, undefined, undefined, false, { ipHash: `peace-${RUN}` });
    expect(k).not.toBeNull();
    const row = keyRow(k!.key_hash);
    expect(row.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(row.shield_episode).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Le désarmement et la remontée
// ---------------------------------------------------------------------------

describe('le désarmement', () => {
  it('le balayage désarme un épisode calme, même sans trafic, et le journal grandit', () => {
    farm();
    const st = evaluateBreakerOnCreation(T);
    expect(st.armed).toBe(true);
    // Plus aucune création : la fenêtre s'est vidée d'elle-même.
    getStatsDB().prepare('DELETE FROM key_creations').run();
    const after = sweepBreaker(at(BREAKER_CALM_MINUTES));
    expect(after.armed).toBe(false);
    const rows = listTransitions();
    expect(rows).toHaveLength(2);
    expect(rows[0].direction).toBe('disarmed');
    expect(rows[0].reason).toBe('calm');
    // Et les trois clés du contrat sont RETIRÉES, pas vidées : le lot 6 attend
    // `null`, et une chaîne vide lui rendrait `''`.
    expect(kvGet(KV_SHIELD_ARMED)).toBeUndefined();
    expect(kvGet(KV_SHIELD_EPISODE_ID)).toBeUndefined();
    expect(shieldEpisodeId()).toBe(null);
    expect(shieldArmedAtMs()).toBe(null);
  });

  it('au-delà de la borne, il désarme ALORS QUE LE TRAFIC DÉPASSE TOUJOURS', () => {
    farm();
    evaluateBreakerOnCreation(T);
    // La rafale continue, les lignes restent dans la fenêtre de T+3h01.
    for (let i = 0; i < FARM_KEYS; i++) {
      creation(`late-${RUN}-${i % FARM_SOURCES}`, -(BREAKER_EPISODE_MAX_HOURS * 60) + 1);
    }
    const after = sweepBreaker(at(BREAKER_EPISODE_MAX_HOURS * 60 + 1));
    expect(after.armed).toBe(false);
    expect(listTransitions()[0].reason).toBe('capped');
  });

  it('la remontée rend le palier de CHAQUE clé, et laisse les clés nommées', () => {
    farm();
    const st = evaluateBreakerOnCreation(T);
    const episode = st.episode_id as string;

    const anon = mint({ monthlyLimit: SHIELD_MONTHLY_LIMIT, episode, noRecredit: 1 });
    const mail = mint({
      tier: 'email',
      monthlyLimit: SHIELD_MONTHLY_LIMIT,
      episode,
      noRecredit: 1,
    });
    // Une clé que le radar a NOMMÉE : elle reste dégradée.
    const cut = mint({ monthlyLimit: SHIELD_MONTHLY_LIMIT, episode, noRecredit: 1 });
    getStatsDB()
      .prepare(
        `INSERT INTO key_revocations (key_prefix, key_hash, reason, episode_id, anchor, anchor_share,
                                      anchor_keys, burst_from, burst_to, burst_keys, window_minutes,
                                      distinct_sources, prev_active, prev_monthly_limit,
                                      prev_units_used, prev_no_recredit)
         VALUES (?, ?, 'anon_burst', ?, 'ua:demo-http-client/1.0', 0.9, 3,
                 '2026-09-15T11:58:00.000Z', '2026-09-15T11:59:00.000Z', 3, 0.5, 5, 1, ?, 0, 1)`,
      )
      .run(cut.prefix, cut.hash, episode, SHIELD_MONTHLY_LIMIT);

    getStatsDB().prepare('DELETE FROM key_creations').run();
    const after = sweepBreaker(at(BREAKER_CALM_MINUTES));
    expect(after.armed).toBe(false);

    // 🚨 Le palier rendu dépend du palier de la clé. Une constante unique
    // rétrograderait silencieusement la clé à adresse du palier gratuit au
    // palier de départ, et ni la réponse ni le journal ne le diraient.
    expect(keyRow(anon.hash).monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(keyRow(mail.hash).monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(keyRow(anon.hash).no_recredit).toBe(0);
    expect(keyRow(anon.hash).shield_episode).toBe(null);
    // La nommée reste à son plafond réduit, et garde son épisode.
    expect(keyRow(cut.hash).monthly_limit).toBe(SHIELD_MONTHLY_LIMIT);
    expect(keyRow(cut.hash).shield_episode).toBe(episode);

    expect(listTransitions()[0].undegraded).toBe(2);
  });

  it('une clé relabellisée par le radar reste dégradée, elle aussi', () => {
    const episode = T.toISOString();
    const k = mint({ tier: 'email', monthlyLimit: SHIELD_MONTHLY_LIMIT, episode, noRecredit: 1 });
    getStatsDB()
      .prepare(
        "INSERT INTO cohort_relabels (key_prefix, old_email, address) VALUES (?, 'x', 'cohort')",
      )
      .run(k.prefix);
    expect(undegradeEpisode(episode)).toBe(0);
    // `all: true` est la voie du faux positif relu : elle rend tout.
    expect(undegradeEpisode(episode, { all: true })).toBe(1);
    expect(keyRow(k.hash).monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
  });

  it('une clé RÉCLAMÉE n’est plus dans le lot : la réclamation efface la dégradation', () => {
    // `claimKey` remet le palier gratuit, efface `no_recredit` ET l'épisode.
    // Une clé promue ne doit donc être ni remontée ni comptée deux fois.
    const episode = T.toISOString();
    const k = mint({
      tier: 'claimed',
      monthlyLimit: FREE_TIER_MONTHLY_LIMIT,
      episode: null,
      claimedAt: '2026-09-15 12:05:00',
    });
    expect(undegradeEpisode(episode)).toBe(0);
    expect(keyRow(k.hash).monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
  });

  it('une clé inactive n’est pas remontée : son état d’avant vit dans le journal', () => {
    const episode = T.toISOString();
    mint({ monthlyLimit: SHIELD_MONTHLY_LIMIT, episode, noRecredit: 1, active: 0 });
    expect(undegradeEpisode(episode, { all: true })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Les minutes sous alerte, portées au registre de l'essai
// ---------------------------------------------------------------------------

describe('les minutes sous alerte', () => {
  function shieldMinutes(day: string): number {
    return getTrialDaily(30).find((r) => r.day === day)?.shield_minutes ?? 0;
  }

  const DAY = T.toISOString().slice(0, 10);

  it('chaque balayage porte les minutes ÉCOULÉES, sans les recompter', () => {
    // 🚨 Cette ligne est la base de mesure d'un réglage encore ouvert : le
    // plafond de l'essai sous alerte, qui n'a pas de valeur possible avant
    // d'être mesuré. Un compteur qui recompterait depuis l'armement à chaque
    // tick la gonflerait à chaque passage, et personne ne le verrait — d'où le
    // repère qui avance exactement de ce qui a été crédité.
    farm();
    evaluateBreakerOnCreation(T);
    expect(shieldMinutes(DAY)).toBe(0);
    sweepBreaker(at(10));
    expect(shieldMinutes(DAY)).toBe(10);
    sweepBreaker(at(25));
    expect(shieldMinutes(DAY)).toBe(25);
  });

  it('en paix, rien ne s’écrit', () => {
    sweepBreaker(at(10));
    expect(shieldMinutes(DAY)).toBe(0);
  });

  it('un trou long est BORNÉ par la durée maximale d’un épisode', () => {
    // Un service arrêté une nuit ne doit pas créditer huit heures d'alerte à un
    // épisode qui ne peut pas durer plus que sa borne : une ligne empoisonnée
    // est pire qu'une ligne manquante.
    farm();
    evaluateBreakerOnCreation(T);
    sweepBreaker(at(48 * 60));
    expect(shieldMinutes(DAY)).toBeLessThanOrEqual(BREAKER_EPISODE_MAX_HOURS * 60);
  });
});

// ---------------------------------------------------------------------------
// L'interrupteur de crise
// ---------------------------------------------------------------------------

describe('IBANFORGE_BREAKER_DISABLED', () => {
  it('pendant un épisode ARMÉ, il DÉSARME — il ne rend pas seulement « non armé »', () => {
    // 🚨 Les trois assertions de ce cas sont indissociables. Un interrupteur
    // qui se contenterait de rendre `false` sans écrire laisserait
    // `creation_breaker:armed` à `'1'`, donc `isShieldArmed()` — que ce lot ne
    // peut pas modifier — continuerait de rendre vrai indéfiniment : radar en
    // cadence d'alerte, rayon borné sur un `armed_at` fantôme, et un état
    // irréversible sauf appel d'administration. L'interrupteur nommé « sortie
    // de crise » aurait laissé tourner ce qu'il devait arrêter.
    farm();
    expect(evaluateBreakerOnCreation(T).armed).toBe(true);
    process.env.IBANFORGE_BREAKER_DISABLED = '1';
    const st = evaluateBreakerOnCreation(at(1));
    expect(st.armed).toBe(false);
    expect(isShieldArmed()).toBe(false);
    expect(listTransitions()[0].reason).toBe('env');
  });

  it('le balayage sait désarmer sous interrupteur, même sans création', () => {
    farm();
    evaluateBreakerOnCreation(T);
    process.env.IBANFORGE_BREAKER_DISABLED = '1';
    expect(sweepBreaker(at(1)).armed).toBe(false);
    expect(isShieldArmed()).toBe(false);
  });

  it('en paix, il n’arme jamais — mais la MESURE continue', () => {
    process.env.IBANFORGE_BREAKER_DISABLED = '1';
    farm();
    expect(evaluateBreakerOnCreation(T).armed).toBe(false);
    // On garde la mesure sans l'effet : sinon l'épisode suivant se déciderait
    // sur une ligne de base qu'on n'a pas relevée.
    expect(countRecentCreations(T)).toBe(FARM_KEYS);
    expect(listTransitions()).toHaveLength(0);
  });

  it('il éteint aussi la révocation, quel que soit son propre opt-in', () => {
    const revBefore = process.env.IBANFORGE_REVOCATION_ENABLED;
    try {
      process.env.IBANFORGE_REVOCATION_ENABLED = '1';
      expect(revocationEnabled()).toBe(true);
      process.env.IBANFORGE_BREAKER_DISABLED = '1';
      expect(revocationEnabled()).toBe(false);
    } finally {
      if (revBefore === undefined) delete process.env.IBANFORGE_REVOCATION_ENABLED;
      else process.env.IBANFORGE_REVOCATION_ENABLED = revBefore;
    }
  });

  it('la révocation part ÉTEINTE, sans variable posée', () => {
    const revBefore = process.env.IBANFORGE_REVOCATION_ENABLED;
    try {
      delete process.env.IBANFORGE_REVOCATION_ENABLED;
      expect(revocationEnabled()).toBe(false);
    } finally {
      if (revBefore !== undefined) process.env.IBANFORGE_REVOCATION_ENABLED = revBefore;
    }
  });
});

// ---------------------------------------------------------------------------
// Les pannes de mesure
// ---------------------------------------------------------------------------

/**
 * Rend le COMPTEUR illisible, et lui seul.
 *
 * 🚨 Pas un mock de `prepare` qui jette sur tout : une base entièrement muette
 * rendrait `kv_state` illisible AUSSI, donc l'état ne pourrait plus être relu,
 * et le test ne prouverait plus rien de ce qu'il vise. Ce qu'on simule ici est
 * la panne réelle et étroite — l'agrégat sur `key_creations` qui n'aboutit pas
 * alors que l'état, lui, se lit encore.
 */
function withUnreadableCounter<T>(fn: () => T): T {
  const db = getStatsDB();
  db.exec('ALTER TABLE key_creations RENAME TO key_creations_hidden');
  try {
    return fn();
  } finally {
    db.exec('ALTER TABLE key_creations_hidden RENAME TO key_creations');
  }
}

describe('la mesure en panne', () => {
  it('un épisode armé RESTE armé quand la mesure échoue', () => {
    // 🚨 « Ne pas dégrader sur une panne » ne veut pas dire « désarmer ». Rendre
    // un état vide ferait naître à plein tarif, en plein épisode, la clé de
    // l'instant où une lecture échoue — et l'échec serait indistinguable d'une
    // heure calme pour qui que ce soit.
    farm();
    evaluateBreakerOnCreation(T);
    const st = withUnreadableCounter(() => evaluateBreakerOnCreation(at(1)));
    expect(st.armed).toBe(true);
    expect(isShieldArmed()).toBe(true);
  });

  it('trois échecs d’affilée font crier la sonde, une réussite la calme', () => {
    farm();
    evaluateBreakerOnCreation(T);
    withUnreadableCounter(() => {
      for (let i = 0; i < BREAKER_BLIND_STREAK; i++) evaluateBreakerOnCreation(at(i + 1));
    });
    expect(readBreakerState().blind_streak).toBe(BREAKER_BLIND_STREAK);
    expect(Number(kvGet(KV_BLIND_STREAK))).toBe(BREAKER_BLIND_STREAK);
    // Une mesure réussie remet le compteur à zéro : la sonde n'est pas
    // collante, sinon elle crierait pour une seconde occupée d'il y a six mois.
    evaluateBreakerOnCreation(at(10));
    expect(readBreakerState().blind_streak).toBe(0);
    expect(kvGet(KV_BLIND_STREAK)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Le désarmement à la main
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// La route de création, sous alerte
// ---------------------------------------------------------------------------

describe('POST /v1/keys/generate sous alerte', () => {
  function app(): Hono {
    const a = new Hono();
    a.route('/', apiKeys);
    return a;
  }

  /**
   * Arme l'alerte comme la route la verra.
   *
   * 🚨 L'horloge n'est pas injectable depuis un handler HTTP : la route appelle
   * `evaluateBreakerOnCreation()` sans argument. Les lignes de naissance sont
   * donc posées relativement à MAINTENANT, et l'état est armé par un premier
   * passage avant que la requête ne parte.
   */
  function armNow(): string {
    for (let i = 0; i < FARM_KEYS; i++) {
      getStatsDB()
        .prepare(
          'INSERT INTO key_creations (ip_hash, user_agent, key_prefix, created_at) VALUES (?, ?, ?, ?)',
        )
        .run(
          `net-${RUN}-${i % FARM_SOURCES}`,
          'demo-http-client/1.0',
          `ifk_${randomBytes(4).toString('hex')}`,
          toSqliteUtc(Date.now() - 60_000),
        );
    }
    const st = evaluateBreakerOnCreation();
    expect(st.armed).toBe(true);
    return st.episode_id as string;
  }

  it('la clé anonyme naît au plafond réduit, et la base porte son épisode', async () => {
    const episode = armNow();
    const res = await app().request('/v1/keys/generate', { method: 'POST' });
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.tier).toBe('anonymous');
    expect(json.monthly_limit).toBe(SHIELD_MONTHLY_LIMIT);
    // 🚨 AUCUN champ `shield` : le plafond servi est déjà un oracle, et un
    // booléen de plus n'ajouterait rien qu'une surface à maintenir. Le `notice`
    // dit le plafond et le chemin pour le relever, jamais la rafale.
    expect(json).not.toHaveProperty('shield');
    expect(String(json.notice)).toContain(String(SHIELD_MONTHLY_LIMIT));
    expect(String(json.notice)).not.toMatch(/burst|abuse|rafale/i);

    const row = getStatsDB()
      .prepare(
        'SELECT monthly_limit, no_recredit, shield_episode FROM api_keys WHERE key_prefix = ?',
      )
      .get(json.key_prefix) as {
      monthly_limit: number;
      no_recredit: number;
      shield_episode: string;
    };
    expect(row.monthly_limit).toBe(SHIELD_MONTHLY_LIMIT);
    expect(row.no_recredit).toBe(1);
    expect(row.shield_episode).toBe(episode);
  });

  it('une clé à adresse NON vérifiée est dégradée elle aussi', async () => {
    // 🚨 C'est tout l'enjeu du prédicat. Le code à six chiffres n'est exigé
    // qu'à partir de la DEUXIÈME clé d'un réseau : la première part avec une
    // adresse non vérifiée, au palier gratuit. Une ferme montée sur un parc de
    // réseaux neufs n'emprunte que ce chemin. Un prédicat écrit sur le palier
    // anonyme laisserait passer la ferme entière.
    armNow();
    const res = await app().request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `owner-${RUN}@alpha-corp.example.net` }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.tier).toBe('email');
    expect(json.monthly_limit).toBe(SHIELD_MONTHLY_LIMIT);
  });

  it('une boîte PROUVÉE à la naissance échappe à la dégradation', async () => {
    // Le réseau a déjà une clé de la semaine, donc la route exige le code ;
    // avec le bon code, `claimed_at` est posé À LA NAISSANCE, et le prédicat
    // `claimed_at IS NULL` ne vise plus cette clé.
    armNow();
    const ip = '198.51.100.77';
    const source = keyCreationSource(ip) as string;
    getStatsDB()
      .prepare(
        'INSERT INTO key_creations (ip_hash, user_agent, key_prefix, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(
        source,
        'demo-http-client/1.0',
        `ifk_${randomBytes(4).toString('hex')}`,
        toSqliteUtc(Date.now() - 3_600_000),
      );
    const email = `proven-${RUN}@alpha-corp.example.net`;
    const challenge = createVerificationChallenge(email, source);
    expect(typeof challenge).toBe('string');

    const res = await app().request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
      body: JSON.stringify({ email, code: challenge as string }),
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(json).not.toHaveProperty('notice');
    const row = getStatsDB()
      .prepare(
        'SELECT claimed_at, claim_method, no_recredit, shield_episode FROM api_keys WHERE key_prefix = ?',
      )
      .get(json.key_prefix) as {
      claimed_at: string | null;
      claim_method: string | null;
      no_recredit: number;
      shield_episode: string | null;
    };
    expect(row.claimed_at).not.toBeNull();
    expect(row.claim_method).toBe('email_code');
    expect(row.no_recredit).toBe(0);
    expect(row.shield_episode).toBe(null);
  });

  it('la réclamation efface la dégradation, et la remontée ne la revoit plus', async () => {
    const episode = armNow();
    const res = await app().request('/v1/keys/generate', { method: 'POST' });
    const json = (await res.json()) as { api_key: string; key_prefix: string };
    const hash = createHash('sha256').update(json.api_key).digest('hex');

    expect(claimKey(hash, 'email_code', { email: `claimer-${RUN}@alpha.example.net` })).toBe(true);
    const row = keyRow(hash);
    expect(row.monthly_limit).toBe(FREE_TIER_MONTHLY_LIMIT);
    expect(row.no_recredit).toBe(0);
    expect(row.shield_episode).toBe(null);
    // Et le lot de l'épisode ne la contient plus : pas de double promotion.
    expect(undegradeEpisode(episode, { all: true })).toBe(0);
  });

  it('sous interrupteur de crise, la route rend le plafond du palier', async () => {
    armNow();
    process.env.IBANFORGE_BREAKER_DISABLED = '1';
    const res = await app().request('/v1/keys/generate', { method: 'POST' });
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
    expect(json).not.toHaveProperty('notice');
    expect(isShieldArmed()).toBe(false);
  });
});

describe('forceDisarm', () => {
  it('rend la liberté, remonte le lot et journalise le geste', () => {
    farm();
    const st = evaluateBreakerOnCreation(T);
    const k = mint({
      monthlyLimit: SHIELD_MONTHLY_LIMIT,
      episode: st.episode_id,
      noRecredit: 1,
    });
    const after = forceDisarm('disarmed_manual', at(5));
    expect(after.armed).toBe(false);
    expect(listTransitions()[0].reason).toBe('manual');
    expect(keyRow(k.hash).monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
  });

  it('sans épisode en cours, il ne journalise rien', () => {
    expect(forceDisarm('disarmed_manual', T).armed).toBe(false);
    expect(listTransitions()).toHaveLength(0);
  });
});
