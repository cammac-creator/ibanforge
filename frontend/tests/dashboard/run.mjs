import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, constants, copyFile, cp, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDashboardFixture } from './fixture.mjs';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reportBase = path.join(frontend, 'test-results/dashboard');
const runId = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex');
const report = path.join(reportBase, runId);
const children = new Set();
let temporary, fixture, version, resultStats, passed = false, interrupted = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function child(args, cwd, env) {
  const processChild = spawn(process.execPath, args, { cwd, env, stdio: 'inherit', detached: process.platform !== 'win32' });
  children.add(processChild);
  const done = new Promise((resolve, reject) => {
    processChild.once('error', reject);
    processChild.once('close', (code, signal) => { children.delete(processChild); resolve({ code, signal }); });
  });
  return { process: processChild, done };
}
async function run(args, cwd, env) {
  const result = await child(args, cwd, env).done;
  if (result.code !== 0) throw new Error(`Commande interrompue ou refusée : ${path.basename(args[0])}, code ${result.code}, signal ${result.signal ?? 'aucun'}`);
}
function terminate(processChild, signal) {
  try {
    if (process.platform === 'win32') processChild.kill(signal);
    else process.kill(-processChild.pid, signal);
  } catch (error) { if (error.code !== 'ESRCH') throw error; }
}
async function cleanup() {
  for (const processChild of children) terminate(processChild, 'SIGTERM');
  if (children.size) await delay(1000);
  for (const processChild of children) terminate(processChild, 'SIGKILL');
  for (let attempt = 0; children.size && attempt < 20; attempt++) await delay(100);
  if (children.size) throw new Error('Un processus de recette n’a pas confirmé son arrêt');
  if (fixture) await fixture.close();
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  interrupted = true;
  for (const processChild of children) terminate(processChild, 'SIGTERM');
});
const checkInterrupted = () => { if (interrupted) throw new Error('Recette interrompue'); };

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, 'localhost', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function copyFrontend(destination) {
  const files = execFileSync('git', ['-C', frontend, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  for (const file of new Set(files)) {
    const parts = file.split('/');
    if (path.isAbsolute(file) || parts.includes('..')) throw new Error('Chemin de copie hors du frontend');
    if (parts.some(part => part.startsWith('.env') || ['.npmrc', '.git', '.vercel', 'node_modules', '.next', 'test-results', 'playwright-report'].includes(part))) continue;
    const source = path.join(frontend, file), target = path.join(destination, file);
    const stat = await lstat(source).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!stat) continue;
    if (!stat.isFile()) throw new Error(`La recette ne copie que des fichiers ordinaires : ${file}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target, fsConstants.COPYFILE_FICLONE);
  }
  await copyFile(path.resolve(frontend, '../CHANGELOG.md'), path.resolve(destination, '../CHANGELOG.md'));
  const dependencies = path.join(frontend, 'node_modules');
  if ((await lstat(dependencies)).isSymbolicLink()) throw new Error('Les dépendances doivent être une copie physique');
  // Le clone natif APFS évite une copie séquentielle de chaque paquet. Les liens
  // sont contrôlés avant la copie et restent à l’intérieur des dépendances.
  for (const entry of await readdir(dependencies, { recursive: true, withFileTypes: true })) {
    if (!entry.isSymbolicLink()) continue;
    const source = path.join(entry.parentPath, entry.name);
    const target = await readlink(source);
    if (path.isAbsolute(target)) throw new Error('Un lien absolu ne serait pas isolé dans la copie temporaire');
    const resolved = path.resolve(entry.parentPath, target);
    if (resolved !== dependencies && !resolved.startsWith(dependencies + path.sep)) throw new Error('Un lien de dépendance sort du dossier node_modules');
  }
  if (process.platform === 'darwin') execFileSync('/bin/cp', ['-cR', dependencies, path.join(destination, 'node_modules')]);
  else await cp(dependencies, path.join(destination, 'node_modules'), {
    recursive: true, mode: fsConstants.COPYFILE_FICLONE, verbatimSymlinks: true,
  });
  await rm(path.join(destination, 'node_modules/.cache'), { recursive: true, force: true });
}

await mkdir(report, { recursive: true });
try {
  if (process.argv.length > 2) throw new Error('La commande de recette complète ne prend pas de filtre');
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Cette recette frontend demande Node 24');
  const { chromium, webkit } = await import('@playwright/test');
  const cli = path.join(frontend, 'node_modules/@playwright/test/cli.js');
  const missing = [];
  for (const [name, browser] of [['chromium', chromium], ['webkit', webkit]]) {
    try { await access(browser.executablePath(), constants.X_OK); } catch { missing.push(name); }
  }
  // Téléchargement des seuls navigateurs manquants, sans réglage système ni compte.
  if (missing.length) await run([cli, 'install', ...missing], frontend, process.env);
  checkInterrupted();
  temporary = await mkdtemp(path.join(tmpdir(), 'ibanforge-dashboard-recette-'));
  const app = path.join(temporary, 'frontend');
  await mkdir(app); await mkdir(report, { recursive: true });
  console.log('Copie physique du frontend et de ses dépendances dans un dossier temporaire.');
  await copyFrontend(app);
  checkInterrupted();
  const port = await freePort(), baseURL = `http://localhost:${port}`;
  const token = randomBytes(32).toString('hex'), sessionSecret = randomBytes(32).toString('hex');
  version = randomBytes(20).toString('hex');
  fixture = createDashboardFixture({ token, origin: baseURL });
  await new Promise((resolve, reject) => { fixture.server.once('error', reject); fixture.server.listen(0, '127.0.0.1', resolve); });
  const apiURL = `http://127.0.0.1:${fixture.server.address().port}`;
  // Aucune variable de compte n’est héritée par la copie compilée ni par son serveur.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'SYSTEMROOT', 'PLAYWRIGHT_BROWSERS_PATH'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
  Object.assign(env, { NODE_ENV: 'production', NEXT_OUTPUT: 'standalone', NEXT_TELEMETRY_DISABLED: '1',
    API_URL: apiURL, NEXT_PUBLIC_API_URL: apiURL, ADMIN_SECRET: token, STATS_TOKEN: token, SESSION_SECRET: sessionSecret,
    GIT_SHA: version, HOSTNAME: 'localhost', PORT: String(port) });
  console.log('Compilation de la copie avec une API fictive locale.');
  await run([path.join(app, 'node_modules/next/dist/bin/next'), 'build'], app, env);
  checkInterrupted();
  const standalone = path.join(app, '.next/standalone');
  for (const [source, target] of [['.next/static', '.next/static'], ['public', 'public'], ['data', 'data'], ['content', 'content'], ['assets', 'assets']]) {
    await cp(path.join(app, source), path.join(standalone, target), { recursive: true, mode: fsConstants.COPYFILE_FICLONE });
  }
  await copyFile(path.join(temporary, 'CHANGELOG.md'), path.resolve(standalone, '../CHANGELOG.md'));
  const site = child([path.join(standalone, 'server.js')], standalone, env);
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    checkInterrupted();
    if (site.process.exitCode !== null) throw new Error('Le serveur de recette s’est arrêté');
    try {
      const response = await fetch(baseURL + '/robots.txt', { signal: AbortSignal.timeout(1000) });
      await response.arrayBuffer();
      if (response.ok && response.headers.get('x-site-version') === version.slice(0, 12)) { ready = true; break; }
    } catch { /* Le démarrage peut prendre quelques instants. */ }
    await delay(100);
  }
  if (!ready) throw new Error('La bonne version locale du site ne répond pas');
  console.log('Site local identifié ; lancement des parcours Chromium et WebKit.');
  await run([cli, 'test', '--config', path.join(frontend, 'tests/dashboard/playwright.config.ts')], frontend,
    { ...env, IBF_RECIPE_BASE_URL: baseURL, IBF_RECIPE_API_URL: apiURL, IBF_RECIPE_TOKEN: token, IBF_RECIPE_SESSION_SECRET: sessionSecret, IBF_RECIPE_REPORT: report });
  checkInterrupted();
  const results = JSON.parse(await readFile(path.join(report, 'resultats.json'), 'utf8'));
  resultStats = results.stats;
  if (!(resultStats.expected > 0) || resultStats.unexpected || resultStats.skipped || resultStats.flaky) throw new Error('La recette n’est pas entièrement réussie : cas absent, ignoré, instable ou en échec');
  passed = true;
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  let cleaned = false;
  try { await cleanup(); cleaned = true; } catch (error) { console.error(error.message); process.exitCode = 1; }
  if (interrupted) process.exitCode = 1;
  if (!resultStats) {
    try { resultStats = JSON.parse(await readFile(path.join(report, 'resultats.json'), 'utf8')).stats; }
    catch { /* Une compilation ou une interruption peut précéder le rapport navigateur. */ }
  }
  const proof = { resultat: passed && !process.exitCode && cleaned ? 'réussi' : 'échec', source: 'données fictives locales', version: version?.slice(0, 12) ?? null, date: new Date().toISOString(), tests: resultStats ?? null, nettoyage: cleaned };
  await writeFile(path.join(report, 'execution.json'), JSON.stringify(proof, null, 2));
  await writeFile(path.join(reportBase, 'dernier.json'), JSON.stringify({ dossier: runId, ...proof }, null, 2));
  if (temporary && cleaned) console.log('Serveurs arrêtés ; copie temporaire supprimée.');
  console.log('Résultat de la recette : ' + proof.resultat + '. Rapport : ' + path.join(report, 'execution.json'));
}
