import { expect, type Page } from '@playwright/test';
import axe from 'axe-core';
import { measureGradientContrast } from './contrast-helper';

export async function auditAccessibility(page: Page, selector: string, name: string, info: import('@playwright/test').TestInfo) {
  await page.addScriptTag({ content: axe.source });
  const result = await page.evaluate(async scope => {
    const a = (window as unknown as { axe: typeof axe }).axe;
    return a.run(document.querySelector(scope)!, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } });
  }, selector);
  await info.attach(name, { body: JSON.stringify(result), contentType: 'application/json' });
  expect(result.violations.map(v => ({ id: v.id, cibles: v.nodes.map(n => n.target) }))).toEqual([]);
  const nodes = result.incomplete.flatMap(rule => rule.nodes.map(node => ({
    rule: rule.id, target: node.target, all: node.all.length, none: node.none.length,
    keys: node.any.map(check => check.data?.messageKey as string | undefined),
  })));
  expect(result.incomplete.filter(rule => !rule.nodes.length), 'Rapport incomplet sans cible').toEqual([]);
  const unsupported = await page.evaluate(items => items.filter(item => {
    if (item.rule !== 'color-contrast' || item.all || item.none || item.target.length !== 1 || typeof item.target[0] !== 'string' || !item.keys.length) return true;
    const el = document.querySelector(item.target[0]);
    if (!el) return true;
    const text = el.textContent?.trim() ?? '';
    return item.keys.some(key => {
      if (key === 'bgGradient') return false;
      if (key === 'shortTextContent') {
        // Axe peut viser « 0 » dans un dd qui contient aussi un paragraphe d’explication.
        const direct = [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent?.trim() ?? '').join('');
        return !/^[0-9—–−+.%?]+$/.test(direct);
      }
      if (key === 'imgNode') return !(el instanceof SVGTextElement);
      if (key === 'nonBmp') return text !== '→' || el.getAttribute('aria-hidden') !== 'true' || !el.closest('a')?.textContent?.replace('→', '').trim();
      if (key === 'elmPartiallyObscured') {
        const group = el.closest('[role="group"]');
        return !el.closest('button[aria-pressed]') || !group || !['auto', 'scroll'].includes(getComputedStyle(group).overflowX) || !/^\d{2}[/.]\d{2}$/.test(text);
      }
      return true;
    });
  }).map(item => ({ cible: item.target, raisons: item.keys })), nodes);
  expect(unsupported, 'Cas non pris en charge par la mesure complémentaire').toEqual([]);

  const measure = async (targets: string[], label: string) => {
    if (!targets.length) return;
    const contrast = await measureGradientContrast(page, targets);
    await info.attach(label + '-fond-sans-glyphes', { body: contrast.background, contentType: 'image/png' });
    await info.attach(label + '-fond-fenetre', { body: contrast.viewportBackground, contentType: 'image/png' });
    await info.attach(label + '-contrastes-mesures', { body: JSON.stringify(contrast.measurements), contentType: 'application/json' });
    expect(contrast.measurements.filter(row => !row.passes).map(row => ({ cible: row.selector, texte: row.text, seuil: row.threshold, minimum: row.worst })), 'Contraste des couleurs du navigateur contre le fond réellement capturé').toEqual([]);
  };
  const obscured = nodes.filter(node => node.keys.includes('elmPartiallyObscured'));
  await measure(nodes.filter(node => !node.keys.includes('elmPartiallyObscured')).map(node => node.target[0] as string), name);
  if (obscured.length) {
    // Le texte d’une semaine hors champ se mesure après l’avoir révélé, comme lors du défilement réel.
    const positions = await page.evaluateHandle(() => [...document.querySelectorAll<HTMLElement>('*')]
      .filter(el => el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight)
      .map(el => ({ el, left: el.scrollLeft, top: el.scrollTop })));
    const windowPosition = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
    try {
      for (const [index, node] of obscured.entries()) {
        const target = node.target[0] as string;
        await page.locator(target).scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        await measure([target], name + '-semaine-revelee-' + index);
      }
    } finally {
      await positions.evaluate(rows => { for (const row of rows) row.el.scrollTo({ left: row.left, top: row.top, behavior: 'instant' }); });
      await page.evaluate(pos => scrollTo({ left: pos.x, top: pos.y, behavior: 'instant' }), windowPosition);
      await expect.poll(() => positions.evaluate(rows => rows.every(row => row.el.scrollLeft === row.left && row.el.scrollTop === row.top)), { message: 'Le défilement initial est restauré après la mesure' }).toBe(true);
      await positions.dispose();
    }
  }
}
