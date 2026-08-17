import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '@mdx-js/mdx';
import matter from 'gray-matter';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';
import { mdxComponents } from './mdx';

/**
 * /changelog renders the repository's CHANGELOG.md through MDX at request time,
 * which means a line of ordinary Markdown can take the page down in production
 * without anything failing at build time — nothing in CI reads that file.
 *
 * It happened: `p99 <50ms` parses as the start of a JSX tag, so the page
 * answered 500 in every locale from the day the line landed until it was found
 * by walking the URLs apis.json promises.
 *
 * The docs and blog pipeline has the same exposure, so both are compiled here
 * with the plugins the site actually uses.
 */
const REPO_ROOT = resolve(__dirname, '../..');

async function compiles(markdown: string): Promise<string | null> {
  try {
    await compile(markdown, { remarkPlugins: [remarkGfm] });
    return null;
  } catch (err) {
    const e = err as { message?: string; line?: number };
    return `line ${e.line ?? '?'}: ${e.message ?? String(err)}`;
  }
}

describe('the changelog the site renders', () => {
  it('is valid MDX, not merely valid Markdown', async () => {
    const source = readFileSync(resolve(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
    // Reported rather than thrown, so the failure names the offending line
    // instead of a stack inside the compiler.
    expect(await compiles(source)).toBeNull();
  });

  it('wraps every angle bracket that would read as a JSX tag', async () => {
    // The specific shape that broke it. Bare `<` followed by a digit or a
    // letter outside inline code is the whole failure class, and a latency or
    // size bound is the way it keeps getting written.
    expect(await compiles('- p99 <50ms and <30ms')).not.toBeNull();
    expect(await compiles('- p99 `<50ms` and `<30ms`')).toBeNull();
  });
});

/**
 * The comment above has said since the changelog incident that the docs and
 * blog pipeline carries the same exposure. It was not actually checked, and
 * the exposure is wider there: a docs page can also name a COMPONENT that
 * compiles cleanly and then throws at render because it was never registered
 * in `mdxComponents`, where only `table` is defined.
 *
 * Both failure modes produce the same symptom — a page that is fine locally
 * and 500s in production, in every locale at once.
 */
describe('every page the docs and blog pipeline renders', () => {
  const CONTENT = resolve(__dirname, '../content');

  function mdxFiles(): string[] {
    const out: string[] = [];
    for (const locale of readdirSync(CONTENT)) {
      for (const section of ['docs', 'blog']) {
        const dir = resolve(CONTENT, locale, section);
        if (!existsSync(dir)) continue;
        for (const file of readdirSync(dir)) {
          if (file.endsWith('.mdx')) out.push(resolve(dir, file));
        }
      }
    }
    return out;
  }

  const files = mdxFiles();

  it('finds the content to check, so an empty sweep cannot pass silently', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((f) => [f.slice(CONTENT.length + 1), f]))('compiles %s', async (_label, file) => {
    const body = matter(readFileSync(file, 'utf8')).content;
    expect(await compiles(body)).toBeNull();
  });

  it('never references a component the renderer does not know', () => {
    // mdxComponents registers `table` and nothing else; MDX resolves any other
    // capitalised tag to undefined and throws while rendering.
    const known = new Set(Object.keys(mdxComponents));
    for (const file of files) {
      const body = matter(readFileSync(file, 'utf8')).content;
      for (const [, tag] of body.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g)) {
        expect(known.has(tag), `${file.slice(CONTENT.length + 1)} uses <${tag}>`).toBe(true);
      }
    }
  });
});
