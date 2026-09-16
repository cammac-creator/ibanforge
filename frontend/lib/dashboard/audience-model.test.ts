import { describe, it, expect } from 'vitest';
import { audienceFixture } from './audience-fixture';
import {
  audienceDate,
  audienceSince,
  audienceTab,
  googleSummary,
  rank,
  readAudienceFunnel,
  readAudienceGoogle,
  readAudienceSources,
  readAudienceWeb,
  siteSummary,
} from './audience-model';
import { overviewHref } from './workspace';
import type { SearchConsole, WebEventsSummary } from '@/lib/dashboard-overview';

const web: WebEventsSummary = {
  days: 7,
  since: '2026-06-01 10:00:00',
  total: 227,
  by_name: [
    { name: 'cta:key', count: 12 },
    { name: 'nav:status', count: 5 },
    { name: 'film:start', count: 10 },
    { name: 'api:trial', count: 200 },
  ],
  by_page: [
    { page: '/api', locale: 'en', count: 200 },
    { page: '/', locale: 'fr', count: 20 },
    { page: '/', locale: 'de', count: 7 },
  ],
  by_referrer: [{ referrer: 'alpha.example.net', count: 9 }],
  by_day: [{ day: '2026-06-16', count: 227 }],
};
const google: SearchConsole = {
  site: 'https://alpha.example.net',
  window_end: '2026-06-14',
  fetched_at: '2026-06-16 08:00:00',
  stale: false,
  top_window: { start: '2026-06-01', end: '2026-06-14' },
  queries: [],
  pages: [],
  inspections: [],
  sitemaps: [],
  weeks: [
    { start: '2026-06-08', end: '2026-06-14', clicks: 30, impressions: 1000, ctr: 3, position: 8 },
    { start: '2026-06-01', end: '2026-06-07', clicks: 10, impressions: 100, ctr: 10, position: 9 },
  ],
};

describe('Fenêtres et navigation Audience', () => {
  it('compte les jours calendaires UTC, même à la frontière du mois et en heure suisse', () => {
    expect(audienceSince(7, '2026-04-01T23:30:00Z')).toBe('2026-03-26');
    expect(audienceSince(90, '2026-06-16T12:00:00Z')).toBe('2026-03-19');
    expect(audienceSince(0, '2026-06-16T12:00:00Z')).toBe('2026-05-18');
  });
  it('garde le sous-onglet lors du changement de période sans transporter un paramètre libre', () => {
    expect(overviewHref('/fr/dashboard', 'growth', 90, 'journey')).toBe(
      '/fr/dashboard?view=growth&period=90&audience=journey',
    );
    expect(overviewHref('/fr/dashboard', 'revenue', 7, 'google')).toBe(
      '/fr/dashboard?view=revenue&period=7',
    );
    expect(overviewHref('/fr/dashboard', 'growth', 7, 'x&secret=1')).toBe(
      '/fr/dashboard?view=growth&period=7',
    );
    expect(audienceTab(['google'])).toBe('summary');
    expect(audienceTab('journey')).toBe('journey');
  });
  it('formate la date sans divergence de moteur ou de fuseau', () => {
    expect(audienceDate('2026-06-16 23:59:59')).toBe('16.06.2026');
    expect(audienceDate(null)).toBe('—');
  });
});

describe('Ne pas confondre clics, événements et personnes', () => {
  it('exclut API et film du total de clics, et /api des pages et langues', () => {
    expect(readAudienceWeb(web)).toEqual(web);
    const site = siteSummary(web);
    expect(site.clicks).toBe(17);
    expect(site.pages).toEqual([{ label: '/', value: 27 }]);
    expect(site.locales).toEqual([
      { label: 'fr', value: 20 },
      { label: 'de', value: 7 },
    ]);
    expect(site.films).toEqual([{ label: 'film:start', value: 10 }]);
  });
  it('regroupe les lignes sans perdre leur valeur ni changer la source', () => {
    expect(
      rank([
        { label: 'fr', value: 4 },
        { label: 'de', value: 9 },
        { label: 'fr', value: 7 },
      ]),
    ).toEqual([
      { label: 'fr', value: 11 },
      { label: 'de', value: 9 },
    ]);
  });
  it('refuse des événements invalides plutôt que de leur inventer zéro', () => {
    expect(readAudienceWeb({ ...web, by_name: [{ name: 'cta:key', count: -1 }] })).toBeNull();
    expect(readAudienceWeb({ ...web, by_page: null })).toBeNull();
    expect(readAudienceSources({ total: 0 })).toBeNull();
    expect(
      readAudienceSources({
        period_days: 7,
        since: null,
        total: 0,
        channels: [],
        landings: [],
        referrers: [],
        campaigns: [],
      })?.total,
    ).toBe(0);
  });
});

describe('Google : périodes complètes et CTR pondéré', () => {
  it('ordonne les semaines et divise la somme des clics par celle des impressions', () => {
    expect(readAudienceGoogle(google)).toEqual(google);
    const result = googleSummary(google);
    expect(result.clicks).toBe(40);
    expect(result.ctr).toBeCloseTo(40 / 1100);
    expect(result.delta).toBe(2);
    expect(google.weeks[0].start).toBe('2026-06-08');
  });
  it('ne fabrique pas une comparaison si une semaine manque ou vaut zéro', () => {
    expect(googleSummary({ ...google, weeks: [google.weeks[0]] }).delta).toBeNull();
    expect(
      googleSummary({
        ...google,
        weeks: [google.weeks[0], { ...google.weeks[1], start: '2026-05-25', end: '2026-05-31' }],
      }).delta,
    ).toBeNull();
    expect(
      googleSummary({ ...google, weeks: [google.weeks[0], { ...google.weeks[1], clicks: 0 }] })
        .delta,
    ).toBeNull();
    expect(googleSummary({ ...google, weeks: [] }).ctr).toBeNull();
  });
  it('conserve une lecture ancienne mais refuse des lignes mal formées', () => {
    expect(readAudienceGoogle({ ...google, stale: true, upstream_status: 502 })?.stale).toBe(true);
    expect(readAudienceGoogle({ ...google, queries: [{ key: 'exemple', clicks: 2 }] })).toBeNull();
  });
});

describe('Essais : dénominateurs, recul et limites de rapprochement', () => {
  it('conserve un taux nullement mesurable et ses cas en attente', () => {
    const parsed = readAudienceFunnel(audienceFixture());
    expect(parsed?.indicators.paid_use_7d).toEqual({
      numerator: 0,
      denominator: 0,
      pending: 1,
      value: null,
      coverage: 0,
    });
    expect(parsed?.indicators.first_result_24h.coverage).toBe(0.75);
    expect(parsed?.device.mcp_remote.sessions).toBe(48);
  });
  it.each([null, {}, { indicators: {} }])('refuse une réponse partielle : %j', (raw) => {
    expect(readAudienceFunnel(raw)).toBeNull();
  });
  it('refuse un pourcentage contredisant les cas observés et un faux zéro sans dénominateur', () => {
    const raw = audienceFixture();
    raw.indicators.first_result_24h.value = 0.99;
    expect(readAudienceFunnel(raw)).toBeNull();
    const empty = audienceFixture();
    empty.indicators.paid_use_7d.value = 0;
    expect(readAudienceFunnel(empty)).toBeNull();
  });
  it('ne force pas à 100 % un rapport croisant les compteurs quotidiens et les lignées à la seconde', () => {
    const raw = audienceFixture();
    raw.device.chain.lineages_of_delivered = { numerator: 2, denominator: 1, value: 2 };
    expect(readAudienceFunnel(raw)?.device.chain.lineages_of_delivered.value).toBe(2);
  });
});
