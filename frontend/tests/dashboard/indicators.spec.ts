import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type fr from '../../messages/fr.json';
import axe from 'axe-core';
import { measureGradientContrast } from './contrast-helper';

const api = process.env.IBF_RECIPE_API_URL!;
const base = process.env.IBF_RECIPE_BASE_URL!;
let errors: string[];
let external: string[];
let messages: typeof fr.dashboard;
let locale: string;

async function control(request: APIRequestContext, command: Record<string, unknown> = {}) {
  const response = await request.post(api + '/__recipe', {
    headers: { 'x-recipe-token': process.env.IBF_RECIPE_TOKEN! }, data: command,
  });
  expect(response.status()).toBe(200);
  return response.json() as Promise<{ requests: string[] }>;
}
async function visit(page: Page, query = 'cohort=active_today') {
  const response = await page.goto(`${locale === 'en' ? '' : '/' + locale}/dashboard/indicators?${query}`, { waitUntil: 'commit' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('[data-indicator-accounts-page]')).toBeVisible();
}
const cards = (page: Page) => page.locator('[data-business-account]');
async function audit(page: Page, name: string, info: import('@playwright/test').TestInfo) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async () => {
    const a = (window as unknown as { axe: typeof axe }).axe;
    return a.run(document.querySelector('[data-indicator-accounts-page]')!, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
  });
  await info.attach(name, { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.violations.map(v => ({ id: v.id, cibles: v.nodes.map(n => n.target) }))).toEqual([]);
  const unsupported = result.incomplete.filter(rule => rule.id !== 'color-contrast' || rule.nodes.length === 0 || rule.nodes.some(node =>
    node.all.length !== 0 || node.none.length !== 0 || node.target.length !== 1 || typeof node.target[0] !== 'string' || node.any.length === 0 || node.any.some(check => check.data?.messageKey !== 'bgGradient')));
  expect(unsupported.map(rule => ({ id: rule.id, cibles: rule.nodes.map(node => node.target) })), 'Cas non pris en charge par la mesure complémentaire').toEqual([]);
  const targets = result.incomplete.flatMap(rule => rule.nodes.map(node => node.target[0] as string));
  if (targets.length) {
    const contrast = await measureGradientContrast(page, targets);
    await info.attach(name + '-fond-sans-glyphes', { body: contrast.background, contentType: 'image/png' });
    await info.attach(name + '-fond-fenetre', { body: contrast.viewportBackground, contentType: 'image/png' });
    await info.attach(name + '-contrastes-mesures', { body: JSON.stringify(contrast.measurements), contentType: 'application/json' });
    expect(contrast.measurements.filter(row => !row.passes).map(row => ({ cible: row.selector, seuil: row.threshold, minimum: row.worst })), 'Contraste des couleurs du navigateur contre le fond réellement capturé').toEqual([]);
  }

}
const content = (page: Page) => page.locator('#dashboard-content');
async function refresh(page: Page) {
  const badge = content(page).locator('[data-view-freshness]');
  const before = await badge.locator('time').getAttribute('datetime');
  await badge.getByRole('button', { name: messages.freshness.refreshLabel, exact: true }).click();
  await expect(badge.locator('time')).not.toHaveAttribute('datetime', before!);
  await expect(badge.getByRole('button', { name: messages.freshness.refreshLabel, exact: true })).toBeEnabled();
}

test.beforeEach(async ({ page, context, request }, info) => {
  locale = String(info.project.use.locale);
  messages = JSON.parse(readFileSync(path.resolve('messages', locale + '.json'), 'utf8')).dashboard;
  errors = []; external = [];
  await control(request, { reset: true });
  const body = Buffer.from(JSON.stringify({ iat: Math.floor(Date.now() / 1000), v: 1 })).toString('base64url');
  const signature = createHmac('sha256', process.env.IBF_RECIPE_SESSION_SECRET!).update(body).digest('base64url');
  await context.addCookies([{ name: 'ibanforge_session', value: body + '.' + signature, url: base, httpOnly: true, sameSite: 'Lax' }]);
  // Toute requête du navigateur reste dans cette recette ; aucun compte réel n’est ouvert.
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([base, api].includes(url.origin)) return route.continue();
    external.push(url.origin);
    return route.abort('blockedbyclient');
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' && /MISSING_MESSAGE|hydration|NEXT_INTL/.test(message.text())) errors.push(message.text());
  });
});

test.afterEach(async ({ page, request }, info) => {
  // Libère aussi les lectures retenues si un scénario échoue avant sa dernière assertion.
  await control(request, { release: true });
  await info.attach('lectures-fictives', { body: JSON.stringify(await control(request)), contentType: 'application/json' });
  expect(errors, 'Erreurs JavaScript ou de traduction').toEqual([]);
  expect(external, 'La page a essayé de consulter un service extérieur').toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Débordement horizontal de la page').toBe(false);
});

test('les quatre indicateurs ouvrent les comptes correspondants et leur dossier', async ({ page }, info) => {
  await page.goto(`${locale === 'en' ? '' : '/' + locale}/dashboard?view=today`, { waitUntil: 'commit' });
  await content(page).getByRole('link', { name: `${messages.pilot.explore} · ${messages.pilot.activeToday}`, exact: true }).click();
  const t = messages.businessAccounts;
  const groups = [
    ['active_today', ['alpha', 'gamma', 'delta']], ['active_week', ['alpha', 'gamma', 'delta']],
    ['new_accounts', ['alpha', 'beta']], ['new_buyers', ['alpha']],
  ] as const;
  for (const [cohort, names] of groups) {
    await content(page).getByRole('navigation', { name: t.selection }).getByRole('link', { name: t.cohort[cohort], exact: true }).click();
    await expect(content(page).getByRole('heading', { level: 1 })).toHaveText(t.cohort[cohort]);
    await expect(cards(page)).toHaveCount(names.length);
    const nouns = { fr: ['compte', 'comptes'], en: ['account', 'accounts'], de: ['Konto', 'Konten'] };
    await expect(page.locator('[data-business-accounts] > div').first().locator('span')).toHaveText(nouns[locale as keyof typeof nouns][names.length === 1 ? 0 : 1]);
    await expect(cards(page).locator('h2')).toHaveText(names.map(name => `contact@${name}.example.net`));
    await expect(page.locator('[data-business-accounts]')).toContainText('UTC');
    await expect(page.locator('[data-business-accounts]')).toContainText(t.readAt.split('{at}')[0]);
    if (cohort === 'new_accounts') await expect(cards(page).nth(1)).toContainText(t.noPurchase);
  }
  await audit(page, 'accessibilite-comptes', info);
  await info.attach('comptes-mobile', { body: await page.locator('[data-indicator-accounts-page]').screenshot(), contentType: 'image/png' });
  const link = cards(page).first().getByRole('link');
  await expect(link).toHaveAttribute('href', /open=contact%40alpha.example.net/);
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await link.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).toContainText('contact@alpha.example.net');
});

test('les échecs de source sont expliqués puis une actualisation retrouve la liste', async ({ page, request }, info) => {
  const t = messages.businessAccounts, failed = messages.overview.failed;
  await control(request, { accounts: 'unauthorized' });
  await visit(page);
  for (const [mode, text] of [
    ['unauthorized', failed.token.replace('{status}', '401')], ['forbidden', failed.token.replace('{status}', '403')],
    ['unavailable', failed.http.replace('{status}', '503')], ['network', failed.unreachable], ['invalid', t.invalidFormat],
  ]) {
    await control(request, { accounts: mode }); await refresh(page);
    const notice = page.locator('[data-business-accounts-unavailable]');
    await expect(notice).toContainText(text); await expect(cards(page)).toHaveCount(0);
    await expect(content(page).getByText(t.empty, { exact: true })).toHaveCount(0);
  }
  await audit(page, 'accessibilite-indisponibilite', info);
  await control(request, { accounts: 'normal' }); await refresh(page);
  await expect(cards(page)).toHaveCount(3); await expect(page.locator('[data-business-accounts-unavailable]')).toHaveCount(0);
});

test('une liste vide et sa pagination gardent leur sens', async ({ page, request }) => {
  const t = messages.businessAccounts;
  await control(request, { accounts: 'empty' }); await visit(page);
  await expect(content(page).getByText(t.empty, { exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(0); await expect(page.locator('[data-business-accounts-unavailable]')).toHaveCount(0);
  await control(request, { accounts: 'pagination' }); await refresh(page);
  await expect(cards(page)).toHaveCount(50); await expect(cards(page).first().locator('h2')).toHaveText('compte-1@alpha.example.net');
  await content(page).getByRole('navigation', { name: t.pagination }).getByRole('link', { name: t.next, exact: true }).click();
  await expect(cards(page)).toHaveCount(5); await expect(cards(page).first().locator('h2')).toHaveText('compte-51@alpha.example.net');
  await expect(content(page).getByRole('navigation', { name: t.pagination })).toContainText(t.page.replace('{page}', '2').replace('{pages}', '2'));
  await content(page).getByRole('navigation', { name: t.pagination }).getByRole('link', { name: t.previous, exact: true }).click();
  await expect(cards(page)).toHaveCount(50);
});

test('une ancienne adresse inhabituelle reste du texte et ne masque pas le relevé', async ({ page, request }) => {
  await control(request, { accounts: 'legacy' }); await visit(page);
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).first().locator('h2')).toHaveText('<b>exemple</b>@alpha.example.net');
  await expect(cards(page).first().locator('h2 b')).toHaveCount(0);
  await expect(cards(page).first().getByRole('link')).toHaveAttribute('href', /open=%3Cb%3Eexemple%3C%2Fb%3E%40alpha.example.net/);
});

test('une sélection invalide et une session absente ne lisent pas les comptes', async ({ page, request, browser }) => {
  await visit(page, 'cohort=inconnu');
  await expect(content(page).getByText(messages.businessAccounts.invalidSelection, { exact: true })).toBeVisible();
  expect((await control(request)).requests.filter(url => url.startsWith('/v1/admin/business-accounts'))).toEqual([]);
  // Une vraie visite sans session n’altère pas les cookies d’une page encore en train de précharger ses liens.
  const anonymous = await browser.newContext({ baseURL: base, locale, viewport: page.viewportSize()! });
  try {
    await anonymous.route('**/*', route => {
      const url = new URL(route.request().url());
      if ([base, api].includes(url.origin)) return route.continue();
      external.push(url.origin); return route.abort('blockedbyclient');
    });
    const signedOut = await anonymous.newPage();
    signedOut.on('pageerror', error => errors.push(error.message));
    signedOut.on('console', message => {
      if (message.type() === 'error' && /MISSING_MESSAGE|hydration|NEXT_INTL/.test(message.text())) errors.push(message.text());
    });
    expect(await anonymous.cookies()).toEqual([]);
    const response = await signedOut.goto(`${locale === 'en' ? '' : '/' + locale}/dashboard/indicators?cohort=active_today`, { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBe(200); await expect(signedOut).toHaveURL(/\/dashboard\/login/);
    expect((await control(request)).requests.filter(url => url.startsWith('/v1/admin/business-accounts'))).toEqual([]);
  } finally { await anonymous.close(); }
});

test('une lecture lente garde le titre et les comptes de la même population', async ({ page, request }) => {
  await visit(page); await expect(cards(page)).toHaveCount(3);
  await control(request, { hold: 'accounts' });
  await content(page).getByRole('navigation', { name: messages.businessAccounts.selection })
    .getByRole('link', { name: messages.businessAccounts.cohort.new_buyers, exact: true }).click({ noWaitAfter: true });
  await expect.poll(async () => (await control(request)).requests.some(url => url.includes('business-accounts?cohort=new_buyers'))).toBe(true);
  // WebKit peut conserver l’ancienne vue pendant la lecture du flux : titre et liste doivent rester cohérents.
  const snapshot = await content(page).evaluate(el => ({ title: el.querySelector('h1')?.textContent, rows: el.querySelectorAll('[data-business-account]').length }));
  if (snapshot.title === messages.businessAccounts.cohort.new_buyers) expect(snapshot.rows).toBe(0);
  else { expect(snapshot.title).toBe(messages.businessAccounts.cohort.active_today); expect(snapshot.rows).toBe(3); }
  await control(request, { release: true });
  await expect(content(page).getByRole('heading', { level: 1 })).toHaveText(messages.businessAccounts.cohort.new_buyers);
  await expect(cards(page)).toHaveCount(1); await expect(cards(page).locator('h2')).toHaveText('contact@alpha.example.net');
});
