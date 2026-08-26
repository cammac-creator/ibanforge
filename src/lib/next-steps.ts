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
  /** The call that performs the step, when one exists: an IBANforge endpoint, or the partner site for a partner handoff. */
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

  // A GB pair the owning institution could not have issued. Blocking, and on the
  // same footing as an unallocated bank code: both say the destination cannot
  // exist, rather than that we failed to find it. The IBAN's own check digits
  // pass in this case, which is exactly why it is worth saying out loud.
  if (result.modulus_check?.passed === false) {
    steps.push({
      code: 'modulus_check_failed',
      do: 'Do not send. The account number fails the UK checksum for this sorting code, so the pair cannot be a real account. Ask the beneficiary to confirm both.',
      because: 'modulus_check.passed is false against the Vocalink modulus weight table',
    });
  }

  // The code is allocated and being withdrawn. Not a reason to stop, a reason to
  // update the beneficiary before the transition period ends. This is the
  // merged-bank case, which only a national register can answer.
  if (check?.retired) {
    steps.push({
      code: 'bank_code_retired',
      do: check.superseded_by
        ? `Update the beneficiary details. The register is retiring this bank code; ${check.superseded_by} takes over.`
        : 'Update the beneficiary details. The register is retiring this bank code and names no successor.',
      because: `bank_code_check.retired is true in ${check.register ?? 'the national register'}`,
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

  // 3. Population signals. Only on an identification — 'bank' is the fallback
  //    for 97.9% of BIC8, so reading a default as "not an EMI" would be the
  //    overclaim that issuer.classification exists to prevent.
  //
  //    `register` counts alongside `curated`: it means an official register
  //    names the holder of this bank code and says what it is, which is the
  //    same kind of finding as a hand-verified BIC8 pairing and carries a date
  //    and an authority on top. Leaving it out would have ingested the EBA
  //    register and then withheld the one signal it exists to produce.
  if ((issuer?.classification === 'curated' || issuer?.classification === 'register') && issuer.type !== 'bank') {
    steps.push({
      code: 'expect_virtual_iban',
      do: 'Expect a virtual IBAN. Account holder and IBAN holder often differ here, so weight the name check accordingly.',
      because: `issuer.type is ${issuer.type} from a ${issuer.classification === 'register' ? 'register' : 'curated'} identification, not the bank default`,
    });
  }

  // 3b. The bank code resolved, but the country's own list of IBAN-issuing
  //     providers does not name its holder. Measured 29/07/2026, only 90 of our
  //     815 Dutch keys are on that list; the rest resolve to corporate
  //     treasuries that hold a Dutch BIC for their own SWIFT traffic and issue
  //     no IBANs at all. Not a denial, since the list is not exhaustive, but a
  //     resolved BIC is no longer allowed to pass for a confirmed bank.
  if (issuer?.iban_issuer === 'not_listed') {
    steps.push({
      code: 'issuer_not_a_known_iban_issuer',
      do:
        'Do not treat this as a confirmed bank. The code resolves to a BIC, but its holder is not among the providers known to issue IBANs in this country, so the account may not exist. Verify the payee by name before sending.',
      because: 'issuer.iban_issuer is not_listed, so the BIC holder is not a known IBAN issuer',
    });
  }

  // 4. Ours to offer, and only once the account itself is not in doubt.
  if (check?.status === 'verified') {
    steps.push({
      code: 'screen_compliance',
      do:
        'Screen the institution against sanctions, FATF status and VoP reachability before the transfer. ' +
        'That endpoint reads the same bank-code verdict as this one, so it will not score an unconfirmed code as an ordinary bank.',
      because: 'bank_code_check.status is verified, so there is an institution to screen',
      action: COMPLIANCE_ACTION,
    });
  }

  // 5. A partner handoff, twice gated: on the result (a register-confirmed
  //    account in a SEPA country, outside CH/LI whose native QR-bill PayQR
  //    does not cover) and on PARTNER_PAYQR=1, because the two directions of
  //    the referral switch on together by agreement, not by deploy. The entry
  //    quotes the partner's own one-sentence description and both of its
  //    stated limits, so the advice stays as auditable as every other step.
  const country = result.country?.code;
  if (
    process.env.PARTNER_PAYQR === '1' &&
    check?.status === 'verified' &&
    result.sepa?.member &&
    country !== 'CH' &&
    country !== 'LI'
  ) {
    steps.push({
      code: 'generate_payment_qr',
      do:
        'To turn the confirmed account into a scannable payment, PayQR (npx -y @czagents/payqr, hosted MCP https://payqr.cz-agents.dev/mcp) generates and self-checks a European payment QR: SPAYD for CZ/SK accounts, EUR-only EPC/GiroCode for other SEPA accounts; EPC requires recipient_name. ' +
        'PayQR validates the IBAN checksum but does not verify account ownership or the beneficiary name, and it does not generate native Swiss QR-bills.',
      because: 'sepa.member is true and bank_code_check.status is verified',
      action: 'https://qr.cz-agents.dev',
    });
  }

  return steps;
}
