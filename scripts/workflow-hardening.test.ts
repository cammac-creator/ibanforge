/**
 * La garde des workflows GitHub (audit du 10.11.2026, OPS-20 et OPS-33).
 *
 * Un commit sur main redéploie l'API. Un job qui tient un jeton capable d'écrire
 * sur main ne doit donc jamais exécuter le code d'une dépendance : ni script
 * d'installation, ni simple import au chargement d'un seeder ou d'un test. Une
 * version piégée entrée dans package-lock.json par une mise à jour ordinaire y
 * lirait le jeton, ou poserait un crochet .git/hooks/pre-push qui s'exécuterait
 * pendant la poussée du robot. `--ignore-scripts` seul ne ferme pas ce trou (un
 * import suffit), ni « remettre le jeton à la seule étape de poussée » (le
 * crochet posé plus tôt s'exécute pendant cette étape). D'où les robots en deux
 * temps : un job de travail en lecture seule, puis un job d'écriture qui ne lance
 * aucun code de dépendance.
 *
 * Ce fichier lit les YAML eux-mêmes et refuse le retour en arrière, dans tous
 * les workflows du dépôt :
 *   - un job qui peut écrire le contenu du dépôt ne lance ni npm, ni npx, ni node,
 *     ni tsx (ni yarn, ni pnpm), n'emploie aucune action hors de
 *     actions/checkout et actions/download-artifact, fait ses checkouts avec
 *     `persist-credentials: false`, et ne glisse aucune expression `${{ }}` dans
 *     un script : une sortie du job de travail y deviendrait du code ;
 *   - un job qui tient un secret, le jeton du run ou un droit d'écriture installe
 *     sans scripts (`--ignore-scripts`), comme les robots et les deux rapports
 *     du lundi (refresh-*, weekly-*) ;
 * et, pour les cinq robots de données : un délai sur chaque job, un seul job
 * d'écriture qui récupère l'artefact, le contrôle puis commite exactement les
 * chemins déclarés, le battement après la poussée et chacune de ses tentatives
 * bornée par `--max-time`, un job report qui attend les deux autres, tourne sauf
 * annulation du run, ne bat qu'après un travail réussi et une poussée réussie (ou
 * sautée quand elle est conditionnelle) et alerte sur tout échec ou annulation,
 * aucun secret à côté du code des dépendances. Le script de contrôle de
 * l'artefact est aussi exécuté ici, tel qu'il est écrit dans chaque workflow,
 * sur des artefacts fabriqués.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WORKFLOWS = join(ROOT, '.github', 'workflows');

// ---------------------------------------------------------------------------
// Un lecteur YAML réduit à ce que ces fichiers emploient
// ---------------------------------------------------------------------------

type YamlNode = string | YamlNode[] | YamlMap;
interface YamlMap {
  [key: string]: YamlNode;
}

/**
 * Mappings et listes en blocs, scalaires simples ou entre guillemets, blocs `|`
 * et `>`. Les collections en ligne (`[main]`, `{}`) restent des chaînes. Une
 * indentation ou une ligne qu'il ne comprend pas le fait échouer : la garde ne
 * doit jamais passer parce qu'elle a mal lu.
 */
function parseYaml(source: string): YamlMap {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  const KEY = /^([A-Za-z0-9_][\w.-]*):(?:\s+(.*))?$/;
  const indentOf = (s: string): number => s.length - s.trimStart().length;
  const isItem = (t: string): boolean => t === '-' || t.startsWith('- ');
  const isContent = (s: string): boolean => s.trim() !== '' && !s.trim().startsWith('#');
  const skip = (): void => {
    while (i < lines.length && !isContent(lines[i])) i++;
  };

  const stripComment = (v: string): string => {
    let quote = '';
    for (let k = 0; k < v.length; k++) {
      const c = v[k];
      const boundary = k === 0 || /\s/.test(v[k - 1]);
      if (quote) {
        if (c === quote) quote = '';
      } else if ((c === "'" || c === '"') && boundary) {
        quote = c;
      } else if (c === '#' && boundary) {
        return v.slice(0, k).trim();
      }
    }
    return v.trim();
  };

  const scalar = (v: string): string => {
    const s = stripComment(v);
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
      return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
      return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return s;
  };

  const blockScalar = (keyIndent: number): string => {
    const body: string[] = [];
    while (i < lines.length && (lines[i].trim() === '' || indentOf(lines[i]) > keyIndent)) {
      body.push(lines[i]);
      i++;
    }
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
    const first = body.find((l) => l.trim() !== '');
    const cut = first === undefined ? 0 : indentOf(first);
    return body.map((l) => l.slice(cut)).join('\n');
  };

  const valueOf = (rest: string, indent: number): YamlNode => {
    const r = stripComment(rest);
    if (/^[|>][-+0-9]*$/.test(r)) return blockScalar(indent);
    if (r !== '') return scalar(rest);
    skip();
    if (i >= lines.length) return '';
    const next = indentOf(lines[i]);
    if (next > indent) return node(next);
    if (next === indent && isItem(lines[i].trim())) return seq(indent);
    return '';
  };

  const map = (indent: number): YamlMap => {
    const out: YamlMap = {};
    for (;;) {
      skip();
      if (i >= lines.length) return out;
      const ind = indentOf(lines[i]);
      const t = lines[i].trim();
      if (ind < indent || (ind === indent && isItem(t))) return out;
      if (ind > indent) throw new Error(`line ${i + 1}: unexpected indentation`);
      const m = KEY.exec(t);
      if (!m) throw new Error(`line ${i + 1}: not a key: ${t}`);
      i++;
      out[m[1]] = valueOf(m[2] ?? '', indent);
    }
  };

  const seq = (indent: number): YamlNode[] => {
    const out: YamlNode[] = [];
    for (;;) {
      skip();
      if (i >= lines.length) return out;
      const line = lines[i];
      const t = line.trim();
      if (indentOf(line) !== indent || !isItem(t)) return out;
      const rest = t.slice(1).trim();
      if (rest === '') {
        i++;
        skip();
        out.push(i < lines.length ? node(indentOf(lines[i])) : '');
      } else if (KEY.test(rest)) {
        // `- key: value` ouvre un mapping dont les clés suivantes s'alignent sur `key`.
        const col = line.indexOf(rest, indent + 1);
        lines[i] = ' '.repeat(col) + rest;
        out.push(map(col));
      } else {
        i++;
        out.push(scalar(rest));
      }
    }
  };

  const node = (indent: number): YamlNode => {
    skip();
    if (i >= lines.length) return '';
    return isItem(lines[i].trim()) ? seq(indent) : map(indent);
  };

  const doc = map(0);
  skip();
  if (i < lines.length) throw new Error(`line ${i + 1}: not understood`);
  return doc;
}

// ---------------------------------------------------------------------------
// Le modèle d'un workflow
// ---------------------------------------------------------------------------

interface Step {
  name: string;
  id: string;
  if: string;
  uses: string;
  with: Record<string, string>;
  env: Record<string, string>;
  run: string;
}
interface Job {
  id: string;
  node: YamlMap;
  needs: string[];
  steps: Step[];
}
interface Workflow {
  file: string;
  doc: YamlMap;
  env: Record<string, string>;
  jobs: Job[];
}
interface Perms {
  all?: 'read' | 'write' | 'none';
  scopes: Record<string, string>;
}

const asMap = (n: YamlNode | undefined): YamlMap =>
  n !== undefined && typeof n === 'object' && !Array.isArray(n) ? n : {};
const asStr = (n: YamlNode | undefined): string => (typeof n === 'string' ? n : '');
const strMap = (n: YamlNode | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(asMap(n)).map(([k, v]) => [k, asStr(v)]));
const flowList = (s: string): string[] =>
  s
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

function load(file: string, text: string): Workflow {
  const doc = parseYaml(text);
  const jobs = Object.entries(asMap(doc.jobs)).map(([id, n]): Job => {
    const node = asMap(n);
    const needs = Array.isArray(node.needs) ? node.needs.map(asStr) : flowList(asStr(node.needs));
    const steps = (Array.isArray(node.steps) ? node.steps : []).map((s): Step => {
      const m = asMap(s);
      return {
        name: asStr(m.name),
        id: asStr(m.id),
        if: asStr(m.if),
        uses: asStr(m.uses),
        with: strMap(m.with),
        env: strMap(m.env),
        run: asStr(m.run),
      };
    });
    return { id, node, needs, steps };
  });
  return { file, doc, env: strMap(doc.env), jobs };
}

function readPerms(n: YamlNode | undefined): Perms | null {
  if (n === undefined) return null;
  if (typeof n === 'string') {
    if (n === 'write-all') return { all: 'write', scopes: {} };
    if (n === 'read-all') return { all: 'read', scopes: {} };
    if (n === '{}' || n === '') return { all: 'none', scopes: {} };
    throw new Error(`permissions not understood: ${n}`);
  }
  if (Array.isArray(n)) throw new Error('permissions as a list');
  return { scopes: strMap(n) };
}

/** Sans bloc `permissions`, le jeton prend le défaut du dépôt : l'écriture. */
const effective = (job: Job, wf: Workflow): Perms =>
  readPerms(job.node.permissions) ?? readPerms(wf.doc.permissions) ?? { all: 'write', scopes: {} };
const level = (p: Perms, scope: string): string => p.scopes[scope] ?? p.all ?? 'none';
const writesSomething = (p: Perms): boolean =>
  p.all === 'write' || Object.values(p.scopes).includes('write');

/** Le script sans ses lignes de commentaire, ses suites de ligne recollées. */
const shellCode = (run: string): string =>
  run
    .split('\n')
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n')
    .replace(/\\\n/g, ' ');

const JS_COMMAND = /(?:^|[\s;&|(`])(npm|npx|node|tsx|yarn|pnpm)(?=$|[\s;&|)`])/m;
const INSTALL = /\bnpm\s+(?:ci|install|i|add)\b[^\n;&|]*/g;
const WRITE_JOB_ACTIONS = /^actions\/(?:checkout|download-artifact)@/;
const VERIFY_STEP = 'Only the expected files, nothing else';

const runsDependencyCode = (job: Job): boolean =>
  job.steps.some((s) => JS_COMMAND.test(shellCode(s.run)) || /^actions\/setup-node@/.test(s.uses));

const holdsCredential = (job: Job, perms: Perms): boolean =>
  /\bsecrets\.|\bgithub\.token\b/.test(JSON.stringify(job.node)) ||
  writesSomething(perms) ||
  level(perms, 'id-token') === 'write';

// ---------------------------------------------------------------------------
// Les règles
// ---------------------------------------------------------------------------

type Rule =
  | 'write-job-runs-no-javascript'
  | 'write-job-checkout-keeps-no-token'
  | 'write-job-takes-no-expression-in-shell'
  | 'credential-job-installs-without-scripts'
  | 'robot-installs-without-scripts';

/** Les écarts d'un fichier, au format « fichier / job / règle ». */
function violations(file: string, text: string): string[] {
  const wf = load(file, text);
  const found = new Set<string>();
  const robot = /^(?:refresh|weekly)-/.test(file);
  for (const job of wf.jobs) {
    const perms = effective(job, wf);
    const add = (rule: Rule): void => {
      found.add(`${file} / ${job.id} / ${rule}`);
    };
    if (level(perms, 'contents') === 'write') {
      for (const s of job.steps) {
        if (s.uses !== '' && !WRITE_JOB_ACTIONS.test(s.uses)) add('write-job-runs-no-javascript');
        if (JS_COMMAND.test(shellCode(s.run))) add('write-job-runs-no-javascript');
        if (/^actions\/checkout@/.test(s.uses) && s.with['persist-credentials'] !== 'false') {
          add('write-job-checkout-keeps-no-token');
        }
        if (s.run.includes('${{')) add('write-job-takes-no-expression-in-shell');
      }
    }
    const scripted = job.steps
      .flatMap((s) => [...shellCode(s.run).matchAll(INSTALL)].map((m) => m[0]))
      .filter((cmd) => !cmd.includes('--ignore-scripts'));
    if (scripted.length > 0 && holdsCredential(job, perms)) {
      add('credential-job-installs-without-scripts');
    }
    if (scripted.length > 0 && robot) add('robot-installs-without-scripts');
  }
  return [...found].sort();
}

/** Les chemins d'une ligne `git add`, guillemets simples retirés. */
function gitAddPaths(run: string): string[] {
  const line = /^\s*git add (.+)$/m.exec(shellCode(run));
  if (!line) return [];
  return (line[1].match(/'[^']*'|\S+/g) ?? []).map((t) => t.replace(/^'|'$/g, ''));
}

const checkoutRef = (job: Job): string =>
  job.steps.find((s) => /^actions\/checkout@/.test(s.uses))?.with.ref ?? '';

/** Ce que la garde exige d'un robot de données en plus des règles communes. */
function robotProblems(file: string, text: string): string[] {
  const wf = load(file, text);
  const problems: string[] = [];
  for (const job of wf.jobs) {
    if (asStr(job.node['timeout-minutes']) === '') problems.push(`${job.id}: no timeout-minutes`);
    if (runsDependencyCode(job) && holdsCredential(job, effective(job, wf))) {
      problems.push(`${job.id}: runs dependency code next to a secret or a write token`);
    }
  }
  const writers = wf.jobs.filter((j) => level(effective(j, wf), 'contents') === 'write');
  if (writers.length !== 1) {
    problems.push(`${writers.length} jobs may write, expected exactly one`);
    return problems;
  }
  const writer = writers[0];
  const work = wf.jobs.filter((j) => writer.needs.includes(j.id) && runsDependencyCode(j));
  if (work.length !== 1)
    problems.push(`${writer.id}: needs ${work.length} work jobs, expected one`);

  const download = writer.steps.findIndex(
    (s) => /^actions\/download-artifact@/.test(s.uses) && s.with.name === 'robot-files',
  );
  const verify = writer.steps.findIndex((s) => s.name === VERIFY_STEP);
  const commit = writer.steps.findIndex((s) => /\bgit push\b/.test(shellCode(s.run)));
  if (!(download >= 0 && download < verify && verify < commit)) {
    problems.push(
      `${writer.id}: download the artefact, check it, then commit (${download}, ${verify}, ${commit})`,
    );
  }

  const declared = (wf.env.COMMITTED_PATHS ?? '').split(/\s+/).filter(Boolean);
  const added = commit >= 0 ? gitAddPaths(writer.steps[commit].run) : [];
  if (declared.length === 0 || declared.join(' ') !== added.join(' ')) {
    problems.push(
      `COMMITTED_PATHS (${declared.join(' ')}) is not the git add (${added.join(' ')})`,
    );
  }

  const beats = wf.jobs.filter((j) => j.steps.some((s) => s.run.includes('/internal/heartbeat/')));
  if (beats.length === 0) problems.push('no heartbeat');
  for (const j of beats) {
    if (j.id === writer.id || work.some((w) => w.id === j.id) || !j.needs.includes(writer.id)) {
      problems.push(`${j.id}: the heartbeat does not wait for ${writer.id}`);
    }
  }
  // Chaque tentative du battement a son délai : sans lui, une API qui accepte la
  // connexion sans répondre ferait expirer le job avant son étape d'alerte.
  for (const j of beats) {
    const curls = j.steps.flatMap((s) =>
      [...shellCode(s.run).matchAll(/\bcurl\b[^\n]*\/internal\/heartbeat\//g)].map((m) => m[0]),
    );
    if (curls.some((c) => !/(?:^|\s)(?:--max-time\s+|-m\s*)\d+/.test(c))) {
      problems.push(`${j.id}: the heartbeat curl has no --max-time`);
    }
  }
  const code = shellCode(text);
  if (code.indexOf('/internal/heartbeat/') < code.indexOf('git push')) {
    problems.push('the heartbeat comes before the push');
  }

  // Le job d'écriture repart de la base que le travail a jugée : le même commit,
  // ou, s'il suit une branche qui bouge, la preuve que ces fichiers n'y ont pas changé.
  if (work.length === 1 && checkoutRef(work[0]) !== checkoutRef(writer)) {
    problems.push(`${writer.id} checks out another ref than ${work[0].id}`);
  }
  if (checkoutRef(writer) !== '') {
    const guarded = writer.steps.some((s) =>
      (s.env.BASE_FILES ?? '').includes('outputs.base_files'),
    );
    if (!guarded)
      problems.push(`${writer.id} follows ${checkoutRef(writer)} without the base check`);
  }
  if (work.length === 1) problems.push(...reportProblems(wf, work[0], writer));
  return problems;
}

/** Une condition `if:` sans son enveloppe `${{ }}`, ses blancs ramenés à un seul. */
const condition = (text: string): string =>
  text
    .trim()
    .replace(/^\$\{\{([\s\S]*)\}\}$/, '$1')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Le job qui attend la poussée (report) : il attend aussi le travail, et part même
 * quand l'un des deux a échoué ou a été sauté, jamais quand le run est annulé. Son
 * battement ne part qu'après un travail réussi et une poussée réussie, ou sautée
 * quand elle est conditionnelle (rien à pousser) ; le robot mensuel, dont la
 * poussée tourne toujours, n'accepte que la réussite. Son alerte part sur une
 * étape en échec ou sur un job en échec ou annulé. Les conditions sont comparées
 * texte pour texte : une variante équivalente se fait en changeant ce modèle.
 */
function reportProblems(wf: Workflow, work: Job, writer: Job): string[] {
  const reports = wf.jobs.filter((j) => j.needs.includes(writer.id));
  if (reports.length !== 1) return [`${reports.length} jobs wait for ${writer.id}, expected one`];
  const report = reports[0];
  const problems: string[] = [];
  if (condition(asStr(report.node.if)) !== '!cancelled()') {
    problems.push(`${report.id}: its condition is not !cancelled()`);
  }
  if (!report.needs.includes(work.id)) {
    problems.push(`${report.id}: does not wait for ${work.id} and ${writer.id}`);
  }
  const beat = report.steps.find((s) => s.run.includes('/internal/heartbeat/'));
  const skippable = asStr(writer.node.if) !== '';
  const pushed = `needs.${writer.id}.result == 'success'`;
  const expectedBeat = `!cancelled() && needs.${work.id}.result == 'success' && ${
    skippable ? `(${pushed} || needs.${writer.id}.result == 'skipped')` : pushed
  }`;
  if (beat && condition(beat.if) !== expectedBeat) {
    problems.push(
      `${report.id}: the heartbeat does not wait for a successful ${work.id} and a ${
        skippable ? 'successful or skipped' : 'successful'
      } ${writer.id}`,
    );
  }
  const alert = report.steps.find((s) => s.run.includes('api.telegram.org'));
  const expectedAlert =
    "!cancelled() && (failure() || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled'))";
  if (!alert) problems.push(`${report.id}: no alert`);
  else if (condition(alert.if) !== expectedAlert) {
    problems.push(
      `${report.id}: the alert does not fire on a failed step or a failed or cancelled job`,
    );
  }
  return problems;
}

// ---------------------------------------------------------------------------
// La garde elle-même, sur des workflows fabriqués
// ---------------------------------------------------------------------------

const GOOD_ROBOT = `name: fixture
on:
  workflow_dispatch:
permissions:
  contents: read
env:
  COMMITTED_PATHS: 'data/x.sqlite'
jobs:
  work:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    outputs:
      changed: \${{ steps.diff.outputs.changed }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/setup-node@v7
      - run: npm ci --ignore-scripts
      - id: diff
        run: npx tsx scripts/diff.ts
      - uses: actions/upload-artifact@v7
        with:
          name: robot-files
          path: \${{ runner.temp }}/robot-files/
  publish:
    needs: work
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
      - uses: actions/download-artifact@v8
        with:
          name: robot-files
          path: \${{ runner.temp }}/robot-files
      - name: ${VERIFY_STEP}
        env:
          ARTEFACT: \${{ runner.temp }}/robot-files
        run: |
          echo check
      - name: Commit
        env:
          PUSH_TOKEN: \${{ github.token }}
        run: |
          git add data/x.sqlite
          git commit -m "chore: x"
          git push
  report:
    needs: [work, publish]
    if: \${{ !cancelled() }}
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      actions: read
    steps:
      - name: Heartbeat
        if: \${{ !cancelled() && needs.work.result == 'success' && needs.publish.result == 'success' }}
        env:
          HEARTBEAT_TOKEN: \${{ secrets.HEARTBEAT_TOKEN }}
        run: curl --max-time 20 -X POST https://api.example.com/internal/heartbeat/fixture
      - name: Alert
        if: \${{ !cancelled() && (failure() || contains(needs.*.result, 'failure') || contains(needs.*.result, 'cancelled')) }}
        env:
          TELEGRAM_BOT_TOKEN: \${{ secrets.TELEGRAM_BOT_TOKEN }}
        run: curl -sS -X POST https://api.telegram.org/fixture
`;

/** La condition du battement quand la poussée tourne toujours, puis quand elle peut être sautée. */
const BEAT_IF_ALWAYS = `needs.work.result == 'success' && needs.publish.result == 'success' }}`;
const BEAT_IF_SKIPPABLE = `needs.work.result == 'success' && (needs.publish.result == 'success' || needs.publish.result == 'skipped') }}`;
/** Une poussée qui ne tourne que si le travail a changé quelque chose. */
const CONDITIONAL_PUBLISH = (source: string): string =>
  edit(
    source,
    '  publish:\n    needs: work\n',
    "  publish:\n    needs: work\n    if: needs.work.outputs.changed == 'true'\n",
  );

/** Remplace un passage qui doit exister une seule fois dans le modèle. */
function edit(source: string, from: string, to: string): string {
  expect(source.split(from).length, from).toBe(2);
  return source.replace(from, to);
}

const PUBLISH_CHECKOUT = `      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
`;

describe('the guard itself', () => {
  it('reads a correct two-step robot without a single complaint', () => {
    expect(violations('refresh-fixture.yml', GOOD_ROBOT)).toEqual([]);
    expect(robotProblems('refresh-fixture.yml', GOOD_ROBOT)).toEqual([]);
  });

  it.each(['npm run build', 'npx tsx scripts/x.ts', 'node scripts/x.mjs', 'tsx scripts/x.ts'])(
    'refuses a write job that runs `%s`',
    (cmd) => {
      const bad = edit(
        GOOD_ROBOT,
        '          git push\n',
        `          ${cmd}\n          git push\n`,
      );
      expect(violations('refresh-fixture.yml', bad)).toContain(
        'refresh-fixture.yml / publish / write-job-runs-no-javascript',
      );
    },
  );

  it.each(['actions/setup-node@v7', './.github/actions/local', 'someone/else@v1'])(
    'refuses a write job that uses %s',
    (action) => {
      const bad = edit(
        GOOD_ROBOT,
        '      - uses: actions/download-artifact@v8\n',
        `      - uses: ${action}\n      - uses: actions/download-artifact@v8\n`,
      );
      expect(violations('refresh-fixture.yml', bad)).toContain(
        'refresh-fixture.yml / publish / write-job-runs-no-javascript',
      );
    },
  );

  it('refuses a write job whose checkout leaves the token in .git/config', () => {
    const bad = edit(
      GOOD_ROBOT,
      PUBLISH_CHECKOUT,
      '      contents: write\n    steps:\n      - uses: actions/checkout@v7\n',
    );
    expect(violations('refresh-fixture.yml', bad)).toEqual([
      'refresh-fixture.yml / publish / write-job-checkout-keeps-no-token',
    ]);
  });

  it('refuses an output of the work job pasted into a script of the write job', () => {
    const bad = edit(
      GOOD_ROBOT,
      '          echo check\n',
      '          echo "${{ needs.work.outputs.changed }}"\n',
    );
    expect(violations('refresh-fixture.yml', bad)).toEqual([
      'refresh-fixture.yml / publish / write-job-takes-no-expression-in-shell',
    ]);
  });

  it('counts a workflow without permissions, or with write-all, as able to write', () => {
    const none =
      'on: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm test\n';
    expect(violations('ci-like.yml', none)).toContain(
      'ci-like.yml / build / write-job-runs-no-javascript',
    );
    const all = `permissions: write-all\n${none}`;
    expect(violations('ci-like.yml', all)).toContain(
      'ci-like.yml / build / write-job-runs-no-javascript',
    );
    const read = `permissions:\n  contents: read\n${none}`;
    expect(violations('ci-like.yml', read)).toEqual([]);
  });

  it('refuses an install with scripts in a job that holds a secret, and in any robot', () => {
    const secret = `permissions:
  contents: read
jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - env:
          KEY: \${{ secrets.KEY }}
        run: npm run report
`;
    expect(violations('other.yml', secret)).toEqual([
      'other.yml / report / credential-job-installs-without-scripts',
    ]);
    expect(violations('other.yml', secret.replace('npm ci', 'npm ci --ignore-scripts'))).toEqual(
      [],
    );
    const oidc = secret
      .replace('  contents: read', '  contents: read\n  id-token: write')
      .replace('KEY: ${{ secrets.KEY }}', 'KEY: plain');
    expect(violations('other.yml', oidc)).toEqual([
      'other.yml / report / credential-job-installs-without-scripts',
    ]);
    const robot = edit(GOOD_ROBOT, 'npm ci --ignore-scripts', 'npm ci');
    expect(violations('refresh-fixture.yml', robot)).toEqual([
      'refresh-fixture.yml / work / robot-installs-without-scripts',
    ]);
  });

  it('refuses a robot job without a time limit', () => {
    const bad = edit(
      GOOD_ROBOT,
      '    needs: work\n    runs-on: ubuntu-latest\n    timeout-minutes: 5\n',
      '    needs: work\n    runs-on: ubuntu-latest\n',
    );
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual(['publish: no timeout-minutes']);
  });

  it('refuses a heartbeat sent before the push', () => {
    const bad = edit(
      GOOD_ROBOT,
      `      - name: ${VERIFY_STEP}\n`,
      `      - name: Heartbeat\n        run: curl --max-time 20 -X POST https://api.example.com/internal/heartbeat/early\n      - name: ${VERIFY_STEP}\n`,
    );
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'publish: the heartbeat does not wait for publish',
      'the heartbeat comes before the push',
    ]);
  });

  it('refuses a heartbeat whose curl may wait for ever', () => {
    const bad = edit(GOOD_ROBOT, 'curl --max-time 20 -X POST', 'curl -X POST');
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'report: the heartbeat curl has no --max-time',
    ]);
  });

  it.each([
    ['no condition (success() implied)', ''],
    ['always()', '    if: ${{ always() }}\n'],
    ['success()', '    if: ${{ success() }}\n'],
  ])('refuses a report job whose condition is %s', (_label, condition) => {
    const bad = edit(GOOD_ROBOT, '    if: ${{ !cancelled() }}\n', condition);
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'report: its condition is not !cancelled()',
    ]);
  });

  it('refuses a report job that does not wait for both other jobs', () => {
    const bad = edit(GOOD_ROBOT, '    needs: [work, publish]\n', '    needs: publish\n');
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'report: does not wait for work and publish',
    ]);
  });

  it('beats after a skipped publish only when the publish may be skipped', () => {
    // Une poussée conditionnelle : le battement doit accepter « sautée » (rien à pousser).
    const conditional = CONDITIONAL_PUBLISH(GOOD_ROBOT);
    expect(robotProblems('refresh-fixture.yml', conditional)).toEqual([
      'report: the heartbeat does not wait for a successful work and a successful or skipped publish',
    ]);
    const accepted = edit(conditional, BEAT_IF_ALWAYS, BEAT_IF_SKIPPABLE);
    expect(robotProblems('refresh-fixture.yml', accepted)).toEqual([]);
    // Une poussée qui tourne toujours (le robot mensuel) : « sautée » n'est pas un succès.
    const monthly = edit(GOOD_ROBOT, BEAT_IF_ALWAYS, BEAT_IF_SKIPPABLE);
    expect(robotProblems('refresh-fixture.yml', monthly)).toEqual([
      'report: the heartbeat does not wait for a successful work and a successful publish',
    ]);
    // Un battement qui part sans que le travail ait réussi.
    const workless = edit(GOOD_ROBOT, "needs.work.result == 'success' && ", '');
    expect(robotProblems('refresh-fixture.yml', workless)).toEqual([
      'report: the heartbeat does not wait for a successful work and a successful publish',
    ]);
    const forced = edit(GOOD_ROBOT, BEAT_IF_ALWAYS, BEAT_IF_ALWAYS.replace(' }}', ' || true }}'));
    expect(robotProblems('refresh-fixture.yml', forced)).toEqual([
      'report: the heartbeat does not wait for a successful work and a successful publish',
    ]);
  });

  it.each([
    ['a cancelled job', " || contains(needs.*.result, 'cancelled')", ''],
    ['a failed job', " || contains(needs.*.result, 'failure')", ''],
    ['a failed step of the report itself', 'failure() || ', ''],
  ])('refuses an alert that stays silent on %s', (_label, from, to) => {
    const bad = edit(GOOD_ROBOT, from, to);
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'report: the alert does not fire on a failed step or a failed or cancelled job',
    ]);
  });

  it('refuses a report job without an alert', () => {
    const bad = edit(GOOD_ROBOT, 'https://api.telegram.org/fixture', 'https://chat.example.net/');
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual(['report: no alert']);
  });

  it('refuses a secret next to the code of the dependencies', () => {
    const bad = edit(
      GOOD_ROBOT,
      '      - id: diff\n',
      '      - env:\n          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}\n        run: echo alert\n      - id: diff\n',
    );
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'work: runs dependency code next to a secret or a write token',
    ]);
  });

  it('refuses a robot whose handed-over paths are not the committed ones', () => {
    const bad = edit(
      GOOD_ROBOT,
      "COMMITTED_PATHS: 'data/x.sqlite'",
      "COMMITTED_PATHS: 'data/x.sqlite data/y.json'",
    );
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'COMMITTED_PATHS (data/x.sqlite data/y.json) is not the git add (data/x.sqlite)',
    ]);
  });

  it('refuses a write job that commits without checking the artefact first', () => {
    const bad = edit(
      GOOD_ROBOT,
      `      - name: ${VERIFY_STEP}\n`,
      '      - name: Something else\n',
    );
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'publish: download the artefact, check it, then commit (1, -1, 3)',
    ]);
  });

  it('refuses a write job that follows a moving branch without the base check', () => {
    const bad = edit(
      GOOD_ROBOT,
      PUBLISH_CHECKOUT,
      '      contents: write\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          ref: main\n          persist-credentials: false\n',
    );
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'publish checks out another ref than work',
      'publish follows main without the base check',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Les workflows du dépôt
// ---------------------------------------------------------------------------

/**
 * Les écarts tolérés, nommés un par un (« fichier / job / règle »). Les deux
 * workflows de publication de paquets y figuraient jusqu'à leur durcissement
 * (C13, 10.11.2026) : la liste est vide depuis, et les règles tiennent tous les
 * workflows. Une ligne ajoutée ici nomme un écart précis et sa raison ; une
 * ligne qui ne correspond plus à aucun écart fait échouer la garde.
 */
const PENDING: string[] = [];

const FILES = readdirSync(WORKFLOWS)
  .filter((f) => /\.ya?ml$/.test(f))
  .sort();
const read = (f: string): string => readFileSync(join(WORKFLOWS, f), 'utf8');
const ROBOTS = FILES.filter((f) => f.startsWith('refresh-'));

describe('every workflow of the repository', () => {
  it.each(FILES)('%s breaks no rule', (file) => {
    const found = violations(file, read(file)).filter((v) => !PENDING.includes(v));
    expect(found).toEqual([]);
  });

  it('keeps only exceptions that are still needed', () => {
    const all = FILES.flatMap((f) => violations(f, read(f)));
    expect(PENDING.filter((p) => !all.includes(p))).toEqual([]);
  });

  it('knows the five data robots and the two Monday reports', () => {
    expect(ROBOTS).toEqual([
      'refresh-bic.yml',
      'refresh-ch-clearing.yml',
      'refresh-compliance.yml',
      'refresh-cz-register.yml',
      'refresh-it-register.yml',
    ]);
    expect(FILES.filter((f) => f.startsWith('weekly-'))).toEqual([
      'weekly-reco-baseline.yml',
      'weekly-veille.yml',
    ]);
  });

  it('installs without scripts in every robot and report: each `npm ci` says so', () => {
    for (const file of FILES.filter((f) => /^(?:refresh|weekly)-/.test(f))) {
      const installs = [...shellCode(read(file)).matchAll(INSTALL)].map((m) => m[0].trim());
      expect(installs.length, file).toBeGreaterThan(0);
      for (const cmd of installs) expect(cmd, file).toBe('npm ci --ignore-scripts');
    }
  });
});

describe('the five data robots', () => {
  it.each(ROBOTS)('%s works read-only, then writes without dependency code', (file) => {
    expect(robotProblems(file, read(file))).toEqual([]);
  });

  it('gates the compliance refresh on the FATF table as well', () => {
    const wf = load('refresh-compliance.yml', read('refresh-compliance.yml'));
    const gate = wf.jobs.flatMap((j) => j.steps).find((s) => s.run.startsWith('npx vitest run '));
    expect(gate?.run.split(/\s+/)).toEqual([
      'npx',
      'vitest',
      'run',
      'src/routes/sanctions-claims.test.ts',
      'src/lib/public-base-family-free.test.ts',
      'src/lib/fatf-db-sync.test.ts',
    ]);
  });
});

// ---------------------------------------------------------------------------
// La publication des paquets et le site après les robots (C13, 10.11.2026)
// ---------------------------------------------------------------------------

/** Les quatre workflows qui publient sur un registre public. */
const PUBLISHING = [
  'dotnet-publish.yml',
  'java-publish.yml',
  'n8n-publish.yml',
  'release-publish.yml',
];
/** Ceux dont chaque action est épinglée à un commit. */
const PINNED = [...PUBLISHING, 'deploy-site.yml'];

/** Chaque ligne `uses:` du texte brut, avec ce qui la suit sur la ligne. */
const usesLines = (text: string): { ref: string; rest: string }[] =>
  [...text.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)(.*)$/gm)].map((m) => ({ ref: m[1], rest: m[2] }));

describe('the publishing workflows (OPS-22, OPS-23, OPS-30)', () => {
  it('are the four expected files', () => {
    expect(FILES.filter((f) => f.endsWith('-publish.yml'))).toEqual(PUBLISHING);
  });

  it.each(PINNED)('%s pins every action to a commit, its release in a comment', (file) => {
    const lines = usesLines(read(file));
    expect(lines.length, file).toBeGreaterThan(0);
    for (const { ref, rest } of lines) {
      expect(ref, file).toMatch(/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/);
      expect(rest.trim(), `${file}: ${ref}`).toMatch(/^# v\d+\.\d+\.\d+$/);
    }
  });

  it.each(PINNED)('%s installs nothing at @latest and puts no expression in a script', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/@latest\b/);
    for (const job of load(file, text).jobs) {
      for (const s of job.steps) expect(s.run, `${file} / ${job.id}`).not.toContain('${{');
    }
  });

  it.each(PUBLISHING)('%s publishes only after the approval of `publication`', (file) => {
    const wf = load(file, read(file));
    const publishers = wf.jobs.filter(
      (job) =>
        level(effective(job, wf), 'id-token') === 'write' ||
        /\bsecrets\./.test(JSON.stringify(job.node)),
    );
    expect(publishers.length, file).toBeGreaterThan(0);
    for (const job of publishers) {
      expect(asStr(job.node.environment), `${file} / ${job.id}`).toBe('publication');
      // Le job qui publie ne peut pas écrire sur le dépôt.
      expect(level(effective(job, wf), 'contents'), `${file} / ${job.id}`).not.toBe('write');
    }
    expect(read(file)).not.toMatch(/continue-on-error/);
  });

  it.each(['n8n-publish.yml', 'release-publish.yml'])(
    '%s ends its npm publication by checking the provenance attestation',
    (file) => {
      const wf = load(file, read(file));
      const npmJob = wf.jobs.find((j) => j.steps.some((s) => /\bnpm publish\b/.test(s.run)));
      const last = npmJob?.steps[npmJob.steps.length - 1];
      expect(last?.run, file).toContain('dist.attestations.provenance');
    },
  );
});

/**
 * Ce que la garde exige de deploy-site.yml (OPS-28) : le site ne recule jamais.
 * Les passages sont sérialisés en entier (`resolve` compris) par un seul groupe
 * de concurrence au niveau du workflow, et chacun construit la tête de main lue
 * à son démarrage, jamais le commit ni la branche de son déclencheur.
 */
function siteProblems(text: string): string[] {
  const wf = load('deploy-site.yml', text);
  const problems: string[] = [];
  const group = asMap(wf.doc.concurrency);
  if (asStr(group.group) === '' || asStr(group['cancel-in-progress']) !== 'false') {
    problems.push('no workflow-level concurrency group without cancel-in-progress');
  }
  for (const job of wf.jobs) {
    if (job.node.concurrency !== undefined) problems.push(`${job.id}: concurrency on a job`);
  }
  if (/\bhead_sha\b|\bhead_branch\b/.test(text))
    problems.push("reads the trigger's commit or branch");
  const job = (id: string): Job | undefined => wf.jobs.find((j) => j.id === id);
  const resolveJob = job('resolve');
  const buildJob = job('build');
  if (!resolveJob || checkoutRef(resolveJob) !== 'main')
    problems.push('resolve does not check out main');
  if (!buildJob || checkoutRef(buildJob) !== '${{ needs.resolve.outputs.sha }}') {
    problems.push('build does not check out what resolve read');
  }
  return problems;
}

describe('the site follows the data robots (OPS-28)', () => {
  const site = load('deploy-site.yml', read('deploy-site.yml'));
  const trigger = asMap(asMap(site.doc.on).workflow_run);

  it('is started by exactly the robots that commit under frontend/', () => {
    const writers = ROBOTS.map((f) => load(f, read(f)))
      .filter((wf) =>
        (wf.env.COMMITTED_PATHS ?? '').split(/\s+/).some((p) => p.startsWith('frontend/')),
      )
      .map((wf) => asStr(wf.doc.name))
      .sort();
    const listed = (Array.isArray(trigger.workflows) ? trigger.workflows : []).map(asStr).sort();
    expect(writers.length).toBeGreaterThan(0);
    expect(listed).toEqual(writers);
    expect(asStr(trigger.types)).toBe('[completed]');
    expect(asStr(trigger.branches)).toBe('[main]');
  });

  it('deploys only after a robot that succeeded, and no job may start a workflow', () => {
    for (const job of site.jobs) {
      expect(level(effective(job, site), 'actions'), job.id).not.toBe('write');
    }
    const job = (id: string): Job | undefined => site.jobs.find((j) => j.id === id);
    expect(asStr(job('resolve')?.node.if)).toContain(
      "github.event.workflow_run.conclusion == 'success'",
    );
    expect(asStr(job('build')?.node.if)).toBe("needs.resolve.outputs.deploy == 'true'");
    expect(job('build')?.needs).toEqual(['resolve']);
    expect(job('deploy')?.needs).toEqual(['resolve', 'build']);
  });

  it('serializes whole runs and always builds the head of main read by resolve', () => {
    expect(siteProblems(read('deploy-site.yml'))).toEqual([]);
  });

  it('refuses concurrency on the jobs instead of the whole run', () => {
    const text = read('deploy-site.yml');
    const bad = edit(
      edit(text, 'concurrency:\n  group: deploy-site\n  cancel-in-progress: false\n', ''),
      '  build:\n    needs: resolve\n',
      '  build:\n    needs: resolve\n    concurrency:\n      group: deploy-site-build\n',
    );
    expect(siteProblems(bad)).toEqual([
      'no workflow-level concurrency group without cancel-in-progress',
      'build: concurrency on a job',
    ]);
  });

  it.each(['head_sha', 'head_branch'])(
    'refuses a resolve that checks out the workflow_run %s',
    (field) => {
      const bad = edit(
        read('deploy-site.yml'),
        '          ref: main\n',
        `          ref: \${{ github.event.workflow_run.${field} }}\n`,
      );
      expect(siteProblems(bad)).toEqual([
        "reads the trigger's commit or branch",
        'resolve does not check out main',
      ]);
    },
  );

  it('refuses a build of the commit that started the run', () => {
    const bad = edit(
      read('deploy-site.yml'),
      '          ref: ${{ needs.resolve.outputs.sha }}\n',
      '          ref: ${{ github.sha }}\n',
    );
    expect(siteProblems(bad)).toEqual(['build does not check out what resolve read']);
  });
});

// ---------------------------------------------------------------------------
// Le contrôle de l'artefact, exécuté tel qu'il est écrit dans chaque robot
// ---------------------------------------------------------------------------

const scratch = mkdtempSync(join(tmpdir(), 'workflow-hardening-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** Un chemin sans extension est un dossier (frontend/data/registers). */
const isDir = (p: string): boolean => !/\.[a-z]+$/.test(p);
const fileOf = (p: string): string => (isDir(p) ? `${p}/a.json` : p);

function put(base: string, rel: string, content: string): void {
  mkdirSync(dirname(join(base, rel)), { recursive: true });
  writeFileSync(join(base, rel), content);
}

/** Un dépôt jetable qui porte les chemins du robot, commités. */
function makeRepo(paths: string[]): string {
  const repo = mkdtempSync(join(scratch, 'repo-'));
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
  };
  git('init', '-q');
  for (const p of paths) put(repo, fileOf(p), 'before\n');
  git('add', '-A');
  git('-c', 'user.name=fixture', '-c', 'user.email=acme@example.com', 'commit', '-qm', 'base');
  return repo;
}

function runStep(script: string, repo: string, env: Record<string, string>) {
  const r = spawnSync('bash', ['-c', script], {
    cwd: repo,
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const gitStatus = (repo: string): string =>
  execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: repo,
    encoding: 'utf8',
  });

describe('the artefact check of each robot, run as written', () => {
  it.each(ROBOTS)(
    '%s copies exactly the expected files, and refuses one more, one less, or a link',
    (file) => {
      const wf = load(file, read(file));
      const paths = wf.env.COMMITTED_PATHS.split(/\s+/).filter(Boolean);
      const step = wf.jobs.flatMap((j) => j.steps).find((s) => s.name === VERIFY_STEP);
      expect(step, file).toBeDefined();
      const script = step?.run ?? '';

      const attempt = (shape: (artefact: string) => void) => {
        const repo = makeRepo(paths);
        const artefact = mkdtempSync(join(scratch, 'artefact-'));
        for (const p of paths) put(artefact, fileOf(p), 'after\n');
        shape(artefact);
        const env = { ARTEFACT: artefact, COMMITTED_PATHS: wf.env.COMMITTED_PATHS };
        return { repo, ...runStep(script, repo, env) };
      };

      // Exactement les fichiers attendus : copiés, et le dépôt n'a bougé que là.
      const ok = attempt(() => {});
      expect(ok.status, ok.out).toBe(0);
      for (const p of paths) expect(readFileSync(join(ok.repo, fileOf(p)), 'utf8')).toBe('after\n');
      const moved = gitStatus(ok.repo)
        .split('\n')
        .filter(Boolean)
        .map((l) => l.slice(3));
      expect(moved.sort()).toEqual(paths.map(fileOf).sort());

      // Un chemin de plus, même voisin d'un chemin attendu : refusé, rien de copié.
      for (const extra of ['.github/workflows/evil.yml', 'src/index.ts', `${paths[0]}.extra`]) {
        const r = attempt((a) => put(a, extra, 'x\n'));
        expect(r.status, `${extra}: ${r.out}`).not.toBe(0);
        expect(r.out).toContain('chemin inattendu');
        expect(gitStatus(r.repo)).toBe('');
      }

      // Un chemin en moins : refusé plutôt qu'un commit partiel.
      const less = attempt((a) => rmSync(join(a, paths[0]), { recursive: true }));
      expect(less.status, less.out).not.toBe(0);
      expect(less.out).toContain('chemin attendu absent');
      expect(gitStatus(less.repo)).toBe('');

      // Un lien symbolique à la place d'un fichier : refusé.
      const link = attempt((a) => {
        rmSync(join(a, fileOf(paths[0])));
        symlinkSync('/etc/hosts', join(a, fileOf(paths[0])));
      });
      expect(link.status, link.out).not.toBe(0);
      expect(link.out).toContain("autre chose qu'un fichier ordinaire");
      expect(gitStatus(link.repo)).toBe('');
    },
    60_000,
  );

  it('the Swiss re-read, which restarts from main, refuses files main changed meanwhile', () => {
    const file = 'refresh-ch-clearing.yml';
    const wf = load(file, read(file));
    const steps = wf.jobs.flatMap((j) => j.steps);
    const base = steps.find((s) => s.id === 'base');
    const guard = steps.find((s) => 'BASE_FILES' in s.env);
    expect(base && guard).toBeTruthy();
    const paths = wf.env.COMMITTED_PATHS.split(/\s+/).filter(Boolean);
    const repo = makeRepo(paths);
    const output = join(scratch, 'github-output');
    writeFileSync(output, '');
    const env = { COMMITTED_PATHS: wf.env.COMMITTED_PATHS, GITHUB_OUTPUT: output };
    expect(runStep(base?.run ?? '', repo, env).status).toBe(0);
    const files = /^files=(\w+)$/m.exec(readFileSync(output, 'utf8'))?.[1] ?? '';
    expect(files).toMatch(/^[0-9a-f]{40}$/);

    // Main n'a pas touché ces fichiers : le job d'écriture continue.
    expect(runStep(guard?.run ?? '', repo, { ...env, BASE_FILES: files }).status).toBe(0);

    // Un commit humain sur data/bic.sqlite entre-temps : refus, rien n'est écrasé.
    put(repo, paths[0], 'changed on main\n');
    execFileSync(
      'git',
      ['-c', 'user.name=fixture', '-c', 'user.email=acme@example.com', 'commit', '-qam', 'human'],
      {
        cwd: repo,
      },
    );
    const r = runStep(guard?.run ?? '', repo, { ...env, BASE_FILES: files });
    expect(r.status, r.out).not.toBe(0);
    expect(r.out).toContain('Main a changé');
    // Des git et des bash lancés pour de vrai : ce fichier tourne aussi dans la
    // porte de chaque robot, où un délai trop court ferait échouer une relecture.
  }, 60_000);
});

describe('the deployment decision, run as written (OPS-28)', () => {
  const site = load('deploy-site.yml', read('deploy-site.yml'));
  const stepOf = (id: string): string =>
    site.jobs.flatMap((j) => j.steps).find((s) => s.id === id)?.run ?? '';

  it('reads the served version only when it has the shape of a commit hash', () => {
    const script = stepOf('served');
    expect(script).toContain('x-site-version');
    // Un faux curl qui rend les en-têtes voulus, ou rien et une erreur.
    const bin = mkdtempSync(join(scratch, 'bin-'));
    writeFileSync(
      join(bin, 'curl'),
      '#!/bin/sh\n[ -s "$FAKE_HEADERS" ] || exit 6\ncat "$FAKE_HEADERS"\n',
      { mode: 0o755 },
    );
    const served = (headers: string) => {
      const dir = mkdtempSync(join(scratch, 'served-'));
      writeFileSync(join(dir, 'headers'), headers);
      writeFileSync(join(dir, 'output'), '');
      const r = runStep(script, dir, {
        PATH: `${bin}:${process.env.PATH ?? ''}`,
        FAKE_HEADERS: join(dir, 'headers'),
        GITHUB_OUTPUT: join(dir, 'output'),
        SITE_URL: 'https://site.example.net/',
      });
      expect(r.status, r.out).toBe(0);
      expect(readdirSync(dir).sort()).toEqual(['headers', 'output']);
      return readFileSync(join(dir, 'output'), 'utf8');
    };
    expect(served('HTTP/2 200\r\nx-site-version: e220c5f1a6a9\r\n\r\n')).toBe(
      'version=e220c5f1a6a9\n',
    );
    expect(served('HTTP/1.1 200 OK\r\nX-Site-Version: e220c5f1a6a9\r\n\r\n')).toBe(
      'version=e220c5f1a6a9\n',
    );
    expect(served('HTTP/2 200\r\ncontent-type: text/html\r\n\r\n')).toBe('');
    expect(served('HTTP/2 200\r\nx-site-version: $(touch pwned)\r\n\r\n')).toBe('');
    expect(served('HTTP/2 200\r\nx-site-version: main\r\n\r\n')).toBe('');
    expect(served('')).toBe('');
  });

  /** Main, côté dépôt : une base, un changement de page, puis un changement de données. */
  const origin = makeRepo(['frontend/data/registers/it-bank.json', 'data/bic.sqlite']);
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const commit = (rel: string, msg: string): string => {
    put(origin, rel, `${msg}\n`);
    git(
      origin,
      '-c',
      'user.name=fixture',
      '-c',
      'user.email=acme@example.com',
      'commit',
      '-qam',
      msg,
    );
    return git(origin, 'rev-parse', 'HEAD');
  };
  const base = git(origin, 'rev-parse', 'HEAD');
  const pages = commit('frontend/data/registers/it-bank.json', 'pages');
  const head = commit('data/bic.sqlite', 'data only');
  // Le checkout de `resolve` : main, telle qu'elle est quand le passage démarre.
  const work = mkdtempSync(join(scratch, 'site-'));
  execFileSync('git', ['clone', '-q', `file://${origin}`, work]);

  /** Ce que décide un script `what`, cas par cas : [deploy, sha]. */
  const outcomes = (script: string): Record<string, [string, string]> => {
    const decide = (event: string, served: string): [string, string] => {
      const output = join(mkdtempSync(join(scratch, 'output-')), 'github-output');
      writeFileSync(output, '');
      const r = runStep(script, work, {
        EVENT: event,
        SERVED: served,
        GITHUB_SHA: base,
        GITHUB_OUTPUT: output,
      });
      const text = readFileSync(output, 'utf8');
      return [
        `${r.status}:${/^deploy=(\w+)$/m.exec(text)?.[1] ?? ''}`,
        /^sha=(\w+)$/m.exec(text)?.[1] ?? '',
      ];
    };
    return {
      'the site already serves the head': decide('workflow_run', head.slice(0, 12)),
      'the site is behind by data only': decide('workflow_run', pages.slice(0, 12)),
      'the site is behind by a page': decide('workflow_run', base.slice(0, 12)),
      'the served version is unreadable': decide('workflow_run', ''),
      'the served version is not in the history': decide('workflow_run', 'deadbeefdead'),
      'the served version is not a hash': decide('workflow_run', '$(touch pwned)'),
      'a push, even of an older commit': decide('push', ''),
    };
  };
  const EXPECTED: Record<string, [string, string]> = {
    'the site already serves the head': ['0:false', head],
    'the site is behind by data only': ['0:false', head],
    'the site is behind by a page': ['0:true', head],
    'the served version is unreadable': ['0:true', head],
    'the served version is not in the history': ['0:true', head],
    'the served version is not a hash': ['0:true', head],
    'a push, even of an older commit': ['0:true', head],
  };

  it('deploys the head of main unless the site already serves its pages', () => {
    expect(outcomes(stepOf('what'))).toEqual(EXPECTED);
    expect(readdirSync(work)).not.toContain('pwned');
  }, 60_000);

  it('would catch a decision that skips an unreadable version, or ships its trigger', () => {
    const script = stepOf('what');
    const silent = edit(
      script,
      'echo "The served version cannot be read: deploying main (${SHA:0:12})."',
      'DEPLOY=false',
    );
    expect(outcomes(silent)['the served version is unreadable']).toEqual(['0:false', head]);
    const trigger = edit(script, 'SHA="$(git rev-parse HEAD)"', 'SHA="$GITHUB_SHA"');
    expect(outcomes(trigger)['a push, even of an older commit']).toEqual(['0:true', base]);
  }, 60_000);
});
