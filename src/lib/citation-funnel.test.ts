import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeAll, getStatsDB } from './db.js';
import { readCitation, type BulletinCitation } from './citation-funnel.js';
import { recordWebEvent } from './web-events.js';
import { swissWeekOf, type SwissWeek } from './swiss-week.js';

/**
 * La carte « De la citation au client », sur une base synthétique et des fixtures inventées
 * (ce dépôt est public). Horloge : mercredi 12.03.2031, la semaine du bulletin est celle
 * du 03.03. Chaque clé est nommée d'après ce qu'elle doit prouver.
 */
const NOW = Date.parse('2031-03-12T10:00:00Z');
const BULLETIN_WEEK = swissWeekOf(Date.parse('2031-03-05T10:00:00Z'));

let seq = 0;

function key(p: {
  at: string;
  referrer?: string | null;
  utm?: string | null;
  attribution?: boolean;
  firstCall?: string;
  paid?: string;
  email?: string;
  rotatedPrefix?: boolean;
}): void {
  seq += 1;
  const hash = `citation-${seq}`;
  const prefix = `ifk_cit${String(seq).padStart(5, '0')}`;
  const db = getStatsDB();
  db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier, lineage_hash)
     VALUES (?, ?, ?, ?, ?, 'site-home', 'email', ?)`,
  ).run(hash, prefix, p.email ?? `une${seq}@alpha.example.net`, null, p.at, hash);
  if (p.rotatedPrefix) {
    db.prepare(
      `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, source, tier, lineage_hash)
       VALUES (?, ?, ?, ?, ?, 'site-home', 'email', ?)`,
    ).run(`${hash}-r`, `${prefix}r`, `une${seq}@alpha.example.net`, null, p.at, hash);
  }
  if (p.attribution !== false) {
    db.prepare(
      `INSERT INTO signup_attribution (key_prefix, created_at, client, referrer, utm_source)
       VALUES (?, ?, 'web', ?, ?)`,
    ).run(prefix, p.at, p.referrer ?? null, p.utm ?? null);
  }
  db.prepare(
    `INSERT INTO lineage_facts (lineage_hash, birth_at, birth_tier, backfilled, first_success_at, updated_at)
     VALUES (?, ?, 'email', 0, ?, ?)`,
  ).run(hash, p.at, p.firstCall ?? null, p.at);
  if (p.paid) {
    db.prepare(
      `INSERT INTO key_purchases (payment_ref, rail, kind, outcome, lineage_hash, key_hash, key_prefix, created_at)
       VALUES (?, 'card', 'pack', 'credited', ?, ?, ?, ?)`,
    ).run(`stripe:cs_cit_${seq}`, hash, hash, prefix, p.paid);
  }
}

function weekOf(c: BulletinCitation, week: SwissWeek) {
  const row = c.weeks.find((w) => w.week === week.label);
  if (!row) throw new Error(`semaine ${week.label} absente`);
  return row;
}

describe('readCitation', () => {
  beforeAll(() => {
    const at = '2031-03-04 10:00:00';
    // Le début des deux mesures : une clé externe d'une semaine plus tôt.
    key({ at: '2031-02-12 10:00:00', referrer: 'chatgpt.com', firstCall: '2031-02-13 10:00:00' });
    // ChatGPT par son référent, utilisée et payante.
    key({
      at,
      referrer: 'chatgpt.com',
      firstCall: '2031-03-05 10:00:00',
      paid: '2031-03-06 10:00:00',
    });
    // ChatGPT par son étiquette seule, utilisée.
    key({ at, utm: 'chatgpt.com', firstCall: '2031-03-05 11:00:00' });
    // Perplexity, jamais utilisée.
    key({ at, referrer: 'www.perplexity.ai' });
    // Une rotation ne compte pas deux fois.
    key({ at, referrer: 'claude.ai', rotatedPrefix: true });
    // Payée après la semaine du bulletin : elle reste dans sa semaine de création.
    key({ at, referrer: 'gemini.google.com', paid: '2031-03-11 10:00:00' });
    // Un autre site, un moteur, et une origine interne : connues, mais pas des IA.
    key({ at, referrer: 'alpha.example.net', utm: 'chatgpt.com' });
    key({ at, referrer: 'www.google.ch' });
    // Sans référent ni étiquette, avec et sans ligne d'origine : inconnues, jamais une IA.
    key({ at });
    key({ at, attribution: false, firstCall: '2031-03-05 12:00:00' });
    // Un compte interne reste hors de tout.
    key({ at, referrer: 'chatgpt.com', email: 'sonde@ibanforge.com' });
    // Hors des huit semaines.
    key({ at: '2031-03-10 10:00:00', referrer: 'chatgpt.com' });

    recordWebEvent({
      name: 'cta:try',
      page: '/fr',
      locale: 'fr',
      referrer: 'www.perplexity.ai',
      viewport: 'phone',
    });
    getStatsDB().prepare(`UPDATE web_events SET created_at = '2031-03-04 12:00:00'`).run();
    // Le film n'est pas un clic, et un autre site n'est pas une IA.
    for (const [name, referrer] of [
      ['film:end', 'chatgpt.com'],
      ['cta:key', 'alpha.example.net'],
      ['nav:docs', 'chatgpt.com'],
    ]) {
      getStatsDB()
        .prepare(
          `INSERT INTO web_events (created_at, name, page, locale, referrer) VALUES (?, ?, '/fr', 'fr', ?)`,
        )
        .run('2031-03-04 13:00:00', name, referrer);
    }
  });

  afterAll(() => closeAll());

  it('compte les clés nées depuis une IA, et ce qu’elles ont fait depuis', () => {
    const c = readCitation(BULLETIN_WEEK, NOW);
    expect(c.arrivals_measured).toBe(false);
    const row = weekOf(c, BULLETIN_WEEK);
    expect(row.keys).toBe(5);
    expect(row.used).toBe(2);
    expect(row.paid).toBe(2);
  });

  it('garde l’inconnu à part, et les autres origines hors des IA', () => {
    const row = weekOf(readCitation(BULLETIN_WEEK, NOW), BULLETIN_WEEK);
    // Tout sauf le compte interne : 5 IA, 2 autres sites, 2 inconnues.
    expect(row.all_keys).toBe(9);
    expect(row.unknown_keys).toBe(2);
  });

  it('donne une IA par ligne, et leur somme vaut le total des semaines', () => {
    const c = readCitation(BULLETIN_WEEK, NOW);
    const named = Object.fromEntries(c.assistants.map((a) => [a.assistant, a]));
    expect(named.chatgpt).toEqual({ assistant: 'chatgpt', keys: 3, used: 3, paid: 1 });
    expect(named.perplexity).toEqual({ assistant: 'perplexity', keys: 1, used: 0, paid: 0 });
    expect(named.gemini).toEqual({ assistant: 'gemini', keys: 1, used: 0, paid: 1 });
    expect(named.copilot).toEqual({ assistant: 'copilot', keys: 0, used: 0, paid: 0 });
    expect(named.claude).toEqual({ assistant: 'claude', keys: 1, used: 0, paid: 0 });
    for (const step of ['keys', 'used', 'paid'] as const) {
      const byAssistant = c.assistants.reduce((sum, a) => sum + (a[step] ?? 0), 0);
      const byWeek = c.weeks.reduce((sum, w) => sum + (w[step] ?? 0), 0);
      expect(byAssistant).toBe(byWeek);
    }
  });

  it('montre huit semaines, celle du bulletin d’abord, sans celles d’après', () => {
    const c = readCitation(BULLETIN_WEEK, NOW);
    expect(c.weeks).toHaveLength(8);
    expect(c.weeks[0].week).toBe(BULLETIN_WEEK.label);
    expect(c.weeks.map((w) => w.week)).toEqual([...new Set(c.weeks.map((w) => w.week))]);
    expect(c.weeks.some((w) => w.monday === '2031-03-10')).toBe(false);
  });

  it('dit « non mesuré » avant le début d’une mesure, jamais zéro, et « partiel » à cheval', () => {
    const c = readCitation(BULLETIN_WEEK, NOW);
    expect(c.since.keys).toBe('2031-02-12 10:00:00');
    expect(c.since.used).toBe('2031-02-12 10:00:00');
    expect(c.since.paid).toBe('2031-02-12 10:00:00');
    const before = c.weeks[c.weeks.length - 1];
    expect(before.coverage).toEqual({ keys: 'none', used: 'none', paid: 'none' });
    expect(before).toMatchObject({ keys: null, used: null, paid: null, all_keys: null });
    const straddling = weekOf(c, swissWeekOf(Date.parse('2031-02-12T10:00:00Z')));
    expect(straddling.coverage.keys).toBe('partial');
    expect(straddling.keys).toBe(1);
    expect(straddling.used).toBe(1);
    expect(weekOf(c, BULLETIN_WEEK).coverage).toEqual({
      keys: 'full',
      used: 'full',
      paid: 'full',
    });
  });

  it('ne compte que les clics, à part, et sur les seuls référents d’une IA', () => {
    const c = readCitation(BULLETIN_WEEK, NOW);
    expect(c.since.site_clicks).toBe('2031-03-04 12:00:00');
    expect(weekOf(c, BULLETIN_WEEK).site_clicks).toBe(2);
    expect(c.weeks[1].site_clicks).toBeNull();
  });

  it('ne porte ni adresse, ni préfixe, ni hachage', () => {
    const text = JSON.stringify(readCitation(BULLETIN_WEEK, NOW));
    for (const leak of ['@', 'ifk_', 'citation-', 'alpha.example.net']) {
      expect(text).not.toContain(leak);
    }
  });
});

describe('readCitation sur une base sans origine enregistrée', () => {
  it('rend tout « non mesuré » pour une semaine d’avant les mesures, même si zéro clé', () => {
    const c = readCitation(swissWeekOf(Date.parse('2020-01-15T10:00:00Z')), NOW);
    expect(c.weeks.every((w) => w.keys === null && w.used === null && w.paid === null)).toBe(true);
    expect(c.assistants.every((a) => a.keys === null && a.used === null && a.paid === null)).toBe(
      true,
    );
  });
});
