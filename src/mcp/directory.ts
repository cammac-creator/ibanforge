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
 * Kept out of `instructions.ts`: its parity test reads that file as text, and
 * a second constant there is one more thing for its extractor to trip on.
 */
import { TRIAL_RESET } from '../lib/trial.js';
import type { PaywallCause } from '../types.js';
import type { NextStep } from '../lib/next-steps.js';

/** The two hosted addresses of the transport, and which one a session was opened on. */
export type McpVariant = 'mcp' | 'directory';

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
 * The `instructions` block of `initialize` on this address.
 *
 * Every tool named here must be registered (`src/routes/mcp-directory.test.ts`): the block is
 * injected into the model's context BEFORE `tools/list`, so citing a tool that
 * does not exist teaches the agent that the documentation lies.
 */
export const MCP_DIRECTORY_INSTRUCTIONS =
  'Start with validate_iban on any IBAN-looking string (e.g. DE89370400440532013000) — one call returns validity, the issuing bank + BIC, virtual-IBAN/EMI detection, SEPA reachability and VoP readiness. ' +
  `Without a key, a fair-use weekly allowance applies per source address: one unit per tool call, one per IBAN in batch_validate_iban, reset on ${TRIAL_RESET}. ` +
  `Beyond it, ${KEY_SENTENCE} on every request; request_api_key then poll_api_key let a human approve a key in a browser, and both keep answering after the allowance is spent. ` +
  'Missing data or a wrong result? Call send_feedback — a human reads every report. ' +
  'Docs and code samples: https://ibanforge.com/docs';

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

/**
 * The descriptions of the two device-grant tools on this address, rewritten
 * from the `/mcp` text rather than written twice: `scripts/mcp-parity.test.ts`
 * holds that text equal, character for character, on the three MCP surfaces.
 * Each edit names the exact `/mcp` passage it replaces; one that no longer
 * matches leaves the `/mcp` passage in place, and the offer scan of
 * `src/routes/mcp-directory.test.ts` turns red if it names a rail.
 */
const DESCRIPTION_EDITS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>> = {
  request_api_key: [
    [
      '`config_line` (returned by poll_api_key) for Claude Code with the npm package; for the hosted server https://api.ibanforge.com/mcp, the header "Authorization: Bearer <key>", which Claude and Claude Desktop take under Request headers when the custom connector is added; ',
      'the header "Authorization: Bearer <key>", which is the `config_line` poll_api_key returns and which Claude takes under Request headers when the connector is added; ',
    ],
    [
      'you used up the free allowance, a call answers 402, or',
      'you used up the keyless allowance, or',
    ],
  ],
  poll_api_key: [
    ['keep using the keyless allowance or x402;', 'keep using the keyless allowance;'],
  ],
};

export function directoryDescription(tool: string, description: string): string {
  return (DESCRIPTION_EDITS[tool] ?? []).reduce(
    (text, [from, to]) => text.split(from).join(to),
    description,
  );
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
