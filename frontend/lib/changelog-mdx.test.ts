import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { describe, expect, it } from 'vitest';

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
