import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SLUG_PATTERN } from './content-slug';
import { getDoc } from './mdx';
import { getPost } from './blog';
import { getLegalDoc } from './legal';

/**
 * FRT-09 (audit 2026-09-01). The traversal is refused today by the Vercel edge,
 * so a production probe proves nothing about the code. These assertions call
 * the loaders directly, which is the only place the guard can be observed.
 *
 * The second test is the one that keeps the allowlist honest: a pattern that
 * rejects a real filename would turn a live page into a 404, and that failure
 * mode is worse than the hole it closes.
 */

const TRAVERSALS = [
  '../../../README',
  '..%2f..%2fREADME',
  '../package',
  'docs/../../secret',
  'index.mdx',
  'Index',
  'a_b',
  '',
  'x'.repeat(300) + '/../etc/passwd',
];

describe('SLUG_PATTERN', () => {
  it('accepts every slug actually shipped in content/', () => {
    const roots = [
      ...['en', 'fr', 'de'].flatMap((l) => [
        path.join(process.cwd(), 'content', l, 'docs'),
        path.join(process.cwd(), 'content', l, 'blog'),
      ]),
      path.join(process.cwd(), 'content', 'legal'),
    ].filter((d) => fs.existsSync(d));

    const slugs = roots.flatMap((d) =>
      fs.readdirSync(d).filter((f) => f.endsWith('.mdx')).map((f) => f.replace(/\.mdx$/, '')),
    );
    expect(slugs.length).toBeGreaterThan(0);
    for (const slug of slugs) {
      expect(SLUG_PATTERN.test(slug), slug).toBe(true);
    }
  });

  it('rejects anything that could walk out of the content folder', () => {
    for (const bad of TRAVERSALS) {
      expect(SLUG_PATTERN.test(bad), bad).toBe(false);
    }
  });
});

describe('the loaders refuse a traversal slug', () => {
  it('getDoc and getPost take the notFound() path', () => {
    for (const bad of TRAVERSALS) {
      // next/navigation's notFound() signals by throwing; either way no read
      // of a file outside content/ ever happens.
      expect(() => getDoc(bad), bad).toThrow();
      expect(() => getPost(bad), bad).toThrow();
    }
  });

  it('getLegalDoc keeps its nullable contract', () => {
    for (const bad of TRAVERSALS) {
      expect(getLegalDoc(bad), bad).toBeNull();
    }
    expect(getLegalDoc('terms')).not.toBeNull();
  });
});
