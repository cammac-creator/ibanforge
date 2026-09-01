/**
 * journey-builder — the honesty core of the village.
 *
 * Input: the JSON served by POST /v1/iban/validate (via the playground relay),
 * verbatim. Output: the ordered list of stations the request really went
 * through, with the outcome each stage really produced. Pure and
 * deterministic: replaying the same response yields the same film, which is
 * what makes this mapping testable (journey.test.ts pins it against saved
 * /v1/demo payloads).
 *
 * Editorial rule: a step may only exist here if the response proves the
 * pipeline ran it. The one liberty taken is pacing (the on-screen slow-down),
 * never the route.
 */

export type StationId =
  | 'gate' | 'scribe' | 'cutter' | 'library' | 'registry'
  | 'six' | 'court' | 'classifier' | 'border' | 'tower' | 'forge' | 'exit';

export type StepOutcome = 'ok' | 'warn' | 'fail' | 'info';

export interface JourneyStep {
  station: StationId;
  /** i18n leaf under live.steps.* — defaults to the station name. */
  key: string;
  outcome: StepOutcome;
  params?: Record<string, string | number | boolean | null>;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function buildJourney(response: Rec): JourneyStep[] {
  const steps: JourneyStep[] = [];
  const cost = typeof response.cost_usdc === 'number' ? response.cost_usdc : null;

  steps.push({
    station: 'gate', key: 'gate', outcome: 'ok',
    params: { paid: cost !== null && cost > 0, cost: cost ?? 0 },
  });

  if (response.valid !== true) {
    steps.push({
      station: 'scribe', key: 'scribe', outcome: 'fail',
      params: { reason: str(response.error) ?? 'unknown' },
    });
    steps.push({ station: 'exit', key: 'exit', outcome: 'fail', params: {} });
    return steps;
  }

  const country = rec(response.country);
  const bban = rec(response.bban);
  const bic = rec(response.bic);
  const check = rec(response.bank_code_check);
  const clearing = rec(response.clearing);
  const modulus = rec(response.modulus_check);
  const pra = rec(response.pra_authorisation);
  const issuer = rec(response.issuer);
  const sepa = rec(response.sepa);
  const cc = country ? str(country.code) : null;

  steps.push({ station: 'scribe', key: 'scribe', outcome: 'ok', params: { cc } });

  if (bban) {
    steps.push({
      station: 'cutter', key: 'cutter', outcome: 'ok',
      params: {
        bankCode: str(bban.bank_code),
        account: str(bban.account_number),
        branch: str(bban.branch_code),
      },
    });
    if (modulus && modulus.checked === true) {
      steps.push({
        station: 'cutter', key: 'modulus',
        outcome: modulus.passed === true ? 'ok' : 'warn',
        params: { passed: modulus.passed === true, source: str(modulus.source) },
      });
    }
  }

  steps.push({
    station: 'library', key: 'library', outcome: bic ? 'ok' : 'warn',
    params: bic
      ? { found: true, source: str(bic.source), basis: str(bic.basis) }
      : { found: false },
  });

  if (bic && str(bic.basis) === 'national_register') {
    steps.push({
      station: 'registry', key: 'registry', outcome: 'ok',
      params: { cc, register: str(bic.source), bic: str(bic.code) },
    });
  }

  if (clearing) {
    steps.push({
      station: 'six', key: 'six', outcome: 'ok',
      params: {
        name: str(clearing.name), iid: str(clearing.iid),
        sic: clearing.sic === true, qrIid: str(clearing.qr_iid),
      },
    });
  }

  if (check) {
    const status = str(check.status) ?? 'unavailable';
    steps.push({
      station: 'court', key: 'court',
      outcome: status === 'verified' ? 'ok' : 'warn',
      params: {
        status,
        authoritative: check.authoritative === true,
        register: str(check.register),
      },
    });
  }

  if (pra) {
    steps.push({
      station: 'court', key: 'pra',
      outcome: pra.authorised === true ? 'ok' : 'warn',
      params: { authorised: pra.authorised === true, firm: str(pra.firm_name) },
    });
  }

  if (issuer) {
    steps.push({
      station: 'classifier', key: 'classifier', outcome: 'ok',
      params: { type: str(issuer.type), name: str(issuer.name) },
    });
  }

  if (sepa) {
    steps.push({
      station: 'border', key: 'border', outcome: 'ok',
      params: {
        sepa: sepa.member === true,
        vopRequired: sepa.vop_required === true,
        vopParticipant: sepa.vop_participant === true,
      },
    });
  }

  const compliance = rec(response.compliance);
  if (compliance) {
    const sanctions = rec(compliance.sanctions);
    const level = str(compliance.risk_level) ?? 'unknown';
    const sanctioned =
      sanctions?.country_sanctioned === true || sanctions?.bank_sanctioned === true;
    steps.push({
      station: 'tower', key: 'tower',
      outcome: sanctioned || level === 'high' ? 'fail' : level === 'low' ? 'ok' : 'warn',
      params: {
        sanctioned,
        fatf: sanctions ? str(sanctions.fatf_status) : null,
        score: typeof compliance.risk_score === 'number' ? compliance.risk_score : null,
        level,
      },
    });
  }

  const ms = typeof response.processing_ms === 'number' ? response.processing_ms : null;
  steps.push({
    station: 'forge', key: 'forge', outcome: 'ok',
    params: { valid: true, bic: bic ? str(bic.code) : null, ms },
  });
  steps.push({ station: 'exit', key: 'exit', outcome: 'ok', params: { ms } });
  return steps;
}
