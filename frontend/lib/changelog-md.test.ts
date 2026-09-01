import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripLeadingH1 } from './changelog-md';

const REPO_ROOT = resolve(__dirname, '../..');

describe('stripLeadingH1', () => {
  it('removes the document title so the page keeps a single h1', () => {
    const out = stripLeadingH1('# Changelog\n\nAll notable changes.\n');
    expect(out).toBe('All notable changes.\n');
  });

  it('leaves every version heading alone', () => {
    const out = stripLeadingH1('# Changelog\n\n## [1.4.4]\n\n### Fixed\n');
    expect(out).toContain('## [1.4.4]');
    expect(out).toContain('### Fixed');
  });

  it('touches nothing when the document has no top-level heading', () => {
    const source = '## [1.4.4]\n\n- a line\n';
    expect(stripLeadingH1(source)).toBe(source);
  });

  it('never removes a second h1 further down (only the leading one)', () => {
    const out = stripLeadingH1('# Changelog\n\ntext\n\n# Stray\n');
    expect(out).toContain('# Stray');
  });

  /**
   * The page fetches this exact file. If the changelog ever stops opening with
   * an `h1` the helper becomes a no-op, which is fine, but if it opens with a
   * DIFFERENT `h1` the page must still end up with only its own.
   */
  it('leaves the real CHANGELOG.md with no top-level heading', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
    const out = stripLeadingH1(source);
    expect(out.split('\n').some((l) => /^#[ \t]/.test(l))).toBe(false);
  });
});
