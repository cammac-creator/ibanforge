import type { Page } from '@playwright/test';

/** Formule W3C : couleurs effectives, sans arrondir le résultat avant le seuil.
 * https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html */
export function contrastRatio(foreground: number[], background: number[]): number {
  if (foreground.length !== 4 || background.length !== 3 ||
      [...foreground, ...background].some(v => !Number.isFinite(v) || v < 0 || v > 255)) {
    throw new Error('Couleur de mesure invalide');
  }
  const alpha = foreground[3] / 255;
  const rgb = background.map((v, i) => foreground[i] * alpha + v * (1 - alpha));
  const luminance = (color: number[]) => color.map(v => {
    const c = v / 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
  }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
  const a = luminance(rgb), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

/** Mesure limitée aux textes ordinaires : les cas non pris en charge font échouer la sonde. */
export async function measureGradientContrast(page: Page, selectors: string[]) {
  await page.evaluate(() => document.fonts.ready);
  const readGeometry = () => page.evaluate(targets => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return targets.flatMap(selector => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Cible absente : ${selector}`);
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const rows = [];
      while (walker.nextNode()) {
        const node = walker.currentNode, parent = node.parentElement!;
        if (!node.textContent?.trim()) continue;
        const style = getComputedStyle(parent);
        for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
          const s = getComputedStyle(ancestor);
          if (s.opacity !== '1' || s.mixBlendMode !== 'normal' || s.filter !== 'none' || s.clip !== 'auto' || s.clipPath !== 'none') {
            throw new Error(`Composition non prise en charge : ${selector}`);
          }
        }
        if (style.textShadow !== 'none') throw new Error(`Ombre de texte non prise en charge : ${selector}`);
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
          .map(r => ({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }));
        if (!rects.length) continue;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = style.webkitTextFillColor || style.color; ctx.fillRect(0, 0, 1, 1);
        const foreground = [...ctx.getImageData(0, 0, 1, 1).data];
        if (foreground[3] === 0) throw new Error(`Remplissage de texte transparent : ${selector} ; couleur=${style.color} ; remplissage=${style.webkitTextFillColor} ; canvas=${ctx.fillStyle} ; transition=${style.transition}`);
        const size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight);
        rows.push({ selector, text: node.textContent.trim(), foreground, size, weight,
          threshold: size >= 24 || (size >= 14 * 96 / 72 && weight >= 700) ? 3 : 4.5, rects });
      }
      if (!rows.length) throw new Error(`Aucun texte mesurable : ${selector}`);
      return rows;
    });
  }, selectors);

  const geometry = await readGeometry();
  // Le retrait du masque ne doit pas lancer une transition de couleur, même très courte.
  const freeze = await page.addStyleTag({ content: '* { transition-property: none !important; transition-duration: 0s !important; }' });
  let background: Buffer;
  try {
    if (JSON.stringify(geometry) !== JSON.stringify(await readGeometry())) throw new Error('Le gel des transitions a changé le texte mesuré');
    // Le remplissage des glyphes disparaît ; les couleurs, fonds, bordures et boîtes restent en place.
    const mask = await page.addStyleTag({ content: '* { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; }' });
    try { background = await page.screenshot({ fullPage: true, scale: 'css' }); }
    finally { await mask.evaluate(node => node.parentNode?.removeChild(node)); }
    // Restaurer les couleurs pendant que les transitions sont encore neutralisées.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally { await freeze.evaluate(node => node.parentNode?.removeChild(node)); }
  const after = await readGeometry();
  if (JSON.stringify(geometry) !== JSON.stringify(after)) throw new Error('La sonde a déplacé ou changé le texte mesuré');

  const samples = await page.evaluate(async ({ png, rows }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    return rows.map(row => {
      const colors = new Map<number, { background: number[]; x: number; y: number }>();
      let count = 0;
      for (const box of row.rects) {
        const left = Math.floor(box.x), top = Math.floor(box.y), right = Math.ceil(box.x + box.width), bottom = Math.ceil(box.y + box.height);
        if (left < 0 || top < 0 || right > canvas.width || bottom > canvas.height) throw new Error(`Boîte hors capture : ${row.selector}`);
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const offset = (y * canvas.width + x) * 4;
          if (pixels[offset + 3] !== 255) throw new Error('Fond capturé non opaque');
          const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
          const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
          if (!colors.has(key)) colors.set(key, { background: rgb, x, y });
          count++;
        }
      }
      return { colors: [...colors.values()], pixels: count };
    });
  }, { png: background.toString('base64'), rows: geometry });
  const measurements = geometry.map((row, i) => {
    const colors = samples[i].colors.map(sample => ({ ...sample, ratio: contrastRatio(row.foreground, sample.background) }));
    if (!colors.length) throw new Error('Aucun pixel de fond mesuré');
    const worst = colors.reduce((a, b) => a.ratio < b.ratio ? a : b);
    return { ...row, pixels: samples[i].pixels, colors: colors.length, worst, passes: worst.ratio >= row.threshold };
  });
  return { background, measurements };
}
