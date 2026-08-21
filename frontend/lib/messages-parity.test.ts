import { describe, expect, it } from 'vitest';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import de from '@/messages/de.json';

/**
 * The three languages must carry the same keys.
 *
 * This was on the audit list as something to go and check by hand. A check run
 * once is worth less than a check that runs forever: the drift it looks for is
 * introduced one key at a time, months apart, by whoever adds a page and
 * translates two files out of three. The reader of the third language then
 * sees a raw key like `account.submit` where a button label should be, and
 * nobody notices because nobody on the team reads that language every day.
 *
 * English is the reference because that is where new copy is written first.
 */

type Tree = Record<string, unknown>;

/** Every leaf path in a message tree, dotted. */
function paths(tree: Tree, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(tree)) {
    const here = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out.push(...paths(v as Tree, here));
    } else {
      out.push(here);
    }
  }
  return out.sort();
}

/**
 * The values a string interpolates, as a sorted set.
 *
 * ⚠️ Only TOP-LEVEL arguments count. A plural form is
 * `{count, plural, one {jour} other {jours}}`: the inner braces are the
 * branches, not variables, and they are SUPPOSED to differ between languages —
 * that is the whole point of translating them. A naive `\{(\w+)\}` sweep reads
 * `{jour}` as a missing placeholder and reports three healthy translations as
 * broken, which is how this check would have been abandoned as too noisy.
 *
 * So: walk the string tracking brace depth, and read the identifier only for
 * braces opened at depth 0. `{year}` yields `year`; the plural above yields
 * `count` in every language.
 */
function placeholders(s: string): string[] {
  const found = new Set<string>();
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (s[i] !== '{') continue;
    if (depth === 0) {
      // The argument name runs to the first comma or closing brace.
      const rest = s.slice(i + 1);
      const name = /^\s*(\w+)\s*(?=[,}])/.exec(rest)?.[1];
      if (name) found.add(name);
    }
    depth++;
  }
  return [...found].sort();
}

function leaf(tree: Tree, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc as Tree)?.[k], tree);
}

const REFERENCE = paths(en as Tree);

describe.each([
  ['fr', fr as Tree],
  ['de', de as Tree],
])('%s against en', (name, tree) => {
  it('carries every key English carries', () => {
    const missing = REFERENCE.filter((p) => leaf(tree, p) === undefined);
    expect(missing, `${name}: ${missing.length} clés manquantes`).toEqual([]);
  });

  it('carries no key English does not', () => {
    const own = paths(tree);
    const extra = own.filter((p) => leaf(en as Tree, p) === undefined);
    expect(extra, `${name}: ${extra.length} clés orphelines`).toEqual([]);
  });

  it('interpolates the same placeholders, so no value silently disappears', () => {
    // A translation that drops {year} renders "© IBANforge." with no year and
    // still passes a key-presence check. This is the one that bites.
    const drifted: string[] = [];
    for (const p of REFERENCE) {
      const a = leaf(en as Tree, p);
      const b = leaf(tree, p);
      if (typeof a !== 'string' || typeof b !== 'string') continue;
      if (placeholders(a).join(',') !== placeholders(b).join(',')) drifted.push(p);
    }
    expect(drifted).toEqual([]);
  });

  it('leaves no value empty or left in English by accident', () => {
    const empty: string[] = [];
    for (const p of REFERENCE) {
      const b = leaf(tree, p);
      if (typeof b === 'string' && b.trim() === '') empty.push(p);
    }
    expect(empty).toEqual([]);
  });
});

describe('placeholder extraction', () => {
  it('reads a plain argument', () => {
    expect(placeholders('© {year} IBANforge.')).toEqual(['year']);
  });

  it('reads the argument of a plural and ignores its branches', () => {
    // The branches are translated words. Treating them as placeholders is what
    // made the first version of this file report three healthy strings broken.
    expect(placeholders('{count, plural, one {day} other {days}}')).toEqual(['count']);
    expect(placeholders('{count, plural, one {jour} other {jours}}')).toEqual(['count']);
  });

  it('agrees across languages on a plural, which is the point', () => {
    const en = placeholders('{count, plural, one {hour} other {hours}}');
    const de = placeholders('{count, plural, one {Stunde} other {Stunden}}');
    expect(en).toEqual(de);
  });

  it('finds several arguments in one string', () => {
    expect(placeholders('{used} of {limit} for {month}')).toEqual(['limit', 'month', 'used']);
  });

  it('returns nothing for a string with no interpolation', () => {
    expect(placeholders('Votre clé')).toEqual([]);
  });
});

describe('the reference itself', () => {
  it('has no duplicate paths', () => {
    expect(new Set(REFERENCE).size).toBe(REFERENCE.length);
  });

  it('reaches the account page and its footer link in all three languages', () => {
    // Pinned by name rather than left to the generic sweep: this surface was
    // added on 21/08 and is the first customer-facing page that is not the
    // marketing site. A missing key here shows a raw string to a paying user.
    for (const tree of [en, fr, de] as Tree[]) {
      expect(leaf(tree, 'account.title')).toBeTruthy();
      expect(leaf(tree, 'account.privacy')).toBeTruthy();
      expect(leaf(tree, 'footer.link.account')).toBeTruthy();
    }
  });
});
