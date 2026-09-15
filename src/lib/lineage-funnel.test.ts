import { beforeEach, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { getLineageFunnel } from './lineage-funnel.js';

/**
 * Le tableau de cohortes, sur une horloge FIXÉE et des lignées posées à la
 * main : les dénominateurs n'y entrent qu'avec leur recul, et un dénominateur
 * nul rend « pas encore mesurable » plutôt qu'un zéro.
 *
 * Les lignes sont écrites directement dans `lineage_facts` : ce fichier teste
 * la LECTURE, et fabriquer trente jours de trafic réel pour la vérifier
 * rendrait le test illisible sans rien prouver de plus. L'écriture a son
 * propre fichier. Fixtures inventées, ce dépôt est public.
 */
const NOW = Date.parse('2026-09-15T12:00:00Z');
const RUN = Date.now();
let n = 0;

/** Un instant SQLite, en jours avant l'horloge fixée. */
function daysAgo(days: number, hours = 0): string {
  return new Date(NOW - days * 86_400_000 - hours * 3_600_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
}

interface Fixture {
  birth: string;
  tier?: string;
  firstSuccess?: string | null;
  unmarked?: string | null;
  week2?: string | null;
  context?: string | null;
  settlement?: string | null;
  paidDelivered?: string | null;
  paidFirstSuccess?: string | null;
  backfilled?: number;
  email?: string;
  issuedByUs?: number;
  /** La porte de naissance, telle que `birth_source` la porte. */
  birthSource?: string | null;
  /** La famille de client du premier succès. */
  client?: string | null;
}

/** Une lignée complète : sa clé dans api_keys, sa ligne dans lineage_facts. */
function lineage(f: Fixture): string {
  n += 1;
  const db = getStatsDB();
  const hash = `fn-${RUN}-${n}`;
  db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, tier,
                           issued_by_us, lineage_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hash,
    `ifk_fn${String(RUN).slice(-4)}${n}`,
    f.email ?? `fn-${RUN}-${n}@alpha.example.net`,
    f.email ?? `fn-${RUN}-${n}@alpha.example.net`,
    f.birth,
    f.tier ?? 'anonymous',
    f.issuedByUs ?? 0,
    hash,
  );
  db.prepare(
    `INSERT INTO lineage_facts
       (lineage_hash, birth_at, birth_tier, birth_source, backfilled,
        first_success_at, first_success_context, first_success_client,
        first_unmarked_success_at, week2_success_at, first_settlement_at,
        paid_key_hash, paid_key_delivered_at, paid_first_success_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hash,
    f.birth,
    f.tier ?? 'anonymous',
    f.birthSource ?? null,
    f.backfilled ?? 0,
    f.firstSuccess ?? null,
    f.context ?? (f.firstSuccess ? 'unknown' : null),
    // Par défaut la famille suit l'activation : une lignée activée sans client
    // déclaré est `other`, une lignée jamais activée n'en a aucune.
    f.client === undefined ? (f.firstSuccess ? 'other' : null) : f.client,
    f.unmarked ?? null,
    f.week2 ?? null,
    f.settlement ?? null,
    f.paidDelivered ? hash : null,
    f.paidDelivered ?? null,
    f.paidFirstSuccess ?? null,
  );
  return hash;
}

function funnel() {
  return getLineageFunnel({ since: '2026-01-01', days: 365, now: NOW });
}

beforeEach(() => {
  const db = getStatsDB();
  db.prepare('DELETE FROM lineage_facts').run();
  db.prepare('DELETE FROM api_keys').run();
  db.prepare('DELETE FROM key_settlements').run();
  db.prepare('DELETE FROM device_grant_daily').run();
  db.prepare('DELETE FROM mcp_remote_daily').run();
});

/** Une journée du rail device, posée à la main. */
function grantDay(
  day: string,
  door: string,
  counts: Partial<{
    opened: number;
    rate_limited: number;
    approved_anonymous: number;
    approved_email: number;
    denied: number;
    expired: number;
    delivered: number;
  }>,
): void {
  getStatsDB()
    .prepare(
      `INSERT INTO device_grant_daily
         (day, source, opened, rate_limited, approved_anonymous, approved_email,
          denied, expired, delivered)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      day,
      door,
      counts.opened ?? 0,
      counts.rate_limited ?? 0,
      counts.approved_anonymous ?? 0,
      counts.approved_email ?? 0,
      counts.denied ?? 0,
      counts.expired ?? 0,
      counts.delivered ?? 0,
    );
}

describe('tableau de cohortes', () => {
  it('sans aucune lignée, chaque indicateur dit « pas encore mesurable »', () => {
    const f = funnel();
    expect(f.lineages).toEqual({ created: 0, admissible: 0, pending: 0 });
    for (const [name, ind] of Object.entries(f.indicators)) {
      expect(ind.value, name).toBeNull();
      expect(ind.note, name).toBe('not_yet_measurable');
    }
    expect(f.unknown_context_share.value).toBeNull();
    expect(f.paid_link_coverage.value).toBeNull();
    // Jamais un pourcentage sur zéro, et jamais un zéro qui en tiendrait lieu.
    expect(f.observed_at).toBe('2026-09-15 12:00:00');
  });

  it("une lignée née il y a deux heures n'entre dans AUCUN dénominateur", () => {
    lineage({ birth: daysAgo(0, 2) });
    const f = funnel();
    expect(f.lineages).toEqual({ created: 1, admissible: 1, pending: 1 });
    expect(f.indicators.first_result_24h.denominator).toBe(0);
    expect(f.indicators.first_result_24h.pending).toBe(1);
    expect(f.indicators.first_result_24h.coverage).toBe(0);
    expect(f.indicators.first_result_24h.value).toBeNull();
  });

  it('le premier résultat sous 24 h ne compte que dans la fenêtre de 24 h', () => {
    // Née il y a 3 jours, premier succès 2 heures plus tard : DANS la fenêtre.
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3, -2) });
    // Née il y a 3 jours, premier succès 2 jours plus tard : HORS fenêtre.
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(1) });
    // Née il y a 3 jours, jamais activée.
    lineage({ birth: daysAgo(3) });
    const ind = funnel().indicators.first_result_24h;
    expect(ind.denominator).toBe(3);
    expect(ind.numerator).toBe(1);
    expect(ind.pending).toBe(0);
    expect(ind.value).toBeCloseTo(1 / 3, 4);
  });

  it("l'utilisation hors panneau attend ses sept jours", () => {
    lineage({ birth: daysAgo(10), firstSuccess: daysAgo(10, -1), unmarked: daysAgo(10, -1) });
    lineage({ birth: daysAgo(10), firstSuccess: daysAgo(10, -1), context: 'demo' });
    // Trop jeune : au `pending`, pas au dénominateur.
    lineage({ birth: daysAgo(2), firstSuccess: daysAgo(2), unmarked: daysAgo(2) });
    const ind = funnel().indicators.unmarked_use_7d;
    expect(ind.denominator).toBe(2);
    expect(ind.numerator).toBe(1);
    expect(ind.pending).toBe(1);
    expect(ind.value).toBe(0.5);
    expect(ind.coverage).toBeCloseTo(2 / 3, 4);
  });

  it('le retour en deuxième semaine se compte depuis le PREMIER SUCCÈS', () => {
    // Activée il y a 20 jours, revenue en deuxième semaine.
    lineage({ birth: daysAgo(21), firstSuccess: daysAgo(20), week2: daysAgo(12) });
    // Activée il y a 20 jours, jamais revenue.
    lineage({ birth: daysAgo(21), firstSuccess: daysAgo(20) });
    // Activée il y a 3 jours : la deuxième semaine n'a pas eu lieu.
    lineage({ birth: daysAgo(4), firstSuccess: daysAgo(3) });
    // Jamais activée : hors population.
    lineage({ birth: daysAgo(30) });
    const ind = funnel().indicators.return_week_2;
    expect(ind.denominator).toBe(2);
    expect(ind.numerator).toBe(1);
    expect(ind.pending).toBe(1);
    expect(ind.value).toBe(0.5);
  });

  it("l'achat attribuable compte un règlement OU une clé payée reliée", () => {
    lineage({ birth: daysAgo(40), settlement: daysAgo(35) });
    lineage({ birth: daysAgo(40), paidDelivered: daysAgo(30) });
    // Réglé, mais 40 jours après la naissance : hors des 30 jours.
    lineage({ birth: daysAgo(80), settlement: daysAgo(40) });
    // Trop jeune pour être jugée.
    lineage({ birth: daysAgo(5) });
    const ind = funnel().indicators.attributable_purchase_30d;
    expect(ind.denominator).toBe(3);
    expect(ind.numerator).toBe(2);
    expect(ind.pending).toBe(1);
  });

  it("l'usage payé attend sept jours après la REMISE", () => {
    lineage({ birth: daysAgo(40), paidDelivered: daysAgo(20), paidFirstSuccess: daysAgo(19) });
    lineage({ birth: daysAgo(40), paidDelivered: daysAgo(20) });
    // Remise il y a deux jours : au `pending`.
    lineage({ birth: daysAgo(40), paidDelivered: daysAgo(2), paidFirstSuccess: daysAgo(2) });
    const ind = funnel().indicators.paid_use_7d;
    expect(ind.denominator).toBe(2);
    expect(ind.numerator).toBe(1);
    expect(ind.pending).toBe(1);
  });

  it('les comptes internes et les clés frappées par nous sont exclus', () => {
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3) });
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3), email: 'audit@ibanforge.com' });
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3), email: `x-${RUN}@cohorte.invalid` });
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3), issuedByUs: 1 });
    const f = funnel();
    expect(f.lineages.created).toBe(4);
    expect(f.lineages.admissible).toBe(1);
    expect(f.indicators.first_result_24h.denominator).toBe(1);
    expect(f.notes[0]).toContain('3 lignee(s) ecartee(s)');
  });

  it('une lignée RECONSTITUÉE à la migration est hors de la mesure', () => {
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3), context: 'traces', backfilled: 1 });
    const f = funnel();
    expect(f.lineages.created).toBe(0);
    expect(f.measurement_started_at).toBeNull();
    expect(f.indicators.first_result_24h.denominator).toBe(0);
  });

  it('une clé PAYÉE née directement ne fait pas partie de la cohorte d’essai', () => {
    lineage({ birth: daysAgo(3), tier: 'paid' });
    expect(funnel().lineages.created).toBe(0);
  });

  it('le démarrage de la mesure est la première lignée au fil de l’eau', () => {
    lineage({ birth: daysAgo(3), backfilled: 1 });
    lineage({ birth: daysAgo(2) });
    lineage({ birth: daysAgo(1) });
    expect(funnel().measurement_started_at).toBe(daysAgo(2));
  });

  it('la part de contexte inconnu est publiée à côté du hors-panneau', () => {
    lineage({ birth: daysAgo(10), firstSuccess: daysAgo(10), context: 'demo' });
    lineage({ birth: daysAgo(10), firstSuccess: daysAgo(10), context: 'unknown' });
    lineage({ birth: daysAgo(10) });
    const s = funnel().unknown_context_share;
    expect(s.denominator).toBe(2);
    expect(s.numerator).toBe(1);
    expect(s.value).toBe(0.5);
  });

  it('la fenêtre est fermée à droite : une lignée née après la borne sort', () => {
    lineage({ birth: '2026-09-01 00:00:00' });
    lineage({ birth: '2026-09-03 00:00:00' });
    // [2026-09-01, 2026-09-03[ : la seconde est exclue, la première incluse.
    const f = getLineageFunnel({ since: '2026-09-01', days: 2, now: NOW });
    expect(f.window).toEqual({ from: '2026-09-01 00:00:00', to: '2026-09-03 00:00:00' });
    expect(f.lineages.created).toBe(1);
  });
});

describe('ventilation par porte de naissance', () => {
  it('chaque porte porte sa population ET ses propres dénominateurs', () => {
    lineage({ birth: daysAgo(3), birthSource: 'mcp-device', firstSuccess: daysAgo(3, -1) });
    lineage({ birth: daysAgo(3), birthSource: 'mcp-device' });
    lineage({ birth: daysAgo(3), birthSource: 'web-device', firstSuccess: daysAgo(3, -1) });
    // Née il y a deux heures : au `pending` de SA porte, pas de l'autre.
    lineage({ birth: daysAgo(0, 2), birthSource: 'web-device' });
    const byDoor = funnel().by_birth_source;
    const mcp = byDoor.find((b) => b.name === 'mcp-device')!;
    const web = byDoor.find((b) => b.name === 'web-device')!;
    expect(mcp.lineages).toBe(2);
    expect(mcp.first_result_24h).toMatchObject({ numerator: 1, denominator: 2, pending: 0 });
    expect(web.lineages).toBe(2);
    expect(web.first_result_24h).toMatchObject({ numerator: 1, denominator: 1, pending: 1 });
  });

  it('une porte absente devient le seau (none)', () => {
    lineage({ birth: daysAgo(3) });
    const bucket = funnel().by_birth_source.find((b) => b.name === '(none)')!;
    expect(bucket.lineages).toBe(1);
  });

  it('au-delà de douze portes, le reste est replié dans (other)', () => {
    // 🚨 La borne à la lecture. `birth_source` recopie une source DÉCLARÉE par
    // l'appelant : sans ce plafond, la réponse grossirait d'un objet par clé.
    // Les portes les plus peuplées restent nommées, le bruit s'additionne.
    for (let i = 0; i < 15; i++) {
      lineage({ birth: daysAgo(3), birthSource: `porte-${i}` });
    }
    // Une porte à deux lignées : elle doit rester nommée malgré le bruit.
    lineage({ birth: daysAgo(3), birthSource: 'porte-grosse' });
    lineage({ birth: daysAgo(3), birthSource: 'porte-grosse' });
    const byDoor = funnel().by_birth_source;
    expect(byDoor).toHaveLength(13);
    expect(byDoor[0].name).toBe('porte-grosse');
    const other = byDoor.find((b) => b.name === '(other)')!;
    // 16 portes distinctes, 12 nommées (dont la grosse), 4 repliées.
    expect(other.lineages).toBe(4);
    expect(other.first_result_24h.denominator).toBe(4);
    // Rien ne se perd : la somme des seaux est la cohorte admissible.
    expect(byDoor.reduce((sum, b) => sum + b.lineages, 0)).toBe(17);
  });
});

describe('ventilation par famille de client', () => {
  it('publie les huit familles plus (unknown) et (none), même à zéro', () => {
    const names = funnel().by_first_client.map((b) => b.name);
    expect(names).toEqual([
      'mcp-npm',
      'sdk-ts',
      'sdk-python',
      'sdk-java',
      'sdk-dotnet',
      'browser',
      'curl',
      'other',
      '(unknown)',
      '(none)',
    ]);
  });

  it('(none) est « née et jamais activée », pas un client manquant', () => {
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3, -1), client: 'mcp-npm' });
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3, -1), client: 'sdk-python' });
    lineage({ birth: daysAgo(3) });
    const byClient = funnel().by_first_client;
    expect(byClient.find((b) => b.name === 'mcp-npm')!.lineages).toBe(1);
    expect(byClient.find((b) => b.name === 'sdk-python')!.lineages).toBe(1);
    expect(byClient.find((b) => b.name === '(none)')!.lineages).toBe(1);
    // Le seau jamais activé a bien un dénominateur — la lignée a 24 h de recul —
    // et un numérateur nul : c'est un fait mesuré, pas une absence de mesure.
    const none = byClient.find((b) => b.name === '(none)')!;
    expect(none.first_result_24h).toMatchObject({ numerator: 0, denominator: 1 });
    expect(none.first_result_24h.value).toBe(0);
  });

  it('une lignée ACTIVÉE sans famille va dans (unknown), jamais dans (none)', () => {
    // 🚨 Le cas de la PREMIÈRE lecture en production : la colonne arrive NULL
    // sur toutes les lignées déjà écrites au fil de l'eau par le lot M, qui ont
    // pourtant un premier succès. Les replier dans « jamais activée »
    // publierait des lignées actives comme n'ayant jamais rien fait — avec un
    // numérateur de premier résultat non nul dans un seau censé n'en avoir
    // aucun.
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3, -1), client: null });
    lineage({ birth: daysAgo(3), firstSuccess: daysAgo(3, -1), client: 'mcp-npm' });
    lineage({ birth: daysAgo(3) });
    const byClient = funnel().by_first_client;
    const unknown = byClient.find((b) => b.name === '(unknown)')!;
    const none = byClient.find((b) => b.name === '(none)')!;
    expect(unknown.lineages).toBe(1);
    expect(unknown.first_result_24h).toMatchObject({ numerator: 1, denominator: 1 });
    expect(none.lineages).toBe(1);
    expect(none.first_result_24h).toMatchObject({ numerator: 0, denominator: 1 });
    // 🚨 L'invariant qui prouve que la ventilation ne perd personne : les dix
    // seaux PARTITIONNENT la cohorte admissible.
    expect(byClient.reduce((sum, b) => sum + b.lineages, 0)).toBe(funnel().lineages.admissible);
  });
});

describe('le bloc device', () => {
  it('somme les compteurs journaliers par porte et en tout', () => {
    grantDay('2026-09-10', 'web-device', {
      opened: 5,
      approved_anonymous: 3,
      approved_email: 1,
      delivered: 3,
      denied: 1,
    });
    grantDay('2026-09-11', 'web-device', { opened: 2, approved_anonymous: 1, delivered: 1 });
    grantDay('2026-09-10', 'mcp-device', {
      opened: 4,
      rate_limited: 2,
      approved_anonymous: 2,
      delivered: 2,
      expired: 1,
    });
    const d = funnel().device;
    expect(d.counters).toEqual({
      opened: 11,
      rate_limited: 2,
      approved_anonymous: 6,
      approved_email: 1,
      approved: 7,
      denied: 1,
      expired: 1,
      delivered: 6,
    });
    expect(d.by_door.map((x) => x.source)).toEqual(['web-device', 'mcp-device', 'other']);
    expect(d.by_door.find((x) => x.source === 'mcp-device')!.rate_limited).toBe(2);
    expect(d.by_door.find((x) => x.source === 'other')!.opened).toBe(0);
    // La chaîne, avec ses dénominateurs et jamais un pourcentage seul.
    expect(d.chain.approved_of_opened).toMatchObject({ numerator: 7, denominator: 11 });
    expect(d.chain.delivered_of_approved).toMatchObject({ numerator: 6, denominator: 7 });
  });

  it('les lignées du rail sont celles nées par les deux portes device', () => {
    lineage({ birth: daysAgo(3), birthSource: 'mcp-device', firstSuccess: daysAgo(3, -1) });
    lineage({ birth: daysAgo(3), birthSource: 'web-device' });
    // Hors rail : elle ne doit pas entrer dans le bloc.
    lineage({ birth: daysAgo(3), birthSource: 'api-trial', firstSuccess: daysAgo(3, -1) });
    grantDay('2026-09-10', 'web-device', { delivered: 4 });
    const d = funnel().device;
    expect(d.lineages).toEqual({ created: 2, admissible: 2 });
    expect(d.indicators.first_result_24h).toMatchObject({ numerator: 1, denominator: 2 });
    // Le seul rapport du bloc qui croise les deux granularités.
    expect(d.chain.lineages_of_delivered).toMatchObject({ numerator: 2, denominator: 4 });
  });

  it('sans aucun grant, la chaîne dit « pas encore mesurable » et jamais zéro', () => {
    const d = funnel().device;
    expect(d.counters.opened).toBe(0);
    expect(d.chain.approved_of_opened.value).toBeNull();
    expect(d.chain.approved_of_opened.note).toBe('not_yet_measurable');
    expect(d.chain.delivered_of_approved.value).toBeNull();
  });

  it('le haut de l’entonnoir MCP distant est sommé et porte sa note', () => {
    const db = getStatsDB();
    db.prepare(
      "INSERT INTO mcp_remote_daily (day, sessions, tool_calls, key_requests) VALUES ('2026-09-10', 4, 30, 2)",
    ).run();
    db.prepare(
      "INSERT INTO mcp_remote_daily (day, sessions, tool_calls, key_requests) VALUES ('2026-09-11', 1, 5, 1)",
    ).run();
    // Hors fenêtre : ne doit pas entrer.
    db.prepare(
      "INSERT INTO mcp_remote_daily (day, sessions, tool_calls, key_requests) VALUES ('2025-01-01', 9, 9, 9)",
    ).run();
    const m = funnel().device.mcp_remote;
    expect(m.sessions).toBe(5);
    expect(m.tool_calls).toBe(35);
    expect(m.key_requests).toBe(3);
    // 🚨 La note est la mesure : sans elle, ces trois nombres se liraient comme
    // des activations, alors qu'aucun n'est rattachable à une lignée.
    expect(m.note).toContain('SANS AUCUNE IDENTITE');
    expect(m.note).toContain('rattachable');
  });

  it('les jours sommés sont annoncés, et ce sont des JOURS', () => {
    const f = getLineageFunnel({ since: '2026-09-01', days: 2, now: NOW });
    expect(f.window).toEqual({ from: '2026-09-01 00:00:00', to: '2026-09-03 00:00:00' });
    expect(f.device.window_days).toEqual({ from: '2026-09-01', to: '2026-09-03' });
    expect(f.device.notes.join(' ')).toContain('JOURS UTC');
  });
});
