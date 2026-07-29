import type Database from 'better-sqlite3';
import { getComplianceDB } from './compliance-db.js';
import type { SanctionsCheck, ReachabilityCheck, VopCheck, ComplianceResult, ScoredRiskLevel } from '../types.js';

let _checkSanctionedCountry: Database.Statement | null = null;
let _checkSanctionedBank: Database.Statement | null = null;
let _checkFatf: Database.Statement | null = null;
let _checkReachability: Database.Statement | null = null;
let _checkVop: Database.Statement | null = null;

export function checkSanctions(countryCode: string, bic8: string | null): SanctionsCheck {
  const db = getComplianceDB();
  if (!_checkSanctionedCountry) _checkSanctionedCountry = db.prepare('SELECT sanction_type FROM sanctioned_countries WHERE country_code = ?');
  if (!_checkSanctionedBank) _checkSanctionedBank = db.prepare('SELECT source_list FROM sanctioned_entities WHERE bic8 = ?');
  if (!_checkFatf) _checkFatf = db.prepare('SELECT status FROM fatf_countries WHERE country_code = ?');

  const countrySanction = _checkSanctionedCountry.get(countryCode) as { sanction_type: string } | undefined;
  const bankSanctions = bic8 ? (_checkSanctionedBank.all(bic8) as { source_list: string }[]) : [];
  const fatfRow = _checkFatf.get(countryCode) as { status: string } | undefined;

  return {
    country_sanctioned: !!countrySanction,
    bank_sanctioned: bankSanctions.length > 0,
    matched_lists: bankSanctions.map(r => r.source_list),
    fatf_status: (fatfRow?.status as SanctionsCheck['fatf_status']) ?? 'non_member',
  };
}

export function checkReachability(bic8: string | null): ReachabilityCheck {
  if (!bic8) return { sepa_instant: false, sct: false, sdd: false };
  const db = getComplianceDB();
  if (!_checkReachability) _checkReachability = db.prepare('SELECT scheme FROM sepa_participants WHERE bic8 = ?');
  const rows = _checkReachability.all(bic8) as { scheme: string }[];
  const schemes = new Set(rows.map(r => r.scheme));
  return { sepa_instant: schemes.has('SCT_INST'), sct: schemes.has('SCT'), sdd: schemes.has('SDD') };
}

export function checkVop(bic8: string | null): VopCheck {
  if (!bic8) return { participant: false, status: 'not_found' };
  const db = getComplianceDB();
  if (!_checkVop) _checkVop = db.prepare('SELECT status FROM vop_participants WHERE bic8 = ?');
  const row = _checkVop.get(bic8) as { status: string } | undefined;
  return { participant: !!row, status: (row?.status as VopCheck['status']) ?? 'not_found' };
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
export type BankCodeConfidence = 'confirmed' | 'unverified' | 'denied';

export function calculateRiskScore(
  sanctions: SanctionsCheck,
  reachability: ReachabilityCheck,
  vop: VopCheck,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
  bankCode: BankCodeConfidence = 'confirmed',
): { risk_score: number; risk_level: ScoredRiskLevel; flags: string[] } {
  let score = 0;
  const flags: string[] = [];

  if (sanctions.country_sanctioned) { score += 50; flags.push('sanctioned_country'); }
  if (sanctions.bank_sanctioned) { score += 50; flags.push('sanctioned_bank'); }
  if (sanctions.fatf_status === 'black_list') { score += 30; flags.push('fatf_black_list'); }
  if (sanctions.fatf_status === 'grey_list') { score += 20; flags.push('fatf_grey_list'); }
  // A SUSPENDED membership (RU since Feb 2023) is a disciplinary signal, not
  // mere non-membership — weight it (and flag it) so it scores at least as
  // severely as non_member (which carries 0, see note below).
  if (sanctions.fatf_status === 'suspended') { score += 10; flags.push('fatf_suspended'); }
  // NOTE: there is intentionally NO weight for fatf_status === 'non_member'.
  // FATF has ~40 members; non-membership says nothing about AML risk (most
  // SEPA countries — PL, CZ, MT, HR… — are not FATF members yet are low-risk).
  // A previous +10 weight here inflated the risk of ~13 standard EU/SEPA
  // countries from 'low' to 'medium'. Only grey/black list carry signal.
  if (issuerType === 'payment_institution') { score += 15; flags.push('payment_institution_issuer'); }
  if (issuerType === 'emi') { score += 10; flags.push('emi_issuer'); }
  if (countryRisk === 'high') { score += 20; flags.push('high_risk_country'); }
  if (countryRisk === 'elevated') { score += 10; flags.push('elevated_risk_country'); }
  if (isTestBic) { score += 30; flags.push('test_bic'); }
  // A register that denies the code outranks every soft signal below: there is
  // no institution to screen, so the screening result means nothing on its own.
  if (bankCode === 'denied') { score += 40; flags.push('bank_code_not_allocated'); }
  // We could not confirm it, which is not the same accusation. Enough to move
  // the level, not enough to pretend we know.
  if (bankCode === 'unverified') { score += 10; flags.push('bank_code_unverified'); }
  if (!reachability.sepa_instant) { score += 5; flags.push('no_sepa_instant'); }
  if (!vop.participant) { score += 5; flags.push('no_vop'); }

  score = Math.min(score, 100);
  const risk_level: ScoredRiskLevel =
    score >= 80 ? 'critical' :
    score >= 60 ? 'high' :
    score >= 40 ? 'elevated' :
    score >= 20 ? 'medium' :
    'low';

  return { risk_score: score, risk_level, flags };
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
    sanctions: { country_sanctioned: false, bank_sanctioned: false, matched_lists: [], fatf_status: 'non_member' },
    reachability: { sepa_instant: false, sct: false, sdd: false },
    vop: { participant: false, status: 'not_found' },
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
  const reachability = checkReachability(bic8);
  const vop = checkVop(bic8);
  const { risk_score, risk_level, flags } = calculateRiskScore(sanctions, reachability, vop, issuerType, countryRisk, isTestBic, bankCode);
  return { sanctions, reachability, vop, risk_score, risk_level, flags };
}

export function resetComplianceStatements(): void {
  _checkSanctionedCountry = null;
  _checkSanctionedBank = null;
  _checkFatf = null;
  _checkReachability = null;
  _checkVop = null;
}
