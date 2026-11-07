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
  return response.json() as Promise<{ requests: string[] }>;
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
    const scrolling = await buttons.first().evaluate(el => el.parentElement!.scrollWidth > el.parentElement!.clientWidth + 1);
    const hint = weekly.getByText(t.weekScrollHint, { exact: true });
    if (scrolling) await expect(hint).toBeVisible(); else await expect(hint).toBeHidden();
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
