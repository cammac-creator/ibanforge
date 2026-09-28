/*
 * Measures the width of each line of the home title in Bebas Neue, in em, for
 * the table of components/home/revue-cover-fit.ts. Each line of the title fills
 * its column exactly: its font size is the column width divided by this width.
 *
 * Run it after any change to the title or to its line breaks (the test next to
 * the table fails until then), against a page of the site that loads the font:
 *
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
 *     node frontend/scripts/measure-cover-fit.mjs [https://ibanforge.com/fr]
 *
 * It prints the new `em` arrays; paste them into the table.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// Playwright is not a dependency of the site: point PLAYWRIGHT_MODULE at any
// installed copy (it is a CommonJS package, hence createRequire).
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const { COVER_LINES } = loadTable();

function loadTable() {
  // The table is TypeScript; its lines are read back with a regular expression
  // rather than a compiler, since they are plain string literals.
  const src = readFileSync(new URL('../components/home/revue-cover-fit.ts', import.meta.url), 'utf8');
  const out = {};
  for (const m of src.matchAll(/(\w+):\s*\{\s*lines:\s*\[([^\]]*)\]/g)) {
    out[m[1]] = [...m[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((s) => JSON.parse(`"${s[1]}"`));
  }
  return { COVER_LINES: out };
}

await (async () => {
  const url = process.argv[2] || 'https://ibanforge.com/fr';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  const result = await page.evaluate(async (table) => {
    await document.fonts.load('400 100px "Bebas Neue"');
    const probe = document.createElement('span');
    probe.style.cssText =
      'position:absolute;left:-9999px;top:0;white-space:nowrap;font:400 100px "Bebas Neue";letter-spacing:0;text-transform:uppercase;font-kerning:normal';
    document.body.append(probe);
    const out = {};
    for (const [locale, lines] of Object.entries(table)) {
      out[locale] = lines.map((line) => {
        probe.textContent = line;
        return Math.round((probe.getBoundingClientRect().width / 100) * 10000) / 10000;
      });
    }
    probe.remove();
    return { out, loaded: document.fonts.check('400 100px "Bebas Neue"') };
  }, COVER_LINES);
  await browser.close();
  if (!result.loaded) throw new Error('Bebas Neue did not load on ' + url);
  for (const [locale, em] of Object.entries(result.out)) console.log(`${locale}: em: [${em.join(', ')}]`);
})();
