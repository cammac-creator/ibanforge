import fs from 'fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAllPosts } from './blog';
import { SLUG_PATTERN } from './content-slug';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getAllPosts', () => {
  it('lists only posts whose slug getPost would open', () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true);
    vi.spyOn(fs, 'readdirSync').mockReturnValue([
      'good-post.mdx',
      'Bad Name.mdx',
      'javascript:alert(1).mdx',
      'notes.txt',
    ] as unknown as ReturnType<typeof fs.readdirSync>);
    vi.spyOn(fs, 'readFileSync').mockReturnValue(
      '---\ntitle: T\ndate: 2026-10-01\n---\nBody text.',
    );
    expect(getAllPosts('en').map((p) => p.slug)).toEqual(['good-post']);
  });

  it('gives every shipped post a slug of the allowed shape', () => {
    const posts = ['en', 'fr', 'de'].flatMap((l) => getAllPosts(l));
    expect(posts.length).toBeGreaterThan(0);
    for (const p of posts) expect(SLUG_PATTERN.test(p.slug), p.slug).toBe(true);
  });
});
