import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import en from '@/messages/en.json';
import de from '@/messages/de.json';
import fr from '@/messages/fr.json';
import { getAllLegalDocs, getLegalDoc, LEGAL_SLUGS, LEGAL_TRANSLATION_LOCALES } from './legal';

/**
 * The courtesy translations of the legal texts (since 2026-10-06).
 *
 * The danger of a translation is not a bad word, it is an OLD text: the
 * English document moves to a new version, the German one keeps describing the
 * previous processing, and a German reader relies on it. So each translation
 * must carry the same `updated` date and the same "Version X.Y" as its English
 * original; changing one without the other fails here.
 *
 * The other checks keep a German page from sending its reader back into the
 * English site by accident (every internal link stays under /de/), and keep
 * the house style of the texts written in German: no long dash, no French
 * space before a semicolon.
 */

const LEGAL = join(process.cwd(), 'content', 'legal');
const read = (rel: string) => readFileSync(join(LEGAL, rel), 'utf8');

/** "Version 1.6" in the first lines of a document, or null for the imprint. */
function versionOf(raw: string): string | null {
  return /Version (\d+\.\d+)/.exec(raw.split('\n').slice(0, 14).join('\n'))?.[1] ?? null;
}

const TRANSLATIONS = LEGAL_TRANSLATION_LOCALES.flatMap((locale) =>
  LEGAL_SLUGS.filter((slug) => existsSync(join(LEGAL, locale, `${slug}.mdx`))).map(
    (slug) => [locale, slug] as const,
  ),
);

describe('the courtesy translations of the legal texts', () => {
  it('cover every German document', () => {
    expect(TRANSLATIONS.filter(([l]) => l === 'de').map(([, s]) => s).sort()).toEqual(
      [...LEGAL_SLUGS].sort(),
    );
  });

  it.each(TRANSLATIONS)('%s/%s keeps the version and date of the English text', (locale, slug) => {
    const original = read(`${slug}.mdx`);
    const translation = read(`${locale}/${slug}.mdx`);
    expect(matter(translation).data.updated).toBe(matter(original).data.updated);
    expect(versionOf(translation)).toBe(versionOf(original));
  });

  it.each(TRANSLATIONS)('%s/%s keeps its links in its own language', (locale, slug) => {
    const body = matter(read(`${locale}/${slug}.mdx`)).content;
    const internal = [...body.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
    for (const href of internal) {
      // security.txt is served at the root of the host, whatever the language.
      if (href.startsWith('/.well-known/')) continue;
      expect(href, href).toMatch(new RegExp(`^/${locale}/`));
    }
  });

  it.each(TRANSLATIONS)('%s/%s follows the house style of texts written in German', (locale, slug) => {
    const raw = read(`${locale}/${slug}.mdx`);
    expect(raw).not.toContain('—');
    expect(raw).not.toMatch(/ ;/);
    // One spelling for the whole set: the standard German ß, as in the
    // technische und organisatorische Maßnahmen of the GDPR.
    expect(raw).not.toMatch(/massgeb|Massnahm|ausschliessl|gemäss\b/i);
  });

  it('serves the translation under its locale, and English everywhere else', () => {
    for (const slug of LEGAL_SLUGS) {
      expect(getLegalDoc(slug, 'de')?.meta.translated, slug).toBe(true);
      expect(getLegalDoc(slug, 'en')?.meta.translated, slug).toBe(false);
      expect(getLegalDoc(slug, 'fr')?.meta.translated, slug).toBe(false);
      // A locale that is not on the list is never joined to a path.
      expect(getLegalDoc(slug, '../de')?.meta.translated, slug).toBe(false);
    }
    expect(getAllLegalDocs('de').every((d) => d.translated)).toBe(true);
    expect(getAllLegalDocs('fr').some((d) => d.translated)).toBe(false);
  });

  it('says on every translated page that the English version prevails', () => {
    expect(de.legal.translation.notice).toMatch(/Unverbindliche Übersetzung/);
    expect(de.legal.translation.notice).toMatch(/englische Fassung/);
    expect(en.legal.translation.notice).toMatch(/English version prevails/);
    expect(fr.legal.translation.notice).toMatch(/version anglaise fait foi/);
    // The catalogue no longer calls a translated German document English.
    for (const slug of LEGAL_SLUGS) {
      expect(de.legal.docs[slug].title, slug).not.toMatch(/auf Englisch/);
    }
  });
});

describe('the privacy policy and the edge log of the API host', () => {
  it('names the request path without promising the query string is dropped', () => {
    // Observed once, never documented by Railway (audit of 2026-10-05): the
    // policy may not say more than that.
    for (const rel of ['privacy.mdx', 'de/privacy.mdx']) {
      const table = read(rel)
        .split('\n')
        .filter((l) => l.startsWith('|'))
        .join('\n');
      expect(table, rel).not.toMatch(/query string|Query-Zeichenfolge/i);
    }
    expect(read('privacy.mdx')).toContain('raw IP address, request path, status');
    expect(read('de/privacy.mdx')).toContain('rohe IP-Adresse, Anfragepfad, Status');
  });
});
