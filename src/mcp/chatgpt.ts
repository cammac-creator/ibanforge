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
 *  - NO BROAD TRIGGER. The texts say what each tool answers, as facts, and
 *    give the model no direction at all (24.10.2026, the same rule as
 *    `/mcp/directory`, see its header): none of them presents a string that
 *    merely looks like an IBAN as a reason to run a check.
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
import { directoryPayload, directoryToolDescriptions } from './directory.js';

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
 * The `instructions` block of `initialize` on this address: a description of
 * the server, its six tools and its limit, with no direction to the model.
 * Every tool named here is one of the six (`src/routes/mcp-chatgpt.test.ts`).
 */
export const MCP_CHATGPT_INSTRUCTIONS =
  'IBANforge checks bank identifiers and states where each answer comes from. ' +
  'validate_iban covers one IBAN, batch_validate_iban several, lookup_bic a BIC/SWIFT code, ' +
  'lookup_ch_clearing a Swiss clearing number (IID), validate_payment_reference a structured payment reference ' +
  'and its pairing with an IBAN, and check_compliance a bank-level compliance triage. ' +
  'These checks establish neither that an account exists, nor who holds it, nor whether a payee name matches, ' +
  'and they approve no payment; IBANforge sends no money. ' +
  'Data that is missing or was not consulted comes back as unknown or null, distinct from a clean result, and each answer carries its source and date. ' +
  'Usage is limited by a weekly allowance shared by every request from the same network source address: ' +
  `one unit per tool request, one per IBAN in batch_validate_iban, reset on ${TRIAL_RESET}. ` +
  'Past the allowance, requests are refused until the reset, and the refusal gives the reset time. ' +
  'Documentation: https://ibanforge.com/docs';

/** What each tool says about the allowance, in place of the line `/mcp` prices. */
export const CHATGPT_ALLOWANCE_NOTE =
  'Counts against a weekly usage allowance shared by the source network address.';

/**
 * The description of each of the six tools: the `/mcp/directory` text
 * (`directoryToolDescriptions` in src/mcp/directory.ts), whose only sentence
 * about a key is the allowance note, ended here with this address's note.
 * One text for the two addresses, so a fact corrected there is corrected here.
 */
export function chatgptDescription(tool: string): string | undefined {
  return directoryToolDescriptions(CHATGPT_ALLOWANCE_NOTE)[tool];
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

/** The `validate_and_explain` prompt, described rather than ordered, with what the check does not establish. */
export const CHATGPT_PROMPT_DESCRIPTION =
  'A prompt template: the validation of one IBAN the user asked about, followed by a plain-language explanation of the result, including what it does not establish.';

export function chatgptValidateAndExplainPrompt(iban: string): string {
  return `Please validate this IBAN and explain the result in plain language for a non-technical user.

IBAN to validate: ${iban}

Use the validate_iban tool first, then:
1. State whether the IBAN is valid or not
2. If valid: name the country, the bank and its BIC with the source the result gives, and whether it is a traditional bank or an e-money institution or neobank
3. Explain the SEPA reachability and whether Verification of Payee (VoP) is required for this country
4. Summarize the risk indicators in plain language, and describe unknown or unconsulted data as unknown
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
