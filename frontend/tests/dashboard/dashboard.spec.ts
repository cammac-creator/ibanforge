import { auditAccessibility } from './accessibility-helper';
import { measureGradientContrast } from './contrast-helper';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type fr from '../../messages/fr.json';

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
  return response.json() as Promise<{ requests: string[]; writes: string[]; stripeDays: { today: string; yesterday: string; old: string } }>;
}
async function visit(page: Page, view: string) {
  const response = await page.goto(`${locale === 'en' ? '' : '/' + locale}/dashboard?view=${view}`, { waitUntil: 'commit' });
  expect(response?.status()).toBe(200);
  await expect(page.locator('html')).toHaveAttribute('lang', locale);
  await expect(page.locator('#dashboard-content')).toBeVisible();
}
const content = (page: Page) => page.locator('#dashboard-content');
const metric = (page: Page, label: string) => content(page).locator('article').filter({ has: page.getByRole('heading', { name: label, exact: true }) }).locator('strong').first();
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

test('les indicateurs distinguent activité, inscriptions et premiers acheteurs', async ({ page }) => {
  await visit(page, 'today');
  for (const [key, value] of [['activeToday', '3'], ['newAccounts', '2'], ['newBuyers', '1'], ['activeWeek', '3']] as const) {
    await expect(metric(page, messages.pilot[key])).toHaveText(value);
  }
  await expect(content(page).getByText(messages.pilot.dayOpen, { exact: true })).toBeVisible();
});

test('comprendre ouvre le guide et permet de poursuivre au clavier', async ({ page, browserName }, info) => {
  await visit(page, 'today');
  await page.waitForLoadState('load');
  const guide = page.locator('#metric-guide');
  const summary = guide.locator('summary');
  const link = content(page).getByRole('link', { name: messages.pilot.understand, exact: true });
  await expect(guide).not.toHaveAttribute('open');
  await link.click();
  await expect(guide).toHaveAttribute('open');
  await expect(page).toHaveURL(/#metric-guide$/);
  await expect(summary).toBeFocused();
  await expect(guide.getByText(messages.pilot.guideIntro, { exact: true })).toBeVisible();
  await expect(guide.getByRole('link', { name: `${messages.pilot.openAnalysis} →`, exact: true })).toHaveCount(10);
  await summary.press('Enter');
  await expect(guide).not.toHaveAttribute('open');
  await link.focus();
  await page.keyboard.press('Enter');
  await expect(guide).toHaveAttribute('open');
  await expect(summary).toBeFocused();
  // WebKit suit son réglage natif : Option-Tab inclut les liens dans le parcours.
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(guide.getByRole('link', { name: `${messages.pilot.openAnalysis} →`, exact: true }).first()).toBeFocused();
  await info.attach('guide-ouvert', { body: await page.screenshot(), contentType: 'image/png' });
});

test('le clic modifié ouvre le guide dans un autre onglet sans changer le premier', async ({ page, context, request }, info) => {
  await visit(page, 'today');
  await page.waitForLoadState('load');
  const initial = page.url();
  const guide = page.locator('#metric-guide');
  await expect(guide).not.toHaveAttribute('open');
  const [nouvelOnglet] = await Promise.all([
    context.waitForEvent('page'),
    content(page).getByRole('link', { name: messages.pilot.understand, exact: true }).click({ modifiers: ['ControlOrMeta'] }),
  ]);
  nouvelOnglet.on('pageerror', error => errors.push(error.message));
  try {
    await nouvelOnglet.waitForLoadState('load');
    await expect(nouvelOnglet).toHaveURL(initial + '#metric-guide');
    await expect(nouvelOnglet.locator('#metric-guide')).toBeVisible();
    await expect(page).toHaveURL(initial);
    await expect(guide).not.toHaveAttribute('open');
    expect((await control(request)).writes).toEqual([]);
    await info.attach('guide-nouvel-onglet', {
      body: JSON.stringify({ nouvelOnglet: true, originalInchange: true, fragment: new URL(nouvelOnglet.url()).hash }),
      contentType: 'application/json',
    });
  } finally {
    await nouvelOnglet.close();
  }
});

test('une source indisponible reste inconnue et ne devient pas zéro', async ({ page, request }) => {
  await control(request, { business: 'unavailable' });
  await visit(page, 'today');
  for (const key of ['activeToday', 'newAccounts', 'newBuyers', 'activeWeek'] as const) {
    await expect(metric(page, messages.pilot[key])).toHaveText('—');
  }
  await expect(content(page).getByText(messages.pilot.unavailable, { exact: true })).toBeVisible();
});

test('les réponses API restent lisibles, filtrables et entièrement accessibles', async ({ page }) => {
  await visit(page, 'service');
  await content(page).locator('summary').filter({ hasText: messages.overview.details.open }).click();
  const panel = content(page).locator('[data-api-responses]'), t = messages.responses;
  const cards = panel.locator('[data-api-response-path]');
  await expect(cards).toHaveCount(12);
  await panel.getByRole('button', { name: t.showAll.replace('{count}', '18'), exact: true }).click();
  await expect(cards).toHaveCount(18);
  await panel.getByRole('button', { name: t.s5xx, exact: true }).click();
  await expect(cards).toHaveCount(1);
  const summary = cards.locator('summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(cards.getByText('HTTP 500', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: t.all, exact: true }).click();
  await panel.getByRole('searchbox').fill('une-adresse-longue');
  await expect(cards).toHaveCount(1);
  await expect(cards.getByText(t.unmeasured, { exact: true })).toBeVisible();
  const geometry = await cards.evaluateAll(items => items.flatMap(item => {
    const box = item.getBoundingClientRect();
    return [...item.querySelectorAll('h4, dt, dd, summary')].filter(child => {
      const b = child.getBoundingClientRect(); return b.width > 0 && (b.left < box.left - 1 || b.right > box.right + 1);
    }).map(child => child.tagName);
  }));
  expect(geometry, 'Texte hors de sa carte').toEqual([]);
  await panel.getByRole('searchbox').fill('aucun-chemin-invente');
  await expect(panel.getByText(t.noMatch, { exact: true })).toBeVisible();
});

test('le temps écoulé ne recharge pas les sources et le bouton annonce son attente', async ({ page }) => {
  await page.clock.install(); await visit(page, 'service');
  const badge = content(page).locator('[data-view-freshness]'), t = messages.freshness;
  await expect(badge.getByText(t.age.now, { exact: true })).toBeVisible();
  const epoch = Date.parse((await badge.locator('time').getAttribute('datetime'))!);
  let requests = 0;
  page.on('request', request => { if (request.url().includes('_rsc=') && !request.headers()['next-router-prefetch']) requests++; });
  for (const [minutes, label] of [[15, t.age.minutes.replace('{value}', '15')], [60, t.age.hours.replace('{value}', '1')]] as const) {
    await page.clock.setSystemTime(epoch + minutes * 60_000); await page.clock.fastForward(30_000);
    await expect(badge.getByText(label, { exact: true })).toBeVisible();
    expect(requests).toBe(0);
  }
  await page.clock.setSystemTime(Date.now());
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/*_rsc=*', async route => { await held; await route.fallback(); });
  const button = badge.getByRole('button', { name: t.refreshLabel, exact: true });
  // La commande vocale et le lecteur d’écran retrouvent les mots visibles.
  const visibleName = (text: string) => text.trim().replace(/…$/, '').trim().toLowerCase();
  const idleText = visibleName(await button.innerText());
  expect(idleText).not.toBe(''); expect(visibleName(t.refreshLabel)).toContain(idleText);
  const box = await button.boundingBox(); expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
  try {
    await button.click();
    const busy = badge.getByRole('button', { name: t.refreshingLabel, exact: true });
    await expect(busy).toBeDisabled(); await expect(busy).toHaveAttribute('aria-busy', 'true');
    const busyText = visibleName(await busy.innerText());
    expect(busyText).not.toBe(''); expect(visibleName(t.refreshingLabel)).toContain(busyText);
    expect(await busy.locator('svg').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
  } finally { release(); }
  await expect(button).toBeEnabled();
  await expect(badge.getByText(t.age.now, { exact: true })).toBeVisible();
  expect(requests).toBe(1);
});

test('les cartes de comptes arrivent pendant que Stripe attend', async ({ page, request }) => {
  await control(request, { hold: 'stripe' });
  try {
    await visit(page, 'revenue');
    await expect(content(page).locator('[data-money-loading="stripe"]')).toBeVisible();
    await expect(content(page).locator('[data-account-count="credits"]')).toHaveText('1');
    await expect(content(page).locator('[data-account-count="quota"]')).toHaveText('1');
  } finally { await control(request, { release: true }); }
  await expect(content(page).locator('[data-money-stripe-unavailable]')).toBeVisible();
});

test('actualiser le portefeuille conserve son solde si l’historique échoue', async ({ page, request }) => {
  await visit(page, 'revenue');
  const wallet = content(page).locator('[data-wallet-card]'), t = messages.revenue;
  const balance = wallet.locator('[data-wallet-balance]');
  await expect(balance).toHaveText(/7[,.]5\s+USDC/);
  await wallet.getByRole('button', { name: t.loadHistory, exact: true }).click();
  await expect(wallet.getByRole('button', { name: t.refreshHistory, exact: true })).toBeVisible();
  const oldHistory = await wallet.locator('.mt-4').last().textContent();
  await control(request, { wallet: 13.5, walletFailure: 'full', hold: 'full' });
  await refresh(page);
  await expect(balance).toHaveText(/13[,.]5\s+USDC/);
  expect(await wallet.locator('.mt-4').last().textContent()).toBe(oldHistory);
  await control(request, { release: true });
  await expect(wallet.getByRole('alert')).toBeVisible();
  await expect(balance).toHaveText(/13[,.]5\s+USDC/);
  expect(await wallet.locator('.mt-4').last().textContent()).toBe(oldHistory);
  const reads = (await control(request)).requests.filter(url => url.startsWith('/admin/revenue'));
  expect(reads.filter(url => url.includes('balance_only'))).toHaveLength(2);
  expect(reads.filter(url => !url.includes('balance_only'))).toHaveLength(2);
});

test('les crédits offerts restent distincts des achats et les semaines sont lisibles', async ({ page }) => {
  await visit(page, 'growth&audience=details&period=7');
  const t = messages.acquisition;
  const activation = content(page).locator('[data-activation-summary]');
  const access = activation.locator('dl > div').filter({ has: page.locator('dt').filter({ hasText: t.access }) }).first();
  await expect(access.locator('dd')).toContainText('2');
  await expect(activation).toContainText(t.accessNote);
  // Termine la lecture de cette page avant le second chargement complet : WebKit
  // rapporte sinon l’annulation de la sonde comme une erreur d’accès interorigine.
  await expect(content(page).locator('[data-live-health] [role="status"]')).toHaveText(messages.monitoring.probeReachable);
  await visit(page, 'service&period=7');
  await content(page).locator('summary').filter({ hasText: messages.overview.details.open }).click();
  const panel = content(page).locator('[data-acquisition]');
  await expect(panel.locator('[data-source-name]')).toHaveText('documentation-integration-exemple');
  await expect(panel.getByText(t.inProgress, { exact: true })).toBeVisible();
  await expect(panel).toContainText(t.period.replace('{days}', '30'));
  await expect(panel.locator('[data-acquisition-week] dd')).toHaveText(['50 %', '100 %']);
  const overflow = await panel.locator('li').evaluateAll(items => items.some(item => {
    const box = item.getBoundingClientRect();
    return [...item.querySelectorAll('p,dt,dd')].some(child => { const b = child.getBoundingClientRect(); return b.width > 0 && (b.left < box.left - 1 || b.right > box.right + 1); });
  }));
  expect(overflow).toBe(false);
});


test('les courbes gardent leurs textes et leurs commandes lisibles après un changement de taille ou de période', async ({ page }, info) => {
  await visit(page, 'today');
  const t = messages.pilot;
  const daily = content(page).getByRole('region', { name: t.dailyTitle, exact: true }).filter({ has: page.getByRole('heading', { name: t.dailyTitle, exact: true }) });
  const weekly = content(page).getByRole('region', { name: t.weeklyTitle, exact: true }).filter({ has: page.getByRole('heading', { name: t.weeklyTitle, exact: true }) });
  await expect(daily).toBeVisible();
  const svg = daily.locator('svg'), slider = daily.getByRole('slider');
  const buttons = weekly.locator('button[aria-pressed]');
  const readGeometry = async () => {
    await expect.poll(() => svg.evaluate(el => {
      const box = el.getBoundingClientRect(), view = (el as SVGSVGElement).viewBox.baseVal;
      return Math.max(Math.abs(box.width - view.width), Math.abs(box.height - view.height));
    })).toBeLessThanOrEqual(1);
    const axes = await svg.locator('text').evaluateAll(items => items.map(el => { const b = el.getBoundingClientRect(); return { texte: el.textContent, largeur: b.width, hauteur: b.height }; }));
    const weeks = await buttons.evaluateAll(items => items.map(el => { const b = el.getBoundingClientRect(); return { largeur: b.width, hauteur: b.height, policeDate: getComputedStyle(el.lastElementChild!).fontSize }; }));
    await expect.poll(() => buttons.evaluateAll(items => {
      const frame = items[0].parentElement!.getBoundingClientRect();
      return items.filter(el => {
        const box = el.getBoundingClientRect();
        return box.right > frame.left + 1 && box.left < frame.right - 1 && (box.left < frame.left - 1 || box.right > frame.right + 1);
      }).length;
    }), { message: 'Aucune semaine coupée au bord du cadre après stabilisation' }).toBe(0);
    // Le débordement et son indication doivent être lus dans la même image après redimensionnement.
    await expect.poll(() => weekly.evaluate((el, label) => {
      const frame = el.querySelector('[role="group"]')!;
      const hint = [...el.querySelectorAll('p')].find(p => p.textContent === label);
      if (!hint) return false;
      const scrolling = frame.scrollWidth > frame.clientWidth + 1;
      const visible = getComputedStyle(hint).display !== 'none' && hint.getBoundingClientRect().height > 0;
      return scrolling === visible;
    }, t.weekScrollHint), { message: 'L’indication correspond au débordement actuel des semaines' }).toBe(true);
    const cursor = await slider.boundingBox();
    expect(axes.every(item => item.hauteur >= 11), 'Hauteur des textes dans le repère du navigateur').toBe(true);
    expect(weeks).toHaveLength(8);
    expect(weeks.every(item => item.largeur >= 43.9 && item.hauteur >= 44 && parseFloat(item.policeDate) >= 12)).toBe(true);
    expect(cursor!.height).toBeGreaterThanOrEqual(44);
    expect((await daily.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await weekly.locator('summary').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    return { largeurNavigateur: page.viewportSize()!.width, axes, semaines: weeks, curseur: cursor };
  };
  const assertSelectedVisible = async () => {
    await expect.poll(() => buttons.evaluateAll(items => {
      const active = items.find(el => el.getAttribute('aria-pressed') === 'true')!;
      const frame = active.parentElement!.getBoundingClientRect(), box = active.getBoundingClientRect();
      return box.left >= frame.left - 1 && box.right <= frame.right + 1;
    })).toBe(true);
  };
  await page.evaluate(() => document.fonts.ready);
  const initial = await readGeometry();
  await assertSelectedVisible();
  expect(await svg.evaluate(el => { for (let p = el.parentElement; p; p = p.parentElement) if (p.scrollTop > 0) return false; return true; })).toBe(true);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await info.attach('mesures-courbes-apres', { body: JSON.stringify(initial), contentType: 'application/json' });
  await info.attach('courbe-jour-apres', { body: await daily.screenshot(), contentType: 'image/png' });
  await info.attach('semaines-apres', { body: await weekly.screenshot(), contentType: 'image/png' });

  await slider.focus(); await page.keyboard.press('Home');
  await expect(slider).toHaveValue('0'); await expect(daily.locator('strong').first()).toHaveText('2');
  await page.keyboard.press('End'); await expect(daily.locator('strong').first()).toHaveText('3');
  const box = (await svg.boundingBox())!;
  await svg.click({ position: { x: 1, y: box.height / 2 } }); await expect(daily.locator('strong').first()).toHaveText('2');
  await svg.click({ position: { x: box.width - 1, y: box.height / 2 } }); await expect(daily.locator('strong').first()).toHaveText('3');

  await slider.focus(); await page.keyboard.press('Home');
  await content(page).getByRole('navigation', { name: messages.workspace.period, exact: true })
    .getByRole('link', { name: messages.workspace.days.replace('{count}', '7'), exact: true }).click();
  await expect(slider).toHaveAttribute('max', '6'); await expect(slider).toHaveValue('6');
  await expect(daily.locator('strong').first()).toHaveText('3');
  await daily.locator('summary').click(); await expect(daily.locator('tbody tr')).toHaveCount(7);
  await expect(daily.locator('tbody tr').first()).toContainText(t.inProgress);
  await daily.locator('summary').click();

  const original = page.viewportSize()!;
  const resized = [];
  for (const width of [320, 390, 430, 900, 1440]) {
    await page.setViewportSize({ width, height: original.height });
    resized.push(await readGeometry()); await assertSelectedVisible();
  }
  await info.attach('mesures-courbes-largeurs', { body: JSON.stringify(resized), contentType: 'application/json' });
  await page.setViewportSize(original); await readGeometry(); await assertSelectedVisible();
  await buttons.first().click(); await expect(buttons.first()).toHaveAttribute('aria-pressed', 'true'); await assertSelectedVisible();
  await buttons.last().click(); await expect(buttons.last()).toHaveAttribute('aria-pressed', 'true'); await assertSelectedVisible();
  await weekly.locator('summary').click(); await expect(weekly.locator('tbody tr')).toHaveCount(8);
});


test('la synthèse lit l’activation une seule fois et garde la période demandée', async ({ page, request }, info) => {
  for (const [period, expected] of [[30, 30], [90, 90], [7, 30]] as const) {
    await control(request, { reset: true });
    await visit(page, `today&period=${period}`);
    await expect(metric(page, messages.pilot.activeToday)).toHaveText('3');
    // La première lecture de santé a fini avant la navigation suivante ; WebKit ne doit pas la couper.
    await expect(content(page).locator('[data-live-health] [role="status"]')).toHaveText(messages.monitoring.probeReachable);
    const calls = (await control(request)).requests.filter(url => url.startsWith('/v1/admin/activation'));
    expect(calls).toEqual([`/v1/admin/activation?days=${expected}`]);
    await info.attach(`activation-${period}`, { body: JSON.stringify(calls), contentType: 'application/json' });
  }
});


test('le menu et la recherche gardent les dossiers accessibles après une panne partielle', async ({ page, request }, info) => {
  await visit(page, 'today');
  await expect(content(page).locator('[data-live-health] [role="status"]')).toHaveText(messages.monitoring.probeReachable);
  const t = messages.workspace;
  if (info.project.use.viewport!.width < 1100) {
    const menu = page.locator('summary').filter({ hasText: t.menu });
    await menu.click();
    const nav = page.getByRole('navigation', { name: t.navigation, exact: true });
    for (const label of [t.clients, t.revenue, t.service, t.growth]) await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    await menu.press('Escape'); await expect(menu).toBeFocused(); await expect(nav).toBeHidden();
  }
  await control(request, { search: 'unavailable' });
  const trigger = page.getByRole('button', { name: t.search, exact: true });
  expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: t.search, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(t.searchUnavailable);
  await control(request, { search: 'invalid' });
  await dialog.getByRole('button', { name: t.retry, exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText(t.searchPartial);
  const input = dialog.getByRole('textbox', { name: t.searchInput, exact: true });
  await input.fill('beta');
  await expect(dialog.locator('li')).toHaveCount(1);
  await expect(dialog).toContainText('contact@beta.example.net');
  await input.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: t.file, exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).toBeHidden(); await expect(trigger).toBeFocused();
  await trigger.click(); await input.fill('beta');
  await info.attach('recherche-partielle-mobile', { body: await dialog.screenshot(), contentType: 'image/png' });
  await dialog.getByRole('button', { name: t.file, exact: true }).click();
  await expect(page).toHaveURL(/dashboard\/clients\?open=contact%40beta.example.net/);
  await expect(page.getByRole('dialog')).toContainText('contact@beta.example.net');
});


test('les classements et situations de Contacts restent lisibles et faciles à toucher', async ({ page, request }, info) => {
  await control(request, { relations: true });
  const results: Array<{ cas: string; mesures: Awaited<ReturnType<typeof measureGradientContrast>>['measurements']; boutons: number[] }> = [];
  for (const [name, outcome] of [['alpha', 'en_discussion'], ['beta', 'pas_maintenant'], ['gamma', 'pas_interesse'], ['delta', 'mauvaise_personne'], ['epsilon', ''], ['zeta', ''], ['eta', ''], ['theta', '']] as const) {
    // Mesurer la fiche chargée, pas l’élément provisoire remplacé pendant son arrivée.
    const response = await page.goto(`${locale === 'en' ? '' : '/' + locale}/dashboard/contacts?client=contact%40${name}.example.net`, { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    const controls = dialog.locator('[data-relationship-controls]'); await expect(controls).toBeVisible();
    await controls.scrollIntoViewIfNeeded();
    await expect(controls.locator('button')).toHaveCount(4);
    await expect(controls.locator('button[aria-pressed="true"]')).toHaveCount(outcome ? 1 : 0);
    const selectors = outcome
      ? ['[role="dialog"] [data-relationship-outcome]', '[role="dialog"] [data-relationship-controls] button[aria-pressed="true"]']
      : ['[role="dialog"] [data-situation-band]'];
    if (!outcome) {
      await expect(dialog.locator('[data-situation-band]')).toContainText(name === 'epsilon' ? 'Jamais contacté' : name === 'zeta' ? 'RIEN À RÉPONDRE' : name === 'eta' ? 'À TOI DE JOUER' : 'LA BALLE EST CHEZ LUI');
    }
    const measured = await measureGradientContrast(page, selectors);
    if (name === 'alpha') {
      const badge = dialog.locator('[data-relationship-outcome]');
      const initial = await badge.getAttribute('style');
      try {
        await badge.evaluate(el => { Object.assign((el as HTMLElement).style, { maxWidth: '1px', minWidth: '0', overflow: 'hidden' }); });
        await expect(measureGradientContrast(page, [selectors[0]])).rejects.toThrow(/Texte coupé par son conteneur/);
        await badge.evaluate((el, style) => { if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style); }, initial);
        await badge.evaluate(el => { (el as HTMLElement).style.transform = 'scale(.9)'; });
        await expect(measureGradientContrast(page, [selectors[0]])).rejects.toThrow(/Transformation non prise en charge/);
      } finally { await badge.evaluate((el, style) => { if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style); }, initial); }
    }
    const heights = await controls.locator('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
    if (name === 'zeta' || name === 'eta') heights.push((await dialog.locator('[data-no-reply-action]').boundingBox())!.height);
    results.push({ cas: name, mesures: measured.measurements, boutons: heights });
    await info.attach(`relations-${name}-fond`, { body: measured.background, contentType: 'image/png' });
    await info.attach(`relations-${name}-fenetre`, { body: measured.viewportBackground, contentType: 'image/png' });
    await info.attach(`relations-${name}`, { body: await dialog.screenshot(), contentType: 'image/png' });
  }
  await info.attach('mesures-relations', { body: JSON.stringify(results), contentType: 'application/json' });
  expect((await control(request)).writes, 'Aucune modification de relation ou de message pendant la recette').toEqual([]);
  expect(results.flatMap(row => row.mesures.filter(m => !m.passes).map(m => ({ cas: row.cas, texte: m.text, minimum: m.worst.ratio, seuil: m.threshold }))), 'Contraste de chaque état dans son fond rendu').toEqual([]);
  expect(results.flatMap(row => row.boutons.filter(height => height < 44).map(height => ({ cas: row.cas, hauteur: height }))), 'Hauteur tactile des boutons dans le repère du navigateur').toEqual([]);
});


test('la synthèse reste accessible quand les indicateurs arrivent ou sont indisponibles', async ({ page, request }, info) => {
  for (const business of ['normal', 'unavailable'] as const) {
    await control(request, { reset: true, business });
    await visit(page, 'today');
    await expect(metric(page, messages.pilot.activeToday)).toHaveText(business === 'normal' ? '3' : '—');
    await expect(content(page).locator('[data-live-health] [role="status"]')).toHaveText(messages.monitoring.probeReachable);
    await auditAccessibility(page, '#dashboard-content', `accueil-${business}`, info);
    if (business === 'normal') {
      const target = '#dashboard-content svg[role="img"] text';
      const text = page.locator(target).first();
      const original = await text.getAttribute('style');
      const freeze = await page.addStyleTag({ content: `${target} { transition: none !important; }` });
      try {
        await text.evaluate(el => { (el as SVGElement).style.fill = '#ff0000'; });
        const colored = await measureGradientContrast(page, [target]);
        expect(colored.measurements[0].foreground).toEqual([255, 0, 0, 255]);
        expect(colored.measurements[0].svgText).toBe(true);
        expect(colored.measurements[0].threshold).toBe(4.5);
        expect(colored.measurements[0].worst.ratio).toBeLessThan(4.5);
        expect(colored.measurements[0].passes, 'Le contraste SVG volontairement insuffisant doit être refusé').toBe(false);
        await info.attach('contre-test-svg-contraste-insuffisant', { body: JSON.stringify(colored.measurements[0]), contentType: 'application/json' });
        await text.evaluate(el => { (el as SVGElement).style.fill = 'transparent'; });
        await expect(measureGradientContrast(page, [target])).rejects.toThrow(/Remplissage de texte transparent/);
        await text.evaluate(el => { (el as SVGElement).style.fill = '#536b5f'; (el as SVGElement).style.fillOpacity = '.5'; });
        await expect(measureGradientContrast(page, [target])).rejects.toThrow(/Remplissage SVG non pris en charge/);
        await text.evaluate(el => { (el as SVGElement).style.fillOpacity = '1'; (el as SVGElement).style.stroke = 'black'; });
        await expect(measureGradientContrast(page, [target])).rejects.toThrow(/Remplissage SVG non pris en charge/);
      } finally {
        try {
          await text.evaluate((el, style) => { if (style === null) el.removeAttribute('style'); else el.setAttribute('style', style); }, original);
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        } finally {
          await freeze.evaluate(el => el.parentNode?.removeChild(el));
        }
      }
    }
    await info.attach(`accueil-${business}-rendu`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    expect((await control(request)).writes, 'Aucune écriture métier pendant l’audit de la synthèse').toEqual([]);
  }
});


test('les ventes gardent leurs devises, leurs périodes et leurs remboursements d’origine', async ({ page, request }, info) => {
  const fixture = await control(request, { stripe: 'normal' });
  await visit(page, 'revenue');
  const t = messages.overview.money.premium, old = messages.overview.money.collected;
  const panel = content(page).locator('[data-stripe-panel]');
  const history = panel.locator('[data-stripe-history]');
  await expect(history).toBeVisible();
  const money = (whole: number, currency: string) => `${whole}${locale === 'en' ? '.' : ','}00 ${currency}`;
  const lifetime = panel.getByRole('region', { name: t.lifetime, exact: true });
  const settlement = panel.getByRole('region', { name: t.settlement, exact: true });
  const total = money(15, 'USD') + ' + ' + money(9, 'EUR');
  await expect(lifetime.getByText(total, { exact: true })).toBeVisible();
  await expect(lifetime).not.toContainText(money(99, 'USD'));
  await expect(settlement).toContainText(t.wholeAccount);
  await expect(settlement).toContainText(old.other.replace('{amount}', money(99, 'USD')));
  await expect(settlement).toContainText(locale === 'en' ? '107.10 CHF' : '107,10 CHF');
  await expect(settlement).toContainText(money(50, 'CHF'));
  await expect(content(page).locator('[data-live-health] [role="status"]')).toHaveText(messages.monitoring.probeReachable);
  await auditAccessibility(page, '[data-stripe-panel]', 'revenus-valides', info);
  const buttons = history.getByRole('group', { name: t.period, exact: true }).getByRole('button');
  expect(await buttons.evaluateAll(items => items.every(item => item.getBoundingClientRect().height >= 44))).toBe(true);
  const refunds = history.locator('dl > div').filter({ has: page.locator('dt').filter({ hasText: t.refunds }) }).locator('dd');
  for (const length of [7, 90, 30] as const) {
    await history.getByRole('button', { name: t.days.replace('{count}', String(length)), exact: true }).click();
    await expect(history.locator('[data-period-count]')).toHaveText(length === 90 ? '4' : '2');
    await expect(history.locator('[data-period-gross]')).toHaveText(money(length === 90 ? 15 : 3, 'USD') + ' + ' + money(9, 'EUR'));
    if (length === 90) await expect(refunds).toContainText(money(2, 'USD'));
    else { await expect(refunds).toHaveText('0' + t.refundsNote); await expect(refunds).not.toContainText('USD'); }
    await expect(lifetime.getByText(total, { exact: true })).toBeVisible();
    const details = history.locator('summary');
    await details.click();
    await expect(history.locator('tbody tr')).toHaveCount(length);
    const oldRow = history.locator('tbody tr').filter({ has: page.getByRole('rowheader', { name: fixture.stripeDays.old, exact: true }) });
    if (length === 90) { await expect(oldRow).toContainText(money(12, 'USD')); await expect(oldRow).toContainText(money(2, 'USD')); }
    else await expect(oldRow).toHaveCount(0);
    await expect(history.getByRole('rowheader', { name: fixture.stripeDays.today + ' *', exact: true })).toHaveCount(1);
    const table = history.getByRole('region', { name: t.dailyDetails, exact: true });
    if (await table.evaluate(el => el.scrollWidth > el.clientWidth)) {
      await table.focus();
      await expect(table).toBeFocused();
      // WebKit déclenche le défilement natif pendant l’appui, avant le relâchement.
      await table.press('ArrowRight', { delay: 100 });
      await expect.poll(() => table.evaluate(el => el.scrollLeft), { message: 'Le détail par jour défile aussi au clavier' }).toBeGreaterThan(0);
    }
    await details.click();
  }
  const skip = page.locator('a[href="#dashboard-content"]');
  const skipState = await skip.evaluate(el => ({ focused: document.activeElement === el, top: el.getBoundingClientRect().top,
    bottom: el.getBoundingClientRect().bottom, transform: getComputedStyle(el).transform }));
  await info.attach('revenus-lien-evitement', { body: JSON.stringify(skipState), contentType: 'application/json' });
  await info.attach('revenus-valides-fenetre', { body: await page.screenshot(), contentType: 'image/png' });
  expect(skipState.focused || skipState.bottom <= 0, 'Le lien d’évitement reste hors champ quand il n’a pas le focus').toBe(true);
  await info.attach('revenus-valides-rendu', { body: await panel.screenshot(), contentType: 'image/png' });
  await control(request, { stripe: 'invalid-series' });
  await refresh(page);
  await expect(history).toHaveCount(0);
  await expect(panel.getByText(t.seriesUnavailable, { exact: true })).toBeVisible();
  await expect(lifetime.getByText(total, { exact: true })).toBeVisible();
  await auditAccessibility(page, '[data-stripe-panel]', 'revenus-serie-indisponible', info);
  await info.attach('revenus-serie-indisponible-rendu', { body: await panel.screenshot(), contentType: 'image/png' });
  expect((await control(request)).writes).toEqual([]);
});


test('les commandes secondaires de réponse restent lisibles et tactiles', async ({ page, request }, info) => {
  await control(request, { relations: true });
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  let failNext = false;
  // Réponses simulées dans le navigateur : aucune route Next ni API métier ne reçoit ces actions.
  await page.route(base + '/api/crm/no-reply*', async route => {
    const req = route.request(), url = new URL(req.url());
    calls.push({ path: url.pathname, method: req.method(), body: req.postDataJSON() });
    const failed = failNext; failNext = false;
    const confirmation = url.pathname === '/api/crm/no-reply-sender' ? req.postDataJSON() : { updated: 1 };
    await route.fulfill({ status: failed ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failed ? { error: 'Indisponibilité fictive' } : confirmation) });
  });
  const response = await page.goto(`${locale === 'en' ? '' : '/' + locale}/dashboard/contacts?client=contact%40iota.example.net`, { waitUntil: 'commit' });
  expect(response?.status()).toBe(200);
  if (page.viewportSize()!.width < 600) await page.setViewportSize({ width: page.viewportSize()!.width, height: 740 });
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const action = dialog.locator('[data-no-reply-action]');
  const results: Array<{ cas: string; mesures: Awaited<ReturnType<typeof measureGradientContrast>>['measurements']; boutons: number[] }> = [];
  const measure = async (name: string, selector: string) => {
    const target = page.locator(selector); await expect(target).toBeVisible(); await target.scrollIntoViewIfNeeded();
    const measured = await measureGradientContrast(page, [selector]);
    const heights = await target.locator('button').evaluateAll(items => items.map(el => el.getBoundingClientRect().height));
    results.push({ cas: name, mesures: measured.measurements, boutons: heights });
    await info.attach(`actions-${name}-fenetre`, { body: await page.screenshot(), contentType: 'image/png' });
    await info.attach(`actions-${name}-fond`, { body: measured.background, contentType: 'image/png' });
  };
  const controls = dialog.locator('[data-relationship-controls]');
  await expect(controls.locator('button[aria-pressed="true"]')).toHaveCount(0);
  await measure('classements-non-selectionnes', '[role="dialog"] [data-relationship-controls]');
  const initialBackground = await action.evaluate(el => getComputedStyle(el).backgroundColor);
  const hoverCapable = await page.evaluate(() => matchMedia('(hover: hover)').matches);
  await info.attach('actions-mode-entree', { body: JSON.stringify({ hoverCapable, viewport: page.viewportSize() }), contentType: 'application/json' });
  await action.hover();
  await expect(action).toHaveAttribute('aria-pressed', 'false');
  await expect(action).toHaveCSS('background-color', initialBackground);
  await expect(action).toHaveCSS('text-decoration-line', hoverCapable ? 'underline' : 'none');
  await measure('survol', '[role="dialog"] [data-no-reply-control]');
  await action.click();
  const offer = dialog.locator('[data-no-reply-rule-offer]');
  await expect(offer).toContainText('no-reply@iota.example.net');
  await measure('proposition', '[role="dialog"] [data-no-reply-rule-offer]');
  await offer.getByRole('button', { name: 'Oui, toujours', exact: true }).click();
  const saved = dialog.locator('[data-no-reply-rule-saved]');
  await expect(saved).toContainText('Règle enregistrée');
  await measure('confirmation', '[role="dialog"] [data-no-reply-rule-saved]');
  await saved.getByRole('button', { name: 'retirer la règle', exact: true }).click();
  await expect(saved).toHaveCount(0);
  await offer.getByRole('button', { name: 'non, cette fois seulement', exact: true }).click();
  await expect(offer).toHaveCount(0);
  failNext = true;
  await action.click();
  await expect(dialog.locator('[data-no-reply-error]')).toContainText('Enregistrement non confirmé.');
  await measure('echec', '[role="dialog"] [data-no-reply-error]');
  await info.attach('mesures-actions-contact', { body: JSON.stringify(results), contentType: 'application/json' });
  await info.attach('actions-interceptees', { body: JSON.stringify(calls), contentType: 'application/json' });
  expect(calls).toEqual([
    { path: '/api/crm/no-reply', method: 'POST', body: { id: 'message-fictif-iota', value: true } },
    { path: '/api/crm/no-reply-sender', method: 'POST', body: { address: 'no-reply@iota.example.net', value: true } },
    { path: '/api/crm/no-reply-sender', method: 'POST', body: { address: 'no-reply@iota.example.net', value: false } },
    { path: '/api/crm/no-reply', method: 'POST', body: { id: 'message-fictif-iota', value: true } },
  ]);
  expect((await control(request)).writes, 'Aucune écriture métier reçue par l’API fictive').toEqual([]);
  expect(results.flatMap(row => row.mesures.filter(m => !m.passes).map(m => ({ cas: row.cas, texte: m.text, minimum: m.worst.ratio, seuil: m.threshold })))).toEqual([]);
  expect(results.flatMap(row => row.boutons.filter(height => height < 44).map(height => ({ cas: row.cas, hauteur: height })))).toEqual([]);
});


test('un classement attend une confirmation cohérente et conserve la saisie si elle manque', async ({ page, request }, info) => {
  await control(request, { relations: true });
  let mode = 'empty';
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const expectedCalls: typeof calls = [];
  await page.route(url => url.origin === base && ['/api/crm/no-reply', '/api/crm/no-reply-sender', '/api/crm/prospect-status'].includes(url.pathname), async route => {
    const req = route.request(), url = new URL(req.url()), body = req.postDataJSON();
    calls.push({ path: url.pathname, method: req.method(), body });
    const isRule = url.pathname === '/api/crm/no-reply-sender';
    const confirmation = mode === 'empty' ? {} : mode === 'zero' ? { updated: 0 }
      : mode === 'wrong-sender' ? { address: 'no-reply@autre.example.net', value: body.value }
      : mode === 'wrong-value' ? { address: body.address, value: !body.value }
      : isRule ? body : { updated: 1 };
    await route.fulfill({ status: 200, contentType: 'application/json', body: mode === 'unreadable' ? '{' : JSON.stringify(confirmation) });
  });
  await page.goto(`${locale === 'en' ? '' : '/' + locale}/dashboard/contacts?client=contact%40iota.example.net`, { waitUntil: 'commit' });
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
  const noReply = dialog.locator('[data-no-reply-control]');
  const status = dialog.locator('[data-prospect-status-control]');
  const outcome = dialog.locator('[data-relationship-controls]');
  const offer = noReply.locator('[data-no-reply-rule-offer]'), saved = noReply.locator('[data-no-reply-rule-saved]');
  const note = outcome.getByRole('textbox', { name: 'Note sur le classement', exact: true });
  const send = async (root: import('@playwright/test').Locator, button: import('@playwright/test').Locator, path: string, body: unknown) => {
    expectedCalls.push({ path, method: 'POST', body });
    await Promise.all([page.waitForResponse(r => r.url() === base + path && r.request().method() === 'POST'), button.click()]);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(root.locator('button:disabled')).toHaveCount(0);
  };
  const observations: unknown[] = [], expected: unknown[] = [];
  for (const failure of ['empty', 'unreadable', 'zero']) {
    mode = failure;
    await send(noReply, noReply.locator('[data-no-reply-action]'), '/api/crm/no-reply', { id: 'message-fictif-iota', value: true });
    observations.push({ mode, action: 'message', erreur: await noReply.getByRole('alert').count(), proposition: await offer.count() });
    expected.push({ mode, action: 'message', erreur: 1, proposition: 0 });
    if (await offer.count()) await offer.getByRole('button', { name: 'non, cette fois seulement', exact: true }).click();
    await send(status, status.getByRole('button', { name: 'archiver', exact: true }), '/api/crm/prospect-status', { id: 'prospect-fictif-iota', status: 'archive' });
    observations.push({ mode, action: 'statut', erreur: await status.getByRole('alert').count() });
    expected.push({ mode, action: 'statut', erreur: 1 });
    if (!(await note.count())) await outcome.getByRole('button', { name: 'En discussion', exact: true }).click();
    await note.fill('Note fictive conservée');
    await send(outcome, outcome.getByRole('button', { name: 'Enregistrer', exact: true }), '/api/crm/prospect-status', { id: 'prospect-fictif-iota', outcome: 'en_discussion', outcomeNote: 'Note fictive conservée' });
    observations.push({ mode, action: 'relation', erreur: await outcome.getByRole('alert').count(), note: await note.count() ? await note.inputValue() : null });
    expected.push({ mode, action: 'relation', erreur: 1, note: 'Note fictive conservée' });
    if (failure === 'empty') await info.attach('confirmation-manquante-rendu', { body: await page.screenshot(), contentType: 'image/png' });
  }
  mode = 'valid';
  await send(noReply, noReply.locator('[data-no-reply-action]'), '/api/crm/no-reply', { id: 'message-fictif-iota', value: true });
  await expect(offer).toBeVisible(); await expect(noReply.getByRole('alert')).toHaveCount(0);
  for (const failure of ['empty', 'wrong-sender', 'wrong-value']) {
    mode = failure;
    await send(noReply, offer.getByRole('button', { name: 'Oui, toujours', exact: true }), '/api/crm/no-reply-sender', { address: 'no-reply@iota.example.net', value: true });
    observations.push({ mode, action: 'regle', erreur: await noReply.getByRole('alert').count(), confirmation: await saved.count() });
    expected.push({ mode, action: 'regle', erreur: 1, confirmation: 0 });
    if (await saved.count()) {
      mode = 'valid';
      await send(noReply, saved.getByRole('button', { name: 'retirer la règle', exact: true }), '/api/crm/no-reply-sender', { address: 'no-reply@iota.example.net', value: false });
    }
  }
  mode = 'valid';
  await send(noReply, offer.getByRole('button', { name: 'Oui, toujours', exact: true }), '/api/crm/no-reply-sender', { address: 'no-reply@iota.example.net', value: true });
  await expect(saved).toBeVisible(); await expect(noReply.getByRole('alert')).toHaveCount(0);
  await send(noReply, saved.getByRole('button', { name: 'retirer la règle', exact: true }), '/api/crm/no-reply-sender', { address: 'no-reply@iota.example.net', value: false });
  await expect(saved).toHaveCount(0); await expect(offer).toBeVisible();
  await offer.getByRole('button', { name: 'non, cette fois seulement', exact: true }).click();
  await send(status, status.getByRole('button', { name: 'archiver', exact: true }), '/api/crm/prospect-status', { id: 'prospect-fictif-iota', status: 'archive' });
  await expect(status.getByRole('alert')).toHaveCount(0);
  if (!(await note.count())) await outcome.getByRole('button', { name: 'En discussion', exact: true }).click();
  await note.fill('Note fictive conservée');
  await send(outcome, outcome.getByRole('button', { name: 'Enregistrer', exact: true }), '/api/crm/prospect-status', { id: 'prospect-fictif-iota', outcome: 'en_discussion', outcomeNote: 'Note fictive conservée' });
  await expect(note).toHaveCount(0); await expect(outcome.getByRole('alert')).toHaveCount(0);
  await info.attach('confirmations-observees', { body: JSON.stringify(observations), contentType: 'application/json' });
  await info.attach('confirmations-requetes-simulees', { body: JSON.stringify(calls), contentType: 'application/json' });
  expect(calls).toEqual(expectedCalls);
  expect((await control(request)).writes).toEqual([]);
  expect(observations).toEqual(expected);
});
