import { defineConfig } from '@playwright/test';
import path from 'node:path';

const baseURL = process.env.IBF_RECIPE_BASE_URL;
const apiURL = process.env.IBF_RECIPE_API_URL;
const report = process.env.IBF_RECIPE_REPORT;
if (!baseURL || new URL(baseURL).hostname !== 'localhost' || new URL(baseURL).protocol !== 'http:' ||
    !apiURL || new URL(apiURL).hostname !== '127.0.0.1' || new URL(apiURL).protocol !== 'http:' ||
    !report || !process.env.IBF_RECIPE_TOKEN || !process.env.IBF_RECIPE_SESSION_SECRET) {
  throw new Error('Lancer la recette isolée avec npm run test:dashboard');
}

export default defineConfig({
  testDir: '.', testMatch: ['dashboard.spec.ts', 'indicators.spec.ts'],
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true, maxFailures: 3,
  globalTimeout: 600_000,
  timeout: 60_000, expect: { timeout: 12_000 },
  outputDir: path.join(report, 'traces'),
  reporter: [['list'], ['json', { outputFile: path.join(report, 'resultats.json') }]],
  use: { baseURL, headless: true, serviceWorkers: 'block', reducedMotion: 'reduce',
    screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  projects: (['chromium', 'webkit'] as const).flatMap(browserName =>
    ([['fr', 320], ['en', 390], ['de', 1440]] as const).map(([locale, width]) => ({
      name: `${browserName}-${locale}-${width}`, use: { browserName, locale,
        viewport: { width, height: 1050 }, hasTouch: width < 400,
        ...(browserName === 'chromium' ? { launchOptions: { args: ['--use-mock-keychain'] } } : {}) },
    }))),
});
