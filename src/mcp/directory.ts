/**
 * The address MCP connector directories list: `/mcp/directory`.
 *
 * The same tools and the same data as `/mcp`, without anything that sells:
 * no price, no credit offer, no payment rail, no partner cross-referral. The
 * connector directories of Claude and ChatGPT both refuse a server that
 * advertises pricing or sponsored content, while `/mcp` itself is read by
 * agents that need the prices to decide whether to pay — so the two coexist,
 * and `/mcp` does not change.
 *
 * 🚨 Same allowance, same counters. This address debits the bucket `/mcp`
 * debits, for tool units and for session openings alike
 * (`src/routes/mcp-http.ts`, `mcpBucket`). A separate bucket would be a free
 * door nobody announced, against the rule of the « 25 » (CLAUDE.md,
 * `src/routes/free-doors-claims.test.ts`). `src/routes/mcp-directory.test.ts` holds
 * it, both ways.
 *
 * 🚨 No figure is written here, on purpose. The texts speak of a weekly
 * allowance without its number: the figure belongs to `MCP_WEEKLY_LIMIT`, and
 * the refusals carry it in their `data`, never in a sentence.
 *
 * 🚨 Descriptions, never directions (24.10.2026). The directory submission
 * commits that no tool description carries an instruction about the model's
 * behaviour, about other tools or about external instruction sources. So every
 * text this address puts in front of a model (`initialize`, each tool, each
 * parameter, each output field, the prompt) says what a tool does, what it
 * takes, what it returns and where its data comes from, and nothing else: no
 * USE WHEN, no DO NOT, no "call X", no "relay", no "show it verbatim". The
 * tool texts are written whole below; the field texts of the schemas `/mcp`
 * shares are rewritten passage by passage (`DIRECTORY_TEXT_EDITS`), since `/mcp`
 * keeps its own words byte for byte. `src/routes/mcp-descriptions.test.ts`
 * turns red on a directive coming back, on both addresses.
 *
 * Kept out of `instructions.ts`: its parity test reads that file as text, and
 * a second constant there is one more thing for its extractor to trip on.
 */
import type { z } from 'zod';
import { TRIAL_RESET } from '../lib/trial.js';
import type { PaywallCause } from '../types.js';
import type { NextStep } from '../lib/next-steps.js';
import { datasetFacts } from '../lib/dataset-facts.js';
import {
  BANK_LEVEL_SANCTIONS,
  bicDirectorySentence,
  serverDescription,
} from '../lib/positioning.js';
import { authoritativeVerdictSentence } from '../lib/register-lists.js';
import {
  COMPLIANCE_HONEST_NAMES,
  VALIDATE_TRUTH_RETURNS,
  bicSourceNote,
} from '../lib/field-notes.js';
import { COMBINED_ADDRESS_CLAUSE } from '../lib/qr-bill-notice.js';
import { DIRECTORY_TOOL_OUTPUT_SCHEMAS } from './output-schemas.js';

/**
 * The hosted addresses of the transport, and which one a session was opened
 * on. `chatgpt` (`/mcp/chatgpt`, `src/mcp/chatgpt.ts`) takes every adaptation
 * of `directory` and narrows it further.
 */
export type McpVariant = 'mcp' | 'directory' | 'chatgpt';

export const MCP_DIRECTORY_PATH = '/mcp/directory';

/**
 * What the eight data tools say about the keyless limit, in place of the
 * `COST:` line `/mcp` ends them with. True, and without a figure that could
 * contradict the one the refusal quotes.
 */
export const DIRECTORY_ALLOWANCE_NOTE =
  'Without a key, a fair-use weekly allowance per source address applies.';

/** Where an IBANforge key comes from, said once for every text below. */
const KEY_SENTENCE =
  'use an IBANforge API key from ibanforge.com, sent as "Authorization: Bearer ifk_..." (or X-API-Key)';

/**
 * The `instructions` block of `initialize` on this address: a description of
 * the server, its tools and its limit, with no direction to the model.
 *
 * Every tool named here must be registered (`src/routes/mcp-directory.test.ts`): the block is
 * injected into the model's context BEFORE `tools/list`, so citing a tool that
 * does not exist teaches the agent that the documentation lies.
 */
export const MCP_DIRECTORY_INSTRUCTIONS =
  'IBANforge validates IBANs and identifies the bank behind them, with the source and date of each answer. ' +
  'validate_iban takes one IBAN (e.g. DE89370400440532013000) and returns its validity, the issuing bank and BIC, virtual-IBAN and e-money detection, SEPA reachability and Verification of Payee readiness; batch_validate_iban does the same for up to 100 IBANs. ' +
  'lookup_bic covers a BIC/SWIFT code, lookup_ch_clearing a Swiss clearing number, check_compliance a bank-level compliance triage, validate_payment_reference a structured payment reference, check_swiss_qr_bill a Swiss QR-bill payload and check_postal_address an ISO 20022 postal address. ' +
  `Without a key, a fair-use weekly allowance applies per source address: one unit per tool request, one per IBAN in batch_validate_iban, reset on ${TRIAL_RESET}. ` +
  'Requests that carry an IBANforge API key from ibanforge.com, sent as "Authorization: Bearer ifk_..." (or X-API-Key), are counted on that key; ' +
  'request_api_key and poll_api_key run the browser approval that issues a free key, and both answer after the allowance is spent. ' +
  'send_feedback delivers a report on missing data or a wrong result to the operators; a human reads every report. ' +
  'Documentation and code samples: https://ibanforge.com/docs';

/**
 * The passages of the texts `/mcp` shares with this address (the field notes
 * of `src/lib/field-notes.ts`, the output schemas of `src/mcp/output-schemas.ts`,
 * the parameters registered in `src/routes/mcp-http.ts`, the server line of
 * `src/lib/positioning.ts`) that direct the model, each said here as a fact.
 * Applied to every description of every schema of this address and to the
 * shared notes the tool texts below are built from, never to `/mcp`.
 *
 * Exact passages, so a text changed at its source no longer matches: the old
 * passage then reaches this address, and `src/routes/mcp-descriptions.test.ts`
 * turns red twice, on the directive itself and on the edit that found nothing.
 */
export const DIRECTORY_TEXT_EDITS: ReadonlyArray<readonly [string, string]> = [
  // The server line of `initialize` (positioning.ts).
  [
    'Check the bank behind an IBAN before you pay:',
    'Checks the bank behind an IBAN before a payment:',
  ],
  // field-notes.ts
  ['so read it as our inference.', 'so it is our inference.'],
  ['nobody holds this code, so do not send.', 'nobody holds this code.'],
  ['payee_name: never checked here;', 'payee_name: not checked here;'],
  ['account_exists: never checked here;', 'account_exists: not checked here;'],
  ['payee_sanctions: never checked;', 'payee_sanctions: not checked;'],
  ['well formed, never that the account exists;', 'well formed, not that the account exists;'],
  ['a key is never removed.', 'no key is removed.'],
  ['(GB has modulus_check instead)', '(GB has modulus_check)'],
  [
    'A fail never makes valid false, because the IBAN check digits are right: read the two separately, and confirm the details with the beneficiary before paying.',
    'A fail leaves valid true, because the IBAN check digits are right: the two verdicts are independent.',
  ],
  [
    'national_check_digits_suspect and never stops a payment)',
    'national_check_digits_suspect, which does not stop a payment)',
  ],
  ['it never gives the expected key.', 'it does not give the expected key.'],
  ['which a valid IBAN never has', 'which no valid IBAN has'],
  [
    'the resolved BANK, never borrowed from the country',
    'the resolved BANK, not borrowed from the country',
  ],
  [
    '(not consulted, never read as not_listed or no_bank)',
    '(not consulted, which differs from not_listed and no_bank)',
  ],
  ['the country answers instead of the register', 'the country answers in place of the register'],
  ['IBANforge never runs the name check itself.', 'IBANforge does not run the name check itself.'],
  ['(never false by default)', '(not false by default)'],
  ['never present on a national_register answer', 'absent from a national_register answer'],
  [
    "Absent means no gap has been established, never 'this is current'.",
    "Absent means no gap has been established, not 'this is current'.",
  ],
  ['It never answers false today:', 'It does not answer false today:'],
  [
    '(the national register says nobody holds it: do not send)',
    '(the national register says nobody holds it)',
  ],
  ['payee_sanctions are always not_checked.', 'payee_sanctions are not_checked in every answer.'],
  ['and payee_screened is always false;', 'and payee_screened is false in every answer;'],
  // positioning.ts and register-lists.ts
  [", never the payee's name", ", not the payee's name"],
  [
    '; everywhere else treat it as UNAVAILABLE and let the downstream name check decide.',
    '; everywhere else not_in_register carries no more weight than unavailable: the reference data consulted does not settle whether the code is allocated.',
  ],
  // output-schemas.ts
  ['this one never moves.', 'this one has 8 characters in every answer.'],
  [' — read bank_code_check.candidates)', ' — bank_code_check.candidates lists them)'],
  [
    'Outside a national_register basis the BIC is ADVISORY: confirm it with the beneficiary or the bank before storing it as a routing instruction.',
    'Outside a national_register basis the BIC is ADVISORY: no register allocates it to this bank code.',
  ],
  [
    'Source of the bank-code/BIC pairing; keep its provenance.',
    'Source of the bank-code/BIC pairing.',
  ],
  [
    'Count curated and register when sizing virtual-IBAN exposure, never default.',
    'curated and register are identifications; default is not.',
  ],
  [
    '— the only value that licenses "do not send")',
    '— the only value that establishes the code is not allocated)',
  ],
  [
    'The last two describe IBANforge, never the beneficiary. Never escalate either into a refusal.',
    'The last two describe IBANforge, not the beneficiary, and neither is a refusal.',
  ],
  ['Never a refusal.', 'It is not a refusal.'],
  [
    'the successor the register designates, re-paper against it.',
    'the successor the register designates.',
  ],
  [
    'it never changes valid or bank_code_check, because both publishers relay rather than allocate.',
    'it leaves valid and bank_code_check unchanged, because both publishers republish rather than allocate.',
  ],
  [
    'from their own website. Relay it with the answer; do not strip it.',
    'from their own website; this field carries that notice.',
  ],
  [' Relay it.', ''],
  [
    'The Banco de Espana citation formula, verbatim.',
    'The Banco de Espana citation formula, word for word.',
  ],
  [
    'Always false. Neither publisher allocates bank codes.',
    'false in every answer: neither publisher allocates bank codes.',
  ],
  ['Branch on `code`, never on the prose.', '`code` is stable; the prose may change.'],
  ['Stable identifier. Branch on this.', 'Stable identifier of the step.'],
  [
    'An IBANforge call that performs the step, when one exists.',
    'The IBANforge tool or route that performs the step, when one exists.',
  ],
  ['Use country.code.', 'country.code carries the same value.'],
  ['Use country.name, which is never null:', 'country.name carries it and is not null:'],
  ['Null, never an empty string,', 'Null, not an empty string,'],
  [
    'False means no bank was screened; do not interpret bank_sanctioned as a finding.',
    'False means no bank was screened, and bank_sanctioned is then not a finding.',
  ],
  [
    'False also when no bank was screened: read institution_listed.',
    'False also when no bank was screened; institution_listed tells the two apart.',
  ],
  ['(never false without a screen)', '(not false without a screen)'],
  [
    'Always false: the payee (account holder) is never screened here.',
    'false in every answer: the payee (account holder) is not screened here.',
  ],
  [
    'the absence of a verdict, never a favourable one.',
    'the absence of a verdict, not a favourable one.',
  ],
  ['Never report null as false.', 'null is distinct from false.'],
  [
    'not_applicable findings never count against it.',
    'not_applicable findings are not counted against it.',
  ],
  [
    'ok means a code was issued. Anything else: read display_to_human and fall back.',
    'ok means a code was issued; any other value means none was, and display_to_human says why.',
  ],
  [
    'Show this to the human, exactly as written, e.g.',
    'The code the human sees on the approval page, e.g.',
  ],
  [
    'The page the human opens. Never open it yourself.',
    'The approval page, opened by the human in a browser.',
  ],
  [' This is the one to show.', ''],
  [
    'A ready-made block of text to show verbatim. Do not paraphrase it.',
    'A ready-made block of text for the human, with the user_code and the link.',
  ],
  [
    'authorization_pending is normal: wait `retry_in_seconds` and call again.',
    'authorization_pending means nobody has approved yet; retry_in_seconds gives the wait before the next poll.',
  ],
  [
    'The exact command line to give the human. Do not run it yourself.',
    'The line that carries the key in the client configuration: on this address, the header "Authorization: Bearer <key>".',
  ],
  [
    'Report id — check status at GET /v1/feedback/{id}.',
    'Identifier of the report; GET /v1/feedback/{id} serves its status.',
  ],
  // The parameters registered in mcp-http.ts.
  [
    'Leave it empty to reuse the last request from this session.',
    'When empty, the last request opened in this session is used.',
  ],
  [
    'Use "other" for product feedback, pricing/payment blockers or feature needs.',
    '"other" covers product feedback, access blockers and feature needs.',
  ],
  [
    'What happened, what you needed, or what blocked you — free text.',
    'What happened, what was needed, or what blocked the request — free text.',
  ],
  ['What you expected (for data errors).', 'The expected value (for data errors).'],
  ['What you received instead (for data errors).', 'The value received (for data errors).'],
  [
    'Where we may answer you (e-mail) — optional, reports can be anonymous.',
    'An e-mail address where the operators may answer — optional, reports can be anonymous.',
  ],
  [
    'Optional creditor IBAN — supply it to get the pairing verdict',
    'Optional creditor IBAN; when present, the answer carries a pairing verdict',
  ],
];

/** A text `/mcp` shares with this address, said as this address says it. */
export function directoryText(text: string): string {
  return DIRECTORY_TEXT_EDITS.reduce((t, [from, to]) => t.split(from).join(to), text);
}

/** A zod schema as this walk reads it: its definition, a clone, a description. */
interface ZodNode {
  _zod: { def: Record<string, unknown> & { type: string } };
  clone(def: Record<string, unknown>): ZodNode;
  describe(text: string): ZodNode;
  description?: string;
}

/**
 * A copy of `schema` whose descriptions, at every depth, went through `edit`.
 *
 * Each node is cloned from its own definition with only its children replaced,
 * so constraints (`min`, `max`, enums), wrappers and `.passthrough()` are those
 * of the original, and a node whose subtree reads the same is returned as is.
 * The original is never mutated: these shapes are shared with `/mcp` and the
 * stdio server. A node kind not walked here keeps its texts; the directive test
 * is what notices one.
 */
export function redescribe<T>(schema: T, edit: (text: string) => string): T {
  return walk(schema as unknown as ZodNode, edit) as unknown as T;
}

function walk(node: ZodNode, edit: (text: string) => string): ZodNode {
  const def = node._zod.def;
  let next = node;
  if (def.type === 'object') {
    const shape = def.shape as Record<string, ZodNode>;
    const walked = Object.fromEntries(Object.entries(shape).map(([k, v]) => [k, walk(v, edit)]));
    if (Object.keys(shape).some((k) => walked[k] !== shape[k]))
      next = node.clone({ ...def, shape: walked });
  } else if (def.type === 'array') {
    const element = walk(def.element as ZodNode, edit);
    if (element !== def.element) next = node.clone({ ...def, element });
  } else if (def.type === 'optional' || def.type === 'nullable' || def.type === 'default') {
    const innerType = walk(def.innerType as ZodNode, edit);
    if (innerType !== def.innerType) next = node.clone({ ...def, innerType });
  } else if (def.type === 'union') {
    const before = def.options as ZodNode[];
    const options = before.map((o) => walk(o, edit));
    if (options.some((o, i) => o !== before[i])) next = node.clone({ ...def, options });
  }
  const text = node.description;
  if (text === undefined) return next;
  const edited = edit(text);
  return edited === text && next === node ? node : next.describe(edited);
}

/** A raw shape (tool parameters, tool output) with every description said as this address says it. */
export function directoryShape(shape: z.ZodRawShape): z.ZodRawShape {
  return Object.fromEntries(
    Object.entries(shape).map(([key, field]) => [key, redescribe(field, directoryText)]),
  );
}

let outputSchemas: Record<string, z.ZodRawShape> | null = null;

/**
 * The output schema of `tool` on this address: the price-free shape of
 * `DIRECTORY_TOOL_OUTPUT_SCHEMAS`, its field texts rewritten. Built once.
 */
export function directoryOutputSchema(tool: string): z.ZodRawShape | undefined {
  outputSchemas ??= Object.fromEntries(
    Object.entries(DIRECTORY_TOOL_OUTPUT_SCHEMAS).map(([name, shape]) => [
      name,
      directoryShape(shape),
    ]),
  );
  return outputSchemas[tool];
}

/** The server line of `initialize` on this address. */
export function directoryServerDescription(): string {
  return directoryText(serverDescription());
}

/** The `validate_and_explain` prompt, described rather than ordered. */
export const DIRECTORY_PROMPT_DESCRIPTION =
  'A prompt template: the validation of one IBAN followed by a plain-language explanation of the result for a non-technical reader.';

const toolTexts = new Map<string, Readonly<Record<string, string>>>();

/**
 * The description of every tool on this address, written whole: what the tool
 * does, what it takes, what it returns, its limits and its sources. "Suited
 * to …" says when a tool answers, as a fact about the tool (the directory
 * policy asks for what it does AND when it applies), never as an order.
 *
 * `note` is the sentence each data tool ends with about the limit of the
 * address: `DIRECTORY_ALLOWANCE_NOTE` here, `CHATGPT_ALLOWANCE_NOTE` for the
 * six tools `/mcp/chatgpt` serves (src/mcp/chatgpt.ts), which carry no other
 * difference. Built on first use, never at import: `bicSourceNote` and
 * `bicDirectorySentence` read the database.
 */
export function directoryToolDescriptions(note: string): Readonly<Record<string, string>> {
  const cached = toolTexts.get(note);
  if (cached) return cached;
  const F = datasetFacts();
  const t = directoryText;
  const texts: Record<string, string> = {
    validate_iban:
      `Validates an IBAN from any of the ${F.claim.countries} IBAN countries and identifies the bank behind it, with the source and date of each answer. ` +
      'Suited to questions such as: is this IBAN valid or mistyped, which bank issued it, is that a traditional bank, a neobank, an e-money institution or a virtual-IBAN provider, ' +
      'can the bank be reached on SEPA rails, is it listed for Verification of Payee (VoP, EU 2024/886). ' +
      'Beyond the mod-97 checksum, which only catches typos, the answer resolves the BIC/SWIFT, classifies the issuer and reads the SEPA registers. ' +
      'Input: one IBAN; spaces and hyphens are stripped. ' +
      `Returns: valid (boolean), ${t(VALIDATE_TRUTH_RETURNS)} ` +
      'country { code, name }, bic { code, bic8, bank_name, city, basis, authoritative, source, as_of, lei, address, … }, issuer { type, name }, ' +
      'sepa { member, schemes, vop_required, vop_participant, bank_reachability, bank_schemes, vop_register_status }, risk_indicators, bank_code_check, next_steps, and for CH and LI clearing { iid, name, type, sic, qr_iid }. ' +
      'basis says where the bank code to BIC pairing came from (national_register | curated_map | directory_prefix) and authoritative, derived from it, says whether the BIC may be stored and settled against; outside a national_register pairing the BIC is advisory. ' +
      'code has 8 or 11 characters, as the consulted source publishes it, and bic8 is the part a supplied BIC compares with: in a cooperative network the branch code names the local bank while the first eight name its clearing institution ' +
      '(Swiss IID 30020 is RBABCH22180, Crédit Mutuel de la Vallée SA, while RBABCH22 alone is Entris Banking AG). ' +
      'bic: null does not by itself mean the bank code is wrong: it covers "no such institution", "an institution absent from the reference data" and "no reference data for this country"; ' +
      'bank_code_check.status says which of the three, and bank_code_check.authoritative how much it is worth. ' +
      `${t(authoritativeVerdictSentence())} ` +
      'match: prefix with more than one candidate means the BIC was picked among several and may belong to another institution. ' +
      "Limits: the answer does not establish that the account exists, is open or belongs to a given person; the name check belongs to the payee's bank, through Verification of Payee. " +
      note,
    batch_validate_iban:
      'Validates up to 100 IBANs in one request and returns one validate_iban result per input IBAN, in the same order. ' +
      'Suited to a list of IBANs: a spreadsheet of bank accounts to clean, a customer file to deduplicate, a payout list to triage before sending. ' +
      'Each IBAN counts as one unit, the same as one validate_iban request. ' +
      `${note} ` +
      'A batch that needs more units than remain in that weekly allowance is refused as a whole, without any result, and its units still count until the reset. ' +
      'Returns: { results: [...same shape as validate_iban], count }; results[].valid tells the valid IBANs apart, and no separate count of them is returned.',
    lookup_bic:
      'Resolves a BIC/SWIFT code (8 or 11 characters, e.g. UBSWCHZH80A, DEUTDEFF) into the institution behind it: name, country, city, LEI and registered head-office address where available. ' +
      'Suited to a question about which bank a BIC belongs to, where that bank is, or its LEI for compliance or regulatory matching. ' +
      'Takes a BIC; an IBAN is not accepted. ' +
      `Backed by: ${bicDirectorySentence({ withCount: true })} ${F.claim.lei} of the rows carry an LEI from GLEIF. ` +
      `Source: ${t(bicSourceNote({ withMonth: true }))} ` +
      note,
    check_compliance:
      'Runs a bank-level compliance triage on an IBAN before a SEPA or cross-border payment. ' +
      "Suited to questions such as: is the payee's bank or its country on a sanctions or FATF list, can a SEPA Instant transfer reach the bank, is the bank listed for Verification of Payee, " +
      'and to a numeric risk score for an internal payment-approval workflow. ' +
      'Informational triage, not a regulated AML/CFT screening product: the result is information for a person to weigh, and it does not approve, block or authorise a payment. ' +
      `Checks: IBAN validity, ${t(BANK_LEVEL_SANCTIONS)}, FATF status, SEPA Instant reachability, and whether the EPC Verification of Payee (VoP) register lists the bank as ready; ` +
      "the name check itself belongs to the payee's bank and is not made here. " +
      'Returns: the validate_iban enrichment plus a compliance object with risk_score (0-100, 0 = safest), risk_level (low | medium | elevated | high | critical | unassessable), ' +
      'sanctions (matched_lists, fatf_status), reachability, vop status and flags[] (e.g. sanctioned_country, fatf_grey_list, emi_issuer, no_vop). ' +
      `${t(COMPLIANCE_HONEST_NAMES)} ` +
      note,
    validate_payment_reference:
      'Validates a structured payment reference and, when an IBAN is supplied, gives a verdict on whether the two may be used together. ' +
      'Suited to assembling a payment instruction from an invoice, a QR-bill or a remittance advice, and to a question about an RF creditor reference, ' +
      'a 27-digit Swiss QR reference, a Belgian +++123/4567/89012+++ structured communication or a Finnish reference number. ' +
      'The IBAN, when given, serves the pairing verdict only: the answer carries no IBAN enrichment. ' +
      'Schemes: RF Creditor Reference (ISO 11649, "SCOR" in Swiss Payment Standards, mod 97-10); Swiss QR reference ("QRR", 27 digits, modulo 10 recursive); ' +
      'Belgian OGM/VCS (12 digits, modulo 97, a remainder of 0 written 97); Finnish viitenumero (4-20 digits, weights 7-3-1 from the right). ' +
      'Norwegian KID and Swedish OCR are recognised but not judged: they answer valid: null with status unverifiable_without_creditor_config, because modulus type and length are configured per creditor account by the beneficiary bank and are not a property of the string; ' +
      'that null means the check needs the creditor bank configuration, not that the reference is invalid. ' +
      'Ambiguity: only a leading "RF" and a 27-digit length pin a scheme down. A bare 12-digit string is both a Belgian OGM and a legal Finnish length, so the more specific reading is returned and the other appears in also_valid_as; ' +
      'reference_type, when given, selects the scheme. ' +
      'Pairing: with an iban, the answer also carries a pairing verdict. Per the Swiss Implementation Guidelines a QRR reference may only be used with a QR-IBAN (institution identifier in the SIX range 30000-31999), ' +
      'and an ISO 11649 reference may not be used with one. Outside CH and LI, pairing is not_applicable, since there is no QR-IBAN to pair against, and the reference keeps its own checksum verdict. ' +
      'valid and pairing are independent: a reference can be arithmetically valid and still not allowed on that account. source and as_of name the document each verdict comes from. ' +
      note,
    check_swiss_qr_bill:
      "Checks a Swiss QR-bill payload, the text a QR-bill's code carries (it starts with SPC), rule by rule, each finding citing the SIX document it comes from. " +
      'Suited to an ERP, an accounting tool or an agent holding a scanned or generated QR-bill, before paying or issuing it: whether it is well formed, ' +
      'whether the reference type matches the IBAN (QRR needs a QR-IBAN, IID 30000-31999), and whether the creditor and debtor addresses are structured (type S) or still combined (type K): ' +
      `${COMBINED_ADDRESS_CLAUSE}. ` +
      'Takes the payload text; the bank holding the account and its payment-rail participation are not part of this answer. ' +
      'Returns: { valid, ready_for_2026_11_14, creditor_iban { value, valid, country, qr_iban, iid }, creditor { present, address, structured, sps_check, proposed_structured }, ' +
      'ultimate_debtor, amount, currency, reference { type, value, valid, note }, findings [{ code, severity, field, detail, source }], next_steps, source }. ' +
      "A combined address comes back with proposed_structured, the S-type fields derived from the combined lines. Each finding's source names the document it is quoted from. " +
      note,
    check_postal_address:
      "Checks a structured ISO 20022 postal address against a payment rail's published address rules, rule by rule, each verdict citing the document it comes from. " +
      'Suited to assembling a payment instruction (pain.001, a Fedwire message, a T2 transfer) with a creditor or debtor address, to learn before submission whether the rail accepts it. ' +
      'The November 2026 changes (SIC 20.11, Fedwire 16.11, T2 R2026.NOV) remove the fully unstructured address option; the answer says whether an address survives them. ' +
      'It checks conformity with the message format rules, not postal reality: it does not establish that a street or town exists. ' +
      "Schemes: 'sps' (Swiss Payment Standards, SIX), 'hvps_plus' (HVPS+ / T2, ECB), 'fedwire' (Federal Reserve). " +
      "There is deliberately no 'cbpr+' scheme: that guideline sits behind swift.com, unreachable to automated readers, and a conformity boolean quoting an unread document would be a guess dressed as a verdict; the note field restates this on every answer. " +
      'Verdicts: pass, fail, and not_applicable, which marks a rule whose precondition is not met and does not count as a pass. conforms is true when no finding failed. ' +
      "Each finding's source names the exact document, version and validity date the rule is quoted from. " +
      note,
    lookup_ch_clearing:
      'Resolves a Swiss or Liechtenstein clearing number (BC-Nummer / IID, 1 to 5 digits) into the institution behind it, with its payment-rail participation ' +
      '(SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) and its QR-IID allocation. ' +
      'Suited to a question about which institution holds an IID, its routing for a Swiss instant transfer, its QR-IID, or what kind of institution it is (bank, PFS or SIC-only participant). ' +
      `Covers every IID of the SIX BankMaster: ${F.claim.chClearing} entries (Swiss official source, refreshed monthly). ` +
      'Returns: institution { name, type, iid_type, headquarters_iid }, address, bic, payment_services { sic, rtgs_chf, instant_payments_chf, eurosic, lsv_bdd_chf, lsv_bdd_eur }, sic_iid, qr_iid, valid_on; ' +
      'a merged IID answers for its successor, with redirected_from. Relevant to CH and LI accounts only. ' +
      note,
    send_feedback:
      'Sends a report to the IBANforge operators: an incorrect validation result, stale or missing BIC or bank data, latency, or anything that blocks use of the service (missing network, quota shape). ' +
      'Suited to a result that looks wrong, to data that is missing, or to a limit (quota, capability) that stopped a request. ' +
      'A human reads every report. Each request writes one report; it does not count against the keyless allowance and answers after the allowance is spent.',
    request_api_key:
      'Opens the approval that issues a free IBANforge API key, with no e-mail address. ' +
      'Returns status and, when status is ok, a user_code, the approval link (verification_uri_complete) and display_to_human, a ready-made text carrying both; any other status means no code was issued, and display_to_human says why. ' +
      "Approval happens in the human's browser and takes about fifteen seconds: the page asks for nothing, and an e-mail address is optional and entered only by that human. " +
      'The key itself is returned once, by poll_api_key, after approval. ' +
      'The key does not change the current session: it applies once it is set in the MCP client configuration and the client reconnects, as the header "Authorization: Bearer <key>" ' +
      '(the config_line poll_api_key returns, which Claude takes under Request headers when the connector is added), or when it is sent to the REST API; ' +
      'ChatGPT sends no key to a connector, so in ChatGPT the key serves on the REST API only. ' +
      'The number of requests per network is limited, the ones still awaiting approval included. ' +
      'This tool does not count against the keyless allowance and answers after it is spent.',
    poll_api_key:
      'Returns the IBANforge API key once a human has approved the request opened by request_api_key. ' +
      'Input: device_code, optional; when empty, the last request opened in this session is used. ' +
      'While nobody has approved, the server holds the answer up to thirty seconds, or answers at once when it is busy; polls closer together than the interval come back as authorization_pending with a longer retry_in_seconds. ' +
      'Statuses: authorization_pending (nobody has approved yet; retry_in_seconds gives the wait before the next poll), ' +
      'approved (carries the key and config_line, once: a later poll does not return them), access_denied (the human refused), ' +
      'expired_token (the code timed out before approval), invalid_grant (the code can no longer be used). ' +
      'config_line is the header "Authorization: Bearer <key>" of the hosted server. ' +
      'This tool does not count against the keyless allowance.',
  };
  toolTexts.set(note, texts);
  return texts;
}

/** The refusal past the weekly allowance: when it comes back, and the key. */
export function directoryAllowanceRefusal(
  used: number,
  limit: number,
  resetsAt: string,
): {
  code: number;
  message: string;
  data: { used: number; limit: number; remaining: number; period: 'week'; resets_at: string };
} {
  return {
    code: -32000,
    message:
      `Weekly keyless allowance reached for this source address; try again next week (it resets on ${TRIAL_RESET}) ` +
      `or ${KEY_SENTENCE}.`,
    data: { used, limit, remaining: 0, period: 'week', resets_at: resetsAt },
  };
}

/** The refusal when the allowance could not be counted at all: not the caller's consumption. */
export const DIRECTORY_ACCOUNTING_UNAVAILABLE =
  'Keyless allowance accounting is temporarily unavailable on this address; try again in a few minutes ' +
  `or ${KEY_SENTENCE}.`;

/** The refusal of one session opening too many from one address in a day, without a key. */
export const DIRECTORY_SESSION_REFUSAL =
  'Daily session limit reached for this source address without a key. Reuse the mcp-session-id returned by ' +
  `initialize instead of opening a session per call, try again tomorrow, or ${KEY_SENTENCE}.`;

/**
 * What a key that cannot pay this call reads on this address.
 *
 * `/mcp` relays the REST refusal word for word (`keyRefusalPayload`), and that
 * text sells what lifts the wall. Here: the cause, the counters when there are
 * any, and where the key is managed. Nothing from `cause.detail`, and no
 * `credits` block: its `topup` field is a purchase link.
 */
const KEY_REFUSAL_REASONS: Record<PaywallCause['reason'], string> = {
  monthly_quota_exhausted: 'its monthly allowance is used up',
  monthly_quota_insufficient: 'it has too few calls left this month for this call',
  credits_exhausted: 'it has no calls left',
  credits_insufficient: 'it has too few calls left for this call',
  invalid_api_key: 'the key is unknown or revoked',
  key_revoked_burst: 'the key was suspended',
  trial_exhausted: 'its allowance is used up',
  trial_unavailable: 'its allowance cannot be counted right now',
};

export function directoryKeyRefusalPayload(cause: PaywallCause): Record<string, unknown> {
  return {
    error: cause.reason,
    message:
      `This IBANforge API key cannot serve this call: ${KEY_REFUSAL_REASONS[cause.reason]}. ` +
      'Check the key at https://ibanforge.com, or try again once its monthly allowance resets.',
    ...(cause.quota ? { quota: cause.quota } : {}),
  };
}

/**
 * The device-grant sentences `/mcp` serves that name a payment rail
 * (`DEVICE_TEXTS` in `src/lib/device-grant.ts`), said without it. Matched on
 * the exact `/mcp` sentence, so a sentence changed there falls back to itself
 * and the directory test turns red if it names a rail.
 */
export function directoryDeviceText(text: string, deviceTexts: Record<string, string>): string {
  if (text === deviceTexts.expired_token) {
    return 'This code expired without being approved. Ask for a new one at most once, then fall back to the keyless allowance.';
  }
  if (text === deviceTexts.device_rate_limited) {
    return (
      'This network has already taken its free keys for today, counting the ones still waiting for ' +
      'approval. Existing keys keep working, and the keyless allowance needs nothing.'
    );
  }
  return text;
}

/** The line a human pastes once a key is approved: the connector header, never the npm package. */
export function directoryConfigLine(rawKey: string): string {
  return `Authorization: Bearer ${rawKey}`;
}

const IBANFORGE_HOSTS: ReadonlySet<string> = new Set([
  'ibanforge.com',
  'www.ibanforge.com',
  'api.ibanforge.com',
]);

/** An `action` that sends the agent to another site than ours. */
function pointsElsewhere(action: string | undefined): boolean {
  if (!action || !/^https?:\/\//i.test(action)) return false;
  try {
    return !IBANFORGE_HOSTS.has(new URL(action).hostname.toLowerCase());
  } catch {
    return true;
  }
}

/**
 * `next_steps` as this address serves them.
 *
 * - The partner cross-referral (`generate_payment_qr`) never appears, and no
 *   step whose `action` leaves our own hosts does either: a future handoff to
 *   another service is caught by the same rule, not by a new line here.
 * - `screen_compliance` stays: it fires only on a confirmed bank code, names
 *   the field that produced it, and its check is a tool of THIS connector,
 *   counted like any other call. Only its `action` changes: the REST route
 *   becomes the tool name, so the step names no paid call.
 *
 * Filtered here, in the MCP layer, never in `src/lib/next-steps.ts`: the REST
 * API and `/mcp` keep their steps exactly as they are.
 */
export function directoryNextSteps(steps: readonly NextStep[]): NextStep[] {
  return steps
    .filter((s) => s.code !== 'generate_payment_qr' && !pointsElsewhere(s.action))
    .map((s) => (s.code === 'screen_compliance' ? { ...s, action: 'check_compliance' } : s));
}

/**
 * A tool result as this address serves it: without `cost_usdc` and
 * `list_price_usdc`, which `/mcp` adds to say what the call is worth on the paid
 * route, and with its `next_steps` filtered.
 */
export function directoryPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...payload };
  delete rest.cost_usdc;
  delete rest.list_price_usdc;
  if (Array.isArray(rest.next_steps)) {
    rest.next_steps = directoryNextSteps(rest.next_steps as NextStep[]);
  }
  return rest;
}
