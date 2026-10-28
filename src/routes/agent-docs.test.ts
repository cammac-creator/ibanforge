import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { apiKeys } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';
import { KEY_ORIGIN_TAGS, ORIGIN_SHAPE } from '../lib/key-origins.js';

/**
 * What coding assistants read about IBANforge, held to the two formats it is
 * published in.
 *
 * `context7.json` tells Context7, the documentation index coding assistants
 * query while they write code, which part of this public repository to read.
 * Its documented behaviour (https://context7.com/docs/library-owners and the
 * schema https://context7.com/schema/context7.json, both read on 28/10/2026)
 * sets three traps:
 *
 * - root-level markdown files are ALWAYS indexed, even when `folders` narrows
 *   the index. A root file left out of `excludeFiles` (the agent instructions,
 *   the release procedure) would be served to every assistant as if it were
 *   usage documentation. Hence the test on the root directory below: the next
 *   markdown file dropped at the root turns it red instead of going out;
 * - a simple name in `excludeFolders` matches at ANY depth. `docs` would also
 *   drop `frontend/content/en/docs`, the documentation itself; `./docs` is the
 *   root-only form;
 * - the schema refuses unknown keys (`additionalProperties: false`) and caps a
 *   rule at 255 characters, and a single refused rule drops every rule.
 *
 * `README.md` is the one root file kept on purpose: excluding it by name would
 * drop the README of every SDK as well (`excludeFiles` matches a file name
 * anywhere, never a path).
 *
 * The skill follows the Agent Skills format (https://agentskills.io/specification,
 * read on 28/10/2026): `name` equals its folder, lowercase letters, digits and
 * single hyphens, at most 64 characters; `description` at most 1024.
 */

const ROOT = join(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');

const CONTEXT7 = 'context7.json';
const SKILL = 'skills/validate-iban-before-payment/SKILL.md';

/** The top-level properties of the published schema, copied on 28/10/2026. */
const SCHEMA_KEYS = new Set([
  '$schema',
  'branch',
  'description',
  'disallow',
  'excludeFiles',
  'excludeFolders',
  'folders',
  'includeExtensions',
  'previousVersions',
  'projectTitle',
  'public_key',
  'redirect',
  'rules',
  'url',
]);

interface Context7Config {
  projectTitle: string;
  description: string;
  folders: string[];
  excludeFolders: string[];
  excludeFiles: string[];
  rules: string[];
}

const config = JSON.parse(read(CONTEXT7)) as Context7Config;

/** A simple glob segment (`*` only) as an anchored regular expression. */
function segmentPattern(glob: string): RegExp {
  const escaped = glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

/** Would this `excludeFolders` entry, read as documented, drop an included folder? */
function shadows(entry: string, folder: string): boolean {
  const segments = folder.split('/');
  const name = entry.replace(/\/$/, '');
  // `./x` and `a/b`: a path from the root, which drops everything under it.
  if (name.startsWith('./') || (name.includes('/') && !name.includes('*'))) {
    const path = name.replace(/^\.\//, '');
    return folder === path || folder.startsWith(`${path}/`);
  }
  // `x`, `*x*` and `**/x`: a folder name matched at any depth.
  const last = name.startsWith('**/') ? name.slice(3) : name;
  if (last.includes('/')) return false;
  return segments.some((s) => segmentPattern(last).test(s));
}

describe('context7.json', () => {
  it('uses only the keys the published schema knows', () => {
    const unknown = Object.keys(config).filter((k) => !SCHEMA_KEYS.has(k));
    expect(unknown).toEqual([]);
  });

  it('stays inside the lengths of the schema', () => {
    expect(config.projectTitle.length).toBeGreaterThan(0);
    expect(config.projectTitle.length).toBeLessThanOrEqual(100);
    expect(config.description.length).toBeGreaterThanOrEqual(10);
    expect(config.description.length).toBeLessThanOrEqual(500);
    expect(config.rules.length).toBeLessThanOrEqual(50);
    expect(config.folders.length).toBeLessThanOrEqual(50);
    expect(config.excludeFolders.length).toBeLessThanOrEqual(50);
    expect(config.excludeFiles.length).toBeLessThanOrEqual(100);
    const tooLong = config.rules.filter((r) => r.length === 0 || r.length > 255);
    expect(tooLong).toEqual([]);
    // A file name, never a path: the schema refuses a slash.
    expect(config.excludeFiles.filter((f) => /[/\\]/.test(f))).toEqual([]);
  });

  it('excludes by name every markdown or HTML file at the root but README.md', () => {
    const rootDocs = readdirSync(ROOT).filter((f) => /\.(md|mdx|markdown|html?)$/i.test(f));
    expect(rootDocs).toContain('README.md');
    expect(rootDocs).toContain('AGENTS.md');
    const missing = rootDocs.filter((f) => f !== 'README.md' && !config.excludeFiles.includes(f));
    expect(missing).toEqual([]);
    // Excluding README.md by name would drop every SDK README too.
    expect(config.excludeFiles).not.toContain('README.md');
  });

  it('never excludes a folder it asks to index', () => {
    const clashes = config.excludeFolders.flatMap((entry) =>
      config.folders.filter((folder) => shadows(entry, folder)).map((f) => `${entry} → ${f}`),
    );
    expect(clashes).toEqual([]);
    // The trap itself, so the reader of this helper sees it bite.
    expect(shadows('docs', 'frontend/content/en/docs')).toBe(true);
    expect(shadows('./docs', 'frontend/content/en/docs')).toBe(false);
  });

  it('indexes the public English documentation and the skill, and nothing internal', () => {
    for (const folder of config.folders) {
      expect(existsSync(join(ROOT, folder)), folder).toBe(true);
    }
    expect(config.folders).toContain('frontend/content/en/docs');
    expect(config.folders).toContain(dirname(dirname(SKILL)));
    expect(existsSync(join(ROOT, 'frontend/content/en/docs/iban-validate.mdx'))).toBe(true);
    // The repository's own docs/ (handover, plans, specs) and the source are
    // never asked for, and stay excluded at the root if `folders` is ever emptied.
    const internal = config.folders.filter((f) => /^(docs|src|scripts|test|data)(\/|$)/.test(f));
    expect(internal).toEqual([]);
    for (const root of ['./docs', './src', './scripts']) {
      expect(config.excludeFolders, root).toContain(root);
    }
  });
});

/** The `?src=` tags a file publishes. */
function srcTags(text: string): string[] {
  return [...text.matchAll(/[?&]src=([^\s"'`)&#]+)/g)].map((m) => m[1]);
}

describe('the attribution tags of what assistants read', () => {
  it.each([
    [CONTEXT7, 'context7'],
    [SKILL, 'skill'],
  ])('%s links with ?src=%s only, a tag the vocabulary knows', (file, tag) => {
    const tags = srcTags(read(file));
    expect(tags.length, file).toBeGreaterThan(0);
    expect([...new Set(tags)]).toEqual([tag]);
    expect(ORIGIN_SHAPE.test(tag)).toBe(true);
    expect(Object.keys(KEY_ORIGIN_TAGS)).toContain(tag);
  });
});

/** The frontmatter of a SKILL.md, single-line `key: value` fields. */
function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z-]+):\s*(.+)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

describe('the agent skill', () => {
  const text = read(SKILL);
  const meta = frontmatter(text);

  it('follows the Agent Skills format', () => {
    expect(meta.name).toBe(basename(dirname(join(ROOT, SKILL))));
    expect(meta.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(meta.name.length).toBeLessThanOrEqual(64);
    expect(meta.description.length).toBeGreaterThan(0);
    expect(meta.description.length).toBeLessThanOrEqual(1024);
  });

  it('says what the check cannot prove', () => {
    expect(meta.description).toMatch(/never verifies the account holder's name/);
    expect(text).toContain("It never checks the account holder's name.");
  });

  it('publishes a key command that mints an anonymous key tagged `skill`', async () => {
    // The body is read from the skill itself: the day someone "simplifies" the
    // command to an empty POST, the key still works and the tag is lost
    // without a sound. This drives the real route with what the skill says.
    const body = /keys\/generate[\s\S]*?-d '([^']+)'/.exec(text)?.[1];
    expect(body).toBe('{"source":"skill"}');
    const app = new Hono();
    app.route('/', apiKeys);
    const res = await app.request('/v1/keys/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    expect(res.status).toBe(201);
    const json = (await res.json()) as { tier: string; key_prefix: string };
    expect(json.tier).toBe('anonymous');
    const row = getStatsDB()
      .prepare('SELECT source FROM api_keys WHERE key_prefix = ?')
      .get(json.key_prefix) as { source: string | null };
    expect(row.source).toBe('skill');
  });
});
