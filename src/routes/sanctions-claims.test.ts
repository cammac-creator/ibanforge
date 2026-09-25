import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadedSanctionsLists, PROMISED_SANCTIONS_LISTS } from '../lib/compliance-db.js';
import { RESTRICTED_FAMILY } from '../lib/restricted-family.js';

/**
 * No served surface may claim a sanctions list we do not screen.
 *
 * ## Why this test exists rather than another round of find-and-replace
 *
 * On 26/07/2026 commit 923413e removed the "OFAC/EU/UN/SECO" claim from 65
 * places across 37 files: three languages of UI copy, the docs, the playground,
 * the MCP descriptors, llms.txt, both SDK READMEs and the served database
 * metadata. It added no test. Two days later the claim was still live at
 * https://ibanforge.com/.well-known/mcp.json, a machine-readable descriptor
 * that agents and catalogues read, because a static file in frontend/public
 * was not in anyone's head at the time.
 *
 * That is the whole argument for this file. A claim spread over 37 files
 * cannot be held by memory; it needs something that fails.
 *
 * ## Why it matters more than an ordinary copy mistake
 *
 * This is a compliance product, so the promise IS the thing being bought, and
 * SECO is the Swiss authority — the jurisdiction the entire positioning rests
 * on. An assistant reading the descriptor would recommend IBANforge for UN or
 * SECO screening; the buyer discovers otherwise on a false negative, which is
 * the most expensive moment possible.
 *
 * ## What the test asserts
 *
 * First, the ground truth: which source lists the shipped database actually
 * holds. Then that no served text names a sanctions authority absent from it.
 * If a UN or SECO feed is ever genuinely wired in, this test starts passing on
 * its own and the copy may be updated — which is the correct order.
 */

const ROOT = join(import.meta.dirname, '..', '..');

/** Directories that never reach a customer. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  'coverage',
  '.superpowers',
  '.claude',
  'docs',
  'data',
  'tmp',
]);

/** Extensions worth scanning: served code, copy, descriptors and manifests. */
const EXTS = /\.(ts|tsx|js|mjs|json|md|mdx|txt|html)$/;

/** Files whose mention of a list is a description of the pipeline, not a promise to a customer. */
const ALLOWED = new Set([
  'scripts/refresh-compliance.ts', // the fetcher: it may name a feed it attempts
  'CHANGELOG.md', // history, and it documents this very removal
  'src/routes/sanctions-claims.test.ts',
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue; // a broken symlink is not a served surface
    }
    if (s.isDirectory()) walk(full, out);
    else if (EXTS.test(name)) out.push(full);
  }
  return out;
}

/**
 * Les listes de sanctions que la production sert depuis la surcouche PRIVÉE, et
 * non depuis la base de ce dépôt.
 *
 * L'ONU depuis l'étape du retrait (25/09/2026) : tous droits réservés, la liste
 * est gardée (décision du 24/09/2026) mais servie depuis un fichier privé
 * (membre `un` de src/lib/restricted-family.ts). Ajoutée DANS LE MÊME COMMIT
 * que la base publique qui ne la porte plus : le workflow hebdomadaire de
 * rafraîchissement lance ce fichier sur la base publique, et sans cette ligne il
 * lirait « l'ONU n'est pas contrôlée » et rougirait sur chaque surface qui dit,
 * à juste titre, qu'elle l'est. Quand la surcouche manque, la réponse le dit
 * elle-même (`unscreened_lists`, drapeau `sanctions_list_unavailable_un`).
 *
 * Ajouter une liste ici, c'est affirmer que la production la sert sans que ce
 * dépôt la porte. Cela n'excuse jamais la disparition d'une liste PUBLIQUE :
 * voir REDISTRIBUTABLE ci-dessous.
 */
const SERVED_FROM_PRIVATE_OVERLAY: readonly string[] = ['UN'];

/**
 * Les listes que ce dépôt a le droit de porter, et doit donc porter : OFAC
 * (domaine public, CC0) et UE (CC BY 4.0). Le plancher qui empêche la
 * déclaration ci-dessus de cacher une liste publique disparue.
 */
const REDISTRIBUTABLE: readonly string[] = ['EU', 'OFAC'];

/**
 * Les listes que porte la base chargée, lues par l'accesseur que l'API utilise
 * elle-même pour `meta.sources` (src/lib/compliance-db.ts), pas par une requête
 * propre à ce test : la porte et la réponse servie ne peuvent pas diverger sur
 * ce qui est chargé.
 */
const loaded = new Set(loadedSanctionsLists().map((l) => l.toUpperCase()));

/** Ce que la production contrôle : les listes chargées, plus celles que sert la surcouche privée. */
const served = new Set([...loaded, ...SERVED_FROM_PRIVATE_OVERLAY.map((l) => l.toUpperCase())]);

/**
 * Every line of a served surface that names a sanctions authority outside
 * `screened`. Only forms that assert screening: "SECONDARY", "UNITED KINGDOM"
 * and the like must not trip it, so the pattern requires the authority to sit
 * in a list of sanctions bodies rather than merely appear as letters.
 *
 * Fonction de l'ensemble contrôlé plutôt que de la base, pour que ce fichier
 * puisse prouver que la porte mord encore sur un ensemble qu'il ne sert pas
 * (voir le dernier bloc).
 */
function overClaims(screened: ReadonlySet<string>): string[] {
  const CLAIM = /\b(OFAC|EU)\s*[/,]\s*(EU|UN|SECO)(\s*[/,]\s*(UN|SECO|EU))*/i;
  const NAMED = /\b(UN|SECO)\b/;

  const offenders: string[] = [];
  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).split('\\').join('/');
    if (ALLOWED.has(rel)) continue;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = CLAIM.exec(line);
      if (!m) continue;
      // The matched run lists authorities; flag any that is not shipped.
      for (const authority of m[0].split(/[/,]/).map((s) => s.trim().toUpperCase())) {
        if (NAMED.test(authority) && !screened.has(authority)) {
          offenders.push(`${rel}: ${line.trim().slice(0, 140)}`);
          break;
        }
      }
    }
  }
  return offenders;
}

describe('sanctions coverage claims match what is served', () => {
  it('serves OFAC, EU and UN, and not SECO', () => {
    // Pinned as ground truth so the rest of the file has something to compare
    // against. If a feed is genuinely added, this is the assertion to change
    // first, before any copy.
    //
    // UN joined on 21/08/2026, and not because a feed was added: the refresh
    // script used to discard any listed BIC absent from our own directory, and
    // all 5 the UN list carries were in that case. Lifting that filter — the
    // fix for the EU list losing half its coverage the same way — made the UN
    // rows appear. The claim string is now derived from this table rather than
    // retyped, so the two cannot drift apart again.
    expect([...served].sort()).toEqual(['EU', 'OFAC', 'UN']);
  });

  it('la liste promise par les réponses est celle que les surfaces nomment', () => {
    // `PROMISED_SANCTIONS_LISTS` décide quand une réponse dit « cette liste n'a
    // pas été consultée » (drapeau sans poids, `listed: null`) : elle doit
    // nommer exactement ce que chaque surface affirme contrôler.
    expect([...PROMISED_SANCTIONS_LISTS].sort()).toEqual(['EU', 'OFAC', 'UN']);
    // Et la surcouche privée n'emporte jamais une liste publique.
    const privateLists = RESTRICTED_FAMILY.filter(
      (m) => m.table === 'sanctioned_entities' && m.where,
    ).map((m) => m.where!.value);
    expect(privateLists).toEqual(['UN']);
    for (const list of REDISTRIBUTABLE) expect(privateLists).not.toContain(list);
  });

  it('holds every redistributable list in the loaded database, never behind the overlay', () => {
    // La déclaration de surcouche ne peut expliquer qu'une liste partie vers le
    // fichier privé. Une liste publique absente de la base chargée, c'est un
    // rafraîchissement cassé, et la déclaration ne doit pas pouvoir le cacher.
    const overlay = new Set(SERVED_FROM_PRIVATE_OVERLAY.map((l) => l.toUpperCase()));
    for (const list of REDISTRIBUTABLE) {
      expect(loaded.has(list), `${list} missing from the loaded database`).toBe(true);
      expect(overlay.has(list), `${list} is redistributable: it stays public`).toBe(false);
    }
  });

  it('no served surface names a sanctions authority we do not screen', () => {
    const offenders = overClaims(served);
    expect(
      offenders,
      `Surfaces claiming a sanctions list that is not served:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

describe('served copy claims only what the product can prove', () => {
  it('no served surface promises account-level verification', () => {
    // The API validates an IBAN and identifies the bank behind it. It cannot
    // see accounts or account holders. Copy that promises more sells a check
    // we do not perform — the exact wording that turned the NL composite-map
    // gap into a liability (src/lib/nl-psp.ts: a fabricated IBAN came back
    // "verified" naming a corporate treasury as the bank). Same audit trail
    // as the sanctions guard above: the phrasing lived on eleven surfaces,
    // so it needs something that fails, not another sweep.
    const FORBIDDEN: Array<[RegExp, string]> = [
      [/vet a counterparty/i, 'promises payee vetting; we screen the bank'],
      [/\bbank exists\b/i, 'a composite-map hit is not proof of existence'],
      [/banque existante/i, 'French variant of the same promise'],
      [/Bank existiert/i, 'German variant of the same promise'],
      [/verify a bank account number/i, 'we validate IBANs, not accounts'],
      [/payment will go through/i, 'we answer bank reachability, not payment outcome'],
      [/is a real bank\b/i, 'issuer classification, not proof of life'],
    ];

    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).split('\\').join('/');
      if (ALLOWED.has(rel)) continue;
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      for (const line of text.split('\n')) {
        for (const [pattern, why] of FORBIDDEN) {
          if (pattern.test(line)) {
            offenders.push(`${rel} (${why}): ${line.trim().slice(0, 140)}`);
          }
        }
      }
    }

    expect(
      offenders,
      `Surfaces promising a check we do not perform:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * What makes a line a coverage claim. Case-sensitive on purpose: the French
 * article "un" and the German conjunction "und" are not the Security Council,
 * and "SECONDARY" is not the Swiss authority.
 *
 * A bare "EU" does not trigger a claim by itself, because in this codebase it
 * is far more often the jurisdiction than the list ("EU high-risk third
 * countries", "EU Instant Payments Regulation"). It still counts inside a run.
 */
const CLAIM_TRIGGER = /\b(OFAC|UN|SECO)\b/;

/**
 * A run of authorities written as a set, e.g. "OFAC, EU, UN" or "EU,OFAC,UN".
 *
 * The middle dot is in the separator list because it is the separator the
 * site's own trust bar uses for every other value it shows. Without it, a
 * claim written correctly in the house typography would be reported as an
 * under-declaration, which is a false alarm the guard would eventually be
 * silenced for.
 */
const RUN = /\b(OFAC|EU|UE|UN|SECO)\b(?:\s*[,/+·]\s*\b(?:OFAC|EU|UE|UN|SECO)\b)+/g;

/**
 * `UE` is how French writes the European Union, and the guard fired on the
 * French footer for spelling it correctly — an under-declaration reported
 * where none existed. Folded rather than added to `served`: the database
 * ships one EU list, not two, so `UE` must satisfy the EU requirement and
 * must not let a surface pass by naming both forms and no UN. Deliberately
 * one-way and case-sensitive: no locale writes something else `UE`.
 */
const ALIASES: Record<string, string> = { UE: 'EU' };
const canonical = (a: string) => ALIASES[a] ?? a;

/**
 * `matched_lists` shows what a single hit looks like, so `["OFAC"]` is a
 * correct example and not a claim about coverage. It is the only exemption,
 * and it is narrow on purpose.
 */
const EXAMPLE_FIELD = 'matched_lists';

/**
 * The mirror image of the guard above: a surface must not name FEWER lists than
 * we screen either.
 *
 * ## Why the same file needs the opposite assertion
 *
 * The guard above only catches a surface that claims an authority we do not
 * have. It is blind to the other drift, and on 21/08/2026 that drift was the
 * live one: lifting the importer filter made the UN axis return entries, so
 * every surface that had honestly said "OFAC" or "OFAC + EU" the day before
 * became an under-declaration overnight. Commit 08e72bf fixed three of them by
 * hand (SUBMISSIONS.md, the Postman collection, the MCP descriptor) and added
 * no test, which is the exact shape of the 923413e mistake this file was
 * written to end.
 *
 * Under-declaring is cheaper than over-declaring, but it is not free: a buyer
 * comparing us against a competitor reads the smaller list and walks, and an
 * assistant summarising the product tells its user we do not screen UN.
 *
 * ## Why the pinned list, rather than scanning the repo
 *
 * Over-declaring is a defect anywhere, so the guard above may sweep the whole
 * tree. Under-declaring is only a defect on a surface that sets out to state
 * WHICH lists are screened. Dozens of served strings legitimately name OFAC
 * alone as the spine of the data or as a one-element example, and sweeping
 * would flag every one of them. So the surfaces that make the coverage claim
 * are pinned here by name; adding a new one is a deliberate act.
 *
 * ## Why it is asserted line by line
 *
 * A file-level "names all three somewhere" assertion stays green when a single
 * one of the five claim lines in compliance.mdx is rewritten back to "(OFAC)".
 * Every line that names a screened authority must therefore carry the full set
 * itself. One test per surface, so a regression reports which surface drifted
 * rather than one opaque failure.
 */
describe('no served surface names fewer sanctions lists than we screen', () => {
  /**
   * Surfaces whose job is to state the screened set. All three locales of each
   * doc: leaving de/fr behind is drift of its own, and the guard above already
   * treats "in any of the three languages" as the standard.
   */
  const COVERAGE_SURFACES = [
    'frontend/content/en/docs/data-sources.mdx',
    'frontend/content/de/docs/data-sources.mdx',
    'frontend/content/fr/docs/data-sources.mdx',
    'frontend/content/en/docs/compliance.mdx',
    'frontend/content/de/docs/compliance.mdx',
    'frontend/content/fr/docs/compliance.mdx',
    'src/mcp/server.ts',
    'src/routes/openapi.ts',
    // The home page's trust bar and its neighbours live here, not in the TSX,
    // which only renders t('trust.sanctionsValue'). It is the most seen surface
    // of the lot and it was the last one still naming a single authority.
    'frontend/messages/en.json',
    'frontend/messages/de.json',
    'frontend/messages/fr.json',
  ];

  it.each(COVERAGE_SURFACES)('%s names every list we serve', (rel) => {
    const { claims, offenders } = underClaims(rel, served);
    // A surface that stopped claiming anything at all is the same failure with
    // the evidence removed, so silence does not pass either.
    expect(claims, `${rel} no longer states which sanctions lists are screened`).toBeGreaterThan(0);
    expect(
      offenders,
      `${rel} names a sanctions list set other than the served ${[...served].sort().join(', ')}:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});

/**
 * Chaque ligne d'une surface de couverture qui énonce un ensemble autre que
 * `screened`, et le nombre de lignes qui en énoncent un.
 *
 * Déclarée au niveau du module pour que la preuve ci-dessous puisse l'appeler
 * sur un ensemble que nous ne servons pas ; les motifs et l'unique exemption
 * sont ceux que documente le bloc au-dessus.
 */
function underClaims(
  rel: string,
  screened: ReadonlySet<string>,
): { claims: number; offenders: string[] } {
  const text = readFileSync(join(ROOT, rel), 'utf8');
  const offenders: string[] = [];
  let claims = 0;

  text.split('\n').forEach((line, i) => {
    if (!CLAIM_TRIGGER.test(line) || line.includes(EXAMPLE_FIELD)) return;
    claims++;
    const complete = [...line.matchAll(RUN)].some((m) => {
      const named = new Set(m[0].split(/[,/+·]/).map((s) => canonical(s.trim())));
      return named.size === screened.size && [...screened].every((a) => named.has(a));
    });
    if (!complete) offenders.push(`  line ${i + 1}: ${line.trim().slice(0, 140)}`);
  });
  return { claims, offenders };
}

/**
 * La porte mord encore quand les listes ne sont plus lues dans ce dépôt.
 *
 * Lire l'ensemble servi par un accesseur et une déclaration, plutôt que dans un
 * littéral épinglé, n'est sûr que si un ensemble privé d'une liste fait encore
 * rougir les surfaces qui la nomment, et si un ensemble augmenté d'une liste
 * fait rougir les surfaces de couverture. Vérifié ici sur des ensembles que
 * nous ne servons pas, contre les vraies surfaces, pour qu'aucune des deux
 * moitiés ne puisse cesser de fonctionner en silence.
 */
describe('the sanctions guard still bites on a set we do not serve', () => {
  it('flags the surfaces naming UN when UN is not served', () => {
    const withoutUn = new Set([...served].filter((l) => l !== 'UN'));
    const offenders = overClaims(withoutUn);
    expect(offenders.length).toBeGreaterThan(0);
    expect(offenders.some((o) => o.startsWith('src/mcp/server.ts:'))).toBe(true);
  });

  it('flags the coverage surfaces when a list is served that none of them names', () => {
    const withSeco = new Set([...served, 'SECO']);
    for (const rel of [
      'src/mcp/server.ts',
      'src/routes/openapi.ts',
      'frontend/content/en/docs/compliance.mdx',
    ]) {
      expect(underClaims(rel, withSeco).offenders.length, rel).toBeGreaterThan(0);
    }
  });
});
