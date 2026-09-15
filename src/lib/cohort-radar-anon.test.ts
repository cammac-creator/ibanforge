/**
 * Rejeu des fermes, des contournements, et des cas honnêtes — passe anonyme.
 *
 * 🚨 CE FICHIER EST LE SEUL GARDE-FOU CONTRE LE MODE DE PANNE LE PLUS PROBABLE
 * DE CE CHANTIER : un chargeur anonyme recopié depuis la passe e-mail rend zéro
 * ligne, le radar reste vert, le rapport dit `anon_scanned: 0` comme il le dirait
 * un jour calme, et aucun test existant ne rougit. Les rejeux ci-dessous
 * échouent immédiatement dans ce cas.
 *
 * FABRICATION DES FIXTURES : par SQL direct, jamais par la route. Deux obstacles
 * rendent la route inutilisable pour ces volumes — une deuxième clé pour la même
 * adresse dans les 24 h est refusée, et le handler plafonne les créations par
 * réseau et par jour.
 *
 * 🚨 DÉPÔT PUBLIC : aucune vraie adresse IP, aucune vraie adresse e-mail, aucun
 * chiffre d'activité réelle. Les fermes se rejouent par leur FORME — une cadence,
 * un nombre de réseaux, une chaîne d'en-tête — avec des valeurs inventées et
 * suffixées par l'horodatage du run.
 *
 * 🚨 PATRON DES VARIABLES D'ENVIRONNEMENT : sauvegarder, poser, restaurer DANS
 * LE TEST. Jamais dans `test/hermetic-stats.ts` ni dans un `setupFiles`, qui ne
 * pose aujourd'hui que `STATS_DB_PATH`. Motif : un opt-in posé globalement ferait
 * passer au vert des tests qui n'exercent plus la branche annoncée, et aucun test
 * ne le signalerait.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { getStatsDB } from './db.js';
import { kvSet } from './forum-radar-server.js';
import {
  runCohortScan,
  cutCohortNow,
  trustedAnchors,
  type CohortRadarReport,
} from './cohort-radar-server.js';
import {
  revokeForBurst,
  listKeyRevocations,
  burstRevocationFor,
  type BurstRevocationInput,
} from './key-revocations.js';
import { KEY_REVOKED_BURST_DETAIL } from '../middleware/api-key.js';
import { ANON_ANCHOR_MIN_KEYS, BREAKER_MIN_DISTINCT_SOURCES, toSqliteUtc } from './cohort-radar.js';
import { ANONYMOUS_CONTACT, ANONYMOUS_MONTHLY_LIMIT, CLAIM_REPAIR_LANDED } from './tiers.js';
import { KV_SHIELD_ARMED, KV_SHIELD_ARMED_AT, KV_SHIELD_EPISODE_ID } from './shield-state.js';

const RUN = Date.now();

// ---------------------------------------------------------------------------
// Le schéma exigé des lots sœurs. Une dépendance se rend VISIBLE par un test qui
// échoue bruyamment et NOMME ce qui manque, jamais par un `it.skip` muet.
// ---------------------------------------------------------------------------

const COLS = (
  getStatsDB().prepare('PRAGMA table_info(api_keys)').all() as Array<{ name: string }>
).map((c) => c.name);
const TABLES = (
  getStatsDB().prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{
    name: string;
  }>
).map((t) => t.name);
const MISSING = [
  ...['tier', 'claimed_at', 'claim_method', 'origin_prefix', 'shield_episode'].filter(
    (c) => !COLS.includes(c),
  ),
  // 🚨 La liste ne nomme PAS `x402_settled_minor` : cette colonne n'existe dans
  // aucune spec. L'autorité sur ce qui a été réglé est la TABLE key_settlements.
  // Sans cette correction, la CI serait rouge en désignant le mauvais remède, et
  // l'implémenteur ajouterait une cinquième autorité sur le montant payé.
  ...['key_settlements', 'key_revocations'].filter((t) => !TABLES.includes(t)),
];
const READY = MISSING.length === 0;

it('le schéma exigé des lots sœurs est en place', () => {
  expect(
    READY,
    `schéma incomplet (manque : ${MISSING.join(', ')}) : les rejeux ne vérifient rien`,
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Fabrication et nettoyage
// ---------------------------------------------------------------------------

interface Minted {
  prefix: string;
  hash: string;
}

let minted: Minted[] = [];

/**
 * Frappe une clé de test et sa ligne de naissance, sans passer par la route.
 *
 * 🚨 `email` vaut la sentinelle `ANONYMOUS_CONTACT`, jamais NULL :
 * `api_keys.email` est `TEXT NOT NULL`. Écrire NULL ici produit
 * « NOT NULL constraint failed » au premier fixture, et plus aucun rejeu ne
 * tourne jamais.
 */
function mint(opts: {
  ua: string | null;
  ipHash: string;
  atMs: number;
  tier?: 'anonymous' | 'claimed' | 'paid';
  limit?: number | null;
  noRecredit?: 0 | 1;
  claimedAt?: string | null;
  claimMethod?: string | null;
  settlements?: number[];
  creditsRemaining?: number | null;
  issuedByUs?: 0 | 1;
  email?: string;
  episode?: string | null;
  originPrefix?: string | null;
  active?: 0 | 1;
  writeCreation?: boolean;
}): Minted {
  const raw = `ifk_${randomBytes(32).toString('hex')}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = raw.slice(0, 12);
  const at = toSqliteUtc(opts.atMs);
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, monthly_limit, no_recredit,
                           tier, claimed_at, claim_method, shield_episode, origin_prefix,
                           issued_by_us, credits_remaining, created_at, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hash,
    prefix,
    opts.email ?? ANONYMOUS_CONTACT,
    opts.email ?? ANONYMOUS_CONTACT,
    opts.limit === undefined ? ANONYMOUS_MONTHLY_LIMIT : opts.limit,
    opts.noRecredit ?? 0,
    opts.tier ?? 'anonymous',
    opts.claimedAt ?? null,
    opts.claimMethod ?? null,
    opts.episode ?? null,
    opts.originPrefix ?? null,
    opts.issuedByUs ?? 0,
    opts.creditsRemaining ?? null,
    at,
    opts.active ?? 1,
  );
  // 🚨 La rotation n'écrit AUCUNE ligne de naissance : c'est exactement ce qui
  // faisait sortir une clé tournée du rayon avant `origin_prefix`.
  if (opts.writeCreation !== false) {
    db.prepare(
      'INSERT INTO key_creations (ip_hash, user_agent, key_prefix, created_at) VALUES (?, ?, ?, ?)',
    ).run(opts.ipHash, opts.ua, prefix, at);
  }
  // 🚨 Le règlement va dans key_settlements, PAS dans une colonne d'api_keys.
  for (const [i, usd] of (opts.settlements ?? []).entries()) {
    db.prepare(
      `INSERT INTO key_settlements (key_hash, key_prefix, payment_ref, quoted_amount_usd, route)
       VALUES (?, ?, ?, ?, '/v1/iban/validate')`,
    ).run(hash, prefix, `ref-${prefix}-${i}`, usd);
  }
  minted.push({ prefix, hash });
  return { prefix, hash };
}

/** Consomme des unités, pour que `prev_units_used` ait quelque chose à consigner. */
function useUnits(hash: string, count: number): void {
  getStatsDB()
    .prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)')
    .run(hash, '2026-09', count);
}

/** Une ligne de naissance orpheline, pour donner une HISTOIRE à un réseau. */
function networkHistory(ipHash: string, atMs: number): void {
  getStatsDB()
    .prepare(
      'INSERT INTO key_creations (ip_hash, user_agent, key_prefix, created_at) VALUES (?, ?, ?, ?)',
    )
    .run(ipHash, 'veteran/1.0', `ifk_hist${randomBytes(4).toString('hex')}`, toSqliteUtc(atMs));
}

/**
 * Remet la base et l'état du bouclier à zéro entre deux scénarios.
 *
 * 🚨 Indispensable, et pas par hygiène : la rafale est mesurée GLOBALEMENT sur
 * toutes les lignes anonymes de la fenêtre. Les fixtures d'un scénario resté en
 * base fusionneraient avec celles du suivant en une seule rafale géante, et les
 * assertions de taille deviendraient fausses pour une raison invisible.
 */
function reset(): void {
  const db = getStatsDB();
  for (const k of minted) {
    db.prepare('DELETE FROM api_usage WHERE key_hash = ?').run(k.hash);
    db.prepare('DELETE FROM key_settlements WHERE key_hash = ?').run(k.hash);
    db.prepare('DELETE FROM key_revocations WHERE key_hash = ?').run(k.hash);
    db.prepare('DELETE FROM key_creations WHERE key_prefix = ?').run(k.prefix);
    db.prepare('DELETE FROM api_keys WHERE key_prefix = ? OR origin_prefix = ?').run(
      k.prefix,
      k.prefix,
    );
  }
  db.prepare("DELETE FROM key_creations WHERE user_agent = 'veteran/1.0'").run();
  minted = [];
  disarm();
  kvSet('anon_cohorts_seen', '');
  kvSet('anon_cohorts_notified', '');
}

/** Pose l'état « sous alerte » à la main : le disjoncteur (lot 5) n'existe pas encore. */
function arm(episodeId: string, armedAtMs: number): void {
  kvSet(KV_SHIELD_ARMED, '1');
  kvSet(KV_SHIELD_ARMED_AT, new Date(armedAtMs).toISOString());
  kvSet(KV_SHIELD_EPISODE_ID, episodeId);
}

/**
 * 🚨 Doit TOUJOURS repasser en paix, y compris quand un test échoue : un état
 * armé laissé derrière soi ferait dégrader les clés des autres scénarios, et
 * changerait la borne de leur rayon sans que rien ne le dise.
 */
function disarm(): void {
  kvSet(KV_SHIELD_ARMED, '0');
  kvSet(KV_SHIELD_ARMED_AT, '');
  kvSet(KV_SHIELD_EPISODE_ID, '');
}

/** L'opt-in de révocation, posé et retiré DANS le test qui l'exige. */
function withRevocationEnabled<T>(fn: () => T): T {
  const saved = process.env.IBANFORGE_REVOCATION_ENABLED;
  process.env.IBANFORGE_REVOCATION_ENABLED = '1';
  try {
    return fn();
  } finally {
    if (saved === undefined) delete process.env.IBANFORGE_REVOCATION_ENABLED;
    else process.env.IBANFORGE_REVOCATION_ENABLED = saved;
  }
}

/** Le scan, rejoué à un instant choisi, pour que les fenêtres soient reproductibles. */
async function scan(atMs: number): Promise<CohortRadarReport> {
  return runCohortScan(new Date(atMs));
}

function activeCount(prefixes: string[]): number {
  const marks = prefixes.map(() => '?').join(',');
  return (
    getStatsDB()
      .prepare(`SELECT COUNT(*) AS n FROM api_keys WHERE active = 1 AND key_prefix IN (${marks})`)
      .get(...prefixes) as { n: number }
  ).n;
}

/** N instants régulièrement étalés sur `spanMs`, à partir de `startMs`. */
function spread(count: number, startMs: number, spanMs: number): number[] {
  return Array.from({ length: count }, (_, i) =>
    count === 1 ? startMs : startMs + Math.round((i * spanMs) / (count - 1)),
  );
}

afterAll(() => {
  reset();
});

describe.skipIf(!READY)('rejeu des fermes, passe anonyme', () => {
  afterEach(() => {
    reset();
  });

  // -------------------------------------------------------------------------
  it('ferme 1, mono-IP : vue et nommée par son ancre réseau, jamais coupée toute seule', async () => {
    // Forme du 17/08 : 41 créations en 19 secondes depuis UNE seule adresse, sans
    // chaîne de client. L'ancre `ip:` est ce qui l'empêche de tomber dans un
    // angle mort — sans elle, aucune ancre ne la relie.
    const now = RUN;
    const start = now - 2 * 60 * 1000;
    const ip = `farm17-${RUN}`;
    const keys = spread(41, start, 19_000).map((at) => mint({ ua: null, ipHash: ip, atMs: at }));
    for (const k of keys) useUnits(k.hash, 4);
    arm(`ep-17-${RUN}`, start);

    const report = await withRevocationEnabled(() => scan(now));
    expect(report.anon_scanned).toBe(41);
    expect(report.anon_burst?.keys).toBe(41);

    const line = report.revocations.find((r) => r.anchor === `ip:${ip}`);
    expect(line, "l'ancre secondaire par réseau doit rattraper une ferme mono-IP").toBeDefined();
    expect(line!.candidates).toBe(41);
    expect(line!.keys).toBe(0);
    expect(line!.distinct_sources).toBe(1);
    // 🚨 Un ip_hash unique est AUSSI la signature d'un NAT d'entreprise ou d'un
    // CGNAT d'opérateur : la passe automatique ne coupe pas là-dessus.
    expect(line!.skipped_reason).toBe('below_source_floor');
    expect(activeCount(keys.map((k) => k.prefix))).toBe(41);
    expect(report.anon_revoked).toBe(0);

    // La voie manuelle, elle, coupe : un humain a lu le rapport.
    const cut = await cutCohortNow({ anchor: `ip:${ip}`, now: new Date(now) });
    expect(cut.revoked).toBe(41);
    expect(cut.skipped).toBe(0);
    expect(activeCount(keys.map((k) => k.prefix))).toBe(0);

    const journal = listKeyRevocations({ limit: 1000 });
    expect(journal.total).toBe(41);
    for (const row of journal.rows) {
      expect(row.reason).toBe('anon_burst');
      expect(row.anchor).toBe(`ip:${ip}`);
      expect(row.prev_monthly_limit).toBe(ANONYMOUS_MONTHLY_LIMIT);
      expect(row.prev_units_used).toBe(4);
      expect(row.prev_active).toBe(1);
      expect(row.anchor_keys).toBe(41);
      expect(row.burst_keys).toBe(41);
      expect(row.distinct_sources).toBe(1);
      expect(row.restored_at).toBeNull();
    }
    // Les bornes du journal se comparent à des `created_at` de la MÊME table :
    // même format, donc comparaison de chaînes correcte.
    const bounds = getStatsDB()
      .prepare(
        `SELECT COUNT(*) AS n FROM key_revocations r
           JOIN key_creations c ON c.key_prefix = COALESCE(r.origin_prefix, r.key_prefix)
          WHERE c.created_at BETWEEN r.burst_from AND r.burst_to`,
      )
      .get() as { n: number };
    expect(bounds.n).toBe(41);

    // Idempotence : la clé est déjà coupée, donc hors du chargeur.
    const again = await cutCohortNow({ anchor: `ip:${ip}`, now: new Date(now) });
    expect(again.revoked).toBe(0);
    expect(listKeyRevocations({ limit: 1000 }).total).toBe(41);
  });

  // -------------------------------------------------------------------------
  it('ferme 2, multi-réseaux : 166 créations signalées SANS être coupées', async () => {
    // Forme du 19/08. Le disjoncteur compte ces 166 créations sur sa fenêtre de
    // soixante minutes ; le radar, lui, a des fenêtres bien plus serrées (15 clés
    // en 30 s, 30 en 5 min), donc le rejeu resserre la cadence à ~137 s, qui est
    // la durée réellement observée de cette rafale. Les deux chiffres décrivent
    // le même évènement vu par deux instruments.
    const now = RUN;
    const start = now - 3 * 60 * 1000;
    const ua = `python-requests/2.34.2-test-${RUN}`;
    const at = spread(166, start, 137_000);

    const farm = at.slice(0, 164).map((t, i) => mint({ ua, ipHash: `net-${RUN}-${i}`, atMs: t }));
    for (const k of farm) useUnits(k.hash, 5);

    // Chargée pour l'OBSERVATION (une clé réclamée dans le rayon est exactement
    // ce que l'opérateur doit voir), jamais coupée : c'est l'instruction paire.
    const claimed = mint({
      ua,
      ipHash: `net-${RUN}-claimed`,
      atMs: at[164],
      tier: 'claimed',
      claimedAt: toSqliteUtc(start),
      claimMethod: 'email_code',
      limit: 200,
    });
    // Payer une fois le plus petit règlement du catalogue n'achète pas une
    // immunité permanente : elle reste dans le rayon.
    const tiny = mint({
      ua,
      ipHash: `net-${RUN}-tiny`,
      atMs: at[165],
      claimMethod: 'x402',
      settlements: [0.002],
    });

    // Sept témoins que le CHARGEUR doit écarter : ils ne comptent donc pas dans
    // la rafale, et leur présence prouve chaque clause du WHERE.
    const excluded = [
      mint({ ua, ipHash: `net-${RUN}-cred`, atMs: at[80], creditsRemaining: 1000 }),
      mint({ ua, ipHash: `net-${RUN}-int`, atMs: at[81], email: `smoke-${RUN}@ibanforge.com` }),
      mint({ ua, ipHash: `net-${RUN}-ours`, atMs: at[82], issuedByUs: 1 }),
      mint({
        ua,
        ipHash: `net-${RUN}-paid`,
        atMs: at[83],
        tier: 'paid',
        claimMethod: 'x402',
        claimedAt: toSqliteUtc(start),
        settlements: [1.0],
      }),
      mint({ ua, ipHash: `net-${RUN}-cohort`, atMs: at[84], email: `x-${RUN}@cohorte.invalid` }),
      mint({ ua, ipHash: `net-${RUN}-off`, atMs: at[85], active: 0 }),
      mint({ ua, ipHash: `net-${RUN}-oem`, atMs: at[86], tier: 'paid', limit: 5000 }),
    ];

    // Deux témoins HORS RAYON, dans la fenêtre de chargement : sans eux, le test
    // « hors rayon » passerait pour la mauvaise raison.
    const twelveMin = mint({ ua, ipHash: `net-${RUN}-old12`, atMs: start - 12 * 60 * 1000 });
    const ninetyMin = mint({ ua, ipHash: `net-${RUN}-old90`, atMs: start - 90 * 60 * 1000 });

    arm(`ep-19-${RUN}`, start);
    const report = await scan(now);

    // 166 dans la rafale : les 164 + la réclamée + celle à 0,002 $. Les sept
    // témoins écartés par le chargeur n'y sont pas.
    expect(report.anon_burst?.keys).toBe(166);
    // 167 chargées : les 166 plus la témoin de 12 minutes, qui est DANS la
    // fenêtre de chargement mais HORS des bornes de la rafale. Celle de 90
    // minutes, elle, ne compte même pas : sous alerte, la fenêtre de chargement
    // commence à l'armement moins la fenêtre du disjoncteur, donc elle est
    // écartée par le WHERE. Les deux bornes du rayon sont exercées séparément :
    // celle-ci par le chargeur, la seconde par le test pur de `withinRadius`.
    expect(report.anon_scanned).toBe(167);

    const line = report.revocations.find((r) => r.anchor === `ua:${ua}`)!;
    expect(line.candidates).toBe(166);
    expect(line.anchor_share).toBe(1);
    expect(line.keys).toBe(0);
    // Armé, mais l'opt-in est absent : rapport seul, et le rapport le DIT.
    expect(line.skipped_reason).toBe('revocation_off');
    expect(report.anon_revoked).toBe(0);
    expect(listKeyRevocations().total).toBe(0);

    // La coupe manuelle : 165 tombent, la réclamée est SAUTÉE, et le lot n'est
    // pas annulé pour autant.
    const cut = await cutCohortNow({ anchor: `ua:${ua}`, now: new Date(now) });
    expect(cut.revoked).toBe(165);
    expect(cut.skipped).toBe(1);
    expect(cut.pending).toBe(0);

    expect(activeCount(farm.map((k) => k.prefix))).toBe(0);
    expect(activeCount([tiny.prefix]), 'payer 0,002 $ n’achète pas une immunité').toBe(0);
    expect(activeCount([claimed.prefix]), 'une clé réclamée survit toujours').toBe(1);
    expect(listKeyRevocations({ prefix: claimed.prefix }).total, 'aucune ligne de journal').toBe(0);
    expect(activeCount([twelveMin.prefix]), 'née 12 min avant la rafale, hors rayon').toBe(1);
    expect(
      activeCount([ninetyMin.prefix]),
      'née 90 min avant l’armement, hors fenêtre de chargement',
    ).toBe(1);
    for (const k of excluded) {
      if (k.prefix === excluded[5].prefix) continue; // déjà inactive par construction
      expect(activeCount([k.prefix]), `témoin écarté par le chargeur : ${k.prefix}`).toBe(1);
    }
    expect(listKeyRevocations({ limit: 1000 }).total).toBe(165);
  });

  // -------------------------------------------------------------------------
  it('ferme lente : elle PASSE, et le test le constate au lieu de le cacher', async () => {
    // 🚨 TROU ASSUMÉ PAR ÉCRIT. Sept créations par heure depuis des réseaux
    // différents ne franchissent aucune fenêtre de rafale, donc le radar ne voit
    // rien. C'est la stratégie silencieuse, et elle est rationnelle pour un
    // attaquant patient : elle rapporte le plafond anonyme multiplié par le
    // nombre de clés, sans jamais déclencher.
    //
    // Ce qui la contient n'est PAS ce module : c'est le plafond de créations par
    // réseau et par jour, et la taille du parc de proxys qu'il faut pour le
    // contourner. Baisser les fenêtres pour l'attraper couperait les pics
    // honnêtes, qui sont le seul jour où ce module agit.
    const now = RUN;
    const keys = spread(21, now - 3 * 60 * 60 * 1000, 3 * 60 * 60 * 1000).map((t, i) =>
      mint({ ua: `slow-${RUN}/1.0`, ipHash: `slownet-${RUN}-${i}`, atMs: t }),
    );
    arm(`ep-slow-${RUN}`, now - 3 * 60 * 60 * 1000);

    const report = await withRevocationEnabled(() => scan(now));
    expect(report.anon_scanned).toBe(21);
    expect(report.anon_burst, 'aucune rafale : la cadence reste sous les fenêtres').toBeNull();
    expect(report.revocations).toHaveLength(0);
    expect(activeCount(keys.map((k) => k.prefix))).toBe(21);
  });

  // -------------------------------------------------------------------------
  it('🚨 dilution extrême : 98 chaînes distinctes, la rafale est vue et rien ne peut être coupé', async () => {
    // LE TROU STRUCTUREL, figé ici pour qu'il ne se redécouvre pas un jour de
    // panne. Une ferme qui change de User-Agent à chaque clé forme 98 groupes de
    // 1, tous sous le plancher d'ancre. Le radar ne peut rien : sans ancre il n'y
    // a pas de rayon, et un rayon sans ancre serait la coupe de TOUS les nouveaux
    // venus de la fenêtre — exactement le dommage que ce module existe pour
    // éviter.
    //
    // Le renoncement, chiffré : ces clés gardent leur plafond anonyme tant que le
    // bouclier n'est pas armé, et le plafond dégradé quand il l'est. C'est le
    // DISJONCTEUR qui paie cette ferme, pas le radar, et c'est pourquoi monter le
    // plancher d'ancre en croyant durcir le module le désarmerait.
    const now = RUN;
    const start = now - 60 * 1000;
    const keys = spread(98, start, 29_000).map((t, i) =>
      mint({ ua: `uniq-${RUN}-${i}/1.0`, ipHash: `dilnet-${RUN}-${i}`, atMs: t }),
    );
    arm(`ep-dil-${RUN}`, start);

    const report = await withRevocationEnabled(() => scan(now));
    expect(report.anon_burst?.keys).toBe(98);
    expect(report.revocations).toHaveLength(98);
    for (const line of report.revocations) {
      expect(line.candidates).toBe(1);
      expect(line.keys).toBe(0);
      expect(line.skipped_reason).toBe('below_anchor_floor');
    }
    expect(report.anon_revoked).toBe(0);
    expect(activeCount(keys.map((k) => k.prefix))).toBe(98);
  });

  // -------------------------------------------------------------------------
  it('nouveau venu empoisonné : la garde de diversité et le plancher d’ancre l’épargnent', async () => {
    // L'attaquant déclenche la rafale globale sous sa propre chaîne, puis plante
    // deux clés sous une chaîne générique pour emmener avec elles le premier
    // inconnu qui la porte. C'est l'empoisonnement de cohorte : il est structurel
    // à une ancre que l'appelant choisit, et il est BON MARCHÉ.
    const now = RUN;
    const start = now - 60 * 1000;
    const farmUa = `farm-${RUN}/1.0`;
    const genericUa = `curl/8.7.1-${RUN}`;

    const farm = spread(40, start, 20_000).map((t, i) =>
      mint({ ua: farmUa, ipHash: `poinet-${RUN}-${i}`, atMs: t }),
    );
    const bait = [
      mint({ ua: genericUa, ipHash: `poibait-${RUN}-a`, atMs: start + 9_000 }),
      mint({ ua: genericUa, ipHash: `poibait-${RUN}-b`, atMs: start + 9_500 }),
    ];
    const honest = mint({ ua: genericUa, ipHash: `poihonest-${RUN}`, atMs: start + 10_000 });
    arm(`ep-poison-${RUN}`, start);

    const report = await withRevocationEnabled(() => scan(now));
    expect(report.anon_burst?.keys).toBe(43);
    const generic = report.revocations.find((r) => r.anchor === `ua:${genericUa}`)!;
    // Le plancher d'ancre est atteint (3 clés), mais pas le plancher de réseaux.
    expect(generic.candidates).toBe(ANON_ANCHOR_MIN_KEYS);
    expect(generic.distinct_sources).toBe(3);
    expect(generic.distinct_sources).toBeLessThan(BREAKER_MIN_DISTINCT_SOURCES);
    expect(generic.skipped_reason).toBe('below_source_floor');
    expect(activeCount([honest.prefix]), 'l’honnête isolé survit').toBe(1);
    expect(activeCount(bait.map((k) => k.prefix))).toBe(2);
    // La ferme elle-même, à quarante réseaux, passe la garde de diversité et
    // n'est retenue que par l'absence de réparation par réclamation.
    const farmLine = report.revocations.find((r) => r.anchor === `ua:${farmUa}`)!;
    expect(farmLine.distinct_sources).toBe(40);
    expect(farmLine.skipped_reason).toBe('claim_repair_missing');
    expect(activeCount(farm.map((k) => k.prefix))).toBe(40);
  });

  it('le même honnête, depuis un réseau qui a une histoire, sort du rayon (clause 9)', async () => {
    // Cette clause protège l'intégrateur QUI REVIENT, pas le nouveau venu — et le
    // nouveau venu est exactement la population que ce palier existe pour gagner.
    // Elle coûte à l'attaquant un jour de patience et une clé par proxy.
    const now = RUN;
    const start = now - 60 * 1000;
    const genericUa = `curl/8.7.1-${RUN}`;
    spread(40, start, 20_000).forEach((t, i) =>
      mint({ ua: `farm-${RUN}/1.0`, ipHash: `clnet-${RUN}-${i}`, atMs: t }),
    );
    mint({ ua: genericUa, ipHash: `clbait-${RUN}-a`, atMs: start + 9_000 });
    mint({ ua: genericUa, ipHash: `clbait-${RUN}-b`, atMs: start + 9_500 });
    const veteranIp = `clveteran-${RUN}`;
    networkHistory(veteranIp, start - 48 * 60 * 60 * 1000);
    const veteran = mint({ ua: genericUa, ipHash: veteranIp, atMs: start + 10_000 });
    arm(`ep-clause9-${RUN}`, start);

    const report = await withRevocationEnabled(() => scan(now));
    const generic = report.revocations.find((r) => r.anchor === `ua:${genericUa}`)!;
    // Le vétéran est sorti du rayon, donc la cohorte retombe à deux clés et passe
    // sous le plancher d'ancre.
    expect(generic.candidates).toBe(2);
    expect(generic.skipped_reason).toBe('below_anchor_floor');
    expect(activeCount([veteran.prefix])).toBe(1);
  });

  // -------------------------------------------------------------------------
  it('ancre FABRIQUÉE : une seule clé réclamée ne protège plus rien', async () => {
    // La séquence de l'attaquant, entièrement dans le produit : une clé anonyme
    // sous sa propre chaîne, un appel, une réclamation par code à six chiffres
    // avec UNE boîte jetable. Protéger toute chaîne portant UNE clé réclamée
    // rendait toute une ferme immunisée pour trente jours, au prix d'une boîte.
    const now = RUN;
    const fakeUa = `Zx/1.0-${RUN}`;
    mint({
      ua: fakeUa,
      ipHash: `fake-${RUN}`,
      atMs: now - 3 * 24 * 60 * 60 * 1000,
      tier: 'claimed',
      claimedAt: toSqliteUtc(now - 3 * 24 * 60 * 60 * 1000),
      claimMethod: 'email_code',
      limit: 200,
    });
    expect(trustedAnchors().has(`ua:${fakeUa}`), 'une boîte ne suffit plus').toBe(false);
  });

  it('ancre RÉELLE : trois clés, trois réseaux, une semaine d’étalement la protègent', async () => {
    // Trois boîtes, trois réseaux, de la patience. C'est beaucoup plus cher qu'une
    // boîte, et ce n'est PAS hors de portée — d'où la coupe manuelle : la
    // protection n'achète qu'un délai et un regard humain, jamais une impunité.
    const now = RUN;
    const sdkUa = `ibanforge-sdk/1.5.0-${RUN}`;
    for (const [i, daysAgo] of [10, 5, 1].entries()) {
      mint({
        ua: sdkUa,
        ipHash: `sdknet-${RUN}-${i}`,
        atMs: now - daysAgo * 24 * 60 * 60 * 1000,
        tier: 'claimed',
        claimedAt: toSqliteUtc(now - daysAgo * 24 * 60 * 60 * 1000),
        claimMethod: 'email_code',
        limit: 200,
      });
    }
    expect(trustedAnchors().has(`ua:${sdkUa}`)).toBe(true);
  });

  // -------------------------------------------------------------------------
  it('rotation : origin_prefix garde la lignée, la clé reste dans le rayon', async () => {
    // 🚨 Ce qui referme l'évasion par la route de rotation n'est PAS le drapeau
    // d'épisode — ce radar ne le lit jamais — c'est `origin_prefix` et la
    // jointure en COALESCE. Une clé tournée porte un préfixe NEUF et n'a aucune
    // ligne de naissance à son nom : jointe sur son préfixe courant, elle
    // sortirait du rayon pour un seul appel sur une route libre-service.
    const now = RUN;
    const start = now - 60 * 1000;
    const ua = `rot-${RUN}/1.0`;
    const born = spread(20, start, 20_000).map((t, i) =>
      mint({ ua, ipHash: `rotnet-${RUN}-${i}`, atMs: t }),
    );
    const creationsBefore = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM key_creations').get() as { n: number }
    ).n;

    // La rotation, dans sa forme SQL : une ligne neuve qui porte la lignée,
    // l'ancienne désactivée, et AUCUNE ligne de naissance de plus.
    const rotated = born.map((old, i) => {
      getStatsDB()
        .prepare(
          "UPDATE api_keys SET active = 0, deactivated_at = datetime('now') WHERE key_hash = ?",
        )
        .run(old.hash);
      return mint({
        ua,
        ipHash: `rotnet-${RUN}-${i}`,
        atMs: start + 30 * 1000,
        originPrefix: old.prefix,
        writeCreation: false,
      });
    });
    const creationsAfter = (
      getStatsDB().prepare('SELECT COUNT(*) AS n FROM key_creations').get() as { n: number }
    ).n;
    expect(creationsAfter, 'la rotation n’écrit aucune ligne de naissance').toBe(creationsBefore);

    arm(`ep-rot-${RUN}`, start);
    const report = await scan(now);
    expect(report.anon_burst?.keys).toBe(20);
    const line = report.revocations.find((r) => r.anchor === `ua:${ua}`)!;
    expect(line.candidates).toBe(20);

    const cut = await cutCohortNow({ anchor: `ua:${ua}`, now: new Date(now) });
    expect(cut.revoked).toBe(20);
    expect(activeCount(rotated.map((k) => k.prefix))).toBe(0);
    // Le journal nomme LES DEUX préfixes : le courant, et la lignée.
    const journal = listKeyRevocations({ limit: 1000 });
    expect(journal.total).toBe(20);
    for (const row of journal.rows) {
      expect(rotated.map((k) => k.prefix)).toContain(row.key_prefix);
      expect(born.map((k) => k.prefix)).toContain(row.origin_prefix);
    }
    expect(listKeyRevocations({ prefix: born[0].prefix }).total, 'cherchable par la lignée').toBe(
      1,
    );
  });

  // -------------------------------------------------------------------------
  it('l’opt-in absent ne coupe RIEN, et posé ne coupe rien non plus tant que la réparation manque', async () => {
    const now = RUN;
    const start = now - 60 * 1000;
    const ua = `optin-${RUN}/1.0`;
    const keys = spread(20, start, 20_000).map((t, i) =>
      mint({ ua, ipHash: `optnet-${RUN}-${i}`, atMs: t }),
    );
    arm(`ep-optin-${RUN}`, start);

    // 1. Drapeau ABSENT : sauvegarder, retirer, restaurer, DANS le test.
    const saved = process.env.IBANFORGE_REVOCATION_ENABLED;
    delete process.env.IBANFORGE_REVOCATION_ENABLED;
    try {
      const off = await scan(now);
      expect(off.revocations.find((r) => r.anchor === `ua:${ua}`)!.skipped_reason).toBe(
        'revocation_off',
      );
      expect(off.anon_revoked).toBe(0);
    } finally {
      if (saved === undefined) delete process.env.IBANFORGE_REVOCATION_ENABLED;
      else process.env.IBANFORGE_REVOCATION_ENABLED = saved;
    }

    // 2. Drapeau POSÉ : la révocation reste bridée, parce que `/v1/keys/claim`
    //    n'accepte pas encore une clé coupée pour rafale. Sans cette garde, la
    //    victime d'un empoisonnement lit un texte qui l'envoie chercher une clé
    //    neuve, et la clé neuve meurt à la rafale suivante.
    const on = await withRevocationEnabled(() => scan(now));
    expect(CLAIM_REPAIR_LANDED, 'le drapeau part à false, par décision').toBe(false);
    expect(on.revocations.find((r) => r.anchor === `ua:${ua}`)!.skipped_reason).toBe(
      'claim_repair_missing',
    );
    expect(on.anon_revoked).toBe(0);
    expect(listKeyRevocations().total).toBe(0);
    expect(activeCount(keys.map((k) => k.prefix))).toBe(20);

    // 3. L'interrupteur de crise éteint aussi la révocation, et il le DIT.
    const savedBreaker = process.env.IBANFORGE_BREAKER_DISABLED;
    process.env.IBANFORGE_BREAKER_DISABLED = '1';
    try {
      const crisis = await withRevocationEnabled(() => scan(now));
      expect(crisis.revocations.find((r) => r.anchor === `ua:${ua}`)!.skipped_reason).toBe(
        'breaker_disabled',
      );
    } finally {
      if (savedBreaker === undefined) delete process.env.IBANFORGE_BREAKER_DISABLED;
      else process.env.IBANFORGE_BREAKER_DISABLED = savedBreaker;
    }

    // 4. Hors alerte, le motif le plus informatif est l'absence d'épisode.
    disarm();
    const calm = await withRevocationEnabled(() => scan(now));
    expect(calm.revocations.find((r) => r.anchor === `ua:${ua}`)!.skipped_reason).toBe('not_armed');
    expect(calm.shield_armed).toBe(false);
  });

  // -------------------------------------------------------------------------
  it('le plafond par appel borne la coupe et rend la file en attente', async () => {
    // better-sqlite3 est synchrone et Node mono-fil : une coupe sans borne
    // bloquerait l'API pour tous les clients, payants compris, pendant toutes ses
    // transactions.
    const now = RUN;
    const start = now - 60 * 1000;
    const ua = `bulk-${RUN}/1.0`;
    spread(520, start, 60_000).forEach((t, i) =>
      mint({ ua, ipHash: `bulknet-${RUN}-${i}`, atMs: t }),
    );
    arm(`ep-bulk-${RUN}`, start);

    const first = await cutCohortNow({ anchor: `ua:${ua}`, now: new Date(now) });
    expect(first.revoked).toBe(500);
    expect(first.pending).toBe(20);
    const second = await cutCohortNow({ anchor: `ua:${ua}`, now: new Date(now) });
    expect(second.revoked).toBe(20);
    expect(second.pending).toBe(0);
    expect(listKeyRevocations({ limit: 1000 }).total).toBe(520);
  });

  // -------------------------------------------------------------------------
  it('l’UPDATE porte la règle entière, et refuse tout ce que le chargeur refuse', async () => {
    // 🚨 Le chargeur filtre déjà ces classes de clés, mais un mécanisme qui coupe
    // ne doit pas laisser sa règle dans une autre fonction : le jour où quelqu'un
    // ajoute un await, une alerte par cohorte ou une sonde dans la boucle, une
    // clé réclamée ou payée entre-temps serait coupée et rien ne l'arrêterait.
    const now = RUN;
    const base = (extra: Partial<Parameters<typeof mint>[0]>): Minted =>
      mint({ ua: `rule-${RUN}/1.0`, ipHash: `rulenet-${RUN}`, atMs: now, ...extra });

    const input = (k: Minted): BurstRevocationInput => ({
      keyHash: k.hash,
      keyPrefix: k.prefix,
      originPrefix: null,
      episodeId: `ep-rule-${RUN}`,
      anchor: `ua:rule-${RUN}/1.0`,
      anchorShare: 1,
      anchorKeys: 1,
      burstFrom: toSqliteUtc(now - 1000),
      burstTo: toSqliteUtc(now + 1000),
      burstKeys: 1,
      windowMinutes: 0.5,
      distinctSources: 5,
    });

    const plain = base({});
    expect(revokeForBurst(input(plain)), 'une clé anonyme nue tombe').toBe(true);
    expect(revokeForBurst(input(plain)), 'et une seconde fois ne réécrit rien').toBe(false);

    const tiny = base({ claimMethod: 'x402', settlements: [0.002] });
    expect(revokeForBurst(input(tiny)), '0,002 $ n’achète pas d’immunité').toBe(true);

    // 🚨 LE test de l'arrondi. Deux cents règlements au tarif unitaire valent
    // exactement le seuil, mais la somme de deux cents flottants binaires ne le
    // vaut pas au quinzième chiffre : sans ROUND(..., 6), un payeur qui a réglé
    // la totalité se retrouverait révocable. Et ce cas n'est pas théorique : il
    // est exactement celui d'une clé qui a réglé et dont la promotion a échoué,
    // donc qui garde `claimed_at IS NULL`.
    const atThreshold = base({ settlements: Array.from({ length: 200 }, () => 0.005) });
    expect(
      revokeForBurst(input(atThreshold)),
      'somme flottante de 200 règlements : voir le ROUND de l’UPDATE',
    ).toBe(false);

    const refused: Array<[string, Minted]> = [
      ['réclamée', base({ tier: 'claimed', claimedAt: toSqliteUtc(now), limit: 200 })],
      ['payée au seuil', base({ settlements: [1.0] })],
      ['à crédits', base({ creditsRemaining: 1000 })],
      ['frappée par nous', base({ issuedByUs: 1 })],
      ['compte interne', base({ email: `smoke-${RUN}-b@ibanforge.com` })],
      ['déjà inactive', base({ active: 0 })],
    ];
    for (const [label, k] of refused) {
      expect(revokeForBurst(input(k)), label).toBe(false);
      expect(listKeyRevocations({ prefix: k.prefix }).total, `${label} : aucun journal`).toBe(0);
    }
  });

  // -------------------------------------------------------------------------
  it('la restauration se fait par l’ancien solde consigné, et par hash', async () => {
    // 🚨 Le journal est le SEUL chemin de retour. Poser active = 0 démarre
    // l'horloge de purge de la télémétrie : trente jours plus tard, les lignes de
    // trafic de la clé ont disparu et ce journal est la seule trace de ce qu'elle
    // a fait. D'où : aucune purge dessus, jamais.
    //
    // La route de restauration est une extension explicitement découpée hors de
    // ce lot ; ce test prouve que le journal PORTE ce qu'il faut, en rejouant la
    // restauration par les valeurs consignées.
    const now = RUN;
    const start = now - 60 * 1000;
    const ua = `restore-${RUN}/1.0`;
    const keys = spread(20, start, 20_000).map((t, i) =>
      mint({ ua, ipHash: `resnet-${RUN}-${i}`, atMs: t, noRecredit: 1, limit: 5 }),
    );
    for (const k of keys) useUnits(k.hash, 3);
    arm(`ep-restore-${RUN}`, start);

    const cut = await cutCohortNow({ anchor: `ua:${ua}`, now: new Date(now) });
    expect(cut.revoked).toBe(20);
    // Les unités REPRISES sont celles qui restaient, jamais le butin déjà dépensé.
    const journal = listKeyRevocations({ pendingOnly: true, limit: 1000 });
    expect(journal.total).toBe(20);
    expect(journal.rows[0].prev_monthly_limit).toBe(5);
    expect(journal.rows[0].prev_no_recredit).toBe(1);
    expect(journal.rows[0].prev_units_used).toBe(3);
    expect(journal.rows[0].prev_credits_remaining).toBeNull();

    const target = keys[0];
    expect(burstRevocationFor(target.hash), 'le middleware doit la reconnaître').not.toBeNull();

    const db = getStatsDB();
    const row = db
      .prepare(
        `SELECT key_hash, prev_monthly_limit, prev_no_recredit FROM key_revocations
          WHERE key_hash = ? AND restored_at IS NULL`,
      )
      .get(target.hash) as {
      key_hash: string;
      prev_monthly_limit: number;
      prev_no_recredit: number;
    };
    db.prepare(
      `UPDATE api_keys SET active = 1, deactivated_at = NULL, monthly_limit = ?, no_recredit = ?
        WHERE key_hash = ?`,
    ).run(row.prev_monthly_limit, row.prev_no_recredit, row.key_hash);
    db.prepare("UPDATE key_revocations SET restored_at = datetime('now') WHERE key_hash = ?").run(
      row.key_hash,
    );

    const after = db
      .prepare(
        'SELECT active, monthly_limit, no_recredit, deactivated_at FROM api_keys WHERE key_hash = ?',
      )
      .get(target.hash) as {
      active: number;
      monthly_limit: number;
      no_recredit: number;
      deactivated_at: string | null;
    };
    expect(after).toEqual({ active: 1, monthly_limit: 5, no_recredit: 1, deactivated_at: null });
    expect(burstRevocationFor(target.hash), 'restaurée : plus de motif à servir').toBeNull();
    expect(listKeyRevocations({ pendingOnly: true, limit: 1000 }).total).toBe(19);
  });

  // -------------------------------------------------------------------------
  it('le texte servi à une clé coupée ne dit pas un mot de l’argent', () => {
    // 🚨 Ce module ne SAIT PAS ce qui a été facturé : le crochet de réclamation
    // x402 avale son erreur par doctrine, donc une clé qui a réellement réglé
    // peut se retrouver sans réclamation enregistrée, être coupée, et lire une
    // phrase fausse. Il dit ce qui a été fait de la CLÉ.
    for (const word of ['charged', 'refund', 'billed', 'nothing was kept']) {
      expect(KEY_REVOKED_BURST_DETAIL.toLowerCase()).not.toContain(word);
    }
    // Et la sortie qui RÉCUPÈRE la clé vient avant celle qui en donne une neuve :
    // une clé neuve meurt à la rafale suivante, qu'un attaquant relance toutes
    // les cinq minutes.
    expect(KEY_REVOKED_BURST_DETAIL.indexOf('POST /v1/keys/claim')).toBeGreaterThan(-1);
    expect(KEY_REVOKED_BURST_DETAIL.indexOf('POST /v1/keys/claim')).toBeLessThan(
      KEY_REVOKED_BURST_DETAIL.indexOf('POST /v1/keys/generate'),
    );
    // Aucune faute de frappe suggérée : c'est exactement ce que l'ancien message
    // faisait, et c'était faux pour un agent pris dans un rayon de souffle.
    expect(KEY_REVOKED_BURST_DETAIL.toLowerCase()).not.toContain('typo');
  });

  // -------------------------------------------------------------------------
  // 🚨 LE TEST À DEUX SENS, à activer par le lot qui livre `/v1/keys/claim`
  // (retirer le `.todo`, rien d'autre). Il échoue dans les DEUX sens et il n'y a
  // pas de position confortable : drapeau levé mais route qui refuse encore = la
  // révocation couperait sans réparation possible ; route qui accepte déjà mais
  // drapeau à false = le radar reste bridé pour rien.
  //
  // Corps attendu, mot pour mot :
  //
  //   const key = mintRevokedForBurst();            // clé inactive + ligne anon_burst
  //   const res = await app.request('/v1/keys/claim', { method: 'POST', body: claimBody(key) });
  //   if (CLAIM_REPAIR_LANDED) {
  //     expect(res.status, 'le drapeau est levé mais /claim refuse encore une clé '
  //       + 'révoquée : la révocation coupe sans réparation possible').toBe(200);
  //   } else {
  //     expect(res.status, 'la route relâche déjà son 401 : lever CLAIM_REPAIR_LANDED, '
  //       + 'sinon le radar reste bridé pour rien').toBe(401);
  //   }
  //
  // Ce que ce garde ne peut pas faire : détecter une route livrée PUIS bridée par
  // un autre chemin. Le module ne possède pas cette route.
  it.todo('CLAIM_REPAIR_LANDED dit ce que /v1/keys/claim fait vraiment');
});

describe.skipIf(!READY)('cadence et sûreté de la passe', () => {
  beforeAll(() => {
    reset();
  });
  afterAll(() => {
    reset();
  });

  it('une base sans clé anonyme rend un bloc anonyme vide, pas une erreur', async () => {
    const report = await scan(RUN);
    expect(report.errors).toEqual([]);
    expect(report.anon_scanned).toBe(0);
    expect(report.anon_burst).toBeNull();
    expect(report.revocations).toEqual([]);
    expect(report.anon_revoked).toBe(0);
    expect(report.shield_armed).toBe(false);
    expect(typeof report.anon_ms).toBe('number');
  });

  it('la passe e-mail reste intacte : son bloc et ses clés ne bougent pas', async () => {
    // Non-régression : la passe historique ne doit rien perdre à la cohabitation.
    const report = await scan(RUN);
    expect(report.scanned).toBe(0);
    expect(report.cohorts).toEqual([]);
  });
});
