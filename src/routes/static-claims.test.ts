import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * One version of our own numbers, everywhere.
 *
 * The 2026-08-06 third-party inventory found the directories quoting five
 * different versions of our dataset figures (121,197 / 121,610 / 121,000+ /
 * "39K+ bank entries" / "84 countries" / "~1,200 Swiss entries") — every one
 * of them copied from some surface of ours at some point in time. We cannot
 * blame a catalogue for serving stale numbers while our own repo offers a
 * buffet of variants.
 *
 * Canonical wording, chosen to stay true across monthly refreshes:
 *   121k+ BIC entries · 39k+ LEI-enriched · 1,100+ Swiss entries · 89 countries
 * (live counts remain available at /llms.txt and /health).
 *
 * A dated snapshot ("as of the 2026-07 refresh (121,610 total)") is honest and
 * allowed: the date is the context that keeps it true. The exemption below is
 * for those lines only.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/** Never reaches a customer, or is not ours to police. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.superpowers',
  '.claude',
  'data',
  'tmp',
  'internal',
  'target',
  'bin',
  'obj',
  '.venv',
  // Implementation plans and specs are dated design history, like CHANGELOG.
  'superpowers',
]);

const EXTS = /\.(ts|tsx|js|mjs|json|md|mdx|txt|html|py|cs|java)$/;

/** History files describe the past; this test polices the present. The two
 * other guard tests cite the banned variants by trade (one asserts their
 * absence, one documents the audit that killed them). */
const ALLOWED = new Set([
  'CHANGELOG.md',
  'src/routes/static-claims.test.ts',
  'src/routes/dataset-claims.test.ts',
  'src/routes/discovery.test.ts',
]);

/** A line that dates its figure is a snapshot, not a claim that can go stale. */
const DATED_LINE = /as of|refresh|Breakdown|20\d{2}-\d{2}/i;

/** In code files, a comment explaining an old drift is documentation, not a
 * served string — served literals never start with a comment marker. */
const CODE_COMMENT = /^\s*(\/\/|\*|\/\*|#)/;
const CODE_EXT = /\.(ts|tsx|js|mjs|py|cs|java)$/;

const BANNED: Array<{ pattern: RegExp; wanted: string }> = [
  {
    pattern: /\b84\s+(countries|pays|Länder)/,
    wanted: '89 countries (real count, live at /llms.txt)',
  },
  { pattern: /\b7[05]\+?\s+(countries|pays|Länder)/, wanted: '89 countries' },
  { pattern: /~\s?1[,.'\u00a0\u202f ]?200\b/, wanted: '1,100+ Swiss entries' },
  { pattern: /\b1[,.']190\b/, wanted: '1,100+ Swiss entries' },
  // 121,000+ / 39,000+ are the long spellings datasetFacts() itself emits on
  // live surfaces — same value as 121k+/39k+, so they are not banned. Only
  // wrong or stale VALUES are.
  { pattern: /\b38[Kk]\+/, wanted: '39k+ LEI-enriched' },
  { pattern: /\b121,(197|610|716)\b/, wanted: '121k+ (or a dated snapshot line)' },
  { pattern: /\b39,265\b/, wanted: '39k+ (or a dated snapshot line)' },
];

/** Archives de l'ancien essai ; aucune exemption de dossier marketing entier.
 * Cette liste ne relâche pas le garde existant sur les chiffres du registre. */
const TRIAL_ARCHIVES = new Set([
  'docs/marketing/agentic-market-submission.md',
  'docs/marketing/stackoverflow-answers-2026-07.md',
  'docs/marketing/ibanforge.postman_collection.json',
  'docs/marketing/awesome-lists/awesome-crewai.md',
  'docs/marketing/awesome-lists/awesome-fintech.md',
  'docs/marketing/awesome-lists/awesome-langchain.md',
  'docs/marketing/awesome-lists/awesome-llamaindex.md',
  'frontend/content/en/blog/2026-04-01-introducing-ibanforge.mdx',
  'frontend/content/fr/blog/2026-04-01-introducing-ibanforge.mdx',
  'frontend/content/de/blog/2026-04-01-introducing-ibanforge.mdx',
  'frontend/content/en/blog/2026-04-03-compliance-features-multilingual.mdx',
  'frontend/content/fr/blog/2026-04-03-compliance-features-multilingual.mdx',
  'frontend/content/de/blog/2026-04-03-compliance-features-multilingual.mdx',
  'frontend/content/en/blog/2026-04-09-landing-redesign-seo.mdx',
  'frontend/content/en/blog/2026-04-29-python-sdk-released.mdx',
  'frontend/content/fr/blog/2026-04-29-python-sdk-released.mdx',
  'frontend/content/de/blog/2026-04-29-python-sdk-released.mdx',
]);

// Exclut 0.200, 200,000 et 1200 ; accepte « free_tier » et les trois langues.
const N200 = String.raw`(?<![.,\d])200(?![.,]?\d)`;
const FREE = String.raw`free[ _-]?tier|free[ _-]?(?:API[ _-]?)?key|offre gratuite|cl[ée]s? (?:API )?gratuites?|kostenlose[rns]?[ _-]?(?:API-)?(?:Schl[üu]ssel|Kontingent)|Gratis-?(?:Stufe|Tarif)`;
const TRIAL_BANNED = [
  new RegExp(`(?:${FREE})[^\\n]{0,60}?${N200}`, 'i'),
  new RegExp(`${N200}[^\\n]{0,60}?(?:free|gratuit|kostenlos|gratis)`, 'i'),
  /\bemailed key\b/i,
  /POST(ing)? (your|any) e-?mail/i,
  /POSTez (n'importe quel |un )?e-?mail/i,
  /POSTen Sie (eine|die)[^.\n]{0,25}E-Mail/i,
  /one per developer|une par développeur|einer pro Entwickler/i,
];

function hasDeprecatedTrialClaim(line: string): boolean {
  return TRIAL_BANNED.some((pattern) => pattern.test(line));
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

describe('static dataset claims', () => {
  it('no surface in the repo uses a non-canonical dataset figure', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel)) continue;
      const lines = readFileSync(file, 'utf8').split('\n');
      const isCode = CODE_EXT.test(file);
      lines.forEach((line, i) => {
        if (DATED_LINE.test(line)) return;
        if (isCode && CODE_COMMENT.test(line)) return;
        for (const { pattern, wanted } of BANNED) {
          if (pattern.test(line)) {
            offenders.push(`${rel}:${i + 1} matches ${pattern} — use "${wanted}"`);
          }
        }
      });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('migration des promesses sur l’essai', () => {
  it.each([
    'free_tier: 200 calls/month',
    'free API key — 200 calls',
    'offre gratuite : 200 appels',
    'clés API gratuites : 200 appels',
    'kostenloser API-Schlüssel: 200 Aufrufe',
    'Gratis-Tarif: 200',
    '200 requêtes gratuites',
    'emailed key',
    'POSTing any e-mail',
    "POSTez n'importe quel e-mail",
    'POSTen Sie eine gültige E-Mail',
    'one per developer',
    'une par développeur',
    'einer pro Entwickler',
  ])('repère la promesse à migrer : %s', (line) => {
    expect(hasDeprecatedTrialClaim(line)).toBe(true);
  });

  it.each([
    'free tier: 0.200 USD',
    'free tier: 200,000 bank entries',
    'free tier: 200.000 entries',
    'free tier: 1200 banks',
    'free tier: 2000 calls',
    'free tier: 25 calls/month',
    'HTTP 200 means success',
  ])('ne confond pas un autre nombre avec le quota : %s', (line) => {
    expect(hasDeprecatedTrialClaim(line)).toBe(false);
  });

  it('ne laisse pas augmenter le nombre de lignes encore à migrer', () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (ALLOWED.has(rel) || TRIAL_ARCHIVES.has(rel)) continue;
      const isCode = CODE_EXT.test(file);
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (DATED_LINE.test(line) || (isCode && CODE_COMMENT.test(line))) return;
          // Une ligne n'est comptée qu'une fois, même si deux motifs coïncident.
          if (hasDeprecatedTrialClaim(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
        });
    }
    // Budget de lignes encore à migrer. Ce nombre ne remonte JAMAIS.
    // Mesuré sur cette branche ; le repère historique était 166 lignes.
    // Réduire avec chaque lot de textes, jusqu'à une égalité à zéro au raccordement.
    const BUDGET = 174;
    expect(offenders.length, offenders.join('\n')).toBeLessThanOrEqual(BUDGET);
  });
});
