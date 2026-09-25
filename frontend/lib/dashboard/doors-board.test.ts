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
    numbers: { created: 1234, first_success: 3, paid: 1, free_active: 23 },
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
      window_days: 30,
      window: { from: '2026-09-05', to: '2026-10-04' },
      active: 23,
      calendar: [
        { month: '2026-09', active: 38, to_date: false },
        { month: '2026-10', active: 9, to_date: true },
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
    numbers: { week: '2026-W40', created: 1234, first_success: 3, paid: 1, free_active: 23 },
    ...p,
  };
}

function digest(p: Partial<DigestState>): DigestState {
  return { ...payload().digest, ...p };
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
      'Résumé prévu ce lundi à 05.10 à 09:47 (heure suisse).',
    ],
    [
      'échec ambigu',
      digest({
        recent: [view({ status: 'failed', last_error: 'send_timeout_ambiguous', numbers: null })],
      }),
      'Résumé pas envoyé ce lundi : Telegram n’a pas répondu à temps, et le message a pu partir : pas de second essai.',
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

  it('montre les nombres envoyés seulement quand la page a bougé depuis', () => {
    const sentNumbers = { week: '2026-W40', created: 1233, first_success: 3, paid: 1, free_active: 23 };
    const moved = digest({ recent: [view({ numbers: sentNumbers })], latest_matches_page: false });
    expect(sentNumbersIfDifferent(moved, last)).toEqual(sentNumbers);
    expect(digestStatus(moved, last).tone).toBe('warn');
    const same = digest({ recent: [view({})], latest_matches_page: true });
    expect(sentNumbersIfDifferent(same, last)).toBeNull();
  });
});

describe('les petites phrases de la page', () => {
  it('dit le contrôle du parc, égal ou avec son écart', () => {
    const p = payload();
    expect(controlLine(p.control)).toBe(
      'Colonne « créées », toutes semaines et toutes portes : 1\u00a0276. Parc externe du jour, compté à part : 1\u00a0276. Égal.',
    );
    expect(controlLine({ ...p.control, external_fleet: 1275, equal: false, gap: 1 })).toContain(
      'Écart de 1 clé, à regarder.',
    );
  });

  it('donne le mois civil de la définition du 22.09 à côté du nombre du lundi', () => {
    expect(freeUsersCalendarLine(payload().free_users)).toBe(
      'Au mois civil, définition du 22.09 : 38 en septembre, 9 en octobre à ce jour.',
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
    expect(html).toContain('Gratuits actifs à 200/mois');
    expect(html).toContain('sur 30 jours, seuil 50');
    expect(html).toContain(data.last_week.sentence);
    expect(html).toContain('Semaine 40 · 28.09 au 04.10');
    expect(html).toContain('avec les mêmes nombres que ci-dessus');
    expect(html).toContain('Inconnue (clé d’avant le marquage)');
    expect(html).toContain('Parc externe du jour, compté à part : 1\u00a0276. Égal.');
    expect(html).toContain('+1');
    const text = html.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/[—–]/);
  });

  it('dit « seuil franchi » quand le nombre du lundi dépasse 50', () => {
    const p = payload();
    const data = payload({
      free_users: {
        ...p.free_users,
        active: 51,
        crossed: true,
        crossed_by: [{ basis: 'window', month: null, active: 51 }],
      },
    });
    const html = renderToStaticMarkup(createElement(DoorsBoard, { data }));
    expect(html).toContain('Seuil franchi : le plafond gratuit de 200 requêtes par mois est à réévaluer.');
  });
});
