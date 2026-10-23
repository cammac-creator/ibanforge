/**
 * The address proposed to the ChatGPT app directory: `/mcp/chatgpt`.
 *
 * Built on `/mcp/directory` (`src/mcp/directory.ts`): every adaptation of that
 * address applies here too (no price, no partner, no `pricing` resource), and
 * this address goes further, because ChatGPT is a different client:
 *
 *  - SIX TOOLS, read-only. ChatGPT sends no key to a connector, so the two
 *    device-grant tools would hand a secret to the model for nothing, and the
 *    OpenAI guidelines forbid authentication secrets in tool data.
 *    `send_feedback` (an anonymous write), `check_postal_address` and
 *    `check_swiss_qr_bill` (inputs that may carry names and addresses) are left
 *    out of this first submission: a scope choice, not an OpenAI rule. The five
 *    are removed from the RUNNING server, not only from `tools/list`: a direct
 *    `tools/call` gets "not found" from the SDK before any handler runs, and is
 *    neither charged nor counted (`src/routes/mcp-http.ts`, `servableTools`).
 *  - ANONYMOUS. This address reads no key at all, in `Authorization` or in
 *    `X-API-Key`: every call is a keyless call, debited on the source address,
 *    and no answer mentions a key. A key read here would bring back the key
 *    refusal texts and the keyed-session exemption, for a client that cannot
 *    send one.
 *  - EXPLICIT REQUESTS ONLY. The texts ask the model to call a tool when the
 *    user asks for a check or for bank information, never because a string
 *    looks like an IBAN.
 *
 * 🚨 Same allowance, same counters as `/mcp` and `/mcp/directory` (decision of
 * Claude-Alain, 23.10.2026, choice 2A): the same weekly bucket and the same
 * daily session openings per source address. No exemption for ChatGPT, its
 * reviewers, an address or a user agent. `src/routes/mcp-chatgpt.test.ts` holds
 * it, in every direction.
 *
 * 🚨 No figure is written here either: the texts speak of a weekly allowance
 * without its number, which travels in the refusal's `data`.
 *
 * 🚨 No new legal text. The only rewritten passage of a shared notice is the
 * list of vendors in `meta.disclaimer` of `check_compliance` (a commercial
 * recommendation): its scope, the absence of any payee screening and the need
 * for a regulated provider stay word for word.
 */
import { TRIAL_RESET } from '../lib/trial.js';
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';
import { directoryPayload } from './directory.js';

export const MCP_CHATGPT_PATH = '/mcp/chatgpt';

/** The six tools this address serves, in the order a reader meets them. */
export const CHATGPT_TOOLS = [
  'validate_iban',
  'batch_validate_iban',
  'lookup_bic',
  'lookup_ch_clearing',
  'validate_payment_reference',
  'check_compliance',
] as const;

export const CHATGPT_TOOL_SET: ReadonlySet<string> = new Set(CHATGPT_TOOLS);

/**
 * The per-tool authentication declaration of the OpenAI tool reference
 * (https://developers.openai.com/plugins/reference, read on 24.10.2026):
 * `noauth`, the tool runs anonymously. Under `_meta` because the MCP SDK lists
 * a tool with its own fields only and drops a top-level `securitySchemes`; the
 * reference names `_meta["securitySchemes"]` as the mirror ChatGPT reads.
 */
export const CHATGPT_TOOL_META: Record<string, unknown> = {
  securitySchemes: [{ type: 'noauth' }],
};

/**
 * The `instructions` block of `initialize` on this address. Every tool named
 * here is one of the six (`src/routes/mcp-chatgpt.test.ts`).
 */
export const MCP_CHATGPT_INSTRUCTIONS =
  'IBANforge checks bank identifiers and says where each answer comes from. ' +
  'Call a tool only when the user explicitly asks to check an IBAN or asks for bank information: ' +
  'validate_iban for one IBAN, batch_validate_iban for several, lookup_bic for a BIC/SWIFT code, ' +
  'lookup_ch_clearing for a Swiss clearing number (IID), validate_payment_reference for a structured payment reference ' +
  'and its pairing with an IBAN, check_compliance for bank-level compliance triage. ' +
  'A string that merely looks like an IBAN is not, on its own, a reason to call a tool. ' +
  'These checks never establish that an account exists, who holds it or whether a payee name matches, ' +
  'and they never approve a payment; IBANforge sends no money. ' +
  'Report missing or unconsulted data as unknown, never as a clean result, and relay the source and date each answer carries. ' +
  'Usage is limited by a weekly allowance shared by every request from the same network source address: ' +
  `one unit per tool call, one per IBAN in batch_validate_iban, reset on ${TRIAL_RESET}. ` +
  'When it is reached, tell the user when it resets and wait for the reset. ' +
  'Documentation: https://ibanforge.com/docs';

/** What each tool says about the allowance, in place of the line `/mcp` prices. */
export const CHATGPT_ALLOWANCE_NOTE =
  'Counts against a weekly usage allowance shared by the source network address.';

/**
 * The descriptions of the six tools, rewritten from the `/mcp/directory` text
 * rather than written a third time: each edit names the exact passage it
 * replaces, so the returns, limits and verdict sentences stay those of the
 * other addresses. A passage changed there no longer matches, the old trigger
 * stays in place, and `src/routes/mcp-chatgpt.test.ts` turns red (it checks
 * that every replacement is served and every replaced passage is gone).
 */
export const CHATGPT_DESCRIPTION_EDITS: Readonly<
  Record<string, ReadonlyArray<readonly [string, string]>>
> = {
  validate_iban: [
    [
      'USE WHEN: the user mentions an IBAN, asks to validate an IBAN and identify the issuing bank, asks to detect a typo in an IBAN, ' +
        'asks who the bank is behind an IBAN, asks whether an IBAN was issued by a traditional bank vs a neobank/EMI/virtual-IBAN provider, ' +
        'asks whether the recipient bank is reachable on SEPA rails, asks whether the recipient bank supports Verification of Payee (VoP, EU 2024/886), ' +
        'or pastes any string starting with two letters and digits (e.g., "DE89...", "CH93...", "FR76..."). ',
      'USE WHEN: the user explicitly asks to check an IBAN or for the bank information behind it: whether it is valid or holds a typo, ' +
        'which bank issued it, whether that is a traditional bank or a neobank, e-money or virtual-IBAN provider, ' +
        'whether the bank is reachable on SEPA rails, or whether it is listed for Verification of Payee (VoP, EU 2024/886). ' +
        'A string that merely looks like an IBAN is not, on its own, a reason to call this tool. ',
    ],
  ],
  batch_validate_iban: [
    [
      'each IBAN counts as one validate_iban call, with or without a key. ',
      'each IBAN counts as one unit of the weekly allowance, the same as one validate_iban call. ' +
        'A batch that needs more units than remain this week is refused as a whole, without any result, ' +
        'and its units are still added to the week until the reset: when the allowance may be running low, check fewer IBANs. ',
    ],
    [
      'USE WHEN: the user pastes a list of IBANs, asks to clean a CSV/spreadsheet of bank accounts, ' +
        'asks to dedupe a customer database, asks to triage a payout list before sending, ' +
        'or whenever you would otherwise call validate_iban more than 2-3 times in a row. ',
      'USE WHEN: the user explicitly asks to check several IBANs together, for example to clean a spreadsheet of bank accounts ' +
        'or to triage a payout list before sending, or when answering the request would otherwise take more than 2-3 validate_iban calls in a row. ',
    ],
    [
      'RETURNS: { results: [...same shape as validate_iban], count, valid_count }. ',
      'RETURNS: { results: [...one per input IBAN, in the same order, same shape as validate_iban], count }. ' +
        'There is no separate count of valid IBANs: read results[].valid. ',
    ],
  ],
  check_compliance: [
    [
      'USE WHEN: the user is about to send a payment / payout / refund and wants to triage risk first, ' +
        "asks whether the payee's bank or its country is under sanctions, asks if a SEPA Instant transfer can reach the bank, " +
        'or needs a numeric risk score for an internal payment-approval workflow. ',
      "USE WHEN: the user explicitly asks for a bank-level compliance check of an IBAN: whether the payee's bank or its country " +
        'appears on a sanctions or FATF list, whether a SEPA Instant transfer can reach the bank, or whether the bank is listed ' +
        'for Verification of Payee. The result is information for a person to weigh: it never approves, blocks or authorises a payment. ',
    ],
  ],
  validate_payment_reference: [
    [
      'USE WHEN: assembling a payment instruction from an invoice, a QR-bill or a remittance advice; whenever a Swiss IBAN and a reference appear together (the pairing rule is what most integrations get wrong); ' +
        'or when the user pastes an "RF..." string, a 27-digit number, a +++123/4567/89012+++ block, or asks whether a payment reference is correct. ',
      'USE WHEN: the user explicitly asks whether a structured payment reference is correct (an RF creditor reference, ' +
        'a 27-digit Swiss QR reference, a Belgian +++123/4567/89012+++ structured communication, a Finnish reference number), ' +
        'or whether a reference may be used with a given IBAN; when both are given, pass both (the Swiss pairing rule is what most integrations get wrong). ',
    ],
  ],
  lookup_ch_clearing: [
    [
      'USE WHEN: the user mentions a Swiss bank by BC-Nummer or IID, pastes a CH or LI IBAN clearing code, ' +
        'asks routing details for a Swiss instant transfer (SIC, euroSIC), asks about QR-bill QR-IID resolution, ' +
        'or needs to classify a Swiss financial institution (bank vs PFS vs SIC-only participant). ',
      'USE WHEN: the user explicitly asks about a Swiss or Liechtenstein clearing number (BC-Nummer / IID): which institution holds it, ' +
        'its routing for a Swiss instant transfer (SIC, euroSIC), its QR-IID, ' +
        'or what kind of institution it is (bank vs PFS vs SIC-only participant). ',
    ],
  ],
};

export function chatgptDescription(tool: string, description: string): string {
  return (CHATGPT_DESCRIPTION_EDITS[tool] ?? []).reduce(
    (text, [from, to]) => text.split(from).join(to),
    description,
  );
}

/**
 * The one commercial recommendation inside a shared notice: the vendors named
 * by `meta.disclaimer` of `check_compliance` (`src/lib/compliance-db.ts`).
 * Only the list goes; "Use a regulated provider … for name-level KYC/AML
 * obligations" stays, with the bank-only scope and the unscreened payee
 * before it. Matched on the exact passage, like the edits above.
 */
export const DISCLAIMER_VENDORS = ' (Refinitiv, ComplyAdvantage, etc.)';

export function chatgptDisclaimer(disclaimer: string): string {
  return disclaimer.split(DISCLAIMER_VENDORS).join('');
}

/**
 * A tool result as this address serves it: the directory result (no price
 * field, no partner step), and the compliance notice without its vendors.
 */
export function chatgptPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const out = directoryPayload(payload);
  const meta = out.meta as Record<string, unknown> | undefined;
  if (meta && typeof meta.disclaimer === 'string') {
    out.meta = { ...meta, disclaimer: chatgptDisclaimer(meta.disclaimer) };
  }
  return out;
}

/** The refusal past the weekly allowance: who shares it, how it counts, when it comes back. */
export function chatgptAllowanceRefusal(
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
      'Weekly usage allowance reached for this source network address, so this call was not served. ' +
      'The allowance is shared by every request that reaches IBANforge from that address, whoever sends it, ' +
      'and counts one unit per tool call and one per IBAN in batch_validate_iban. ' +
      `It resets on ${TRIAL_RESET} (resets_at in data): wait until then and try again.`,
    data: { used, limit, remaining: 0, period: 'week', resets_at: resetsAt },
  };
}

/** The refusal when the allowance could not be counted: not the caller's consumption, and nothing served. */
export const CHATGPT_ACCOUNTING_UNAVAILABLE =
  'Usage accounting is temporarily unavailable on this connector, so this call was not served. ' +
  'This does not mean that the weekly allowance is used up. Try again in a few minutes.';

/** The refusal of one session opening too many from one address in a day. */
export const CHATGPT_SESSION_REFUSAL =
  'Daily limit of new sessions reached for this source network address. ' +
  'Reuse the mcp-session-id returned by initialize instead of opening a new session for each call, ' +
  'or try again after 00:00 UTC.';

/** The `ibanforge://countries` resource, described for this address: reference data, not an account. */
export const CHATGPT_COUNTRIES_DESCRIPTION =
  'The IBAN countries IBANforge knows, each with its IBAN length, SEPA membership, whether Verification of Payee ' +
  'is required, and a country risk classification. Reference data about countries, not about any account.';

/** The `validate_and_explain` prompt, said with what the check does not establish. */
export const CHATGPT_PROMPT_DESCRIPTION =
  'Validate an IBAN the user asked about and explain the result in plain language, including what it does not establish.';

export function chatgptValidateAndExplainPrompt(iban: string): string {
  return `Please validate this IBAN and explain the result in plain language for a non-technical user.

IBAN to validate: ${iban}

Use the validate_iban tool first, then:
1. State whether the IBAN is valid or not
2. If valid: name the country, the bank and its BIC with the source the result gives, and whether it is a traditional bank or an e-money institution or neobank
3. Explain the SEPA reachability and whether Verification of Payee (VoP) is required for this country
4. Summarize the risk indicators in plain language, and call unknown or unconsulted data unknown
5. If invalid: explain what's wrong (wrong format, failed checksum, unsupported country)
6. Say that this check does not confirm that the account exists or who holds it, and that it does not approve a payment

Keep the explanation under 150 words and avoid jargon.`;
}

/**
 * The discovery body of `GET /mcp/chatgpt` without a session: how to connect,
 * the six tools, anonymous access, where the documentation is.
 */
export function chatgptDiscoveryBody(tools: readonly string[]): Record<string, unknown> {
  return {
    protocol: 'mcp',
    version: LATEST_PROTOCOL_VERSION,
    supported_versions: SUPPORTED_PROTOCOL_VERSIONS,
    transport: 'streamable-http',
    endpoint: `https://api.ibanforge.com${MCP_CHATGPT_PATH}`,
    authentication: 'none',
    message:
      'This is the IBANforge MCP HTTP endpoint for ChatGPT. To use it, send a POST with a JSON-RPC initialize request, then keep the returned mcp-session-id header on subsequent requests.',
    tools: [...tools],
    documentation: 'https://ibanforge.com/docs',
  };
}
