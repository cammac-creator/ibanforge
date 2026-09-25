import type Database from 'better-sqlite3';
import {
  complianceTableLoaded,
  getComplianceDB,
  unscreenedSanctionsLists,
} from './compliance-db.js';
import { getSepaInfo } from './countries.js';
import { resetTraceIndex } from './bic-trace.js';
import type {
  SanctionsCheck,
  ReachabilityCheck,
  VopCheck,
  ComplianceResult,
  ScoredRiskLevel,
} from '../types.js';

let _checkSanctionedCountry: Database.Statement | null = null;
let _checkSanctionedBank: Database.Statement | null = null;
let _checkFatf: Database.Statement | null = null;
let _checkReachability: Database.Statement | null = null;
let _checkVop: Database.Statement | null = null;

export function checkSanctions(countryCode: string, bic8: string | null): SanctionsCheck {
  const db = getComplianceDB();
  if (!_checkSanctionedCountry)
    _checkSanctionedCountry = db.prepare(
      'SELECT sanction_type FROM sanctioned_countries WHERE country_code = ?',
    );
  if (!_checkFatf)
    _checkFatf = db.prepare('SELECT status FROM fatf_countries WHERE country_code = ?');

  const countrySanction = _checkSanctionedCountry.get(countryCode) as
    { sanction_type: string } | undefined;
  const fatfRow = _checkFatf.get(countryCode) as { status: string } | undefined;

  // L'axe banque, seulement quand il y a une banque ET une liste à consulter
  // (25/09/2026). Sans liste chargée, sauter cette seule recherche : les axes
  // pays et GAFI ont leurs propres tables et répondent quand même. Tout faire
  // tomber dans le repli « base illisible » disait `country_sanctioned: false`
  // sur des tables lues, et une banque résolue d'un pays sanctionné passait de
  // critical à elevated. La requête n'est préparée qu'ici, après la sonde :
  // préparée sans condition, une table supprimée faisait lever même un IBAN
  // sans banque résolue.
  const bankScreened = bic8 !== null && complianceTableLoaded('sanctioned_entities');
  let bankSanctions: { source_list: string }[] = [];
  if (bankScreened) {
    if (!_checkSanctionedBank)
      _checkSanctionedBank = db.prepare(
        'SELECT source_list FROM sanctioned_entities WHERE bic8 = ?',
      );
    bankSanctions = _checkSanctionedBank.all(bic8) as { source_list: string }[];
  }

  return {
    country_sanctioned: !!countrySanction,
    bank_sanctioned: bankSanctions.length > 0,
    matched_lists: bankSanctions.map((r) => r.source_list),
    fatf_status: (fatfRow?.status as SanctionsCheck['fatf_status']) ?? 'non_member',
    // The country and FATF axes answered; the bank axis only did if there was a
    // bank to ask about. See the field note in types.ts.
    bank_screened: bankScreened,
  };
}

/**
 * The bank axis of the sanctions screen, on its own, for a caller that has a
 * BIC rather than an IBAN.
 *
 * Kept separate from checkSanctions() because that one also answers about the
 * COUNTRY, and a BIC lookup has no business asserting country-level sanctions
 * or a FATF status — the caller asked about an institution.
 *
 * `listed: null` when the compliance database could not be consulted. A
 * sanctions screen that fails must never read as "clean": that is the whole
 * defect this file spent 21/08/2026 removing, and re-introducing it on a
 * cheaper endpoint would be no better.
 */
export interface BicSanctionsScreen {
  /** False when the sanctions database could not be read. Nothing below counts. */
  screened: boolean;
  /**
   * Null when `screened` is false — never `false`, which would be a claim.
   * Null aussi (25/09/2026) quand rien ne correspond sur les listes lues alors
   * qu'une liste promise manque (`unscreened_lists`) : un « non » sur l'UE et
   * l'OFAC n'est pas un « non » sur l'ONU.
   */
  listed: boolean | null;
  matched_lists: string[];
  /**
   * Les listes que chaque surface nomme et que ce déploiement n'a pas chargées.
   * Présent seulement quand il en manque une : absent, toutes ont été lues.
   */
  unscreened_lists?: string[];
}

export function screenBicSanctions(bic8: string): BicSanctionsScreen {
  // Aucune liste chargée, c'est la même nouvelle qu'une base illisible : rien
  // n'a été consulté, donc rien ci-dessous ne peut se lire « propre ».
  if (!complianceTableLoaded('sanctioned_entities')) {
    return { screened: false, listed: null, matched_lists: [] };
  }
  try {
    const db = getComplianceDB();
    if (!_checkSanctionedBank)
      _checkSanctionedBank = db.prepare(
        'SELECT source_list FROM sanctioned_entities WHERE bic8 = ?',
      );
    const rows = _checkSanctionedBank.all(bic8) as { source_list: string }[];
    // Une liste promise absente (l'ONU sans sa surcouche privée) : une
    // correspondance ailleurs reste un « oui » ferme, mais aucune correspondance
    // ne vaut plus « non » (voir unscreenedSanctionsLists).
    const unscreened = unscreenedSanctionsLists();
    return {
      screened: true,
      listed: rows.length > 0 ? true : unscreened.length > 0 ? null : false,
      matched_lists: rows.map((r) => r.source_list),
      ...(unscreened.length > 0 ? { unscreened_lists: unscreened } : {}),
    };
  } catch {
    return { screened: false, listed: null, matched_lists: [] };
  }
}

/**
 * Territoires de la zone géographique SEPA que getSepaInfo() ne compte pas
 * comme membres, alors que le registre EPC porte leurs banques (vérifié le
 * 25/09/2026 : GG, GP, JE, MQ et RE y figurent). Les départements et
 * collectivités d'outre-mer français, Jersey, Guernesey, l'île de Man et Åland.
 */
const SEPA_SCOPE_TERRITORIES = new Set([
  'AX',
  'BL',
  'GF',
  'GG',
  'GP',
  'IM',
  'JE',
  'MF',
  'MQ',
  'PM',
  'RE',
  'YT',
]);

/**
 * Le pays est-il hors de la zone SEPA, si bien que la réponse ne dépend pas du
 * registre EPC ?
 *
 * Aucune banque d'un tel pays ne peut figurer dans les registres des schémas :
 * « pas de SEPA Instant, pas de VoP » y est un constat tiré du pays, registre
 * chargé ou non. Faux pour un pays inconnu (pas de pays, pas de constat).
 */
function outsideSepaScope(countryCode: string | undefined): boolean {
  if (!countryCode) return false;
  return !getSepaInfo(countryCode).member && !SEPA_SCOPE_TERRITORIES.has(countryCode);
}

/**
 * @param countryCode Le pays qui décide si le registre est nécessaire : celui
 *   de l'IBAN sur le chemin IBAN, celui du BIC sur le chemin BIC. Facultatif :
 *   sans lui, un registre absent donne toujours « non consulté ».
 */
export function checkReachability(bic8: string | null, countryCode?: string): ReachabilityCheck {
  if (!bic8) return { sepa_instant: false, sct: false, sdd: false, screened: false };
  // Un registre EPC qui n'est pas chargé n'a pas été consulté. Répondre
  // `screened: true` ici disait « non joignable » de toutes les banques, et
  // ajoutait 5 à leur score de risque, sur une table simplement absente. Hors
  // de la zone SEPA, en revanche, le pays suffit : la réponse reste celle
  // d'une base complète, avec ou sans registre.
  if (!complianceTableLoaded('sepa_participants')) {
    return {
      sepa_instant: false,
      sct: false,
      sdd: false,
      screened: outsideSepaScope(countryCode),
    };
  }
  const db = getComplianceDB();
  if (!_checkReachability)
    _checkReachability = db.prepare('SELECT scheme FROM sepa_participants WHERE bic8 = ?');
  const rows = _checkReachability.all(bic8) as { scheme: string }[];
  const schemes = new Set(rows.map((r) => r.scheme));
  return {
    sepa_instant: schemes.has('SCT_INST'),
    sct: schemes.has('SCT'),
    sdd: schemes.has('SDD'),
    screened: true,
  };
}

export function checkVop(bic8: string | null, countryCode?: string): VopCheck {
  if (!bic8) return { participant: false, status: 'not_found', screened: false };
  // Même règle que checkReachability : pas de registre VoP chargé, pas de
  // réponse VoP, sauf hors de la zone SEPA où le pays répond.
  if (!complianceTableLoaded('vop_participants')) {
    return { participant: false, status: 'not_found', screened: outsideSepaScope(countryCode) };
  }
  const db = getComplianceDB();
  if (!_checkVop) _checkVop = db.prepare('SELECT status FROM vop_participants WHERE bic8 = ?');
  const row = _checkVop.get(bic8) as { status: string } | undefined;
  const status = (row?.status as VopCheck['status']) ?? 'not_found';
  // `participant` answers "does this bank answer VoP requests today", so only
  // an active registration counts. The register also publishes institutions
  // "Pending EDS registration"; they are carried with that status rather than
  // omitted, but reporting them as participants would tell a payer a name check
  // is available before it is.
  return { participant: status === 'active', status, screened: true };
}

/**
 * How much the bank code itself could be confirmed, which the score used to
 * ignore entirely.
 *
 * A pilot customer put it precisely: next_steps routed a caller from the endpoint that
 * had stopped guessing to the one that still did, without telling them. An
 * unresolved bank code scored as an ordinary bank, which is 0 added risk, so a
 * fabricated Bankleitzahl and Commerzbank came out the same.
 *
 * The two states are weighted differently on purpose. `denied` is a national
 * register saying the code is not allocated, which is a fact. `unverified` is
 * our composite map not carrying it, which is an absence of knowledge. Scoring
 * them the same would repeat, inside the score, exactly the collapse that
 * bank_code_check exists to undo.
 */
export type BankCodeConfidence = 'confirmed' | 'inferred' | 'unverified' | 'denied';

/** Le score minimal d'une banque résolue qu'aucune liste de sanctions n'a pu contrôler. */
export const SANCTIONS_LISTS_UNAVAILABLE_FLOOR = 50;

export function calculateRiskScore(
  sanctions: SanctionsCheck,
  reachability: ReachabilityCheck,
  vop: VopCheck,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
  bankCode: BankCodeConfidence = 'confirmed',
  /**
   * Une banque a-t-elle été résolue (un BIC8 était en main) ? Par défaut, ce
   * que dit `bank_screened`, qui n'est plus la même chose depuis le
   * 25/09/2026 : une banque résolue n'est pas passée aux listes quand aucune
   * liste n'est chargée. buildComplianceResult() passe la valeur exacte.
   */
  bankResolved: boolean = sanctions.bank_screened,
  /**
   * Les listes promises que la base servie ne porte pas (voir
   * unscreenedSanctionsLists) : un drapeau sans poids par liste, quand une
   * banque a été passée aux listes chargées.
   */
  unscreenedLists: readonly string[] = [],
): { risk_score: number; risk_level: ScoredRiskLevel; flags: string[] } {
  let score = 0;
  const flags: string[] = [];
  // Une banque résolue, et aucune liste de sanctions chargée pour la contrôler.
  const sanctionsListsUnavailable = bankResolved && !sanctions.bank_screened;

  if (sanctions.country_sanctioned) {
    score += 50;
    flags.push('sanctioned_country');
  }
  // 80, not 50: a DIRECT designation of the bank is the gravest single fact
  // this endpoint can establish, and 80 is the 'critical' floor. At 50, a
  // designated bank in a clean country peaked at 60 ('high') while a
  // NONEXISTENT test BIC in a grey-list country scored 70 — the score ranked
  // an OFAC-designated bank below a bank that does not exist, and a client
  // whose hard-block policy was keyed on 'critical' would wave the designated
  // bank through to manual review.
  if (sanctions.bank_sanctioned) {
    score += 80;
    flags.push('sanctioned_bank');
  }
  if (sanctions.fatf_status === 'black_list') {
    score += 30;
    flags.push('fatf_black_list');
  }
  if (sanctions.fatf_status === 'grey_list') {
    score += 20;
    flags.push('fatf_grey_list');
  }
  // A SUSPENDED membership (RU since Feb 2023) is a disciplinary signal, not
  // mere non-membership — weight it (and flag it) so it scores at least as
  // severely as non_member (which carries 0, see note below).
  if (sanctions.fatf_status === 'suspended') {
    score += 10;
    flags.push('fatf_suspended');
  }
  // NOTE: there is intentionally NO weight for fatf_status === 'non_member'.
  // FATF has ~40 members; non-membership says nothing about AML risk (most
  // SEPA countries — PL, CZ, MT, HR… — are not FATF members yet are low-risk).
  // A previous +10 weight here inflated the risk of ~13 standard EU/SEPA
  // countries from 'low' to 'medium'. Only grey/black list carry signal.
  if (issuerType === 'payment_institution') {
    score += 15;
    flags.push('payment_institution_issuer');
  }
  if (issuerType === 'emi') {
    score += 10;
    flags.push('emi_issuer');
  }
  if (countryRisk === 'high') {
    score += 20;
    flags.push('high_risk_country');
  }
  if (countryRisk === 'elevated') {
    score += 10;
    flags.push('elevated_risk_country');
  }
  if (isTestBic) {
    score += 30;
    flags.push('test_bic');
  }
  // A register that denies the code outranks every soft signal below: there is
  // no institution to screen, so the screening result means nothing on its own.
  if (bankCode === 'denied') {
    score += 40;
    flags.push('bank_code_not_allocated');
  }
  // We could not confirm it, which is not the same accusation. Enough to move
  // the level, not enough to pretend we know.
  if (bankCode === 'unverified') {
    score += 10;
    flags.push('bank_code_unverified');
  }
  // Une banque nommée d'après une source qui ne tranche pas (la carte composite,
  // le repli par préfixe) : `bank_code_holder` vaut `inferred`. SANS POIDS
  // (25/09/2026), même doctrine que `no_bank_resolved` : le drapeau dit ce que
  // vaut la réponse sans déplacer un seul score. Une banque déduite et une
  // banque confirmée pèsent encore pareil ; le drapeau est là pour qu'un
  // lecteur sache laquelle il a sous les yeux.
  if (bankCode === 'inferred') {
    flags.push('bank_code_inferred');
  }
  // The two reachability penalties below are only meaningful when a bank was
  // actually screened. With no resolved institution the EPC registers were
  // never queried, so `sepa_instant: false` and `participant: false` are
  // defaults, not findings — adding 10 points for them was scoring the absence
  // of a check as if it were the result of one. That is the same defect
  // `unassessableCompliance()` fixed for invalid IBANs, one layer down, and the
  // same doctrine as `issuer_type: null` and `authoritative: false`.
  //
  // `no_bank_resolved` carries no weight on purpose. The fact it names is
  // already scored, once, by `bank_code_unverified` (+10) or
  // `bank_code_not_allocated` (+40); a second weight for the same fact would be
  // double-counting, and inventing one merely to keep scores from moving would
  // reintroduce a number that means "we did not check".
  //
  // (25/09/2026) Qu'une banque ait été résolue se lit désormais dans
  // `bankResolved` (un BIC8 était en main), plus dans les deux champs
  // `screened` ni dans `bank_screened` : ceux-ci disent aussi « le registre ou
  // la liste n'est pas chargé », et une banque résolue ne doit pas être décrite
  // comme non résolue parce qu'une table manque.
  //
  // Un registre non chargé se note de la même façon, axe par axe et pour la
  // même raison : `sepa_register_unavailable` et `vop_register_unavailable` ne
  // pèsent rien, parce qu'ils décrivent ce que nous n'avons pas pu consulter,
  // pas la banque. Les noter, c'est ce qui faisait passer une banque ordinaire
  // de 0 à 10 sur une base sans les tables EPC. Hors de la zone SEPA, le pays
  // répond à la place du registre (`screened: true`) et les points restent.
  if (!bankResolved) {
    flags.push('no_bank_resolved');
  } else {
    if (!reachability.screened) {
      flags.push('sepa_register_unavailable');
    } else if (!reachability.sepa_instant) {
      score += 5;
      flags.push('no_sepa_instant');
    }
    if (!vop.screened) {
      flags.push('vop_register_unavailable');
    } else if (!vop.participant) {
      score += 5;
      flags.push('no_vop');
    }
  }

  // Une banque passée aux listes chargées, mais pas à toutes celles que le
  // service nomme : `bank_sanctioned: false` ne dit rien de la liste manquante.
  // Sans poids, comme les registres non chargés : il décrit ce que nous n'avons
  // pas lu, pas la banque (25/09/2026).
  if (bankResolved && sanctions.bank_screened) {
    for (const list of unscreenedLists)
      flags.push(`sanctions_list_unavailable_${list.toLowerCase()}`);
  }
  score = Math.min(score, 100);
  // Une banque résolue que nous n'avons pu passer à aucune liste : jamais
  // « low », jamais moins qu'elevated (50), comme le repli d'une base
  // illisible. Un plancher et non un poids : un risque déjà établi par le pays
  // ou le GAFI n'en est jamais diminué.
  if (sanctionsListsUnavailable) {
    flags.push('sanctions_lists_unavailable');
    score = Math.max(score, SANCTIONS_LISTS_UNAVAILABLE_FLOOR);
  }
  return { risk_score: score, risk_level: levelOf(score), flags };
}

/** Le niveau que porte un score. */
function levelOf(score: number): ScoredRiskLevel {
  return score >= 80
    ? 'critical'
    : score >= 60
      ? 'high'
      : score >= 40
        ? 'elevated'
        : score >= 20
          ? 'medium'
          : 'low';
}

/** Le score minimal d'une réponse dont une table de conformité n'a pas pu être lue. */
export const COMPLIANCE_DATA_UNAVAILABLE_FLOOR = 50;

/**
 * Le verdict quand une table de conformité est présente mais illisible (une
 * recherche a levé : schéma inattendu, page corrompue).
 *
 * Jusqu'au 25/09/2026, les deux appelants remplaçaient alors TOUT le verdict par
 * un bloc écrit en dur : `country_sanctioned: false`, `fatf_status:
 * 'non_member'`, 50. Un « non » sur des axes dont les tables se lisaient très
 * bien : une table VoP illisible suffisait à faire passer une banque
 * biélorusse de critical à elevated, pays sanctionné effacé.
 *
 * Désormais chaque axe est lu dans son propre try. Ce qui se lit répond ; ce
 * qui ne se lit pas répond « non consulté » (hors de la zone SEPA, le pays
 * répond pour SEPA et VoP, comme ailleurs). Le drapeau reste
 * `compliance_data_unavailable`, en tête, avec les drapeaux pondérés qui
 * expliquent le score ; les trois drapeaux « non chargé » s'effacent devant
 * lui, qui dit déjà que quelque chose n'a pas été lu. Le score ne descend
 * jamais sous 50, ni sous ce que les axes lus établissent.
 *
 * Si même les axes pays et GAFI ne se lisent pas, la réponse reste celle
 * d'avant (`country_sanctioned: false`, `non_member`) : le contrat n'a pas de
 * valeur « non consulté » pour ces deux champs.
 */
export function unreadableComplianceResult(
  countryCode: string,
  bic8: string | null,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
  bankCode: BankCodeConfidence = 'confirmed',
): ComplianceResult {
  const attempt = <T>(...tries: Array<() => T>): T | null => {
    for (const t of tries) {
      try {
        return t();
      } catch {
        // L'axe suivant, ou « non consulté » : voir la note de la fonction.
      }
    }
    return null;
  };
  const sanctions: SanctionsCheck = attempt(
    () => checkSanctions(countryCode, bic8),
    () => checkSanctions(countryCode, null),
  ) ?? {
    country_sanctioned: false,
    bank_sanctioned: false,
    matched_lists: [],
    fatf_status: 'non_member',
    bank_screened: false,
  };
  const byCountry = bic8 !== null && outsideSepaScope(countryCode);
  const reachability: ReachabilityCheck = attempt(() => checkReachability(bic8, countryCode)) ?? {
    sepa_instant: false,
    sct: false,
    sdd: false,
    screened: byCountry,
  };
  const vop: VopCheck = attempt(() => checkVop(bic8, countryCode)) ?? {
    participant: false,
    status: 'not_found',
    screened: byCountry,
  };
  const scored = calculateRiskScore(
    sanctions,
    reachability,
    vop,
    issuerType,
    countryRisk,
    isTestBic,
    bankCode,
    bic8 !== null,
    attempt(() => unscreenedSanctionsLists()) ?? [],
  );
  const NOT_LOADED = new Set([
    'sanctions_lists_unavailable',
    'sepa_register_unavailable',
    'vop_register_unavailable',
  ]);
  const risk_score = Math.max(scored.risk_score, COMPLIANCE_DATA_UNAVAILABLE_FLOOR);
  return {
    sanctions,
    reachability,
    vop,
    risk_score,
    risk_level: levelOf(risk_score),
    flags: ['compliance_data_unavailable', ...scored.flags.filter((f) => !NOT_LOADED.has(f))],
  };
}

/**
 * The verdict for an IBAN that could not be validated.
 *
 * A factory rather than a shared constant: each caller gets its own object, so
 * one that attaches a field cannot corrupt the next. Exported because tests and
 * any future caller must assert against one definition — three call sites used
 * to assemble this block by hand and two had already drifted.
 *
 * Everything here reads as "nothing established", never as "nothing wrong".
 */
export function unassessableCompliance(): ComplianceResult {
  return {
    sanctions: {
      country_sanctioned: false,
      bank_sanctioned: false,
      matched_lists: [],
      fatf_status: 'non_member',
      bank_screened: false,
    },
    reachability: { sepa_instant: false, sct: false, sdd: false, screened: false },
    vop: { participant: false, status: 'not_found', screened: false },
    risk_score: null,
    risk_level: 'unassessable',
    flags: ['iban_invalid'],
  };
}

/**
 * `valid` is REQUIRED and comes first, deliberately.
 *
 * An optional `valid = true` would have compiled at every existing call site
 * and preserved the defect at any one the author forgot. Required means
 * TypeScript names each of the four callers. And it is a parameter rather than
 * a `countryCode === ''` test because that emptiness is an accident of how the
 * validator reports errors, not a contract: it happens to hold on all six
 * error paths today and nothing keeps it holding tomorrow.
 */
export function buildComplianceResult(
  valid: boolean,
  countryCode: string,
  bic8: string | null,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
  bankCode: BankCodeConfidence = 'confirmed',
): ComplianceResult {
  // Nothing to screen. Return before touching the database: the sanctions,
  // reachability and VoP lookups would all miss and their misses are what used
  // to be added up into a reassuring 10.
  if (!valid) return unassessableCompliance();
  const sanctions = checkSanctions(countryCode, bic8);
  // Le pays passé ici est celui de l'IBAN sur le chemin IBAN, celui du BIC sur
  // le chemin BIC : c'est lui qui dit si la réponse SEPA dépend du registre.
  const reachability = checkReachability(bic8, countryCode);
  const vop = checkVop(bic8, countryCode);
  const { risk_score, risk_level, flags } = calculateRiskScore(
    sanctions,
    reachability,
    vop,
    issuerType,
    countryRisk,
    isTestBic,
    bankCode,
    bic8 !== null,
    unscreenedSanctionsLists(),
  );
  return { sanctions, reachability, vop, risk_score, risk_level, flags };
}

export function resetComplianceStatements(): void {
  _checkSanctionedCountry = null;
  _checkSanctionedBank = null;
  _checkFatf = null;
  _checkReachability = null;
  _checkVop = null;
  // Les registres EPC de cette base sont une source de trace (bic-trace.ts).
  resetTraceIndex();
}
