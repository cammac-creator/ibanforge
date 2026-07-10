import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

/**
 * Legal documents (terms, privacy, dpa, imprint) live in content/legal/ as a
 * single English set — they are contractual texts, kept locale-independent on
 * purpose. Pages under app/[locale]/legal/ render them for every locale with
 * an "authoritative version is English" note on non-EN locales.
 */

const LEGAL_DIR = path.join(process.cwd(), 'content', 'legal');

export interface LegalMeta {
  slug: string;
  title: string;
  description: string;
  order: number;
  updated: string;
}

export const LEGAL_SLUGS = ['terms', 'privacy', 'dpa', 'imprint'] as const;

export function getLegalDoc(slug: string): { meta: LegalMeta; content: string } | null {
  if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) return null;
  const file = path.join(LEGAL_DIR, `${slug}.mdx`);
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
    },
    content,
  };
}

export function getAllLegalDocs(): LegalMeta[] {
  return LEGAL_SLUGS.map((slug) => getLegalDoc(slug)?.meta)
    .filter((m): m is LegalMeta => Boolean(m))
    .sort((a, b) => a.order - b.order);
}
