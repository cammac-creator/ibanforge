import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_ASK } from '../lib/consent.js';
import { REST_TRIAL_DAILY_LIMIT, TRIAL_FREE_KEY_HINT, TRIAL_SIGNUP_SOURCE } from '../lib/trial.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';

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
  // Artefact GÉNÉRÉ par `npm run openapi:dump` depuis src/routes/openapi.ts,
  // gitignoré : absent d'un poste propre et de la CI, présent chez qui a lancé
  // le dump. Le garde lit déjà openapi.ts ; compter aussi sa copie doublait
  // les mêmes lignes et faisait dépendre le budget de l'environnement.
  'openapi.generated.json',
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

/**
 * La DÉCLARATION canonique d'un plafond n'est pas une promesse périmée : c'est
 * la source unique que ce garde existe pour imposer, et le motif « palier +
 * 200 » l'attrape par construction (`FREE_TIER_MONTHLY_LIMIT = 200`).
 *
 * 🚨 Exemptée par CHEMIN et par forme, jamais par motif seul : un motif
 * exempterait aussi la dixième copie du même chiffre dans un autre fichier,
 * c'est-à-dire exactement la maladie soignée ici (neuf copies du 200 vivaient
 * sans constante du tout).
 */
const CANONICAL_CONSTANTS = 'src/lib/tiers.ts';
const CONSTANT_DECLARATION = /^export const [A-Z0-9_]+ = \d+;/;

/**
 * Les fichiers dont le lot des textes agents (15/09/2026) a la charge.
 *
 * Leur compte est à ZÉRO et le reste : un budget global qui descend laisse une
 * régression se cacher derrière le travail des autres, alors qu'une égalité à
 * zéro par fichier nomme le fichier qui régresse. Les autres lignes vivantes
 * appartiennent aux textes humains (frontend/), aux paquets publiés et aux
 * intégrations, et restent sous le plafond global ci-dessous.
 */
const MIGRATED = [
  'src/app.ts',
  'src/lib/attribution.ts',
  // Ajoutés par le lot des surfaces MCP (15/09/2026), chacun MESURÉ à zéro
  // avant d'entrer ici : ils portent désormais les textes du device grant, donc
  // ils appartiennent à la même discipline que les autres surfaces d'agents.
  'src/lib/consent.ts',
  'src/mcp/inventory.ts',
  'src/mcp/output-schemas.ts',
  'src/mcp/server.ts',
  'src/lib/forum-draft-gen.ts',
  'src/lib/mcp-resources.ts',
  'src/lib/trial.ts',
  'src/mcp/instructions.ts',
  'src/middleware/api-key.ts',
  'src/middleware/enrich-402.ts',
  'src/routes/api-keys.ts',
  'src/routes/artifacts.ts',
  'src/routes/device-grant.ts',
  'src/lib/device-grant.ts',
  'src/routes/discovery.ts',
  'src/routes/landing.ts',
  'src/routes/mcp-http.ts',
  'src/routes/openapi.ts',
  'src/routes/playground.ts',
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'mcp/README.md',
  'mcp/server.json',
  'mcp/src/index.ts',
];

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
          if (rel === CANONICAL_CONSTANTS && CONSTANT_DECLARATION.test(line)) return;
          // Une ligne n'est comptée qu'une fois, même si deux motifs coïncident.
          if (hasDeprecatedTrialClaim(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
        });
    }
    // Budget de lignes encore à migrer. Ce nombre ne remonte JAMAIS.
    // Mesuré sur cette branche ; le repère historique était 166 lignes, puis
    // 174 avant le lot des textes agents (15/09/2026), qui a vidé ses fichiers.
    // Réduire avec chaque lot de textes, jusqu'à une égalité à zéro au raccordement.
    // 24/09/2026 : 140 → 45. Mesuré à 39 sur une copie propre après le lot des
    // textes secondaires (articles des 07.09 et 14.09, pages de doc qui
    // annonçaient « 200 » comme LA clé) ; la marge couvre les fichiers non suivis
    // d'un poste de travail, que ce balayage lit aussi (deux lignes chez
    // l'intégrateur ce jour-là).
    const BUDGET = 45;
    expect(offenders.length, offenders.join('\n')).toBeLessThanOrEqual(BUDGET);
  });

  it('les fichiers du lot des textes agents sont à ZÉRO, et y restent', () => {
    const offenders: string[] = [];
    for (const rel of MIGRATED) {
      const isCode = CODE_EXT.test(rel);
      readFileSync(join(ROOT, rel), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (DATED_LINE.test(line) || (isCode && CODE_COMMENT.test(line))) return;
          if (rel === CANONICAL_CONSTANTS && CONSTANT_DECLARATION.test(line)) return;
          if (hasDeprecatedTrialClaim(line)) offenders.push(`${rel}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

/**
 * Le gabarit d'adresse ne voyage JAMAIS sans son interdit.
 *
 * 🚨 Balayage de FICHIERS, et c'est la correction qui compte : la version
 * précédente de cette règle bouclait sur les chaînes de `src/lib/consent.ts`,
 * donc sur UNE des six surfaces de publication. La zone B ne peut pas importer
 * (`mcp/`, `frontend/`, `sdks/`, `integrations/` sont d'autres paquets), donc le
 * gabarit y voyage en copie verbatim, et aucune de ces copies n'était vérifiée.
 * Une traduction, une troncature de description d'outil ou une réécriture de
 * `llms.txt` qui laisse tomber l'interdit ne faisait rougir aucun test.
 *
 * ⚠️ Ce balayage-ci EXCLUT les fichiers de test, à l'inverse du balayage des
 * tournures ci-dessus, et il faut dire pourquoi les deux diffèrent : un test
 * qui épingle la phrase de consentement la CITE, il ne la publie à personne,
 * alors qu'une fixture qui affirme « 200 requêtes par mois » est une valeur
 * périmée qu'il faut corriger comme la source.
 */
const FORBID =
  /never send an address your human has not|n'envoyez pas l'adresse de votre utilisateur|senden Sie die Adresse .{0,40} nicht/i;
const IS_TEST = /\.(test|spec)\.(ts|tsx|js|mjs)$/;

describe('la phrase de consentement et son interdit', () => {
  it("aucune surface ne publie le gabarit d'adresse sans son interdit", () => {
    const offenders: string[] = [];
    let seen = 0;
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file);
      if (IS_TEST.test(rel)) continue;
      const text = readFileSync(file, 'utf8');
      if (!text.includes(CONSENT_ASK) && !text.includes('to create a free IBANforge key')) continue;
      seen += 1;
      if (!FORBID.test(text)) offenders.push(rel);
    }
    expect(offenders, `gabarit d'adresse sans interdit : ${offenders.join(', ')}`).toEqual([]);
    // 🚨 Un balayage qui ne trouve aucune surface passe au vert en ne
    // vérifiant rien : la phrase est publiée, donc au moins un fichier la
    // porte, et le jour où plus rien ne la porte c'est une régression.
    expect(seen, 'plus aucune surface ne publie la phrase de consentement').toBeGreaterThan(0);
  });

  it("le conseil de l'essai garde le jeton de mesure et annonce la clé par sa destination", () => {
    // Sans le `source`, la carte des portes d'entrée du tableau de bord tombe à
    // zéro pour toujours, et aucun autre test ne le verrait.
    expect(TRIAL_FREE_KEY_HINT).toContain(`"source":"${TRIAL_SIGNUP_SOURCE}"`);
    // Depuis le 24/09/2026, le plafond du JOUR n'est plus dans cette phrase :
    // elle est servie dans le bloc `trial`, juste à côté de `daily_limit`, et
    // les deux 25 face à face se lisaient « la clé vaut moins que pas de clé ».
    // La clé s'annonce par ses 200 une fois réclamée, le 25 du mois ensuite,
    // chiffres lus dans les constantes.
    expect(TRIAL_FREE_KEY_HINT).toContain(
      `${FREE_TIER_MONTHLY_LIMIT} requests a month once claimed`,
    );
    expect(TRIAL_FREE_KEY_HINT).toContain(`starts at ${ANONYMOUS_MONTHLY_LIMIT} requests a month`);
    expect(TRIAL_FREE_KEY_HINT.indexOf(String(FREE_TIER_MONTHLY_LIMIT))).toBeLessThan(
      TRIAL_FREE_KEY_HINT.indexOf(`starts at ${ANONYMOUS_MONTHLY_LIMIT}`),
    );
    expect(TRIAL_FREE_KEY_HINT).not.toMatch(/\bday\b/i);
    expect(TRIAL_FREE_KEY_HINT).not.toContain(`${REST_TRIAL_DAILY_LIMIT} are`);
    // Réclamer demande un code reçu à une adresse : « un appel » était faux.
    expect(TRIAL_FREE_KEY_HINT).toMatch(/code mailed/);
    expect(TRIAL_FREE_KEY_HINT).not.toContain('you@');
  });

  it('une ligne où les deux plafonds se croisent porte les deux unités', () => {
    // Les deux quotas valent le même nombre et n'ont AUCUN rapport : 25 par
    // jour sur la seule route de validation, 25 par mois sur tous les
    // endpoints. Une ligne qui cite le nombre deux fois les met face à face,
    // et c'est là que l'unité devient obligatoire.
    const figure = String(REST_TRIAL_DAILY_LIMIT);
    expect(figure).toBe(String(ANONYMOUS_MONTHLY_LIMIT));
    // 🚨 Le chiffre NU, comme `N200` ci-dessus : sans ces bornes, « 1k = $5,
    // 5k = $20, 25k = $80 » compte deux 25 et la ligne des paquets de crédits
    // devient une infraction. Un garde qui rougit sur une phrase vraie se fait
    // désarmer.
    const bare = new RegExp(String.raw`(?<![.,\d])${figure}(?![.,]?\d)(?![kK])`, 'g');
    const offenders: string[] = [];
    for (const rel of ['frontend/public/llms.txt', 'frontend/public/llms-full.txt']) {
      readFileSync(join(ROOT, rel), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if ((line.match(bare) ?? []).length < 2) return;
          if (/\bday\b/i.test(line) && /\bmonth\b/i.test(line)) return;
          offenders.push(`${rel}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});
