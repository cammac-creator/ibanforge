import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { SLUG_PATTERN } from './content-slug';

/**
 * Legal documents (terms, privacy, dpa, sla, imprint) live in content/legal/.
 * The English set is the contractual one, and the only one that binds.
 *
 * Since 2026-10-06 a locale may also carry courtesy translations in
 * content/legal/<locale>/<slug>.mdx (German first: EU customers read their
 * data-processing agreement in German). A translated page says it is not
 * binding and links to the English text; a document with no translation falls
 * back to English, with a note saying so. `lib/legal.test.ts` keeps each
 * translation on the same version and date as its English original, so a
 * translation can never silently describe an older text.
 */

const LEGAL_DIR = path.join(process.cwd(), 'content', 'legal');

export interface LegalMeta {
  slug: string;
  title: string;
  description: string;
  order: number;
  updated: string;
  /** True when the text served is a courtesy translation, not the English original. */
  translated: boolean;
}

export const LEGAL_SLUGS = ['terms', 'privacy', 'dpa', 'sla', 'imprint'] as const;

/**
 * The locales that may hold courtesy translations. A fixed list, checked
 * before any path is built: the locale comes from the URL, and only these
 * folder names may ever be joined to LEGAL_DIR.
 */
export const LEGAL_TRANSLATION_LOCALES = ['de'] as const;

function translationFile(slug: string, locale: string): string | null {
  if (!(LEGAL_TRANSLATION_LOCALES as readonly string[]).includes(locale)) return null;
  const file = path.join(LEGAL_DIR, locale, `${slug}.mdx`);
  return fs.existsSync(file) ? file : null;
}

export function getLegalDoc(
  slug: string,
  locale: string = 'en',
): { meta: LegalMeta; content: string } | null {
  if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) return null;
  /*
   * FRT-09 (2026-09-01), second lock. LEGAL_SLUGS already closes the door on
   * path traversal; the shape check is here so that adding a slug to that list
   * later cannot reopen it by accident. `null` rather than notFound(): the
   * caller contract is a nullable return, and getAllLegalDocs maps over it.
   */
  if (!SLUG_PATTERN.test(slug)) return null;
  const translated = translationFile(slug, locale);
  const file = translated ?? path.join(LEGAL_DIR, `${slug}.mdx`);
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf-8');
  const { data, content } = matter(raw);
  return {
    meta: {
      slug,
      title: data.title || slug,
      description: data.description || '',
      order: data.order ?? 99,
      updated: data.updated || '',
      translated: translated !== null,
    },
    content,
  };
}

export function getAllLegalDocs(locale: string = 'en'): LegalMeta[] {
  return LEGAL_SLUGS.map((slug) => getLegalDoc(slug, locale)?.meta)
    .filter((m): m is LegalMeta => Boolean(m))
    .sort((a, b) => a.order - b.order);
}
