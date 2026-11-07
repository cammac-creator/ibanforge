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
        const svgText = parent instanceof SVGElement;
        if (svgText && (style.stroke !== 'none' || style.fillOpacity !== '1')) throw new Error(`Remplissage SVG non pris en charge : ${selector}`);
        const ancestors: Element[] = [];
        let positioned = false;
        for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
          const s = getComputedStyle(ancestor);
          ancestors.push(ancestor);
          positioned ||= s.position === 'fixed' || s.position === 'sticky';
          if ((s.scale && !['none', '1', '1 1', '1 1 1'].includes(s.scale)) || (s.rotate && !['none', '0deg'].includes(s.rotate)) || (s.perspective && s.perspective !== 'none')) throw new Error(`Transformation non prise en charge : ${selector}`);
          if (s.transform !== 'none') {
            const matrix = new DOMMatrix(s.transform);
            if (!matrix.is2D || matrix.a !== 1 || matrix.b !== 0 || matrix.c !== 0 || matrix.d !== 1) throw new Error(`Transformation non prise en charge : ${selector}`);
          }
          if (s.opacity !== '1' || s.mixBlendMode !== 'normal' || s.filter !== 'none' || s.clip !== 'auto' || s.clipPath !== 'none') {
            throw new Error(`Composition non prise en charge : ${selector}`);
          }
        }
        if (style.textShadow !== 'none') throw new Error(`Ombre de texte non prise en charge : ${selector}`);
        const range = document.createRange(); range.selectNodeContents(node);
        const rects = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0)
          .map(r => ({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }));
        if (!rects.length) continue;
        const viewport = { x: scrollX, y: scrollY, width: innerWidth, height: innerHeight };
        if (!Number.isInteger(scrollX) || !Number.isInteger(scrollY)) throw new Error('Défilement fractionnaire non pris en charge');
        for (const box of rects) {
          const left = box.x - scrollX, top = box.y - scrollY;
          if (left < 0 || left + box.width > innerWidth || (positioned && (top < 0 || top + box.height > innerHeight))) throw new Error(`Texte positionné hors fenêtre : ${selector}`);
          for (const ancestor of ancestors) {
            if (ancestor === document.documentElement || ancestor === document.body) continue;
            const a = ancestor as HTMLElement, style = getComputedStyle(a), frame = a.getBoundingClientRect();
            const svg = a instanceof SVGElement;
            if (svg && [style.borderLeftWidth, style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth].some(v => parseFloat(v) !== 0)) throw new Error(`Bordure SVG non prise en charge : ${selector}`);
            const x = frame.left + (svg ? 0 : a.clientLeft), y = frame.top + (svg ? 0 : a.clientTop);
            const width = svg ? frame.width : a.clientWidth, height = svg ? frame.height : a.clientHeight;
            if ((style.overflowX !== 'visible' && (left < x - .01 || left + box.width > x + width + .01)) ||
                (style.overflowY !== 'visible' && (top < y - .01 || top + box.height > y + height + .01))) throw new Error(`Texte coupé par son conteneur : ${selector}`);
          }
        }
        const fill = svgText ? style.fill : style.webkitTextFillColor && style.webkitTextFillColor.toLowerCase() !== 'currentcolor' ? style.webkitTextFillColor : style.color;
        ctx.fillStyle = '#010203'; ctx.fillStyle = fill; const parsed = ctx.fillStyle;
        ctx.fillStyle = '#040506'; ctx.fillStyle = fill;
        if (parsed !== ctx.fillStyle) throw new Error(`Couleur illisible par le canvas : ${selector}`);
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillRect(0, 0, 1, 1);
        const foreground = [...ctx.getImageData(0, 0, 1, 1).data];
        if (foreground[3] === 0) throw new Error(`Remplissage de texte transparent : ${selector} ; couleur=${style.color} ; remplissage=${style.webkitTextFillColor} ; canvas=${ctx.fillStyle} ; transition=${style.transition}`);
        const size = parseFloat(style.fontSize), weight = parseFloat(style.fontWeight);
        rows.push({ selector, viewport, positioned, svgText, text: node.textContent.trim(), foreground, size, weight,
          // SVG : seuil conservateur de texte ordinaire, quelle que soit l’échelle du viewBox.
          threshold: !svgText && (size >= 24 || (size >= 14 * 96 / 72 && weight >= 700)) ? 3 : 4.5, rects });
      }
      if (!rows.length) throw new Error(`Aucun texte mesurable : ${selector}`);
      return rows;
    });
  }, selectors);

  const geometry = await readGeometry();
  // Le retrait du masque ne doit pas lancer une transition de couleur, même très courte.
  const freeze = await page.addStyleTag({ content: '* { transition-property: none !important; transition-duration: 0s !important; }' });
  let background: Buffer;
  let viewportBackground: Buffer;
  try {
    if (JSON.stringify(geometry) !== JSON.stringify(await readGeometry())) throw new Error('Le gel des transitions a changé le texte mesuré');
    // Le remplissage des glyphes disparaît ; les couleurs, fonds, bordures et boîtes restent en place.
    const mask = await page.addStyleTag({ content: '* { -webkit-text-fill-color: transparent !important; text-decoration-color: transparent !important; text-shadow: none !important; } svg text, svg text * { fill: transparent !important; }' });
    try {
      background = await page.screenshot({ fullPage: true, scale: 'css' });
      viewportBackground = await page.screenshot({ fullPage: false, scale: 'css' });
    }
    finally { await mask.evaluate(node => node.parentNode?.removeChild(node)); }
    // Restaurer les couleurs pendant que les transitions sont encore neutralisées.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  } finally { await freeze.evaluate(node => node.parentNode?.removeChild(node)); }
  const after = await readGeometry();
  if (JSON.stringify(geometry) !== JSON.stringify(after)) throw new Error('La sonde a déplacé ou changé le texte mesuré');

  const samples = await page.evaluate(async ({ png, viewportPng, rows }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png;
    await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0); const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const view = new Image(); view.src = 'data:image/png;base64,' + viewportPng; await view.decode();
    const viewCanvas = document.createElement('canvas'); viewCanvas.width = view.naturalWidth; viewCanvas.height = view.naturalHeight;
    const viewContext = viewCanvas.getContext('2d', { willReadFrequently: true })!;
    viewContext.drawImage(view, 0, 0); const viewPixels = viewContext.getImageData(0, 0, viewCanvas.width, viewCanvas.height).data;
    return rows.map(row => {
      if (viewCanvas.width !== row.viewport.width || viewCanvas.height !== row.viewport.height) throw new Error('Capture de fenêtre dans un repère inattendu');
      const colors = new Map<number, { background: number[]; x: number; y: number }>();
      let count = 0, viewportPixels = 0;
      for (const box of row.rects) {
        const left = Math.floor(box.x), top = Math.floor(box.y), right = Math.ceil(box.x + box.width), bottom = Math.ceil(box.y + box.height);
        if (left < 0 || top < 0 || right > canvas.width || bottom > canvas.height) throw new Error(`Boîte hors capture : ${row.selector}`);
        for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
          const offset = (y * canvas.width + x) * 4;
          const vx = x - row.viewport.x, vy = y - row.viewport.y;
          if (vx >= 0 && vy >= 0 && vx < viewCanvas.width && vy < viewCanvas.height) {
            const viewOffset = (vy * viewCanvas.width + vx) * 4;
            if ([0, 1, 2, 3].some(c => pixels[offset + c] !== viewPixels[viewOffset + c])) throw new Error(`Fond différent entre page entière et fenêtre : ${row.selector}`);
            viewportPixels++;
          }
          if (pixels[offset + 3] !== 255) throw new Error('Fond capturé non opaque');
          const rgb = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
          const key = (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
          if (!colors.has(key)) colors.set(key, { background: rgb, x, y });
          count++;
        }
      }
      if (row.positioned && viewportPixels !== count) throw new Error(`Fond positionné non entièrement vérifié dans la fenêtre : ${row.selector}`);
      return { colors: [...colors.values()], pixels: count, viewportPixels };
    });
  }, { png: background.toString('base64'), viewportPng: viewportBackground.toString('base64'), rows: geometry });
  const measurements = geometry.map((row, i) => {
    const colors = samples[i].colors.map(sample => ({ ...sample, ratio: contrastRatio(row.foreground, sample.background) }));
    if (!colors.length) throw new Error('Aucun pixel de fond mesuré');
    const worst = colors.reduce((a, b) => a.ratio < b.ratio ? a : b);
    return { ...row, pixels: samples[i].pixels, viewportPixelsVerified: samples[i].viewportPixels, colors: colors.length, worst, passes: worst.ratio >= row.threshold };
  });
  return { background, viewportBackground, measurements };
}
