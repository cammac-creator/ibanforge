/**
 * The tool RESPONSES of the directory addresses (`/mcp/directory`,
 * `/mcp/chatgpt`), said as facts (24.10.2026).
 *
 * The descriptions of both addresses carry no direction to the model since
 * PR 433 (`src/mcp/directory.ts`). A review reads the answers too, and those
 * still spoke to the agent: `next_steps[].do` ("Do not send.", "Screen the
 * institution…"), the device-grant texts ("Tell your human…"), the QR-bill
 * steps ("Fix the creditor IBAN…"), the notes of a payment reference ("Pass
 * reference_type…"). Here each of them becomes a statement in the third
 * person: what the result establishes, what a rule says, what a field holds.
 * A rule stays a rule ("a QRR reference travels only with a QR-IBAN"), said as
 * a fact.
 *
 * 🚨 Only on these two addresses. The texts are produced in `src/lib/`, shared
 * with the REST API and `/mcp`, which keep them byte for byte. They are
 * rewritten on the way out, in one place: every tool callback of the two
 * addresses is wrapped (`src/routes/mcp-http.ts`) and its result goes through
 * `directoryResult`, `structuredContent` and every text block alike.
 *
 * Two mechanisms:
 *  - `next_steps[].do` is written per step `code` (and variant), from the
 *    result the step belongs to: a new code that reaches these addresses
 *    without a sentence here is caught by `src/routes/mcp-responses.test.ts`;
 *  - every other text is rewritten passage by passage
 *    (`DIRECTORY_RESPONSE_EDITS`): exact passages of the `/mcp` text, so a
 *    text changed at its source no longer matches, its old wording reaches the
 *    address, and the same test turns red on it.
 *
 * Kept verbatim, on purpose, each with its reason: `directoryVerbatimPassages`
 * below.
 *
 * Separate from `DIRECTORY_TEXT_EDITS` (the descriptions): that table is held
 * to "every passage is found in what `/mcp` serves in `tools/list`", which a
 * response text never is.
 */
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { DEVICE_TEXTS } from '../lib/device-grant.js';
import { GR_IMPORTANT_NOTE } from '../lib/gr-register.js';
import type { NextStep } from '../lib/next-steps.js';
import { COMBINED_ADDRESS_SOURCE } from '../lib/qr-bill-notice.js';
import { ANONYMOUS_MONTHLY_LIMIT, FREE_TIER_MONTHLY_LIMIT } from '../lib/tiers.js';

/** A passage of a response text and what these addresses say in its place. */
type ResponseEdit = readonly [string | RegExp, string];

/**
 * Every passage of a response text, other than a `next_steps[].do`, that
 * directs the reader, with its factual wording. Grouped by the module that
 * produces it. Order matters only where two passages overlap; none do.
 */
export const DIRECTORY_RESPONSE_EDITS: ReadonlyArray<ResponseEdit> = [
  // iban-core (the npm package `ibanforge`): `error_detail` of validate_iban.
  ['Check digits must be 2 digits (ISO 13616), got ', 'ISO 13616 check digits are 2 digits, got '],
  [/(BBAN structure mismatch for [A-Z]{2}: [^(]*?) must (?:be|match) /g, '$1 is specified as '],

  // src/routes/mcp-http.ts: lookup_ch_clearing on a malformed IID.
  ['IID must be a 1-5 digit number.', 'An IID is a 1-5 digit number, and this input is not one.'],

  // src/lib/swiss-qr-bill.ts: the findings, stated as what the standard requires.
  [
    'Country must be an ISO 3166-1 alpha-2 code, got "',
    'The standard requires an ISO 3166-1 alpha-2 country code, got "',
  ],
  [
    'PstCd and TwnNm must be empty for a combined (K) address; the postal code and town go into AdrLine2.',
    'In a combined (K) address PstCd and TwnNm stay empty, and the postal code and town belong in AdrLine2.',
  ],
  [
    'AdrTp is missing; it must be S (structured).',
    'AdrTp is missing; the standard requires S (structured).',
  ],
  [
    'AdrTp must be S (structured) or, historically, K; got "',
    'The standard requires AdrTp S (structured) or, historically, K; got "',
  ],
  [
    'Line 1 must be "SPC" (Swiss Payments Code), got "',
    'The standard requires line 1 to be "SPC" (Swiss Payments Code), got "',
  ],
  ['Line 2 must be "0200", got "', 'The standard requires line 2 to be "0200", got "'],
  [
    'Line 3 (coding type) must be "1" (UTF-8), got "',
    'The standard requires line 3 (coding type) to be "1" (UTF-8), got "',
  ],
  [
    'The creditor account must be a Swiss or Liechtenstein IBAN, got country ',
    'The standard requires a Swiss or Liechtenstein IBAN for the creditor account, got country ',
  ],
  [
    'The ultimate creditor block must stay empty; the field is reserved for future use.',
    'The standard requires the ultimate creditor block to stay empty; the field is reserved for future use.',
  ],
  [
    'Amount must be decimal with two places and a dot (e.g. 1949.75), got "',
    'The standard requires the amount as a decimal with two places and a dot (e.g. 1949.75), got "',
  ],
  ['Currency must be CHF or EUR, got "', 'The standard requires the currency CHF or EUR, got "'],
  [
    'Reference type must be QRR, SCOR or NON, got "',
    'The standard requires the reference type QRR, SCOR or NON, got "',
  ],
  [
    'Line 31 must be the trailer "EPD", got "',
    'The standard requires line 31 to be the trailer "EPD", got "',
  ],
  [
    'Billing information must start with "//" followed by the definition tag (e.g. //S1/...).',
    'The standard requires billing information to start with "//" followed by the definition tag (e.g. //S1/...).',
  ],
  // The fields proposed for a combined address.
  [
    'Derived from the combined lines: check the street and building number, then set AdrTp to S.',
    'Derived from the combined lines: the street and building number come from a split of those lines that the creditor has not confirmed, and a structured address carries AdrTp S.',
  ],
  [
    'AdrLine2 does not split cleanly into postal code and town; complete the structured fields by hand.',
    'AdrLine2 does not split cleanly into postal code and town, so these structured fields are incomplete.',
  ],
  // The type K notice (COMBINED_ADDRESS_NOTICE.en, src/lib/qr-bill-notice.ts),
  // its dates and sources unchanged.
  [
    'A type K QR-bill may therefore be refused at payment: reissue it with type S.',
    'A type K QR-bill may therefore be refused at payment, which a reissue with type S avoids.',
  ],
  [
    'Also redo the standing orders and templates captured from a type K QR-bill.',
    'Standing orders and templates captured from a type K QR-bill carry the same unstructured address.',
  ],
  // The QR-bill `next_steps`, a list of sentences.
  [
    'Reissue the QR-bill with the creditor address in type S: the banks guarantee payment of a type K QR-bill only until the end of September 2026; see creditor.proposed_structured.',
    'The creditor address is in type K, and the banks guarantee payment of a type K QR-bill only until the end of September 2026; creditor.proposed_structured carries the type S fields for a reissue.',
  ],
  [
    'Convert the ultimate debtor address to type S; see ultimate_debtor.proposed_structured.',
    'The ultimate debtor address is in type K; ultimate_debtor.proposed_structured carries the type S fields.',
  ],
  [
    'Fix the creditor IBAN before anything else: the QR-bill cannot be paid.',
    'The creditor IBAN is invalid, so the QR-bill cannot be paid as it stands.',
  ],
  [
    'Structure and checksums pass. To learn the bank behind the IBAN and its payment-rail participation, call POST /v1/iban/validate (paid).',
    'Structure and checksums pass. The bank behind the IBAN and its payment-rail participation are outside this check.',
  ],

  // src/lib/address-conformity.ts. The SPS quotations between quotation marks
  // stay as quoted.
  ['. Note that the fetched T2 document', '. The fetched T2 document'],
  [
    'subject to confirmation. See ibanforge.com/blog/2026-09-02-which-date-structured-addresses.',
    'subject to confirmation; ibanforge.com/blog/2026-09-02-which-date-structured-addresses sets out these dates.',
  ],

  // src/lib/payment-reference.ts
  [
    "Ask the creditor's bank, or read the configuration that came with the invoice.",
    "The creditor's bank knows that configuration, and an invoice may carry it.",
  ],
  [' Note: the string looks like ', ' The string looks like '],
  [
    ' you asked for — the verdict above judges it as ',
    ' requested; the verdict above judges it as ',
  ],
  ['Pass reference_type to force a scheme.', 'reference_type, when given, forces a scheme.'],
  [
    ' — see also_valid_as. Pass reference_type when you know the country.',
    '; also_valid_as gives that reading, and reference_type, when given, selects the scheme.',
  ],
  [
    " Either use the creditor's QR-IBAN or send this payment without a QRR reference.",
    " A QRR reference therefore travels only with the creditor's QR-IBAN, and a payment to this IBAN carries none.",
  ],
  [
    ', and an ISO 11649 reference (SCOR) must not be used with one per the Swiss Implementation Guidelines (SPS).',
    ', and per the Swiss Implementation Guidelines (SPS) an ISO 11649 reference (SCOR) is not allowed with one.',
  ],

  // src/lib/national-check/
  [
    'The last two digits of the Belgian account number do not match',
    'The last two digits of the Belgian account number differ from',
  ],
  [
    '(positions 9 and 10 of the BBAN) do not match the bank',
    '(positions 9 and 10 of the BBAN) fail to match the bank',
  ],
  [
    ': treat this as a warning, and have the beneficiary confirm the account number.',
    ': this is a warning, and the beneficiary can confirm the account number.',
  ],

  // src/lib/compliance-db.ts: the last sentence of `meta.disclaimer` of
  // check_compliance, with its vendors (/mcp/directory) or without them, once
  // `chatgptDisclaimer` has run (/mcp/chatgpt). Said as a fact, scope kept:
  // Claude-Alain's decision of 24.10.2026, for these two addresses only.
  [
    /Use a regulated provider(?: \([^)]*\))? for name-level KYC\/AML obligations\./g,
    'IBANforge is not a regulated AML/CFT screening provider; regulated screening, ' +
      'including the name-level checks of KYC/AML obligations, is done by such providers.',
  ],

  // src/lib/device-grant.ts: `message` of poll_api_key and `display_to_human`
  // of request_api_key. Whole sentences, matched as written in DEVICE_TEXTS.
  [
    DEVICE_TEXTS.authorization_pending,
    'Nobody has approved this code yet; retry_in_seconds gives the wait before the next poll. Nothing is wrong.',
  ],
  [
    DEVICE_TEXTS.slow_down,
    'This poll came sooner than the interval allows; retry_in_seconds gives the longer wait before the next one.',
  ],
  [
    DEVICE_TEXTS.access_denied,
    'Somebody refused this request on the approval page. A new request opens a new approval, and the number of requests per network is limited.',
  ],
  [
    DEVICE_TEXTS.expired_token,
    'This code expired without being approved. A new request opens a new code, and the keyless allowance stays available.',
  ],
  [
    DEVICE_TEXTS.device_rate_limited,
    'This network has already taken its free keys for today, counting the ones still waiting for ' +
      'approval. Existing keys keep working, and the keyless allowance needs nothing.',
  ],
  [
    DEVICE_TEXTS.device_unavailable,
    'The key service is temporarily unable to open a request; validation still works.',
  ],
  [DEVICE_TEXTS.saved, 'The key is returned once: a later poll does not return it.'],
  // `displayToHuman` for a code that was issued: a text for the human, in the
  // third person, the code and the link where they were.
  [
    'IBANforge needs one approval from you, and it takes about fifteen seconds.\n',
    'The IBANforge key needs one approval, which takes about fifteen seconds.\n',
  ],
  ['  1. Open:  ', '  1. Approval page:  '],
  ['  2. Check the code shown on the page reads:  ', '  2. Code shown on that page:  '],
  [
    '  3. Press the first button under the code. No e-mail, no card, no account.\n',
    '  3. The first button under the code issues the key. No e-mail, no card, no account.\n',
  ],
  [
    `That gives ${ANONYMOUS_MONTHLY_LIMIT} requests a month. On the same page you may add an e-mail address\n` +
      `instead, which raises it to ${FREE_TIER_MONTHLY_LIMIT}.`,
    `That key carries ${ANONYMOUS_MONTHLY_LIMIT} requests a month. An e-mail address, optional and added on the same page,\n` +
      `raises it to ${FREE_TIER_MONTHLY_LIMIT}.`,
  ],
];

/**
 * The passages these addresses serve word for word, on purpose, each with its
 * reason. The response crib (`cribResponse` in `src/mcp/directives.ts`, read by
 * `src/routes/mcp-responses.test.ts` and by the online proof) removes them,
 * byte for byte, before it reads a text: a word added around one is read.
 * The check_compliance disclaimer is no longer among them: its last sentence
 * is rewritten above (decision of Claude-Alain, 24.10.2026).
 */
export function directoryVerbatimPassages(): ReadonlyArray<readonly [string, string]> {
  return [
    [
      COMBINED_ADDRESS_SOURCE,
      'an attributed citation (SIX, UBS, ZKB): what those documents say, in the source field',
    ],
    ['"N — Must not be sent"', 'a quotation of the SPS status legend, between quotation marks'],
    [
      '"Data already provided in another element must not be repeated."',
      'a quotation of SPS, between quotation marks',
    ],
    [
      `Important Note: "${GR_IMPORTANT_NOTE}"`,
      'the HBA licence: its Important Note in full on every response carrying HEBIC data (production only)',
    ],
  ];
}

/** A response text as these addresses serve it. */
export function directoryResponseText(text: string): string {
  return DIRECTORY_RESPONSE_EDITS.reduce(
    (t, [from, to]) => (typeof from === 'string' ? t.split(from).join(to) : t.replace(from, to)),
    text,
  );
}

/** The bank-code block of a result, as far as the step sentences read it. */
interface StepContext {
  bank_code_check?: { retired_on?: string | null; superseded_by?: string | null } | null;
  psd_registration?: unknown;
}

/**
 * `next_steps[].do` on these addresses, per step code, from the result the step
 * belongs to: what the result establishes, never what to do with it. The
 * variants follow `src/lib/next-steps.ts` exactly. `undefined` for a code this
 * table does not know: the step then keeps its `/mcp` sentence, and the test
 * that produces every code turns red.
 *
 * `generate_payment_qr` has no sentence: these addresses never serve it
 * (`directoryNextSteps`).
 */
export function directoryStepSentence(step: NextStep, result: StepContext): string | undefined {
  const check = result.bank_code_check ?? undefined;
  switch (step.code) {
    case 'bank_code_not_allocated':
      return 'The bank code is absent from the national register, so no institution holds this account and a payment to it has no receiving bank.';
    case 'verify_payee_name':
      return result.psd_registration
        ? 'The register names who holds this bank code, but not who holds the account behind it: only a beneficiary name check establishes the account holder before funds are released.'
        : 'The bank code is not confirmed, which differs from invalid: the reference data consulted does not settle it, and a beneficiary name check is what decides before funds are released.';
    case 'modulus_check_failed':
      return 'The account number fails the UK checksum for this sorting code, so the pair cannot be a real account; the correct sorting code and account number come from the beneficiary.';
    case 'national_check_digits_suspect':
      return 'The account number does not satisfy the check-digit method the Bundesbank lists for this bank, but that method comes with no published test number, so this is a warning and not a refusal; the beneficiary can confirm the account number.';
    case 'national_check_digits_failed':
      return 'The national check key inside this IBAN does not match the bank and account numbers it carries, so the account number cannot have been issued as written, even though the IBAN check digits are correct; the correct account number comes from the beneficiary.';
    case 'bank_code_retired':
      if (check?.retired_on) {
        return check.superseded_by
          ? `The register struck this bank code off on ${check.retired_on}; its legal successor by merger or incorporation holds bank code ${check.superseded_by}, which is not necessarily the bank that now holds the account. Beneficiary details that still carry this code are out of date.`
          : `The register struck this bank code off on ${check.retired_on} and names no legal successor. Beneficiary details that still carry this code are out of date.`;
      }
      return check?.superseded_by
        ? `The register is retiring this bank code; ${check.superseded_by} takes over. Beneficiary details that carry this code are due for an update.`
        : 'The register is retiring this bank code and names no successor. Beneficiary details that carry this code are due for an update.';
    case 'bic_is_advisory':
      return 'This BIC was picked among several candidate institutions, so it is advisory and not confirmed for settlement; the beneficiary or the bank can confirm the right one.';
    case 'test_bic':
      return 'The resolved BIC is a test code, not a live institution: it belongs to a sandbox run, not to a real payment.';
    case 'expect_virtual_iban':
      return 'This is likely a virtual IBAN: with this issuer, account holder and IBAN holder often differ, which gives the name check more weight.';
    case 'issuer_not_a_known_iban_issuer':
      return 'The bank is not confirmed: the code resolves to a BIC, but its holder is not among the providers known to issue IBANs in this country, so the account may not exist; a payee name check settles it before sending.';
    case 'screen_compliance':
      return 'check_compliance screens this institution against sanctions, FATF status and VoP reachability before a transfer; it reads the same bank-code verdict as this answer, so it does not score an unconfirmed code as an ordinary bank.';
    default:
      return undefined;
  }
}

/**
 * `because` keeps its words: it names the field that produced the step. One
 * variant ends on a direction, which these addresses say as a fact.
 */
const BECAUSE_EDITS: ReadonlyArray<readonly [string, string]> = [
  [', screen it and confirm the payee by name', ', and only a name check confirms the payee'],
];

function isStep(value: unknown): value is NextStep {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as NextStep).code === 'string' &&
    typeof (value as NextStep).do === 'string'
  );
}

/** One step of `next_steps`, said on these addresses. */
function directoryStep(step: NextStep, result: StepContext): NextStep {
  return {
    ...step,
    do: directoryStepSentence(step, result) ?? step.do,
    because: BECAUSE_EDITS.reduce((t, [from, to]) => t.split(from).join(to), step.because),
  };
}

/**
 * A JSON value with every response text said as these addresses say it, at
 * every depth: each string through `directoryResponseText`, and each
 * `next_steps` list of step objects through `directoryStep`, with the object
 * that carries it as the result. The input is never mutated.
 */
export function directoryResponse<T>(value: T): T {
  return walk(value) as T;
}

function walk(value: unknown): unknown {
  if (typeof value === 'string') return directoryResponseText(value);
  if (Array.isArray(value)) return value.map(walk);
  if (!value || typeof value !== 'object') return value;
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    out[key] =
      key === 'next_steps' && Array.isArray(child)
        ? child.map((s) => (isStep(s) ? directoryStep(s, source as StepContext) : walk(s)))
        : walk(child);
  }
  return out;
}

/**
 * A text block as these addresses serve it. The tools write JSON there, two
 * spaces of indentation or none: it is parsed, rewritten like
 * `structuredContent`, and written back in the same layout. A text that is not
 * JSON is rewritten as a sentence.
 */
function directoryText(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return directoryResponseText(text);
  }
  return JSON.stringify(directoryResponse(parsed), null, text.includes('\n') ? 2 : undefined);
}

/** A tool result as these addresses serve it: `structuredContent` and every text block. */
export function directoryResult(result: CallToolResult): CallToolResult {
  return {
    ...result,
    content: result.content.map((block) =>
      block.type === 'text' ? { ...block, text: directoryText(block.text) } : block,
    ),
    ...(result.structuredContent
      ? { structuredContent: directoryResponse(result.structuredContent) }
      : {}),
  };
}
