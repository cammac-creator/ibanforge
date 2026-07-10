import type Database from 'better-sqlite3';
import { getComplianceDB } from './compliance-db.js';
import type { SanctionsCheck, ReachabilityCheck, VopCheck, ComplianceResult, RiskLevel } from '../types.js';

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

export function calculateRiskScore(
  sanctions: SanctionsCheck,
  reachability: ReachabilityCheck,
  vop: VopCheck,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
): { risk_score: number; risk_level: RiskLevel; flags: string[] } {
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
  if (!reachability.sepa_instant) { score += 5; flags.push('no_sepa_instant'); }
  if (!vop.participant) { score += 5; flags.push('no_vop'); }

  score = Math.min(score, 100);
  const risk_level: RiskLevel =
    score >= 80 ? 'critical' :
    score >= 60 ? 'high' :
    score >= 40 ? 'elevated' :
    score >= 20 ? 'medium' :
    'low';

  return { risk_score: score, risk_level, flags };
}

export function buildComplianceResult(
  countryCode: string,
  bic8: string | null,
  issuerType: string,
  countryRisk: string,
  isTestBic: boolean,
): ComplianceResult {
  const sanctions = checkSanctions(countryCode, bic8);
  const reachability = checkReachability(bic8);
  const vop = checkVop(bic8);
  const { risk_score, risk_level, flags } = calculateRiskScore(sanctions, reachability, vop, issuerType, countryRisk, isTestBic);
  return { sanctions, reachability, vop, risk_score, risk_level, flags };
}

export function resetComplianceStatements(): void {
  _checkSanctionedCountry = null;
  _checkSanctionedBank = null;
  _checkFatf = null;
  _checkReachability = null;
  _checkVop = null;
}
