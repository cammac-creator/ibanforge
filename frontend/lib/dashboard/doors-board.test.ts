import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DoorsBoard } from '@/components/dashboard/doors-board';
import {
  controlLine,
  digestStatus,
  freeUsersCalendarLine,
  sentNumbersIfDifferent,
  weekShort,
  type DigestState,
  type DigestView,
  type DoorsPayload,
} from './doors-board';

/**
 * La vue du tableau des portes, sur une réponse d'API inventée (ce dépôt est
 * public). Elle ne recalcule rien : ce test vérifie qu'elle affiche les nombres
 * reçus, tels quels, et qu'elle dit l'état du résumé du lundi sans se tromper.
 */
const zero = { created: 0, first_success: 0, nudged: 0, called_after_nudge: 0, followup_pending: 0, paid: 0 };

function payload(over: Partial<DoorsPayload> = {}): DoorsPayload {
  const lastWeek = {
    week: '2026-W40',
    title: 'Semaine 40 · 28.09 au 04.10',
    monday: '2026-09-28',
    sunday: '2026-10-04',
    numbers: { created: 1234, first_success: 3, paid: 1, free_active: 23, free_active_keys: 27 },
    nudged: 2,
    called_after_nudge: 1,
    followup_pending: 1,
    top_doors: [{ door: 'site-docs', label: 'Documentation', created: 700 }],
    sentence:
      'La porte « Documentation » a donné le plus de clés (700 sur 1234), 2 relances parties (1 suivie d’un appel sous sept jours, 1 encore dans ce délai).',
  };
  return {
    observed_at: '2026-10-07 10:00:00',
    observed_at_zurich: '07.10 à 12:00',
    weeks_shown: 2,
    weeks: [
      {
        key: '2026-W41',
        kind: 'current',
        title: 'Semaine 41 · 05.10 au 11.10',
        monday: '2026-10-05',
        sunday: '2026-10-11',
        totals: { ...zero, created: 2 },
        doors: [{ door: 'glama', label: 'Glama', ...zero, created: 2 }],
      },
      {
        key: '2026-W40',
        kind: 'complete',
        title: 'Semaine 40 · 28.09 au 04.10',
        monday: '2026-09-28',
        sunday: '2026-10-04',
        totals: { created: 1234, first_success: 3, nudged: 2, called_after_nudge: 1, followup_pending: 1, paid: 1 },
        doors: [
          { door: 'site-docs', label: 'Documentation', created: 700, first_success: 2, nudged: 2, called_after_nudge: 1, followup_pending: 1, paid: 1 },
          { door: '(inconnue)', label: 'Inconnue (clé d’avant le marquage)', ...zero, created: 534, first_success: 1 },
        ],
      },
      {
        key: 'before',
        kind: 'before',
        title: 'Avant le 28.09',
        monday: null,
        sunday: null,
        totals: { ...zero, created: 40 },
        doors: [{ door: '(inconnue)', label: 'Inconnue (clé d’avant le marquage)', ...zero, created: 40 }],
      },
    ],
    by_door: [
      { door: 'site-docs', label: 'Documentation', created: 700, first_success: 2, nudged: 2, called_after_nudge: 1, followup_pending: 1, paid: 1 },
      { door: '(inconnue)', label: 'Inconnue (clé d’avant le marquage)', ...zero, created: 534, first_success: 1 },
      { door: 'glama', label: 'Glama', ...zero, created: 2 },
    ],
    totals: { created: 1276, first_success: 3, nudged: 2, called_after_nudge: 1, followup_pending: 1, paid: 1 },
    control: { created_total: 1276, external_fleet: 1276, equal: true, gap: 0, external_key_rows: 1280 },
    free_users: {
      threshold: 50,
      threshold_counts: 'people',
      window_days: 30,
      window: { from: '2026-09-05', to: '2026-10-04' },
      active_people: 23,
      active_keys: 27,
      calendar: [
        { month: '2026-09', people: 38, keys: 44, to_date: false },
        { month: '2026-10', people: 1, keys: 1, to_date: true },
      ],
      crossed_by: [],
      crossed: false,
    },
    last_week: lastWeek,
    definitions: { cle: 'Une clé, c’est une clé et ses rotations.' },
    digest: {
      enabled: true,
      blocked: null,
      window: { first: '08:00', last: '10:59', deadline: '17:00' },
      this_monday: { week: '2026-W41', monday: '2026-10-05', deadline_passed: true },
      recent: [],
      latest_matches_page: null,
    },
    ...over,
  };
}

function view(p: Partial<DigestView>): DigestView {
  return {
    week: '2026-W41',
    summary_week: '2026-W40',
    status: 'sent',
    attempts: 1,
    planned_at: '05.10 à 09:47',
    next_attempt_at: '05.10 à 09:47',
    departed_at: '05.10 à 09:47',
    sent_at: '05.10 à 09:47',
    skip_reason: null,
    last_error: null,
    numbers: {
      week: '2026-W40',
      created: 1234,
      first_success: 3,
      paid: 1,
      free_active: 23,
      free_active_keys: 27,
    },
    ...p,
  };
}

/** Un état du résumé ; par défaut, le lundi de la semaine n'a pas encore passé 17:00. */
function digest(p: Partial<DigestState>): DigestState {
  return {
    ...payload().digest,
    this_monday: { week: '2026-W41', monday: '2026-10-05', deadline_passed: false },
    ...p,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('l’état du résumé du lundi, en une phrase', () => {
  const last = payload().last_week;

  it.each<[string, DigestState, string]>([
    ['éteint', digest({ enabled: false }), 'Résumé du lundi éteint : il ne part plus.'],
    [
      'pas encore planifié',
      digest({}),
      'Prochain résumé : lundi, à une minute tirée au hasard entre 08:00 et 10:59, heure suisse.',
    ],
    [
      'lundi passé sans aucune ligne',
      digest({ this_monday: { week: '2026-W41', monday: '2026-10-05', deadline_passed: true } }),
      'Résumé de ce lundi 05.10 pas parti : l’API ne tournait pas ce lundi.',
    ],
    [
      'pas encore planifié et bloqué',
      digest({ blocked: 'telegram_not_configured' }),
      'Le prochain résumé du lundi ne pourra pas partir : Telegram n’est pas configuré sur l’API.',
    ],
    [
      'envoyé, mêmes nombres',
      digest({ recent: [view({})], latest_matches_page: true }),
      'Résumé envoyé le lundi 05.10 à 09:47 (heure suisse), avec les mêmes nombres que ci-dessus.',
    ],
    [
      'prévu',
      digest({ recent: [view({ status: 'planned', departed_at: null, sent_at: null, numbers: null })] }),
      'Résumé prévu ce lundi 05.10 à 09:47 (heure suisse).',
    ],
    [
      'envoi non confirmé',
      digest({
        recent: [view({ status: 'failed', last_error: 'send_unconfirmed', numbers: null })],
      }),
      'Résumé pas envoyé ce lundi : Telegram n’a pas confirmé l’envoi (coupure ou délai dépassé) et le message a pu partir : pas de second essai.',
    ],
    [
      'refus de Telegram, trois fois',
      digest({
        recent: [view({ status: 'failed', last_error: 'telegram_refused_429', numbers: null })],
      }),
      'Résumé pas envoyé ce lundi : Telegram a refusé le message.',
    ],
    [
      'sauté',
      digest({ recent: [view({ status: 'skipped', skip_reason: 'kill_switch', numbers: null })] }),
      'Résumé sauté ce lundi : l’interrupteur du résumé est coupé.',
    ],
    [
      'manqué',
      digest({ recent: [view({ status: 'missed', numbers: null })] }),
      'Résumé pas parti ce lundi : l’API ne tournait pas avant 17:00, heure suisse.',
    ],
  ])('%s', (_name, state, text) => {
    expect(digestStatus(state, last).text).toBe(text);
    expect(digestStatus(state, last).text).not.toMatch(/[—–]/);
  });

  it('montre les nombres envoyés seulement quand la page a bougé depuis, et dit pourquoi elle peut bouger', () => {
    const sentNumbers = {
      week: '2026-W40',
      created: 1233,
      first_success: 3,
      paid: 1,
      free_active: 23,
      free_active_keys: 27,
    };
    const moved = digest({ recent: [view({ numbers: sentNumbers })], latest_matches_page: false });
    expect(sentNumbersIfDifferent(moved, last)).toEqual(sentNumbers);
    expect(digestStatus(moved, last)).toEqual({
      tone: 'warn',
      text:
        'Résumé envoyé le lundi 05.10 à 09:47 (heure suisse) ; depuis, la page a bougé : passage en ' +
        'payant, remboursement, ferme regroupée ou données arrivées en retard.',
    });
    const same = digest({ recent: [view({})], latest_matches_page: true });
    expect(sentNumbersIfDifferent(same, last)).toBeNull();
  });
});

describe('les petites phrases de la page', () => {
  it('dit la cohérence interne sans la présenter comme une preuve', () => {
    const p = payload();
    expect(controlLine(p.control)).toBe(
      'La colonne « créées », toutes semaines et toutes portes, fait 1\u00a0276, comme le parc externe compté par la même règle : le tableau ne perd ni ne double aucune clé.',
    );
    expect(controlLine(p.control)).not.toMatch(/preuve|Égal\./);
    expect(controlLine({ ...p.control, external_fleet: 1275, equal: false, gap: 1 })).toBe(
      'La colonne « créées » fait 1\u00a0276, le parc externe compté par la même règle 1\u00a0275 : le tableau perd ou double 1 clé, à regarder.',
    );
  });

  it('donne le mois civil de la définition du 22.09 à côté du nombre du lundi', () => {
    expect(freeUsersCalendarLine(payload().free_users)).toBe(
      'Au mois civil, définition du 22.09 : 38 personnes (44 clés) en septembre, 1 personne (1 clé) en octobre à ce jour.',
    );
  });

  it('abrège les semaines pour un téléphone', () => {
    const [current, complete, before] = payload().weeks;
    expect(weekShort(current)).toEqual({ label: 'S41, en cours', detail: '05.10 au 11.10' });
    expect(weekShort(complete)).toEqual({ label: 'S40', detail: '28.09 au 04.10' });
    expect(weekShort(before)).toEqual({ label: 'Avant le 28.09', detail: null });
  });
});

describe('la vue, rendue au serveur', () => {
  it('affiche les nombres de l’API tels quels, sans Intl ni tiret long', () => {
    const numberFormat = vi.spyOn(Number.prototype, 'toLocaleString');
    const intlNumber = vi.spyOn(Intl, 'NumberFormat');
    const intlDate = vi.spyOn(Intl, 'DateTimeFormat');
    const data = payload({
      digest: digest({ recent: [view({})], latest_matches_page: true }),
    });
    const html = renderToStaticMarkup(createElement(DoorsBoard, { data }));
    expect(numberFormat).not.toHaveBeenCalled();
    expect(intlNumber).not.toHaveBeenCalled();
    expect(intlDate).not.toHaveBeenCalled();
    // Les quatre nombres du lundi, groupés à la française.
    expect(html).toContain('1\u00a0234');
    expect(html).toContain('Premier appel réussi');
    expect(html).toContain('Gratuits actifs à 200/mois, en personnes');
    expect(html).toContain('27 clés, sur 30 jours ; seuil 50 personnes');
    expect(html).toContain('des personnes distinctes, derrière');
    expect(html).toContain('compte les personnes (décision du 22.09)');
    expect(html).toContain(data.last_week.sentence);
    expect(html).toContain('Semaine 40 · 28.09 au 04.10');
    expect(html).toContain('avec les mêmes nombres que ci-dessus');
    expect(html).toContain('Inconnue (clé d’avant le marquage)');
    expect(html).toContain('Cohérence interne');
    expect(html).toContain('le tableau ne perd ni ne double aucune clé');
    expect(html).not.toContain('emerald-500/30 bg-emerald-500/5 text-emerald-200">La colonne');
    expect(html).toContain('+1');
    // Les nombres s'accordent : 0 et 1 au singulier.
    expect(html).toContain('0 premier appel');
    expect(html).toContain('0 paiement');
    expect(html).not.toContain('0 paiements');
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/[—–]/);
  });

  it('dit « seuil franchi » quand le nombre du lundi dépasse 50', () => {
    const p = payload();
    const data = payload({
      free_users: {
        ...p.free_users,
        active_people: 51,
        active_keys: 60,
        crossed: true,
        crossed_by: [{ basis: 'window', month: null, people: 51 }],
      },
    });
    const html = renderToStaticMarkup(createElement(DoorsBoard, { data }));
    expect(html).toContain('Seuil franchi : le plafond gratuit de 200 requêtes par mois est à réévaluer.');
  });
});
