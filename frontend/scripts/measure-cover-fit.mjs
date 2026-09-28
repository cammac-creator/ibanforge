/*
 * Measures the lines of the home that fill their column, for the table of
 * components/home/revue-cover-fit.ts: the cover title and the title of the
 * ending in Bebas Neue, the file counter of chapter 04 in Bebas Neue with
 * tabular figures, and « Commerzbank. » in Inter 600. Each is set at 1em and
 * its width becomes the number the CSS divides its column by.
 *
 * Run it after any change to those texts or to their line breaks (the test next
 * to the table fails until then), against a page of the site that loads both
 * fonts, a local `next start` rather than the live site:
 *
 *   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright \
 *     node frontend/scripts/measure-cover-fit.mjs [http://127.0.0.1:3311/fr]
 *
 * It prints each entry whole (lines, widths, and the text they were measured
 * on); paste them into the table.
 */
import { createRequire } from 'node:module';

// Playwright is not a dependency of the site: point PLAYWRIGHT_MODULE at any
// installed copy (it is a CommonJS package, hence createRequire).
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

// The table imports nothing and uses only erasable TypeScript: Node reads it
// as it is.
const { COVER_LINES, FIN_LINES, COUNTER_FIT, BANK_FIT } = await import(
  new URL('../components/home/revue-cover-fit.ts', import.meta.url).href
);

const round = (n) => Math.round(n * 10000) / 10000;

/**
 * The counter as the page writes it: thousands, then a spacer or a comma, then
 * three digits. `text` is the same figure as lib/format-grouped.ts writes it
 * (a no-break space in French and German), the form the test compares.
 */
function counterParts(value, sep) {
  const thousands = String(Math.floor(value / 1000));
  const rest = String(value % 1000).padStart(3, '0');
  return { thousands, sep, rest, text: `${thousands}${sep === ',' ? ',' : '\u00a0'}${rest}` };
}

const url = process.argv[2] || 'http://127.0.0.1:3311/fr';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });

const input = {
  cover: Object.fromEntries(Object.entries(COVER_LINES).map(([l, e]) => [l, e.lines])),
  fin: Object.fromEntries(Object.entries(FIN_LINES).map(([l, e]) => [l, { narrow: e.narrow, wide: e.wide }])),
  counter: Object.fromEntries(
    Object.keys(COVER_LINES).map((l) => [l, counterParts(COUNTER_FIT.value, COUNTER_FIT[l].sep)]),
  ),
  bank: BANK_FIT.text,
};

const result = await page.evaluate(async (input) => {
  await document.fonts.load('400 100px "Bebas Neue"');
  await document.fonts.load('600 100px Inter');
  // Every style is set before the probe joins the page: under reduced motion
  // the site gives each property a 0.01 ms transition, and a probe restyled
  // after its first style reports its old size (handover §13).
  const probe = (css) => {
    const el = document.createElement('span');
    el.style.cssText = `position:absolute;left:-9999px;top:0;white-space:nowrap;line-height:1;font-kerning:normal;transition:none;${css}`;
    document.body.append(el);
    return el;
  };
  const bebas = probe('font:400 100px "Bebas Neue";letter-spacing:0;text-transform:uppercase');
  const width = (el, text) => {
    el.textContent = text;
    return el.getBoundingClientRect().width / 100;
  };
  const out = { cover: {}, fin: {}, counter: {} };
  for (const [locale, lines] of Object.entries(input.cover)) out.cover[locale] = lines.map((l) => width(bebas, l));
  for (const [locale, { narrow, wide }] of Object.entries(input.fin)) {
    out.fin[locale] = {
      narrow: Math.max(...narrow.map((l) => width(bebas, l))),
      wide: Math.max(...wide.map((l) => width(bebas, l))),
    };
  }
  const figures = probe('font:400 100px "Bebas Neue";letter-spacing:0;font-variant-numeric:tabular-nums');
  for (const [locale, c] of Object.entries(input.counter)) {
    figures.replaceChildren();
    figures.append(c.thousands);
    if (c.sep === ',') figures.append(',');
    else {
      const spacer = document.createElement('span');
      spacer.style.cssText = 'display:inline-block;width:0.08em;height:0';
      figures.append(spacer);
    }
    figures.append(c.rest);
    out.counter[locale] = figures.getBoundingClientRect().width / 100;
  }
  const inter = probe('font:600 100px Inter;letter-spacing:-0.04em');
  out.bank = width(inter, input.bank);
  for (const el of [bebas, figures, inter]) el.remove();
  return {
    out,
    loaded: document.fonts.check('400 100px "Bebas Neue"') && document.fonts.check('600 100px Inter'),
  };
}, input);
await browser.close();
if (!result.loaded) throw new Error('Bebas Neue or Inter did not load on ' + url);

console.log('export const COVER_LINES = {');
for (const [locale, em] of Object.entries(result.out.cover)) {
  const lines = COVER_LINES[locale].lines;
  console.log(`  ${locale}: {`);
  console.log(`    lines: [${lines.map((l) => JSON.stringify(l)).join(', ')}],`);
  console.log(`    em: [${em.map(round).join(', ')}],`);
  console.log(`    measured: ${JSON.stringify(lines.join('|'))},`);
  console.log('  },');
}
console.log('}');
console.log('\nexport const FIN_LINES = {');
for (const [locale, em] of Object.entries(result.out.fin)) {
  const { narrow, wide } = FIN_LINES[locale];
  console.log(`  ${locale}: {`);
  console.log(`    narrow: [${narrow.map((l) => JSON.stringify(l)).join(', ')}],`);
  console.log(`    wide: [${wide.map((l) => JSON.stringify(l)).join(', ')}],`);
  console.log(`    em: { narrow: ${round(em.narrow)}, wide: ${round(em.wide)} },`);
  console.log(`    measured: ${JSON.stringify(`${narrow.join('|')}/${wide.join('|')}`)},`);
  console.log('  },');
}
console.log('}');
console.log('\nexport const COUNTER_FIT = {');
console.log(`  value: ${COUNTER_FIT.value},`);
for (const [locale, em] of Object.entries(result.out.counter)) {
  const c = input.counter[locale];
  console.log(`  ${locale}: { sep: ${JSON.stringify(c.sep)}, em: ${round(em)}, measured: ${JSON.stringify(c.text)} },`);
}
console.log('}');
console.log(
  `\nexport const BANK_FIT = { text: ${JSON.stringify(BANK_FIT.text)}, em: ${round(result.out.bank)}, measured: ${JSON.stringify(BANK_FIT.text)} } as const`,
);
