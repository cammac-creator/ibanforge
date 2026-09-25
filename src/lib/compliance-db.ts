import type DatabaseType from 'better-sqlite3';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { COUNTRY_RISK_AS_OF } from './countries.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const COMPLIANCE_DB_PATH =
  process.env.COMPLIANCE_DB_PATH ?? resolve(__dirname, '../../data/compliance.sqlite');

let complianceDB: DatabaseType.Database | null = null;

export function getComplianceDB(): DatabaseType.Database {
  if (!complianceDB) {
    const Database = require('better-sqlite3') as typeof DatabaseType;
    complianceDB = new Database(COMPLIANCE_DB_PATH, { readonly: true });
  }
  return complianceDB;
}

export function closeComplianceDB(): void {
  if (complianceDB) {
    complianceDB.close();
    complianceDB = null;
    _metaStmt = null;
  }
  // Les mémos décrivent la connexion qui vient de fermer : un fichier rouvert
  // peut porter des tables que le précédent n'avait pas.
  _tableLoaded.clear();
  _sourcesMemo = undefined;
}

/**
 * Les tables de conformité que le code sonde avant de les consulter.
 *
 * `sanctioned_entities` porte les listes de sanctions, `sepa_participants` et
 * `vop_participants` les registres EPC des schémas SEPA et de la Verification
 * of Payee : ce sont elles qui peuvent manquer (sortie du dépôt public décidée
 * le 24/09/2026), et leur absence se lit « non consulté » dans le corps des
 * réponses.
 *
 * `fatf_countries` n'est sondée que pour nommer FATF dans `meta.sources` et
 * dater `meta.fatf_as_of`. C'est une table publique et statique, remplie à
 * chaque rafraîchissement depuis src/lib/compliance-static.ts, qui ne fait pas
 * partie des tables qui peuvent manquer : le corps (`fatf_status`) n'est pas
 * protégé pour elle et répond `non_member` sur une table vide, comme avant.
 */
export type ComplianceTable =
  'sanctioned_entities' | 'sepa_participants' | 'vop_participants' | 'fatf_countries';

const _tableLoaded = new Map<ComplianceTable, boolean>();

/** `meta.sources` de la connexion ouverte, figé une fois les trois sondes tranchées. */
let _sourcesMemo: string | null | undefined;

/**
 * Une table peut-elle être consultée : existe-t-elle ET porte-t-elle au moins
 * une ligne ?
 *
 * ## Pourquoi une table vide n'est pas une réponse
 *
 * Chacune de ces tables est un registre ou une liste publiés, jamais vides
 * légitimement : les registres EPC portent des milliers de banques, les listes
 * de sanctions des centaines de BIC. Une table vide ou absente veut donc dire
 * que la donnée n'a pas été chargée, et une recherche qui n'y trouve rien n'a
 * rien consulté. Jusqu'au 25/09/2026, `checkReachability` et `checkVop`
 * répondaient encore `screened: true` sur une table vide : « non joignable »,
 * « pas de VoP », et le score de risque payant d'une banque ordinaire passait
 * de 0 à 10. Les tables sous licence restrictive quittent le dépôt public
 * (décision du 24/09/2026) et arriveront en production par un fichier privé
 * séparé : « cette table n'est pas là » est devenu un état que le code doit
 * dire tout haut.
 *
 * ## Pourquoi la sonde peut échouer en silence et pas les recherches
 *
 * Une sonde qui ne peut pas tourner répond `false`, que chaque appelant traduit
 * en « non consulté » : une phrase sur nous, jamais sur la banque. Les
 * recherches elles-mêmes restent sans garde, si bien qu'une table présente mais
 * illisible remonte jusqu'aux gardes de l'appelant : sur la conformité, la
 * réponse `compliance_data_unavailable` ; sur les surfaces sans score
 * (validation, lot, outil MCP validate_iban), `sepa.vop_participant: null`
 * (voir enrich.ts).
 *
 * Mémorisé par connexion (les tables ne changent pas sous une connexion en
 * lecture seule) et effacé par closeComplianceDB(). Une sonde qui a échoué
 * n'est pas mémorisée : elle ne dit rien de la connexion suivante.
 */
export function complianceTableLoaded(table: ComplianceTable): boolean {
  const memo = _tableLoaded.get(table);
  if (memo !== undefined) return memo;
  let loaded: boolean;
  try {
    const db = getComplianceDB();
    const exists = db
      .prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    // Le nom est l'un des quatre littéraux de ComplianceTable, jamais une entrée.
    loaded = !!exists && !!db.prepare(`SELECT 1 AS ok FROM ${table} LIMIT 1`).get();
  } catch {
    return false;
  }
  _tableLoaded.set(table, loaded);
  return loaded;
}

/**
 * Les listes de sanctions que porte réellement la base chargée, par exemple
 * ['EU', 'OFAC', 'UN'].
 *
 * Le seul endroit qui répond « quelles listes contrôlons-nous », lu dans les
 * lignes. `meta.sources` de chaque réponse de conformité et la porte des
 * affirmations (src/routes/sanctions-claims.test.ts) le lisent tous deux : une
 * liste non chargée n'est jamais nommée, et une réponse ne dit jamais « aucune
 * correspondance » sur une liste qu'elle n'a pas consultée.
 */
export function loadedSanctionsLists(): string[] {
  if (!complianceTableLoaded('sanctioned_entities')) return [];
  return (
    getComplianceDB()
      .prepare('SELECT DISTINCT source_list FROM sanctioned_entities ORDER BY source_list')
      .all() as Array<{ source_list: string }>
  ).map((r) => r.source_list);
}

/**
 * La chaîne de provenance servie dans `meta.sources`, calculée sur ce qui est
 * chargé.
 *
 * Même format et même ordre que ce qu'écrit scripts/refresh-compliance.ts dans
 * la table `metadata` (les listes, puis FATF, puis un `EPC-<schéma>` par
 * schéma) : sur une base complète, la chaîne servie ne change pas. Elle est
 * calculée ici plutôt que relue dans cette clé, parce que la clé décrit la base
 * que le rafraîchissement a construite, et que la base servie a pu perdre une
 * table depuis : une chaîne qui nomme l'ONU ou l'EPC sur une base qui ne les
 * porte pas, c'est exactement l'affirmation que ce champ doit empêcher. Nulle
 * quand rien n'est chargé.
 *
 * Mémorisée par connexion : elle est servie dans chaque réponse de conformité
 * (dont la démo gratuite), et la recalculer à chaque fois coûtait deux
 * SELECT DISTINCT, dont un parcours complet de sepa_participants, soit un
 * temps synchrone plusieurs fois supérieur à celui de la réponse sur une base
 * complète. Elle n'est figée que lorsque les trois sondes qu'elle lit ont
 * tranché : une sonde qui a échoué n'est pas mémorisée (voir
 * complianceTableLoaded), et figer une chaîne amputée par un échec passager la
 * servirait jusqu'au redémarrage. Effacée par closeComplianceDB().
 */
export function loadedComplianceSources(): string | null {
  if (_sourcesMemo !== undefined) return _sourcesMemo;
  const parts = [...loadedSanctionsLists()];
  if (complianceTableLoaded('fatf_countries')) parts.push('FATF');
  if (complianceTableLoaded('sepa_participants')) {
    const schemes = getComplianceDB()
      .prepare('SELECT DISTINCT scheme FROM sepa_participants ORDER BY scheme')
      .all() as Array<{ scheme: string }>;
    for (const r of schemes) parts.push(`EPC-${r.scheme}`);
  }
  const sources = parts.length > 0 ? parts.join(',') : null;
  const decided = (['sanctioned_entities', 'fatf_countries', 'sepa_participants'] as const).every(
    (t) => _tableLoaded.has(t),
  );
  if (decided) _sourcesMemo = sources;
  return sources;
}

export interface ComplianceMeta {
  /** Scope of the sanctions screening — bank (BIC8) level only, never the beneficiary. */
  scope: 'bank_bic_only';
  /** Plain-language limitation, surfaced in every compliance response. */
  disclaimer: string;
  /** ISO timestamp of the last compliance-data refresh (null if unknown). */
  sanctions_as_of: string | null;
  /** Year-month (YYYY-MM) of the FATF plenary the lists reflect (null if unknown). */
  fatf_as_of: string | null;
  /** Comma-separated data sources (null if unknown). */
  sources: string | null;
  /**
   * Year-month the editorial country-risk axis was last reviewed.
   *
   * `risk_indicators.country_risk` is NOT a restatement of `fatf_status`: it is
   * a separate, broader AML picture (offshore centres, conflict zones,
   * EBA-flagged jurisdictions) that stacks on top of the FATF signal. The two
   * can therefore disagree on a given country by design. Both now carry a date
   * so a caller can tell a considered difference from a stale list.
   */
  country_risk_as_of: string;
  /** One line naming the two axes, so the disagreement is never read as a bug. */
  country_risk_scope: string;
}

const DISCLAIMER =
  'Informational triage only — NOT a regulated AML/CFT product. Sanctions screening ' +
  'is performed at the BANK (BIC8) level: it flags the holding institution, NOT the ' +
  'beneficiary / account-holder name. Most sanctions designations target persons and ' +
  'companies, which this does not screen. Use a regulated provider (Refinitiv, ' +
  'ComplyAdvantage, etc.) for name-level KYC/AML obligations.';

let _metaStmt: DatabaseType.Statement | null = null;

/**
 * Read the compliance dataset metadata (refresh date, FATF as-of, sources) and
 * pair it with the fixed scope + disclaimer. Returned on every compliance
 * response so an agent can see the freshness AND the limits of the signal.
 * Never throws: on any error it returns the static scope/disclaimer with null
 * freshness fields.
 */
export function getComplianceMeta(): ComplianceMeta {
  const base: ComplianceMeta = {
    scope: 'bank_bic_only',
    disclaimer: DISCLAIMER,
    sanctions_as_of: null,
    fatf_as_of: null,
    sources: null,
    country_risk_as_of: COUNTRY_RISK_AS_OF,
    country_risk_scope:
      'risk_indicators.country_risk is a separate editorial AML axis (offshore centres, conflict zones, EBA-flagged jurisdictions) layered ON TOP of compliance.sanctions.fatf_status, not a restatement of it. The two can disagree on a country by design; each carries its own review date.',
  };
  try {
    const db = getComplianceDB();
    if (!_metaStmt) _metaStmt = db.prepare('SELECT key, value FROM metadata');
    const rows = _metaStmt.all() as Array<{ key: string; value: string }>;
    const map = new Map(rows.map((r) => [r.key, r.value]));
    return {
      ...base,
      sanctions_as_of: map.get('last_refresh') ?? null,
      // Pas de date pour une liste GAFI que `sources` ne nomme pas.
      fatf_as_of: complianceTableLoaded('fatf_countries') ? (map.get('fatf_as_of') ?? null) : null,
      // Calculé sur les lignes, pas relu dans la clé `sources` : voir
      // loadedComplianceSources().
      sources: loadedComplianceSources(),
    };
  } catch {
    return base;
  }
}
