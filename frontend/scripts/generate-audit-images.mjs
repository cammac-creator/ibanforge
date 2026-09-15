/**
 * Capture l’aperçu fictif du classeur dans les trois langues, hors réseau.
 * Depuis frontend : node scripts/generate-audit-images.mjs
 * Outil ponctuel : npx playwright@1.63.0 (Chromium : npx playwright@1.63.0 install chromium).
 * Aucun appel à l’API et aucune donnée client. Les textes viennent des catalogues.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'audit');
const temporary = await mkdtemp(join(tmpdir(), 'ibanforge-audit-images-'));
const hash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const escape = (s) => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const font = (await readFile(join(root, 'assets', 'bebas-neue.ttf'))).toString('base64');
const mark = (await readFile(join(root, 'assets', 'anvil-mark.png'))).toString('base64');
const manifest = {};
await mkdir(out, { recursive: true });

try {
  for (const locale of ['en', 'fr', 'de']) {
    const { audit: { workbook: w } } = JSON.parse(await readFile(join(root, 'messages', `${locale}.json`), 'utf8'));
    const html = `<!doctype html><html lang="${locale}"><meta charset="utf-8"><title>${escape(w.imageTitle)}</title>
<style>
@font-face{font-family:Bebas;src:url(data:font/ttf;base64,${font})}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#0c0a09;color:#fff7ed;font-family:Arial,sans-serif;padding:36px 44px;overflow:hidden}
header{display:flex;align-items:center;justify-content:space-between;margin-bottom:20px}.brand{display:flex;align-items:center;gap:12px;font:34px Bebas;letter-spacing:1px}.brand img{width:34px;height:38px;object-fit:contain}.brand span{color:#f59e0b}.format{font-size:15px;color:#d6d3d1;letter-spacing:2px}
h1{font:52px/1.04 Bebas;margin:0 0 22px;letter-spacing:1px}.sheet{background:#fff;color:#292524;border-radius:10px;overflow:hidden;border:1px solid #78716c}
.bands{display:grid;grid-template-columns:34% 66%;font-size:14px;font-weight:bold}.bands span{padding:12px 18px;background:#e7e5e4}.bands span+span{background:#fef3c7;border-left:2px solid #f59e0b}
table{width:100%;table-layout:fixed;border-collapse:collapse;font-size:14px}th{text-align:left;background:#f5f5f4;font-weight:600}th,td{padding:13px 10px;border:1px solid #e7e5e4;vertical-align:middle;overflow-wrap:break-word}th:nth-child(3),td:nth-child(3){border-left:2px solid #f59e0b}td:nth-child(n+3){background:#fffbeb}td:nth-child(2),td:nth-child(6){font:12px/1.6 monospace;white-space:nowrap}.status{font-weight:bold;color:#047857}.status.error{color:#b91c1c}
.tabs{height:38px;display:flex;gap:6px;align-items:stretch;padding-left:28px;background:#f5f5f4;border-top:1px solid #d6d3d1;font-size:13px}.tabs span{padding:10px 18px}.tabs span:first-child{background:white;border-bottom:3px solid #d97706;font-weight:bold}
footer{display:flex;justify-content:space-between;color:#d6d3d1;font-size:14px;margin-top:18px}
</style><body><header><div class="brand"><img src="data:image/png;base64,${mark}" alt="">IBAN<span>FORGE</span></div><div class="format">.XLSX</div></header>
<h1>${escape(w.imageTitle)}</h1><div class="sheet"><div class="bands"><span>${escape(w.originalColumns)}</span><span>${escape(w.auditColumns)}</span></div>
<table><colgroup>${[16,18,12,20,14,12,8].map((width) => `<col style="width:${width}%">`).join('')}</colgroup><thead><tr>${w.cols.map((c) => `<th>${escape(c)}</th>`).join('')}</tr></thead><tbody>
${w.rows.map((row) => `<tr>${row.map((cell, i) => `<td class="${i === 2 ? `status${cell === w.status.error ? ' error' : ''}` : ''}">${escape(cell)}</td>`).join('')}</tr>`).join('')}
</tbody></table><div class="tabs"><span>Audit</span><span>${escape(w.summaryTab)}</span></div></div>
<footer><span>${escape(w.imageCaption)}</span><span>ibanforge.com</span></footer></body></html>`;
    const htmlPath = join(temporary, `${locale}.html`);
    const imagePath = join(temporary, `${locale}.png`);
    await writeFile(htmlPath, html);
    execFileSync('npx', ['--yes', 'playwright@1.63.0', 'screenshot', '--browser=chromium', '--viewport-size=1200,630', '--wait-for-timeout=500', pathToFileURL(htmlPath).href, imagePath], { stdio: 'inherit' });
    const png = await readFile(imagePath);
    const filename = `workbook-${locale}.${hash(png)}.png`;
    await writeFile(join(out, filename), png);
    manifest[locale] = { src: `/audit/${filename}`, width: 1200, height: 630, sourceHash: hash(JSON.stringify(w)) };
  }
  await writeFile(join(root, 'lib', 'audit-images.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
