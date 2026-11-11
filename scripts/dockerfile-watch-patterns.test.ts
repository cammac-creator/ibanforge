import { existsSync, readFileSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path: string): string => readFileSync(resolve(ROOT, path), 'utf8');

// railway.toml ne redéploie l'API que pour les chemins de `watchPatterns`. Depuis le
// 10.11.2026, scripts/ y figure fichier par fichier, et non plus en entier : un script
// d'exploitation ne redémarre plus l'API (avec un volume, chaque redémarrage coupe le
// service quelques secondes). Le revers : un script que l'image copie ou lance doit être
// nommé dans les deux fichiers, sinon sa prochaine modification n'arrive jamais en
// production. Ce test tient l'accord entre le Dockerfile et railway.toml, et garde
// l'outil d'effacement là où son mode d'emploi dit de le lancer.

interface Instruction {
  index: number;
  stage: number;
  keyword: string;
  args: string;
}

/** Les instructions du Dockerfile, commentaires retirés et lignes continuées jointes. */
function instructions(source: string = read('Dockerfile')): Instruction[] {
  const out: Instruction[] = [];
  let stage = -1;
  let pending = '';
  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.endsWith('\\')) {
      pending += `${line.slice(0, -1)} `;
      continue;
    }
    const m = /^(\S+)\s+([\s\S]*)$/.exec(`${pending}${line}`.trim());
    pending = '';
    if (!m) continue;
    const keyword = m[1]!.toUpperCase();
    if (keyword === 'FROM') stage++;
    out.push({ index: out.length, stage, keyword, args: m[2]! });
  }
  return out;
}

interface Copy {
  index: number;
  stage: number;
  sources: string[];
  dest: string;
}

/**
 * Les COPY et les ADD qui lisent le dépôt, pas ceux qui reprennent un autre étage
 * (`--from`), ni les sources qu'ADD télécharge (une adresse). Une source écrite
 * `./scripts/x` est ramenée à `scripts/x`, le chemin que nomme railway.toml.
 */
function repositoryCopies(list: Instruction[] = instructions()): Copy[] {
  const copies: Copy[] = [];
  for (const i of list) {
    if (i.keyword !== 'COPY' && i.keyword !== 'ADD') continue;
    const words: string[] = i.args.startsWith('[') ? JSON.parse(i.args) : i.args.split(/\s+/);
    if (words.some((w) => w.startsWith('--from='))) continue;
    const paths = words.filter((w) => !w.startsWith('--'));
    const sources = paths
      .slice(0, -1)
      .filter((s) => !/^[a-z][a-z0-9+.-]*:\/\/|^git@/i.test(s))
      .map((s) => s.replace(/^(?:\.\/)+/, ''));
    if (sources.length === 0) continue;
    copies.push({ index: i.index, stage: i.stage, sources, dest: paths[paths.length - 1]! });
  }
  return copies;
}

/**
 * Les chemins `scripts/…` qu'une commande nomme, ramenés au dépôt : écrits tels
 * quels, `./scripts/…`, ou `/app/scripts/…` (/app est le WORKDIR des deux étages).
 */
const scriptsIn = (command: string): string[] =>
  [...command.matchAll(/(?:^|[\s"'=])(?:\.\/|\/app\/)?(scripts\/[^\s"';&|)]*)/g)].map((m) => m[1]!);

/** Tout ce que le Dockerfile prend de scripts/, en copie ou en commande. */
const scriptsCitedByDockerfile = (list: Instruction[] = instructions()): string[] => [
  ...new Set([
    ...repositoryCopies(list)
      .flatMap((c) => c.sources)
      .filter((s) => s.startsWith('scripts')),
    ...list.filter((i) => i.keyword === 'RUN').flatMap((i) => scriptsIn(i.args)),
  ]),
];

function watchPatterns(): string[] {
  const block = /^watchPatterns\s*=\s*\[([\s\S]*?)\]/m.exec(read('railway.toml'));
  expect(block, 'railway.toml must declare watchPatterns').not.toBeNull();
  return [...block![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]!);
}

/** `dir/**` couvre tout ce qui est sous dir/ ; tout autre motif, ce chemin exact. */
const covers = (pattern: string, path: string): boolean =>
  pattern.endsWith('/**') ? path.startsWith(pattern.slice(0, -2)) : pattern === path;

/** Un motif de .dockerignore : `**` traverse les dossiers, `*` et `?` non. */
function dockerignoreRegex(pattern: string): RegExp {
  const body = pattern
    .replace(/^\/|\/$/g, '')
    .split('**')
    .map((part) =>
      part
        .split('*')
        .map((seg) => seg.replace(/[.+^$(){}|\\]/g, '\\$&').replace(/\?/g, '[^/]'))
        .join('[^/]*'),
    )
    .join('.*');
  return new RegExp(`^${body}(/|$)`);
}

// Un Dockerfile fabriqué : ce que le lecteur doit voir même quand le vrai ne l'écrit pas.
const FIXTURE = `FROM node:22.23.4-slim AS builder
WORKDIR /app
ADD scripts/a.ts scripts/a.ts
ADD --chown=node:node https://example.com/tool.tar.gz /tmp/
COPY ./scripts/d.ts ./scripts/
RUN npx tsx ./scripts/b.ts && node /app/scripts/c.cjs
FROM node:22.23.4-slim
WORKDIR /app
COPY --from=builder /app/dist dist/
`;

describe('the Dockerfile reader itself', () => {
  it('reads ADD like COPY, but neither a URL nor another stage', () => {
    expect(repositoryCopies(instructions(FIXTURE)).map((c) => c.sources)).toEqual([
      ['scripts/a.ts'],
      ['scripts/d.ts'],
    ]);
  });

  it('finds a script named ./scripts/… or /app/scripts/… in a RUN', () => {
    expect(scriptsCitedByDockerfile(instructions(FIXTURE)).sort()).toEqual([
      'scripts/a.ts',
      'scripts/b.ts',
      'scripts/c.cjs',
      'scripts/d.ts',
    ]);
  });
});

describe('Dockerfile and Railway watch patterns', () => {
  it('watches every path the image copies from the repository', () => {
    const patterns = watchPatterns();
    const unwatched = repositoryCopies()
      .flatMap((c) => c.sources)
      .filter((source) => !patterns.some((p) => covers(p, source)));
    expect(unwatched).toEqual([]);
  });

  it('names each scripts/ file it uses, and watches exactly those', () => {
    const cited = scriptsCitedByDockerfile();
    expect(cited).toContain('scripts/seed-uk-modulus.ts');
    expect(cited).toContain('scripts/forget-customer.cjs');
    for (const path of cited) {
      // Un dossier ou un motif copié en entier exigerait de surveiller scripts/**.
      expect(path, `${path} must be one file, not a folder or a glob`).not.toMatch(/\/$|[*?[]/);
      expect(existsSync(resolve(ROOT, path)) && statSync(resolve(ROOT, path)).isFile()).toBe(true);
    }
    const watchedScripts = watchPatterns().filter((p) => p.startsWith('scripts'));
    expect([...watchedScripts].sort()).toEqual([...cited].sort());
  });

  it('copies a build script, and what it imports, before running it', () => {
    for (const run of instructions().filter((i) => i.keyword === 'RUN')) {
      const copiedBefore = repositoryCopies().filter(
        (c) => c.stage === run.stage && c.index < run.index,
      );
      const isCopied = (path: string): boolean =>
        copiedBefore.some((c) =>
          c.sources.some((s) => (s.endsWith('/') ? path.startsWith(s) : path === s)),
        );
      for (const script of scriptsIn(run.args)) {
        // Le seeder UK ne bloque pas la construction (`|| echo WARNING`) : un fichier
        // absent de l'étage n'y ferait aucun bruit, la production perdrait le contrôle UK.
        expect(isCopied(script), `${script} is run before being copied`).toBe(true);
        for (const m of read(script).matchAll(/^import\s+(?!type\s)[^'"]*?['"](\.[^'"]+)['"]/gm)) {
          const target = relative(ROOT, resolve(ROOT, dirname(script), m[1]!)).replace(
            /\.js$/,
            '.ts',
          );
          expect(isCopied(target), `${script} imports ${target}, absent from its stage`).toBe(true);
        }
      }
    }
  });

  it('lets .dockerignore keep every script it copies', () => {
    const ignored = read('.dockerignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#') && !l.startsWith('!'));
    for (const script of scriptsCitedByDockerfile()) {
      expect(
        ignored.filter((p) => dockerignoreRegex(p).test(script)),
        script,
      ).toEqual([]);
    }
  });

  it('ships the erasure tool where its usage says to run it, and no other script', () => {
    const all = instructions();
    const last = Math.max(...all.map((i) => i.stage));
    const workdir = all
      .filter((i) => i.stage === last && i.keyword === 'WORKDIR')
      .pop()
      ?.args.trim();
    expect(workdir).toBe('/app');
    const shipped = repositoryCopies().filter(
      (c) => c.stage === last && c.sources.some((s) => s.startsWith('scripts')),
    );
    expect(shipped.map((c) => c.sources)).toEqual([['scripts/forget-customer.cjs']]);
    const dest = shipped[0]!.dest;
    const absolute = posix.join(
      dest.startsWith('/') ? '' : workdir!,
      dest.endsWith('/') ? `${dest}forget-customer.cjs` : dest,
    );
    expect(absolute).toBe('/app/scripts/forget-customer.cjs');

    const tool = read('scripts/forget-customer.cjs');
    expect(tool).toContain(`node ${absolute} `);
    // Rien d'autre de scripts/ ni de src/ dans cet étage : l'outil ne charge que des
    // modules de Node et des dépendances de production (npm ci --omit=dev).
    const prod = new Set(Object.keys(JSON.parse(read('package.json')).dependencies ?? {}));
    const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));
    const required = [...tool.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]!);
    expect(required).toContain('better-sqlite3');
    expect(required.filter((r) => !builtins.has(r) && !prod.has(r))).toEqual([]);
  });
});
