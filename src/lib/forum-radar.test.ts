import { describe, it, expect } from 'vitest';
import {
  MIN_SCORE,
  MARKETPLACES,
  PLATFORM_LIMITS,
  detectLang,
  finalizeCandidate,
  interpretCheck,
  parseDiscourse,
  parseGitHubIssues,
  parseHN,
  parseOdooSearch,
  parsePullpush,
  parseStackExchange,
  recencyBonus,
  repoOfUrl,
  scoreThread,
  type MarketplaceDef,
} from './forum-radar.js';

describe('PLATFORM_LIMITS — chaque source a sa limite', () => {
  it('couvre toutes les sources de fils avec un plafond de bon goût', () => {
    for (const src of ['stackoverflow', 'money_se', 'github', 'reddit', 'hn', 'manual']) {
      expect(PLATFORM_LIMITS[src], src).toBeDefined();
      expect(PLATFORM_LIMITS[src].comfy).toBeGreaterThan(0);
    }
    expect(PLATFORM_LIMITS.stackoverflow.max).toBe(30_000);
    expect(PLATFORM_LIMITS.github.max).toBe(65_536);
    expect(PLATFORM_LIMITS.hn.max).toBeNull();
  });
});

describe('recencyBonus — les fils récents passent devant', () => {
  const now = Date.parse('2026-08-18T12:00:00Z');
  it('gradue : +25 la semaine, +15 le mois, +8 le trimestre, 0 au-delà', () => {
    expect(recencyBonus('2026-08-15', now)).toBe(25);
    expect(recencyBonus('2026-08-01', now)).toBe(15);
    expect(recencyBonus('2026-06-15', now)).toBe(8);
    expect(recencyBonus('2019-01-01', now)).toBe(0);
  });
  it('0 sur date vide, invalide ou future', () => {
    expect(recencyBonus('', now)).toBe(0);
    expect(recencyBonus('n/a', now)).toBe(0);
    expect(recencyBonus('2027-01-01', now)).toBe(0);
  });
  it('finalizeCandidate additionne et trace le bonus, plafonné à 100', () => {
    const t = finalizeCandidate(
      { url: 'https://x', source: 'github', title: 'IBAN validation with BIC lookup', excerpt: 'validate please', activity: '', threadCreatedAt: '2026-08-16' },
      now,
    );
    expect(t?.scoreDetail).toContain('récent(+25)');
    expect(t?.score).toBeLessThanOrEqual(100);
  });
});

describe('parseDiscourse / parseOdooSearch — les nouveaux forums', () => {
  it('Discourse : reconstruit les URLs de topics', () => {
    const [c] = parseDiscourse(
      { topics: [{ id: 56496, title: 'IBAN number isn&#39;t valid', slug: 'iban-number-isnt-valid', created_at: '2019-12-01T00:00:00Z', posts_count: 5 }] },
      'discuss.frappe.io',
    );
    expect(c.url).toBe('https://discuss.frappe.io/t/iban-number-isnt-valid/56496');
    expect(c.title).toBe("IBAN number isn't valid");
    expect(c.activity).toContain('discuss.frappe.io');
  });
  it('Odoo : extrait les fils du HTML, dédupliqués, slug humanisé', () => {
    const html = 'x href="/forum/help-1/how-to-use-sepa-direct-debit-sdd-205846" y /forum/help-1/how-to-use-sepa-direct-debit-sdd-205846 z /forum/help-1/tag/foo';
    const out = parseOdooSearch(html);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://www.odoo.com/forum/help-1/how-to-use-sepa-direct-debit-sdd-205846');
    expect(out[0].title).toBe('how to use sepa direct debit sdd');
  });
  it('payloads vides tolérés', () => {
    expect(parseDiscourse({}, 'x')).toEqual([]);
    expect(parseOdooSearch('<html>rien</html>')).toEqual([]);
  });
});

describe('repoOfUrl — la clé du malus anti-backlog', () => {
  it('extrait owner/repo en minuscules des URLs GitHub', () => {
    expect(repoOfUrl('https://github.com/Metasfresh/metasfresh/issues/13338')).toBe('metasfresh/metasfresh');
  });
  it('null hors GitHub', () => {
    expect(repoOfUrl('https://stackoverflow.com/questions/1')).toBeNull();
  });
});

describe('scoreThread — un score lisible, jamais opaque', () => {
  it('score fort sur une vraie douleur produit (BIC depuis IBAN)', () => {
    const { score, detail } = scoreThread(
      'Generate BIC from IBAN bank account number',
      'Is there any existing library to get the BIC code from an IBAN?',
    );
    expect(score).toBeGreaterThanOrEqual(MIN_SCORE);
    expect(detail).toContain('iban');
    expect(detail).toContain('bic');
  });

  it('les niches suisses et VoP pèsent plus lourd que le générique', () => {
    const qr = scoreThread('QR-IBAN detection for Liechtenstein', 'How do I detect a QR-IID?').score;
    const vop = scoreThread('Verification of Payee', 'Is the beneficiary bank VoP ready?').score;
    const generic = scoreThread('IBAN regex', 'validate an IBAN with a regex').score;
    expect(qr).toBeGreaterThan(generic);
    expect(vop).toBeGreaterThan(generic);
  });

  it('pénalise les contextes hors sujet (SDK Stripe, générateurs de faux)', () => {
    const stripe = scoreThread('Stripe IbanElement error', 'sepa_debit is not a valid source type');
    const fake = scoreThread('Generate random IBAN for tests', 'need fake iban data');
    expect(stripe.score).toBeLessThan(scoreThread('IBAN error', 'sepa debit').score + 1);
    expect(fake.detail).toContain('fake-gen(-)');
  });

  it('borne le score à 0-100', () => {
    const kitchen = scoreThread(
      'QR-IBAN VoP virtual IBAN swiss clearing sanctions SEPA direct debit',
      'validate iban bic bank code mcp ai agent verification of payee',
    );
    expect(kitchen.score).toBeLessThanOrEqual(100);
    expect(scoreThread('nothing relevant', 'plain text').score).toBeGreaterThanOrEqual(0);
  });
});

describe('detectLang — route la langue du BROUILLON', () => {
  it('allemand sur un fil FinTS typique', () => {
    expect(detectLang('Wird es für die neue Spezifikation eine Änderung geben, und werden die Banken das nicht unterstützen?')).toBe('de');
  });
  it('français détecté', () => {
    expect(detectLang('Comment valider un IBAN avec les données de la banque pour une application ?')).toBe('fr');
  });
  it('anglais par défaut', () => {
    expect(detectLang('How to get the BIC from an IBAN?')).toBe('en');
  });
});

describe('finalizeCandidate — filtre le bruit sous MIN_SCORE', () => {
  const base = { url: 'https://x', source: 'github' as const, activity: '', threadCreatedAt: '2026-01-01' };
  it('rejette un candidat hors sujet', () => {
    expect(finalizeCandidate({ ...base, title: 'Fix typo in README', excerpt: 'small doc change' })).toBeNull();
  });
  it('garde un candidat pertinent avec langue et détail', () => {
    const t = finalizeCandidate({
      ...base,
      title: 'IBAN validation with bank code check',
      excerpt: 'the BIC lookup fails for Swiss clearing numbers',
    });
    expect(t).not.toBeNull();
    expect(t?.lang).toBe('en');
    expect(t?.scoreDetail.length).toBeGreaterThan(0);
  });
});

describe('parsers — payloads réels → candidats propres', () => {
  it('Stack Exchange : strip HTML, activité lisible', () => {
    const [c] = parseStackExchange(
      {
        items: [
          {
            title: 'IBAN &amp; BIC <b>check</b>',
            link: 'https://stackoverflow.com/questions/1',
            body: '<p>How do I validate?</p>',
            score: 27,
            answer_count: 10,
            view_count: 66441,
            creation_date: 1352678400,
          },
        ],
      },
      'stackoverflow',
    );
    expect(c.title).toBe('IBAN & BIC check');
    expect(c.excerpt).toBe('How do I validate?');
    expect(c.activity).toContain('66441 vues');
    expect(c.threadCreatedAt).toBe('2012-11-12');
  });

  it('GitHub : body null toléré, état et commentaires exposés', () => {
    const [c] = parseGitHubIssues({
      items: [{ html_url: 'https://github.com/a/b/issues/1', title: 'Find BIC from IBAN', body: null, state: 'open', comments: 3, created_at: '2013-07-01T00:00:00Z' }],
    });
    expect(c.excerpt).toBe('');
    expect(c.activity).toBe('open · 3 comm.');
    expect(c.threadCreatedAt).toBe('2013-07-01');
  });

  it('HN et pullpush : URLs reconstruites', () => {
    const [h] = parseHN({ hits: [{ objectID: '123', title: 'Show HN: IBAN tool', points: 3, num_comments: 0, created_at: '2026-04-01T00:00:00Z' }] });
    expect(h.url).toBe('https://news.ycombinator.com/item?id=123');
    const [p] = parsePullpush({ data: [{ permalink: '/r/fintech/comments/x/y/', title: 'IBAN API?', subreddit: 'fintech', score: 5, num_comments: 2, created_utc: 1750000000 }] });
    expect(p.url).toBe('https://reddit.com/r/fintech/comments/x/y/');
    expect(p.activity).toContain('r/fintech');
  });

  it('payloads inattendus → listes vides, jamais de throw', () => {
    expect(parseStackExchange(null, 'stackoverflow')).toEqual([]);
    expect(parseGitHubIssues({})).toEqual([]);
    expect(parseHN({ hits: [{}] })).toEqual([]);
    expect(parsePullpush(undefined)).toEqual([]);
  });
});

describe('interpretCheck — verdicts de présence marketplace', () => {
  const def = (kind: MarketplaceDef['kind'], marker?: string): MarketplaceDef => ({
    slug: 't',
    name: 'T',
    url: 'https://t',
    kind,
    marker,
    checkTarget: 'https://t',
    cadenceHours: 24,
  });

  it('bazaar : compte agrégé → listé ou absent avec consigne', () => {
    expect(interpretCheck(def('bazaar'), 200, '5')).toEqual({ status: 'listed', detail: '5 ressources au catalogue' });
    const absent = interpretCheck(def('bazaar'), 200, '0');
    expect(absent.status).toBe('absent');
    expect(absent.detail).toContain('micro-règlement');
  });

  it('github_issue : open = en file, closed = à vérifier à la main', () => {
    const open = interpretCheck(def('github_issue'), 200, JSON.stringify({ state: 'open', comments: 0, updated_at: '2026-04-28T10:00:00Z' }));
    expect(open.status).toBe('pending');
    expect(open.detail).toContain('2026-04-28');
    expect(interpretCheck(def('github_issue'), 200, JSON.stringify({ state: 'closed' })).status).toBe('manual');
  });

  it('http_contains : 404 = absent, marqueur trouvé = listé (tier/score extraits)', () => {
    expect(interpretCheck(def('http_contains', 'ibanforge'), 404, '').status).toBe('absent');
    expect(interpretCheck(def('http_contains', 'ibanforge'), 200, 'nothing here').status).toBe('absent');
    const listed = interpretCheck(def('http_contains', 'ibanforge'), 200, '{"name":"IBANforge","tier":"verified","score":84.4}');
    expect(listed.status).toBe('listed');
    expect(listed.detail).toContain('verified');
    expect(listed.detail).toContain('84.4');
  });

  it('npm : version et date de publication', () => {
    const out = interpretCheck(def('npm'), 200, JSON.stringify({ 'dist-tags': { latest: '1.4.3' }, time: { '1.4.3': '2026-08-05T21:00:00Z' } }));
    expect(out.status).toBe('listed');
    expect(out.detail).toBe('v1.4.3 publiée le 2026-08-05');
  });

  it('dead_watch : un mort qui répond redevient un sujet', () => {
    expect(interpretCheck(def('dead_watch'), 404, '').status).toBe('dead');
    expect(interpretCheck(def('dead_watch'), 200, 'hello').status).toBe('manual');
  });
});

describe('MARKETPLACES — cohérence des définitions', () => {
  it('slugs uniques, cibles présentes pour les checks auto', () => {
    const slugs = MARKETPLACES.map((m) => m.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const m of MARKETPLACES) {
      if (m.kind !== 'manual') {
        expect(m.checkTarget, m.slug).toBeTruthy();
        expect(m.cadenceHours, m.slug).toBeGreaterThan(0);
      }
    }
  });
});
