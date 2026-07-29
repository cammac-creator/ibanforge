import type { IBANValidationResult } from '../types.js';

/**
 * What an agent should do next, derived from THIS result.
 *
 * ## Why the API says this at all
 *
 * A validation result is consumed inside a chain: something handed us an IBAN
 * and something downstream is about to move money. The fields already say what
 * we found, but the consequence is left to the caller to infer, and the
 * inference is exactly where the mistakes are. `bank_code_check.authoritative`
 * is the difference between "stop" and "carry on and verify the name", and an
 * agent that reads only `valid` will get both wrong.
 *
 * ## What it is not
 *
 * It is not a place to advertise. Every step is conditional on the result and
 * carries the field that produced it in `because`, so a caller can audit the
 * advice instead of trusting it. A step that would fire on every response would
 * be noise, and noise is what makes agents stop reading the field.
 *
 * ## Shape, and why it is a list rather than the map used by /v1/feedback
 *
 * `feedback.ts` returns a fixed pair of links, so a map reads fine there. Here
 * the entries are conditional and their ORDER carries meaning: what blocks a
 * payment comes before what merely enriches it. A map has no order and nowhere
 * to put the evidence.
 */
export interface NextStep {
  /** Stable machine-readable identifier. Branch on this, not on the prose. */
  code: string;
  /** What to do, in one sentence an agent can relay to a person. */
  do: string;
  /** The field of this response that produced the step, so the advice is auditable. */
  because: string;
  /** An IBANforge call that performs the step, when one exists. */
  action?: string;
}

const COMPLIANCE_ACTION = 'POST /v1/iban/compliance';

export function nextSteps(result: IBANValidationResult): NextStep[] {
  if (!result.valid) return [];

  const steps: NextStep[] = [];
  const check = result.bank_code_check;
  const issuer = result.issuer;

  // 1. Blocking first. The register denying a code is the only case where a
  //    caller may act on non-existence, and it must not be softened into the
  //    "verify the name" advice given everywhere else.
  if (check?.status === 'not_in_register' && check.authoritative) {
    steps.push({
      code: 'bank_code_not_allocated',
      do: 'Do not send. The bank code is absent from the national register, so no institution holds this account.',
      because: `bank_code_check.status is not_in_register and authoritative is true (${check.register ?? 'national register'})`,
    });
  } else if (check && check.status !== 'verified') {
    steps.push({
      code: 'verify_payee_name',
      do: 'Treat this as unavailable rather than invalid, and let a beneficiary name check decide before releasing funds.',
      because:
        `bank_code_check.status is ${check.status} with authoritative false, ` +
        'so the bank code is absent from our reference data, not proven absent from the country',
    });
  }

  // 2. Qualify an answer we did give, when we gave it on a heuristic.
  if (check?.match === 'prefix' && (check.candidates ?? 0) > 1) {
    steps.push({
      code: 'bic_is_advisory',
      do: 'Do not settle against this BIC. Confirm it with the beneficiary or your bank first.',
      because: `bank_code_check.match is prefix and matched ${check.candidates} institutions`,
    });
  }

  if (result.risk_indicators?.test_bic) {
    steps.push({
      code: 'test_bic',
      do: 'Stop unless this is a sandbox run. The resolved BIC is a test code, not a live institution.',
      because: 'risk_indicators.test_bic is true (ISO 9362 location code ends in 0)',
    });
  }

  // 3. Population signals. Only on a curated identification: 'bank' is the
  //    fallback for 97.9% of BIC8, so reading a default as "not an EMI" would
  //    be the overclaim that issuer.classification exists to prevent.
  if (issuer?.classification === 'curated' && issuer.type !== 'bank') {
    steps.push({
      code: 'expect_virtual_iban',
      do: 'Expect a virtual IBAN. Account holder and IBAN holder often differ here, so weight the name check accordingly.',
      because: `issuer.type is ${issuer.type} from a curated identification, not the bank default`,
    });
  }

  // 4. Ours to offer, and only once the account itself is not in doubt.
  if (check?.status === 'verified') {
    steps.push({
      code: 'screen_compliance',
      do: 'Screen the institution against sanctions, FATF status and VoP reachability before the transfer.',
      because: 'bank_code_check.status is verified, so there is an institution to screen',
      action: COMPLIANCE_ACTION,
    });
  }

  return steps;
}
