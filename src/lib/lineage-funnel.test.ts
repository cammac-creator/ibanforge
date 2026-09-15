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
       (lineage_hash, birth_at, birth_tier, backfilled, first_success_at, first_success_context,
        first_unmarked_success_at, week2_success_at, first_settlement_at,
        paid_key_hash, paid_key_delivered_at, paid_first_success_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    hash,
    f.birth,
    f.tier ?? 'anonymous',
    f.backfilled ?? 0,
    f.firstSuccess ?? null,
    f.context ?? (f.firstSuccess ? 'unknown' : null),
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
});

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
