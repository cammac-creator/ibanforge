import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulletinView } from '@/components/dashboard/bulletin-view';
import {
  ageText,
  civilLong,
  delta,
  heartbeatsTone,
  machineState,
  publicationDay,
  readBulletin,
  siteHomeText,
  swissDayTime,
  unreadText,
  weekSpan,
  type BulletinHeartbeats,
  type BulletinPayload,
} from './bulletin';

/**
 * Le bulletin du lundi côté site : la garde de forme, les phrases, et le rendu de la
 * vue sur une charge utile INVENTÉE (ce dépôt est public : aucun chiffre réel).
 */
function sample(): BulletinPayload {
  return {
    version: 1,
    observed_at: '2026-10-07 10:00:00',
    observed_at_zurich: '07.10 à 12:00',
    week: {
      label: '2026-W40',
      title: 'Semaine 40 · 28.09 au 04.10',
      monday: '2026-09-28',
      sunday: '2026-10-04',
      start_utc: '2026-09-27 22:00:00',
      end_utc: '2026-10-04 22:00:00',
      last_complete: true,
      previous: '2026-W39',
      next: null,
    },
    requested: { week: null },
    numbers: {
      state: 'read',
      totals: {
        created: 4,
        first_success: 2,
        nudged: 1,
        called_after_nudge: 0,
        followup_pending: 1,
        paid: 0,
      },
      previous: { week: '2026-W39', created: 1, first_success: 2, paid: 1 },
      free_active: {
        people: 3,
        keys: 4,
        threshold: 50,
        window: { from: '2026-09-05', to: '2026-10-04' },
        crossed: false,
      },
      site_home: {
        since: '2026-09-27 08:49:01',
        coverage: 'full',
        created: 1,
        first_success: 0,
        paid: 0,
      },
      doors: [{ door: 'site-docs', label: 'Documentation', created: 3, first_success: 2, paid: 0 }],
      sentence: 'La porte « Documentation » a donné le plus de clés (3 sur 4).',
    },
    moved: {
      merged_pulls: {
        state: 'read',
        source: 'github',
        repo: 'cammac-creator/ibanforge',
        fetched_at: '2026-10-07 09:58:00',
        pulls: [
          {
            number: 41,
            title: 'feat: une page inventée',
            merged_at: '2026-09-30 12:00:00',
            url: 'https://github.com/cammac-creator/ibanforge/pull/41',
          },
        ],
      },
      heartbeats: {
        state: 'read',
        items: [
          {
            kind: 'cron',
            name: 'weekly-veille',
            label: 'veille hebdo (+ canari découvrabilité)',
            last_beat_at: '2026-10-05 12:57:00',
            age_hours: 45.1,
            max_age_hours: 216,
            state: 'on_time',
            alert_open: false,
          },
          {
            kind: 'radar',
            name: 'forum_radar_last_scan_at',
            label: 'radar forums',
            last_beat_at: '2026-10-05 10:00:00',
            age_hours: 48,
            max_age_hours: 30,
            state: 'late',
            alert_open: true,
          },
        ],
        on_time: 1,
        late: 1,
        never: 0,
      },
      alerts: {
        state: 'read',
        open: [
          {
            key: 'heartbeat:forum_radar_last_scan_at',
            label: 'radar forums',
            fails: 2,
            opened_at: '2026-10-06 16:00:00',
            last_failure_at: '2026-10-07 09:00:00',
          },
        ],
        failing: [],
      },
      sources: {
        state: 'read',
        sources: [
          {
            source: 'gleif',
            entries: 1000,
            last_updated: '2026-10-01 03:15:00',
            age_days: 6,
            source_as_of: null,
            stale: false,
            stale_reason: null,
          },
          {
            source: 'swiftcodes',
            entries: 500,
            last_updated: '2026-10-01 03:15:00',
            age_days: 6,
            source_as_of: '2018-01',
            stale: true,
            stale_reason: 'source_frozen',
          },
        ],
        fresh: 1,
        total: 2,
      },
    },
    needs: {
      missing_bics: {
        state: 'read',
        source: 'operations',
        total_lookups: 5,
        total_countries: 2,
        top: [
          { country: 'IT', lookups: 3, distinct_codes: 2 },
          { country: 'DE', lookups: 2, distinct_codes: 1 },
        ],
        excluded_internal: 1,
      },
      forum_threads: { state: 'read', found: 2, still_new: 1 },
    },
    not_yet: [
      { key: 'decisions', title: 'À toi de décider', reason: 'À l’étape suivante.' },
      { key: 'veille', title: 'La veille en trois lignes', reason: 'Encore sur Telegram.' },
    ],
    definitions: { semaine: 'Du lundi 00:00 au dimanche 23:59, heure suisse.' },
  };
}

function render(data: BulletinPayload): string {
  return renderToStaticMarkup(createElement(BulletinView, { data, locale: 'fr' }));
}

afterEach(() => vi.restoreAllMocks());

describe('la garde de forme', () => {
  it('accepte la version 1 complète', () => {
    expect(readBulletin(sample())).not.toBeNull();
  });

  it('refuse une autre version, un bloc manquant, un état inconnu ou un lien hors du dépôt', () => {
    const elsewhere = {
      state: 'read',
      source: 'github',
      repo: 'cammac-creator/ibanforge',
      fetched_at: '2026-10-07 09:58:00',
      pulls: [{ number: 41, title: 't', merged_at: '2026-09-30 12:00:00', url: 'https://alpha.example.net/pull/41' }],
    };
    const cases: Array<[string, (p: BulletinPayload) => unknown]> = [
      ['version 2', (p) => ({ ...p, version: 2 })],
      ['pas de bloc des besoins', (p) => ({ ...p, needs: undefined })],
      ['un état inconnu', (p) => ({ ...p, moved: { ...p.moved, alerts: { state: 'peut-être' } } })],
      ['non lu sans raison', (p) => ({ ...p, numbers: { state: 'unread' } })],
      ['un lien ailleurs', (p) => ({ ...p, moved: { ...p.moved, merged_pulls: elsewhere } })],
      ['une semaine mal écrite', (p) => ({ ...p, week: { ...p.week, label: '2026-40' } })],
    ];
    for (const [name, spoil] of cases) {
      expect(readBulletin(spoil(sample())), name).toBeNull();
    }
    expect(readBulletin(null)).toBeNull();
    expect(readBulletin('{}')).toBeNull();
  });
});

describe('les phrases, sans Intl', () => {
  it('écrit les écarts, les dates et les âges', () => {
    expect([delta(3, 1), delta(1, 3), delta(2, 2)]).toEqual(['+2', '−2', '=']);
    expect(civilLong('2026-10-05')).toBe('lundi 5 octobre');
    expect(civilLong('2026-10-01')).toBe('jeudi 1er octobre');
    expect(publicationDay('2026-10-04')).toBe('lundi 5 octobre');
    expect(publicationDay('2027-01-03')).toBe('lundi 4 janvier');
    expect(weekSpan('2026-09-21', '2026-09-27')).toBe('du 21 au 27 septembre');
    expect(weekSpan('2026-09-28', '2026-10-04')).toBe('du 28 septembre au 4 octobre');
    expect(weekSpan('2026-12-28', '2027-01-03')).toBe('du 28 décembre 2026 au 3 janvier 2027');
    // Heure d'été, puis heure d'hiver.
    expect(swissDayTime('2026-10-07 10:00:00')).toBe('07.10 à 12:00');
    expect(swissDayTime('2026-12-01 10:00:00')).toBe('01.12 à 11:00');
    expect([ageText(0.4), ageText(5.2), ageText(72)]).toEqual([
      'il y a moins d’une heure',
      'il y a 5 h',
      'il y a 3 j',
    ]);
    expect(unreadText('http_403')).toContain('60 appels');
  });

  it('dit ce que la porte de l’accueil couvre de la semaine', () => {
    const home = sample().numbers;
    if (home.state !== 'read') throw new Error('sample');
    expect(siteHomeText(home.site_home)).toEqual({
      figure: '1 clé prise depuis l’accueil',
      note: null,
    });
    expect(siteHomeText({ ...home.site_home, coverage: 'partial', created: 0 }).note).toBe(
      'Compté seulement depuis la mise en ligne de l’accueil neuf, le 27.09 à 10:49.',
    );
    expect(siteHomeText({ ...home.site_home, coverage: 'none', created: null })).toEqual({
      figure: null,
      note: 'La porte de l’accueil n’existait pas encore cette semaine-là : elle compte depuis le 27.09 à 10:49.',
    });
  });

  it('résume l’état des automatisations en une pastille', () => {
    expect(machineState(sample())).toEqual({
      tone: 'bad',
      text: '1 alerte ouverte, 1 automatisation en retard',
    });
    // Une situation calme : aucune alerte, chaque battement à l'heure.
    const calm = (): BulletinPayload => {
      const p = sample();
      if (p.moved.alerts.state === 'read') p.moved.alerts.open = [];
      if (p.moved.heartbeats.state === 'read') {
        p.moved.heartbeats.items = p.moved.heartbeats.items.map((i) => ({ ...i, state: 'on_time' }));
        p.moved.heartbeats.on_time = p.moved.heartbeats.items.length;
        p.moved.heartbeats.late = 0;
      }
      return p;
    };
    expect(machineState(calm())).toEqual({ tone: 'ok', text: 'Tout tourne en ce moment' });

    // Un radar qui n'a jamais tourné n'est pas « tout tourne » : gris, jamais vert.
    const never = calm();
    if (never.moved.heartbeats.state !== 'read') throw new Error('sample');
    never.moved.heartbeats.items[1] = { ...never.moved.heartbeats.items[1], state: 'never' };
    never.moved.heartbeats.on_time = 1;
    never.moved.heartbeats.never = 1;
    expect(machineState(never)).toEqual({
      tone: 'neutral',
      text: 'Rien en retard, 1 automatisation sans battement encore',
    });
    expect(heartbeatsTone(never.moved.heartbeats)).toBe('neutral');

    // Une date illisible est un défaut à regarder : rouge.
    const unreadable = calm();
    if (unreadable.moved.heartbeats.state !== 'read') throw new Error('sample');
    unreadable.moved.heartbeats.items[1] = {
      ...unreadable.moved.heartbeats.items[1],
      state: 'unreadable',
    };
    unreadable.moved.heartbeats.on_time = 1;
    expect(machineState(unreadable)).toEqual({ tone: 'bad', text: '1 date illisible' });
    expect(heartbeatsTone(unreadable.moved.heartbeats)).toBe('bad');
    expect(heartbeatsTone((calm().moved.heartbeats as BulletinHeartbeats))).toBe('ok');
  });

  it('ne peint pas en vert une ligne de signes de vie incomplète', () => {
    const data = sample();
    if (data.moved.heartbeats.state !== 'read' || data.moved.alerts.state !== 'read') {
      throw new Error('sample');
    }
    data.moved.alerts.open = [];
    data.moved.heartbeats.items[1] = { ...data.moved.heartbeats.items[1], state: 'never' };
    data.moved.heartbeats.late = 0;
    data.moved.heartbeats.never = 1;
    const html = render(data);
    expect(html).toContain('Automatisations à l’heure : 1 sur 2.');
    expect(html).toMatch(/bg-\[var\(--ink-5\)\]"><\/span><div[^>]*>Automatisations/);
    expect(html).not.toMatch(/bg-emerald-400"><\/span><div[^>]*>Automatisations/);
  });
});

describe('le rendu de la vue', () => {
  it('suit l’ordre de la maquette, avec l’ambre sur la porte de l’accueil', () => {
    const html = render(sample());
    expect(html).toContain('lundi 5 octobre');
    expect(html).toContain('Semaine 40 · du 28 septembre au 4 octobre');
    expect(html).toMatch(/text-amber-300">1 clé prise depuis l’accueil</);
    expect(html).toContain('La porte « Documentation » a donné le plus de clés (3 sur 4).');
    expect(html).toContain('BIC de Italie (IT) absents : 3 recherches');
    expect(html).toContain('2 fils trouvés par le radar des forums, dont 1 pas encore regardé.');
    expect(html).toContain('https://github.com/cammac-creator/ibanforge/pull/41');
    expect(html).toContain('À toi de décider');
    const order = ['Les chiffres de la semaine', 'Ce qui a bougé', 'Ce qu’on cherche sans trouver', 'Pas encore là'].map(
      (t) => html.indexOf(t),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('dit « non lu » quand GitHub n’a pas répondu, sans jamais dire « aucune »', () => {
    const data = sample();
    data.moved.merged_pulls = {
      state: 'unread',
      source: 'github',
      repo: 'cammac-creator/ibanforge',
      fetched_at: '2026-10-07 10:00:00',
      reason: 'http_403',
    };
    const html = render(data);
    expect(html).toContain('Mises en ligne : non lues, GitHub a refusé la lecture');
    expect(html).toContain('Mises en ligne non lues');
    expect(html).not.toContain('Aucune PR');
    expect(html).not.toMatch(/0 mise en ligne/);
  });

  it('ne montre aucun chiffre quand les chiffres n’ont pas pu être lus', () => {
    const data = sample();
    data.numbers = { state: 'unread', reason: 'read_failed' };
    const html = render(data);
    expect(html).toContain('Les chiffres : non lu, la lecture a échoué côté API.');
    expect(html).not.toContain('nouvelles clés');
  });

  it('rend le même texte sans formateur natif d’heure ni de nombre', () => {
    const dateFormat = vi.spyOn(Intl, 'DateTimeFormat');
    const toLocale = vi.spyOn(Number.prototype, 'toLocaleString');
    const toLocaleDate = vi.spyOn(Date.prototype, 'toLocaleDateString');
    render(sample());
    expect(dateFormat).not.toHaveBeenCalled();
    expect(toLocale).not.toHaveBeenCalled();
    expect(toLocaleDate).not.toHaveBeenCalled();
  });
});
