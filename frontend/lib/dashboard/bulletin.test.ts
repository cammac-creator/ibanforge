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
  money,
  moneyList,
  periodTitle,
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
            name: 'heartbeat:forum_radar_last_scan_at',
            label: 'radar forums',
            cases: 1,
            fails: 2,
            opened_at: '2026-10-06 16:00:00',
            last_failure_at: '2026-10-07 09:00:00',
          },
        ],
        failing: [],
        stale: [],
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

  it('refuse une autre version, un bloc manquant ou un état inconnu', () => {
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
      ['une semaine mal écrite', (p) => ({ ...p, week: { ...p.week, label: '2026-40' } })],
    ];
    for (const [name, spoil] of cases) {
      expect(readBulletin(spoil(sample())), name).toBeNull();
    }
    expect(readBulletin(null)).toBeNull();
    expect(readBulletin('{}')).toBeNull();

    // Un lien hors du dépôt ne gâte que la liste des PR : le reste de la semaine s'affiche.
    const spoiled = readBulletin({ ...sample(), moved: { ...sample().moved, merged_pulls: elsewhere } });
    expect(spoiled?.moved.merged_pulls).toEqual({
      state: 'unread',
      source: 'github',
      repo: 'cammac-creator/ibanforge',
      fetched_at: '2026-10-07 09:58:00',
      reason: 'foreign_link',
    });
    expect(spoiled?.moved.alerts.state).toBe('read');
    expect(render(spoiled as BulletinPayload)).not.toContain('alpha.example.net');
  });

  it('accepte des alertes sans liste « à part », et la lit comme vide', () => {
    const p = sample() as unknown as { moved: { alerts: Record<string, unknown> } };
    delete p.moved.alerts.stale;
    const read = readBulletin(p);
    expect(read?.moved.alerts).toMatchObject({ state: 'read', stale: [] });
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

  it('ne compte jamais une alerte rangée à part dans la pastille, mais la montre', () => {
    const data = sample();
    if (data.moved.heartbeats.state !== 'read' || data.moved.alerts.state !== 'read') {
      throw new Error('sample');
    }
    data.moved.alerts.open = [];
    data.moved.heartbeats.items = data.moved.heartbeats.items.map((i) => ({ ...i, state: 'on_time' }));
    data.moved.heartbeats.on_time = data.moved.heartbeats.items.length;
    data.moved.heartbeats.late = 0;
    data.moved.alerts.stale = [
      {
        name: 'x402:purchase-unconfirmed',
        label: null,
        cases: 2,
        fails: 2,
        opened_at: '2026-09-01 08:00:00',
        last_failure_at: '2026-09-01 08:00:00',
      },
    ];
    expect(machineState(data)).toEqual({ tone: 'ok', text: 'Tout tourne en ce moment' });
    const html = render(data);
    expect(html).toContain('Aucune alerte ouverte en ce moment.');
    expect(html).toContain('Sans nouvel échec depuis plus de 7 jours, jamais refermées');
    expect(html).toContain('x402:purchase-unconfirmed (2 cas)');
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
    expect(html).toContain('Italie (IT) : 3 recherches de BIC sans réponse');
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
    expect(html).toContain('Les chiffres : non lus, la lecture a échoué côté API.');
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

// ─── Étapes A2 et B : propositions, historique des alertes, veille ──────────

function withA2(): BulletinPayload {
  const p = sample();
  p.not_yet = [];
  p.decisions = {
    state: 'read',
    computed: true,
    shown: [
      {
        key: 'session:7',
        kind: 'session',
        title: 'Publier le module inventé',
        detail: 'Un détail inventé.',
        origin: null,
        country: null,
        answer: null,
        postponed_at: null,
      },
      {
        key: 'regle:bic-introuvable:IT',
        kind: 'bic_introuvable',
        title: 'Chercher une source pour les BIC du pays IT',
        detail: '12 recherches de BIC sans réponse la semaine 40, sur 4 codes différents.',
        origin: null,
        country: 'IT',
        answer: {
          key: 'regle:bic-introuvable:IT',
          answer: 'plus_tard',
          label: 'Chercher une source pour les BIC du pays IT',
          week: '2026-W40',
          answered_at: '2026-10-05 07:10:00',
        },
        postponed_at: null,
      },
    ],
    more: 1,
    answered: [],
  };
  p.moved.alert_history = {
    state: 'read',
    kept_since: '2026-10-01 18:00:00',
    coverage: 'partial',
    opened: [
      {
        name: 'heartbeat:weekly-veille',
        label: 'veille hebdo (+ canari découvrabilité)',
        cases: 1,
        first_opened_at: '2026-10-02 06:00:00',
        still_open: 1,
      },
    ],
    closed: [
      {
        name: 'db:stats',
        label: null,
        cases: 2,
        last_closed_at: '2026-10-03 10:00:00',
        longest_hours: 3.5,
        opened_before_history: 1,
      },
    ],
  };
  p.veille = {
    state: 'read',
    sources: [
      {
        source: 'weekly-veille',
        label: 'La veille marché',
        state: 'read',
        received_at: '2026-10-05 06:30:00',
        lines: ['Une porte inventée qui s’ouvre.', '<b>pas du HTML</b>'],
        score: null,
      },
      { source: 'weekly-reco-baseline', label: 'Le score des IA', state: 'none' },
    ],
  };
  return p;
}

describe('les blocs des étapes A2 et B', () => {
  it('sont gardés par la garde quand ils ont leur forme', () => {
    const read = readBulletin(withA2());
    expect(read?.decisions).toMatchObject({ state: 'read', more: 1 });
    expect(read?.moved.alert_history).toMatchObject({ coverage: 'partial' });
    expect(read?.veille).toMatchObject({ state: 'read' });
  });

  it('une API d’avant l’étape A2 (sans ces blocs) s’affiche sans eux', () => {
    const read = readBulletin(sample());
    expect(read).not.toBeNull();
    expect(read?.decisions).toBeUndefined();
    const html = render(read as BulletinPayload);
    expect(html).not.toContain('bulletin-answer');
    expect(html).toContain('Les chiffres de la semaine');
  });

  it('un bloc mal formé est écarté seul, jamais la page', () => {
    const bad = withA2() as unknown as Record<string, unknown>;
    bad.decisions = {
      state: 'read',
      computed: true,
      more: 0,
      answered: [],
      shown: [{ key: 'https://alpha.example.net', kind: 'session', title: 't' }],
    };
    bad.veille = { state: 'read', sources: [{ source: 'x', label: 'y', state: 'read', lines: [42] }] };
    const read = readBulletin(bad);
    expect(read).not.toBeNull();
    expect(read?.decisions).toBeUndefined();
    expect(read?.veille).toBeUndefined();
    expect(read?.moved.alert_history).toMatchObject({ state: 'read' });
    expect(render(read as BulletinPayload)).not.toContain('alpha.example.net');
  });

  it('rend les propositions en tête, avec trois boutons dans un formulaire sans JavaScript', () => {
    const html = render(withA2());
    const decide = html.indexOf('À toi de décider');
    expect(decide).toBeGreaterThan(-1);
    expect(decide).toBeLessThan(html.indexOf('Les chiffres de la semaine'));
    expect(html).toContain('Publier le module inventé');
    expect(html).toContain('Chercher une source pour les BIC : Italie (IT)');
    const forms = html.match(/<form[^>]*>/g) ?? [];
    expect(forms).toHaveLength(2);
    for (const f of forms) {
      expect(f).toContain('action="/api/dashboard/bulletin-answer"');
      expect(f).toContain('method="post"');
    }
    expect(html).toMatch(/<input[^>]*name="key"[^>]*value="session:7"|<input[^>]*value="session:7"[^>]*name="key"/);
    expect(html).toMatch(/<input[^>]*value="fr"/);
    expect((html.match(/<button[^>]*name="answer"/g) ?? []).length).toBe(6);
    for (const a of ['oui', 'plus_tard', 'non']) expect(html).toMatch(new RegExp(`<button[^>]*value="${a}"`));
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Plus tard</);
    expect(html).toContain('Ta réponse : Plus tard, le 05.10 à 09:10.');
    expect(html).toContain('1 autre proposition attend');
    expect(html).not.toContain('<script');
  });

  it('dit l’issue d’une réponse quand la route revient', () => {
    const ok = renderToStaticMarkup(createElement(BulletinView, { data: withA2(), locale: 'fr', notice: 'ok' }));
    expect(ok).toContain('Réponse enregistrée.');
    const ko = renderToStaticMarkup(createElement(BulletinView, { data: withA2(), locale: 'fr', notice: 'echec' }));
    expect(ko).toContain('La réponse n’a pas été enregistrée');
  });

  it('rend l’historique de la semaine, et ce qu’il ne couvre pas', () => {
    const html = render(withA2());
    expect(html).toContain('Pendant la semaine : 1 alerte ouverte, 2 refermées.');
    expect(html).toContain('Ouverte : veille hebdo (+ canari découvrabilité), le 02.10 à 08:00, toujours ouverte');
    expect(html).toContain('Refermée : db:stats (2 fois), le 03.10 à 12:00, après 4 h (ouverte avant que l’historique soit tenu)');
    expect(html).toContain('Historique tenu seulement depuis le 01.10 à 20:00');
    const none = withA2();
    none.moved.alert_history = { state: 'read', kept_since: '2026-10-06 08:00:00', coverage: 'none', opened: [], closed: [] };
    expect(render(none)).toContain('Historique des alertes : pas encore tenu cette semaine-là.');
  });

  it('rend la veille en texte, et dit « rien de déposé » pour une source muette', () => {
    const html = render(withA2());
    expect(html).toContain('La veille et le score des IA');
    expect(html).toContain('Une porte inventée qui s’ouvre.');
    expect(html).toContain('&lt;b&gt;pas du HTML&lt;/b&gt;');
    expect(html).toContain('Rien de déposé pour cette semaine.');
    const scored = withA2();
    if (scored.veille?.state !== 'read') throw new Error('sample');
    scored.veille.sources[1] = {
      source: 'weekly-reco-baseline',
      label: 'Le score des IA',
      state: 'read',
      received_at: '2026-10-05 06:50:00',
      lines: ['Présent : une requête inventée'],
      score: { value: 2, out_of: 7, errors: 1 },
    };
    const s = render(scored);
    expect(s).toContain('2 sur 7 requêtes, score partiel : 1 requête en erreur');
  });

  it('une semaine passée montre les réponses données ce lundi-là, sans boutons', () => {
    const past = withA2();
    past.decisions = {
      state: 'read',
      computed: false,
      shown: [],
      more: 0,
      answered: [
        { key: 'session:3', answer: 'oui', label: 'Une décision inventée', week: '2026-W39', answered_at: '2026-09-28 07:00:00' },
      ],
    };
    const html = render(past);
    expect(html).toContain('Une décision inventée');
    expect(html).toContain('Réponse : Oui, le 28.09 à 09:00.');
    expect(html).not.toContain('bulletin-answer');
  });
});

// ─── Priorité 05 : encaissé moins coûts (montants inventés et ronds) ────────

function withMoney(): BulletinPayload {
  const p = withA2();
  p.money = {
    state: 'read',
    stripe_read_at: '2026-10-07T09:55:00.000Z',
    periods: [
      {
        month: '2026-09',
        from: '2026-09-01',
        to: '2026-10-01',
        complete: true,
        received: { state: 'read', count: 3, gross: { usd: 4000 }, refunded: { usd: 1000 }, test_mode: false },
        costs: [
          {
            item: 'frais_stripe',
            label: 'Frais Stripe',
            source: 'stripe',
            expected: true,
            state: 'connu',
            amounts: { chf: 250 },
            nature: 'mesure',
          },
          {
            item: 'vercel',
            label: 'Site (Vercel)',
            source: 'saisie',
            expected: true,
            state: 'connu',
            amounts: { usd: 2000 },
            nature: 'releve',
          },
          {
            item: 'railway',
            label: 'API (Railway)',
            source: 'saisie',
            expected: true,
            state: 'inconnu',
            reason: 'non_saisi',
            blocking: true,
          },
          {
            item: 'domaines',
            label: 'Noms de domaine et courriel',
            source: 'saisie',
            expected: false,
            state: 'inconnu',
            reason: 'non_saisi',
            blocking: false,
          },
        ],
        result: { status: 'au_plus', by_currency: { usd: 1000, chf: -250 }, missing: ['API (Railway)'] },
      },
      {
        month: '2026-10',
        from: '2026-10-01',
        to: '2026-10-05',
        complete: false,
        received: { state: 'inconnu', reason: 'stripe_unreachable' },
        costs: [],
        result: { status: 'inconnu', by_currency: null, missing: [] },
      },
    ],
  };
  return p;
}

describe('encaissé moins coûts, côté site', () => {
  it('écrit les montants en unités, devise par devise, sans Intl', () => {
    // Le séparateur des milliers est l'espace insécable de format-grouped.
    expect(money(123456, 'usd').replace(/\s/g, ' ')).toBe('1 234,56 USD');
    expect(money(-250, 'chf')).toBe('−2,50 CHF');
    expect(money(1000, 'usd', true)).toBe('+10,00 USD');
    expect(money(500, 'jpy')).toBe('500 JPY');
    expect(moneyList({ usd: 1000, chf: -250 }, true)).toBe('−2,50 CHF · +10,00 USD');
    expect(moneyList({})).toBe('—');
    expect(periodTitle({ month: '2026-09', from: '2026-09-01', to: '2026-10-01', complete: true })).toBe(
      'Septembre 2026',
    );
    expect(periodTitle({ month: '2026-10', from: '2026-10-01', to: '2026-10-05', complete: false })).toBe(
      'Octobre 2026, du 1er au 4',
    );
  });

  it('garde le bloc quand il a sa forme, l’écarte seul sinon', () => {
    expect(readBulletin(withMoney())?.money).toMatchObject({ state: 'read' });
    const bad = withMoney() as unknown as Record<string, unknown>;
    bad.money = { state: 'read', stripe_read_at: null, periods: [{ month: '2026-09', costs: 'beaucoup' }] };
    const read = readBulletin(bad);
    expect(read).not.toBeNull();
    expect(read?.money).toBeUndefined();
  });

  it('dit un plafond quand un coût manque, et l’inconnu quand Stripe n’a pas répondu', () => {
    const html = render(withMoney());
    expect(html).toContain('Encaissé moins coûts');
    expect(html.indexOf('Encaissé moins coûts')).toBeGreaterThan(html.indexOf('Les chiffres de la semaine'));
    expect(html).toContain('Septembre 2026');
    expect(html).toContain('10,00 USD');
    expect(html).toContain('−10,00 USD');
    expect(html).toContain('relevé');
    expect(html).toContain('inconnu, pas saisi');
    expect(html).toContain('Au plus');
    expect(html).toContain('−2,50 CHF · +10,00 USD');
    expect(html).toContain('Il manque : API (Railway).');
    // Un poste ponctuel non saisi n'est pas une ligne « inconnu ».
    expect(html).not.toContain('Noms de domaine et courriel');
    expect(html).toContain('Octobre 2026, du 1er au 4');
    expect(html).toContain('Résultat inconnu');
    expect(html).toContain('Encaissé inconnu : Stripe n’a pas répondu.');
    expect(html).toContain('Stripe lu le 07.10 à 11:55.');
  });
});
