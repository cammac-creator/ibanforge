import { beforeEach, describe, expect, it } from 'vitest';
import { getStatsDB } from './db.js';
import { writeFeed } from './bulletin-feed.js';
import {
  BIC_PROPOSAL_MIN_CODES,
  BIC_PROPOSAL_MIN_LOOKUPS,
  DECISIONS_SHOWN_MAX,
  addSessionProposal,
  readDecisions,
  recordAnswer,
} from './bulletin-decisions.js';
import { swissWeekFromLabel } from './bulletin.js';
import { sqliteUtc } from './swiss-week.js';

/**
 * « À toi de décider » : propositions de la session et des règles, réponses
 * Oui / Plus tard / Non. Base synthétique, textes inventés. Horloge : mercredi
 * 07.10.2026 à 12:00 heure suisse ; la dernière semaine close est la 40.
 */
const NOW = Date.parse('2026-10-07T10:00:00Z');
const DAY = 86_400_000;
const W40 = swissWeekFromLabel('2026-W40')!;
const W39 = swissWeekFromLabel('2026-W39')!;

function reset(): void {
  getStatsDB().exec(
    'DELETE FROM bulletin_proposals; DELETE FROM bulletin_answers; DELETE FROM bulletin_feed;',
  );
}

function propose(title: string, origin?: string): string {
  const r = addSessionProposal({ title, ...(origin ? { origin } : {}) }, W40);
  if (!r.ok) throw new Error(r.error);
  return r.key;
}

/** Une réponse posée à la main, à une date donnée (l'horloge de SQLite ne se truque pas). */
function answerAt(key: string, answer: string, week: string, at: number, origin?: string): void {
  getStatsDB()
    .prepare(
      `INSERT INTO bulletin_answers (proposal_key, week, answer, origin, label, answered_at)
       VALUES (?, ?, ?, ?, 'libellé inventé', ?)`,
    )
    .run(key, week, answer, origin ?? null, sqliteUtc(at));
}

const noBics = { top: [] };

beforeEach(() => reset());

describe('les propositions de la session principale', () => {
  it('sont gardées en texte brut, et refusées hors de leur forme', () => {
    const r = addSessionProposal(
      { title: '  Publier\nle module  ', detail: 'Un détail inventé.', origin: 'weekly-veille' },
      W40,
    );
    expect(r).toMatchObject({ ok: true, week: '2026-W40' });
    const d = readDecisions(W40, true, noBics, NOW);
    expect(d.shown).toEqual([
      expect.objectContaining({
        kind: 'session',
        title: 'Publier le module',
        detail: 'Un détail inventé.',
        origin: 'weekly-veille',
        answer: null,
      }),
    ]);
    for (const [body, error] of [
      [null, 'invalid_body'],
      [{ title: '' }, 'invalid_title'],
      [{ title: 'x'.repeat(141) }, 'invalid_title'],
      [{ title: 'un', detail: 42 }, 'invalid_detail'],
      [{ title: 'un', origin: 'ailleurs' }, 'invalid_origin'],
      [{ title: 'un', html: '<b>' }, 'invalid_body'],
    ] as const) {
      expect(addSessionProposal(body, W40), JSON.stringify(body)).toEqual({ ok: false, error });
    }
  });

  it('en montre trois au plus, et compte les autres', () => {
    for (let i = 1; i <= 5; i++) propose(`Proposition ${i}`);
    const d = readDecisions(W40, true, noBics, NOW);
    expect(d.shown.map((p) => p.title)).toEqual([
      'Proposition 1',
      'Proposition 2',
      'Proposition 3',
    ]);
    expect(d.shown).toHaveLength(DECISIONS_SHOWN_MAX);
    expect(d.more).toBe(2);
  });
});

describe('les réponses', () => {
  it('Oui et Non restent visibles le lundi de la réponse, puis ne reviennent pas', () => {
    const a = propose('A');
    const b = propose('B');
    expect(recordAnswer(a, 'oui', W40, noBics, NOW)).toEqual({
      ok: true,
      key: a,
      answer: 'oui',
      week: '2026-W40',
    });
    expect(recordAnswer(b, 'non', W40, noBics, NOW)).toMatchObject({ ok: true });
    const same = readDecisions(W40, true, noBics, NOW);
    expect(same.shown.map((p) => [p.title, p.answer?.answer])).toEqual([
      ['A', 'oui'],
      ['B', 'non'],
    ]);
    expect(same.answered.map((x) => x.answer)).toEqual(['oui', 'non']);
    // Le lundi suivant (semaine 41 close), elles ont disparu.
    const W41 = swissWeekFromLabel('2026-W41')!;
    expect(readDecisions(W41, true, noBics, NOW + 7 * DAY).shown).toEqual([]);
  });

  it('Plus tard revient vingt-huit jours après la réponse, pas avant', () => {
    const a = propose('A');
    answerAt(a, 'plus_tard', '2026-W36', NOW - 27 * DAY);
    expect(readDecisions(W40, true, noBics, NOW).shown).toEqual([]);
    reset();
    const b = propose('B');
    answerAt(b, 'plus_tard', '2026-W36', NOW - 28 * DAY);
    const back = readDecisions(W40, true, noBics, NOW).shown;
    expect(back).toEqual([
      expect.objectContaining({ key: b, answer: null, postponed_at: sqliteUtc(NOW - 28 * DAY) }),
    ]);
  });

  it('la dernière réponse fait foi, et le libellé gardé est celui de l’API', () => {
    const a = propose('Titre de l’API');
    recordAnswer(a, 'non', W40, noBics, NOW);
    recordAnswer(a, 'plus_tard', W40, noBics, NOW);
    const d = readDecisions(W40, true, noBics, NOW);
    expect(d.shown[0].answer).toMatchObject({ answer: 'plus_tard', label: 'Titre de l’API' });
    expect(d.answered).toHaveLength(1);
  });

  it('refuse une clé que le bulletin ne montre pas', () => {
    for (let i = 1; i <= 4; i++) propose(`P${i}`);
    expect(recordAnswer('session:999999', 'oui', W40, noBics, NOW)).toEqual({
      ok: false,
      error: 'unknown_proposal',
    });
    // La quatrième existe, mais n'est pas montrée (au-delà des trois).
    const fourth = readDecisions(W40, true, noBics, NOW);
    expect(fourth.more).toBe(1);
    const hidden = `session:${
      (getStatsDB().prepare(`SELECT MAX(id) AS id FROM bulletin_proposals`).get() as { id: number })
        .id
    }`;
    expect(recordAnswer(hidden, 'oui', W40, noBics, NOW)).toMatchObject({ ok: false });
    expect(recordAnswer('regle:bic-introuvable:IT', 'oui', W40, noBics, NOW)).toMatchObject({
      ok: false,
    });
  });

  it('une semaine passée montre ses réponses sans refaire les règles', () => {
    answerAt('session:1', 'oui', '2026-W39', NOW - 8 * DAY);
    const d = readDecisions(W39, false, noBics, NOW);
    expect(d).toMatchObject({ computed: false, shown: [], more: 0 });
    expect(d.answered.map((a) => [a.key, a.answer])).toEqual([['session:1', 'oui']]);
  });
});

describe('les règles sans modèle', () => {
  it('propose un pays aux BIC introuvables au-delà du seuil, pas en dessous', () => {
    const bics = {
      top: [
        {
          country: 'IT',
          lookups: BIC_PROPOSAL_MIN_LOOKUPS,
          distinct_codes: BIC_PROPOSAL_MIN_CODES,
        },
        { country: 'DE', lookups: 50, distinct_codes: 1 },
        { country: 'FR', lookups: BIC_PROPOSAL_MIN_LOOKUPS - 1, distinct_codes: 9 },
        { country: '??', lookups: 99, distinct_codes: 99 },
      ],
    };
    const d = readDecisions(W40, true, bics, NOW);
    expect(d.shown).toEqual([
      expect.objectContaining({
        key: 'regle:bic-introuvable:IT',
        kind: 'bic_introuvable',
        country: 'IT',
        detail: '10 recherches de BIC sans réponse la semaine 40, sur 3 codes différents.',
      }),
    ]);
    // Non : le pays ne revient plus, même au-dessus du seuil.
    expect(recordAnswer('regle:bic-introuvable:IT', 'non', W40, bics, NOW)).toMatchObject({
      ok: true,
    });
    const W41 = swissWeekFromLabel('2026-W41')!;
    expect(readDecisions(W41, true, bics, NOW + 7 * DAY).shown).toEqual([]);
  });

  it('propose d’arrêter une veille qui dépose depuis quatre semaines sans aucun Oui', () => {
    for (const w of ['2026-W37', '2026-W38', '2026-W39']) {
      writeFeed('weekly-veille', w, { lines: ['une ligne inventée'], score: null });
    }
    // Trois semaines seulement : pas encore.
    expect(readDecisions(W40, true, noBics, NOW).shown).toEqual([]);
    writeFeed('weekly-veille', '2026-W40', { lines: ['une ligne inventée'], score: null });
    expect(readDecisions(W40, true, noBics, NOW).shown).toEqual([
      expect.objectContaining({
        key: 'regle:veille-sans-oui:weekly-veille',
        kind: 'veille_sans_oui',
        origin: 'weekly-veille',
      }),
    ]);
    // Un Oui à une proposition née de cette veille, dans la fenêtre : plus de proposition.
    answerAt('session:77', 'oui', '2026-W38', Date.parse('2026-09-15T08:00:00Z'), 'weekly-veille');
    expect(readDecisions(W40, true, noBics, NOW).shown).toEqual([]);
  });

  it('range la session d’abord, puis les veilles, puis les pays', () => {
    for (const w of ['2026-W37', '2026-W38', '2026-W39', '2026-W40']) {
      writeFeed('weekly-reco-baseline', w, {
        lines: ['un'],
        score: { value: 1, out_of: 7, errors: 0 },
      });
    }
    propose('Session');
    const d = readDecisions(
      W40,
      true,
      { top: [{ country: 'IT', lookups: 40, distinct_codes: 9 }] },
      NOW,
    );
    expect(d.shown.map((p) => p.kind)).toEqual(['session', 'veille_sans_oui', 'bic_introuvable']);
  });
});
