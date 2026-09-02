/**
 * Every package imported by runtime code must be a production dependency.
 *
 * Why this exists: on 02/09/2026 the audit route imported `xlsx`, which sat
 * in devDependencies. Tests, typecheck and the build all passed (the dev
 * tree has it), the Railway image runs `npm ci --omit=dev`, the container
 * died at boot with ERR_MODULE_NOT_FOUND, and because the service mounts a
 * volume the previous container had already been stopped: fifteen minutes
 * of outage for a one-line package.json mistake. This check fails CI first.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { builtinModules } from 'node:module';

const ROOT = new URL('..', import.meta.url).pathname;
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};
const prod = new Set(Object.keys(pkg.dependencies ?? {}));
const dev = new Set(Object.keys(pkg.devDependencies ?? {}));
const builtins = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

function packageOf(spec: string): string | null {
  if (spec.startsWith('.') || spec.startsWith('/') || builtins.has(spec)) return null;
  if (spec.startsWith('node:')) return null;
  const parts = spec.split('/');
  return spec.startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]!;
}

const IMPORT_RE =
  /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]|\bimport\(\s*['"]([^'"]+)['"]\s*\)|\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;

const offenders: Array<{ file: string; pkg: string; where: 'devDependencies' | 'missing' }> = [];
for (const file of walk(join(ROOT, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (!spec) continue;
    const name = packageOf(spec);
    if (!name || prod.has(name)) continue;
    // Type-only imports vanish at build time and never reach the container.
    if (/import\s+type\s/.test(m[0])) continue;
    offenders.push({
      file: relative(ROOT, file),
      pkg: name,
      where: dev.has(name) ? 'devDependencies' : 'missing',
    });
  }
}

if (offenders.length > 0) {
  console.error('Runtime code imports packages that the production image will not have:');
  for (const o of offenders) console.error(`  ${o.file}: "${o.pkg}" (${o.where})`);
  console.error(
    'Move them to "dependencies" in package.json (npm ci --omit=dev builds the image).',
  );
  process.exit(1);
}
console.log('runtime deps ok: every package imported by src/ is a production dependency');
