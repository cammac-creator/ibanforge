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
 * chemins déclarés, le battement après la poussée, aucun secret à côté du code
 * des dépendances. Le script de contrôle de l'artefact est aussi exécuté ici,
 * tel qu'il est écrit dans chaque workflow, sur des artefacts fabriqués.
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
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      actions: read
    steps:
      - name: Heartbeat
        env:
          HEARTBEAT_TOKEN: \${{ secrets.HEARTBEAT_TOKEN }}
        run: curl -X POST https://api.example.com/internal/heartbeat/fixture
`;

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
      `      - name: Heartbeat\n        run: curl -X POST https://api.example.com/internal/heartbeat/early\n      - name: ${VERIFY_STEP}\n`,
    );
    expect(robotProblems('refresh-fixture.yml', bad)).toEqual([
      'publish: the heartbeat does not wait for publish',
      'the heartbeat comes before the push',
    ]);
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
 * Les deux workflows de publication de paquets gardent ces écarts jusqu'à leur
 * propre durcissement, nommés un par un. Une ligne qui ne correspond plus à
 * aucun écart fait échouer la garde : la retirer, pour que la règle tienne
 * désormais ce fichier.
 */
const PENDING = [
  'n8n-publish.yml / publish / credential-job-installs-without-scripts',
  'release-publish.yml / publish / credential-job-installs-without-scripts',
  'release-publish.yml / publish / write-job-checkout-keeps-no-token',
  'release-publish.yml / publish / write-job-runs-no-javascript',
  'release-publish.yml / publish / write-job-takes-no-expression-in-shell',
];

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
