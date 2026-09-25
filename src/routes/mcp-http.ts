/**
 * HTTP transport for the MCP server.
 *
 * Exposes, via Streamable HTTP at /mcp and compatible with Smithery and remote
 * MCP clients: the eight data tools of the stdio MCP server (validate_iban,
 * batch_validate_iban, lookup_bic, check_compliance, lookup_ch_clearing,
 * validate_payment_reference, check_postal_address, check_swiss_qr_bill), plus
 * the three tools that write — send_feedback, and the device grant pair
 * request_api_key / poll_api_key.
 *
 * 🚨 The count is not written here on purpose. This header claimed "7 data
 * tools plus send_feedback" while the transport served nine, which is the same
 * defect `src/mcp/inventory.ts` exists to cure: a literal beside a moving list
 * always loses. `src/mcp/inventory.ts` is the list; this is a sentence about
 * shape.
 */

import { Hono } from 'hono';
import type { HonoEnv } from '../types.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { validateIBAN } from '../lib/iban.js';
import { createEnrichCache, enrichResult } from '../lib/enrich.js';
import { recordFeedbackRow, FEEDBACK_ERROR_TYPES } from './feedback.js';
import { bicCountryName, bicSourceFields, lookup, namedRow, nonEmpty } from '../lib/bic-lookup.js';
import { validateBIC } from '../lib/bic-validator.js';
import { buildComplianceResponse } from '../lib/compliance-response.js';
import { lookupClearingByBankCode, normalizeIid } from '../lib/ch-clearing.js';
import { validatePaymentReference, buildReferenceCheck } from '../lib/payment-reference.js';
import {
  checkPostalAddress,
  ADDRESS_SCHEMES,
  type AddressScheme,
} from '../lib/address-conformity.js';
import { checkSwissQrBill } from '../lib/swiss-qr-bill.js';

import { extractClientIp } from '../lib/stats.js';
import {
  countDailyUnits,
  countDailyUnitsInMemory,
  countWeeklyTrialUnits,
} from '../lib/daily-ip-ledger.js';
import { TRIAL_RESET, trialResetsAt } from '../lib/trial.js';
import { bumpMcpRemoteDaily } from '../lib/agent-entry-daily.js';
import { ledgerBucket } from '../lib/ledger-bucket.js';
import {
  buildCountriesPayload,
  buildPricingPayload,
  buildValidateAndExplainPrompt,
} from '../lib/mcp-resources.js';
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
import { MCP_INSTRUCTIONS } from '../mcp/instructions.js';
import { TOOL_OUTPUT_SCHEMAS } from '../mcp/output-schemas.js';
import { MCP_WEEKLY_LIMIT, MCP_SESSIONS_PER_IP_DAY } from '../lib/mcp-limits.js';
import { ALLOWANCE_EXEMPT_TOOLS, MCP_TOOLS } from '../mcp/inventory.js';

/** The tools a call may name and be served; parity with registerTool is tested. */
const MCP_TOOL_NAMES: ReadonlySet<string> = new Set(MCP_TOOLS.map((t) => t.name));
import {
  ANONYMOUS_MONTHLY_LIMIT,
  FREE_TIER_MONTHLY_LIMIT,
  KEY_CLAIM_URL,
  KEY_GENERATE_URL,
} from '../lib/tiers.js';
import { keyCreationSource } from '../lib/key-creation-guard.js';
import {
  DEVICE_CODE_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  DEVICE_SLOW_DOWN_INCREMENT_SECONDS,
  DEVICE_TEXTS,
  DEVICE_VERIFICATION_URI,
  awaitGrantSettlement,
  consumeGrantKey,
  deviceConfigLine,
  displayToHuman,
  findGrantBySecret,
  type GrantRow,
  grantMonthlyLimit,
  hashGrantSecret,
  openGrant,
  sanitizeDisplayField,
  secondsUntil,
  touchPoll,
} from '../lib/device-grant.js';

/** Dataset sizes, read once and rounded down so a claim cannot outlive its data. */
const F = datasetFacts();

// The bank-code verdict, "what an agent should do next", the official-identity
// block and the BIC basis/authoritative pair used to be declared here, local
// to this transport. They now live in `../mcp/output-schemas.js` (imported
// above as part of TOOL_OUTPUT_SCHEMAS), shared with `src/mcp/server.ts`
// (MCP-15) — see that module's header for why.

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'));

const mcpHttp = new Hono<HonoEnv>();

// ── Session store ─────────────────────────────────────────────────────────────
/**
 * Active transports, held by session id — with two exit doors.
 *
 * Every open session holds a whole McpServer: 2.77 MB of heap, measured after
 * two forced GCs (security audit SEC-01 / MCP-08, 2026-09-01). Until that audit
 * this was a bare Map with no exit door at all: `onsessionclosed` and `onclose`
 * fire only for a client that sends DELETE or drops its stream, and directory
 * crawlers (Smithery, Glama, MCP.so) do neither — they open a session and walk
 * away. 300 anonymous POSTs from one IP retained 812 MB, and session #1 still
 * answered afterwards, which is the proof that nothing was ever released.
 *
 * So: a session unused for 30 minutes is swept, and the store is capped, the
 * least recently used going first. Both are cheap for a client and decisive for
 * the container — losing a session costs one `initialize`, which every MCP
 * client knows how to send (and which the POST handler now names explicitly);
 * losing the process to an OOM costs every client at once.
 */
const MCP_SESSION_IDLE_MS = 30 * 60 * 1000;
const MCP_MAX_SESSIONS = 300;

export interface McpSessionStore {
  readonly size: number;
  /** Reading a session marks it in use, which is what keeps it out of the sweep. */
  get(id: string, now?: number): WebStandardStreamableHTTPServerTransport | undefined;
  set(id: string, transport: WebStandardStreamableHTTPServerTransport, now?: number): void;
  delete(id: string): boolean;
  /** Drops every session idle for longer than the TTL; returns how many went. */
  sweep(now?: number): number;
}

/**
 * `maxSessions` and `idleMs` are parameters rather than constants read from the
 * module so the eviction rules can be exercised on a store of three sessions
 * instead of three hundred — the alternative is a test that allocates ~830 MB
 * of McpServer and leaves it in the runner for every file that comes after.
 */
export function createMcpSessionStore(
  maxSessions: number = MCP_MAX_SESSIONS,
  idleMs: number = MCP_SESSION_IDLE_MS,
): McpSessionStore {
  interface Entry {
    transport: WebStandardStreamableHTTPServerTransport;
    lastSeen: number;
  }
  // Insertion order is kept as recency order (a read re-inserts), so the head
  // of the Map is always the least recently used entry.
  const entries = new Map<string, Entry>();

  /** Forget the session AND let the SDK release the stream it still holds. */
  const release = (id: string, entry: Entry): void => {
    // Delete first: close() calls back into `onclose`, which deletes again, and
    // this ordering is what makes that re-entry a no-op instead of a surprise.
    entries.delete(id);
    try {
      void Promise.resolve(entry.transport.close()).catch(() => undefined);
    } catch {
      // A transport that refuses to close must not take the sweep down with it.
    }
  };

  return {
    get size(): number {
      return entries.size;
    },
    get(
      id: string,
      now: number = Date.now(),
    ): WebStandardStreamableHTTPServerTransport | undefined {
      const entry = entries.get(id);
      if (!entry) return undefined;
      entry.lastSeen = now;
      entries.delete(id);
      entries.set(id, entry);
      return entry.transport;
    },
    set(
      id: string,
      transport: WebStandardStreamableHTTPServerTransport,
      now: number = Date.now(),
    ): void {
      entries.delete(id);
      while (entries.size >= maxSessions) {
        const oldest = entries.entries().next();
        if (oldest.done) break;
        const [victimId, victim] = oldest.value;
        release(victimId, victim);
      }
      entries.set(id, { transport, lastSeen: now });
    },
    delete(id: string): boolean {
      return entries.delete(id);
    },
    sweep(now: number = Date.now()): number {
      const stale = [...entries].filter(([, entry]) => now - entry.lastSeen >= idleMs);
      for (const [id, entry] of stale) release(id, entry);
      return stale.length;
    },
  };
}

/** The live store. Exported so the idle sweep can be exercised end to end. */
export const mcpSessions = createMcpSessionStore();

/**
 * What this transport costs, said in the description an agent actually reads.
 *
 * Six of the seven data tools named no price at all on either shipped surface
 * (MCP-10, audit 2026-09-01): an agent reading tools/list had no basis on which
 * to decide to pay, so it never did. The catalogue price and the free allowance
 * belong in the same sentence — one without the other either scares the agent
 * off or hides the bill.
 */
// 🚨 Le chiffre est INTERPOLÉ depuis mcp-limits.js, et c'est ce qui rend
// l'interpolation possible : tant que la constante était déclarée plus bas
// dans CE module, l'utiliser ici jetait un ReferenceError à l'import — l'API ne
// démarrait plus.
//
// 🚨 Deux phrases, et c'est voulu (24/09/2026) : depuis que l'accès sans clé de
// ce transport se compte à la semaine, son chiffre est celui de la clé sans
// e-mail au mois. Dans une même phrase, les deux se liraient « la clé vaut la
// même chose que pas de clé » (src/routes/free-doors-claims.test.ts).
export const FREE_TIER_NOTE =
  `free with no key on this transport: ${MCP_WEEKLY_LIMIT} units a week per source address, one per call and ` +
  `one per IBAN in batch_validate_iban, reset on ${TRIAL_RESET}. ` +
  `Or an ifk_ key with no e-mail at all: POST ${KEY_GENERATE_URL} with no body for ` +
  `${ANONYMOUS_MONTHLY_LIMIT} REST calls/month, and POST /v1/keys/claim lifts that same key to ` +
  `${FREE_TIER_MONTHLY_LIMIT} a month`;
const costLine = (price: string): string => `COST: ${price} (${FREE_TIER_NOTE}).`;

/**
 * Say what was billed, and separately what it is worth.
 *
 * Every tool answered `cost_usdc: 0.005` on the free MCP tier, so an agent
 * relaying that field told its operator about a charge nobody made (MCP-17,
 * audit 2026-09-01). `cost_usdc` is now what this call actually cost — zero on
 * this transport — and the catalogue price moves to `list_price_usdc`, which is
 * the number an agent needs to compare paying against the REST route.
 *
 * ⚠️ Both fields must be declared in each tool's outputSchema: the SDK
 * validates the payload against it and drops `structuredContent` silently on a
 * mismatch, so an undeclared field is a field no agent will ever see.
 */
function billedFree(payload: Record<string, unknown>, listPrice?: number): Record<string, unknown> {
  const listed = listPrice ?? payload.cost_usdc;
  if (typeof listed !== 'number') return payload;
  return { ...payload, cost_usdc: 0, list_price_usdc: listed };
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

/**
 * What the tool handlers are allowed to know about the CURRENT caller.
 *
 * 🚨 MUTABLE, and refreshed by the POST handler on every request. Until the
 * device grant landed, no tool handler had any access to the caller at all —
 * `createMcpServer()` took no parameter and the one write this surface did
 * (send_feedback) passed `ipHash: null`.
 *
 * Mutable and not a value, because `createMcpServer()` is called ONCE per
 * session while `request_api_key` and `poll_api_key` are called many times
 * afterwards, potentially from other addresses: the session id travels in a
 * plain header through agent gateways and MCP proxies. A context captured by
 * value at session creation would freeze the address of the session OPENING for
 * the whole of its life, and then:
 *   - the per-network reservation would meter the opening address, not the
 *     caller's;
 *   - and the fingerprint binding below would have no CURRENT fingerprint left
 *     to compare against.
 */
export interface McpCallContext {
  ip: string | null;
  userAgent: string | null;
}

/**
 * The context objects the live tool closures hold, by session id.
 *
 * Kept beside the session store rather than inside it: the store owns
 * transports and its eviction closes them, while this is plain data whose only
 * job is to be mutated in place.
 */
const sessionCtx = new Map<string, McpCallContext>();

/**
 * The last `device_code` requested on a session, WITH the fingerprint that
 * opened it.
 *
 * 🚨 The fingerprint is half of this entry, and it is the half that matters.
 * `poll_api_key` accepts no argument and reuses the last request, so without
 * the binding the session id would become a BEARER OF AN API KEY: the store
 * above attaches a session to no address, and the id travels in clear through
 * every proxy between an agent and here. The generator is sound
 * (`crypto.randomUUID()`), so the id cannot be guessed — what changes without
 * the binding is the blast radius of a LEAK, not its probability. Today a
 * stolen id is worth at most the free unit allowance; without this, it would
 * be worth a live API key, collected by an argument-less `poll_api_key`.
 *
 * Purged on the first successful collection (a grant is collected once anyway)
 * and on `onsessionclosed`.
 *
 * The fingerprint is the one that OPENED the grant, hashed exactly as
 * `openGrant` hashes it — the `'unknown'` sentinel an MCP surface substitutes
 * for an absent address is treated there as an absence, so it is treated as one
 * here too. Hashing it differently would make the binding test pass for the
 * wrong reason.
 */
const sessionDeviceCode = new Map<string, { deviceCode: string; ipHash: string | null }>();

/** The same mapping `openGrant` applies before `keyCreationSource`. */
function mcpFingerprint(ctx: McpCallContext): string | null {
  return ctx.ip && ctx.ip !== 'unknown' ? keyCreationSource(ctx.ip) : null;
}

/** The structured answer of `poll_api_key`, exactly the declared schema. */
interface PollAnswer {
  status:
    'authorization_pending' | 'approved' | 'access_denied' | 'expired_token' | 'invalid_grant';
  api_key: string | null;
  key_prefix: string | null;
  tier: 'anonymous' | 'email' | 'claimed' | 'paid' | null;
  monthly_limit: number | null;
  email: string | null;
  retry_in_seconds: number | null;
  expires_in: number | null;
  config_line: string | null;
  message: string;
}

function pollAnswer(
  partial: Partial<PollAnswer> & { status: PollAnswer['status']; message: string },
): PollAnswer {
  // 🚨 Every field is declared and present, `null` where there is nothing to
  // say. The SDK validates the payload against the output schema and drops
  // `structuredContent` SILENTLY on a mismatch, so a field left out is a field
  // no agent will ever see — and the whole answer goes with it.
  return {
    api_key: null,
    key_prefix: null,
    tier: null,
    monthly_limit: null,
    email: null,
    retry_in_seconds: null,
    expires_in: null,
    config_line: null,
    ...partial,
  };
}

/**
 * The answer when the grant is no longer pending, or no longer alive. `null`
 * means "pending and alive", the only case where we wait.
 *
 * 🚨 The collection is attempted BEFORE the interval check, exactly as the HTTP
 * route does it: an approved key is the terminal answer, and putting two
 * concurrent collections through a `slow_down` would make uniqueness
 * untestable. `consumeGrantKey` stays the sole judge of the race.
 */
function settleDeviceGrant(grant: GrantRow, secretHash: string): PollAnswer | null {
  if (grant.status === 'denied') {
    return pollAnswer({ status: 'access_denied', message: DEVICE_TEXTS.access_denied });
  }
  if (grant.status === 'delivered') {
    return pollAnswer({ status: 'invalid_grant', message: DEVICE_TEXTS.invalid_grant });
  }
  if (grant.status === 'approved') {
    // 🚨 Le second argument est le RAIL, et il est obligatoire : un nonce de
    // paiement présenté ici ne rend rien.
    const minted = consumeGrantKey(secretHash, 'device');
    if (minted) {
      return pollAnswer({
        status: 'approved',
        api_key: minted.api_key,
        key_prefix: minted.key_prefix,
        tier: minted.tier,
        monthly_limit: grantMonthlyLimit(minted.tier, minted.monthly_limit),
        // Absent on the anonymous tier on the REST route; here the schema
        // declares the field, so it is `null` rather than missing — and `null`
        // is not a word an agent can mistake for an address.
        email: minted.email,
        config_line: deviceConfigLine(minted.api_key),
        message: DEVICE_TEXTS.saved,
      });
    }
    // Approved but nothing left to hand over: either the collection window
    // closed, or a concurrent race won. Both answers are honest and different,
    // and that is what lets the agent know whether it may re-open a grant.
    return grant.expired === 1
      ? pollAnswer({ status: 'expired_token', message: DEVICE_TEXTS.expired_token })
      : pollAnswer({ status: 'invalid_grant', message: DEVICE_TEXTS.invalid_grant });
  }
  if (grant.status === 'expired' || grant.expired === 1) {
    return pollAnswer({ status: 'expired_token', message: DEVICE_TEXTS.expired_token });
  }
  return null;
}

/**
 * `poll_api_key` on this surface: the database directly, no HTTP.
 *
 * The long wait is `awaitGrantSettlement` — the SAME loop the HTTP route runs,
 * with the same three `pollsInFlight` ceilings. Two loops would have given two
 * behaviours under saturation, and both answer `authorization_pending`, so
 * nothing would say which one was right.
 */
async function collectDeviceGrant(secret: string, ipHash: string | null): Promise<PollAnswer> {
  const secretHash = hashGrantSecret(secret);
  const grant = findGrantBySecret(secret, 'device');
  if (!grant) {
    return pollAnswer({ status: 'invalid_grant', message: DEVICE_TEXTS.invalid_grant });
  }

  const settled = settleDeviceGrant(grant, secretHash);
  if (settled) return settled;

  // 🚨 `slow_down` has no place in the output enum (§2.7 names five statuses),
  // and inventing a sixth would drop `structuredContent` in silence. An agent
  // polling too fast is an agent that must wait, which is exactly what
  // `authorization_pending` plus `retry_in_seconds` already says — so it is
  // reported as that, with the RFC 8628 increment added to the interval.
  if (touchPoll(secretHash, 'device') === 'slow_down') {
    return pollAnswer({
      status: 'authorization_pending',
      retry_in_seconds: DEVICE_POLL_INTERVAL_SECONDS + DEVICE_SLOW_DOWN_INCREMENT_SECONDS,
      expires_in: grant.expires_in,
      message: DEVICE_TEXTS.slow_down,
    });
  }

  const waited = await awaitGrantSettlement(secret, 'device', grant, ipHash);
  if (waited.kind === 'vanished') {
    return pollAnswer({ status: 'invalid_grant', message: DEVICE_TEXTS.invalid_grant });
  }

  const after = settleDeviceGrant(waited.grant, secretHash);
  if (after) return after;
  return pollAnswer({
    status: 'authorization_pending',
    retry_in_seconds: DEVICE_POLL_INTERVAL_SECONDS,
    expires_in: secondsUntil(waited.grant.expires_at),
    message: DEVICE_TEXTS.authorization_pending,
  });
}

function createMcpServer(ctx: McpCallContext, sessionKey: () => string | undefined): McpServer {
  const server = new McpServer(
    {
      name: 'ibanforge',
      title: 'IBANforge',
      version: pkg.version,
      // The first line every MCP client and directory reads. Written once in
      // src/lib/positioning.ts, where the register countries and the share of
      // the frozen 2018 directory copy are read from the data (24/09/2026).
      description: serverDescription(),
      websiteUrl: 'https://ibanforge.com',
      icons: [
        {
          src: 'https://www.ibanforge.com/favicon.ico',
          mimeType: 'image/vnd.microsoft.icon',
          sizes: ['64x64'],
        },
        {
          src: 'https://api.ibanforge.com/og-image.png',
          mimeType: 'image/svg+xml',
          sizes: ['1200x630'],
        },
      ],
    },
    {
      // Injected by MCP clients into their model's context at connect time —
      // the single best-placed sentences we own. Shared with the two stdio
      // surfaces since 2026-09-01 (MCP-11): three copies of one paragraph is
      // three chances to fix one and forget two.
      instructions: MCP_INSTRUCTIONS,
    },
  );

  server.registerTool(
    'validate_iban',
    {
      title: 'Validate IBAN',
      description:
        `Verify whether an IBAN from any of the ${F.claim.countries} IBAN countries is valid AND enrich it with bank, compliance and routing data. ` +
        'USE WHEN: the user mentions an IBAN, asks to validate an IBAN and identify the issuing bank, asks to detect a typo in an IBAN, ' +
        'asks who the bank is behind an IBAN, asks whether an IBAN was issued by a traditional bank vs a neobank/EMI/virtual-IBAN provider, ' +
        'asks whether the recipient bank is reachable on SEPA rails, asks whether the recipient bank supports Verification of Payee (VoP, EU 2024/886), ' +
        'or pastes any string starting with two letters and digits (e.g., "DE89...", "CH93...", "FR76..."). ' +
        'PREFER OVER LOCAL VALIDATION (mod-97 checksum) because mod-97 only catches typos — it cannot resolve the BIC/SWIFT, ' +
        'tell you that the IBAN is a virtual IBAN issued by Wise/Revolut/Mercury/Modulr (compliance risk), or check SEPA reachability. ' +
        `RETURNS: ${VALIDATE_TRUTH_RETURNS} ` +
        'valid (boolean), bank_code_holder, checks, country { code, name }, bic { code, bic8, redirected_from?, bank_name, city, basis, authoritative, source, as_of, source_as_of?, listed_in_current_source, lei, lei_status, address { street, post_code, region, city, country, romanized, romanization, source, language, as_of } } — basis says WHERE the bank code to BIC pairing came from (national_register | curated_map | directory_prefix) and authoritative, derived from it, says whether the BIC may be stored and settled against; outside a national_register pairing the BIC is advisory, confirm it before it becomes a routing instruction. code is 8 or 11 characters, as the consulted source publishes it: COMPARE A SUPPLIED BIC ON bic8, never on code — the branch code is informational and in a cooperative network it names the LOCAL bank while the first eight name its clearing institution (Swiss IID 30020 is RBABCH22180, Crédit Mutuel de la Vallée SA, while RBABCH22 alone is Entris Banking AG). redirected_from is present when the register answered for the bank code that took over the one you asked about (CH/LI: SIX redirects a concatenated IID, which does not make the IBAN invalid) — lei and address are read from the same directory row /v1/bic/:code serves, so this call already carries them; both are null when GLEIF publishes nothing for that BIC, which means "no LEI on file", not "the institution has none". bic.address is the LEGAL ENTITY seat, so bic.address.city may legitimately differ from bic.city (the register city for THIS bank code), and bic.address.as_of dates the entity last filing, usually much older than bic.as_of. ' +
        'issuer { type: bank | digital_bank | emi | payment_institution, name }, sepa { member, schemes, vop_required, vop_participant — is the resolved bank listed as ready in the EPC VoP register, bank_reachability, bank_schemes, vop_register_status: the bank itself in the EPC registers, never the country }, ' +
        'risk_indicators { issuer_type (null when no institution resolved), country_risk, test_bic, sepa_reachable, sepa_reachable_scope, vop_coverage }, and for CH/LI: clearing { iid, name, type, sic, qr_iid }. ' +
        'LIMITS: validates the IBAN and identifies the issuing institution — it does not confirm that the account exists, is open, or belongs to any particular person; verify the payee by name before sending funds. ' +
        'IMPORTANT — bic: null does not mean the bank code is wrong. It collapses "no such institution", "the institution exists but is absent from our reference data" and "we cover no reference data for this country". Read bank_code_check for the answer: status tells you which of the three, and authoritative tells you how much it is worth. ' +
        `${authoritativeVerdictSentence()} ` +
        'match: prefix with candidates > 1 means the BIC was picked from several and may belong to a different institution. ' +
        costLine('$0.005 per call'),
      inputSchema: {
        iban: z.string().describe('IBAN to validate (spaces/hyphens stripped automatically)'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.validate_iban,
      annotations: { title: 'Validate IBAN', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iban }) => {
      const result = validateIBAN(iban);
      enrichResult(result);
      const payload = billedFree(result as unknown as Record<string, unknown>);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  server.registerTool(
    'batch_validate_iban',
    {
      title: 'Batch Validate IBANs',
      description:
        'Validate up to 100 IBANs in a single call. Paid per call in USDC via x402, it costs $0.002 per IBAN instead of $0.005 per validate_iban call; ' +
        'on an API key or a credit pack each IBAN uses one request or credit, the same as one validate_iban call. ' +
        'USE WHEN: the user pastes a list of IBANs, asks to clean a CSV/spreadsheet of bank accounts, ' +
        'asks to dedupe a customer database, asks to triage a payout list before sending, ' +
        'or whenever you would otherwise call validate_iban more than 2-3 times in a row. ' +
        'RETURNS: { results: [...same shape as validate_iban], count, valid_count }. ' +
        costLine('$0.002 USDC per IBAN via x402'),
      inputSchema: {
        ibans: z.array(z.string()).min(1).max(100).describe('Array of IBANs (1-100)'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.batch_validate_iban,
      annotations: { title: 'Batch Validate IBANs', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ ibans }) => {
      // One cache for the whole batch: a payout list is mostly the same few
      // banks, and without it every row re-resolves the same bank from scratch
      // (PERF-05). Same shape as the REST route in src/routes/iban-batch.ts.
      const cache = createEnrichCache();
      const results = ibans.map((iban) => {
        const result = validateIBAN(iban);
        enrichResult(result, cache);
        // The list price is stated explicitly here because `enrichResult`
        // stamps every row with the SINGLE-call price (0.005) while a row of a
        // batch is catalogued at 0.002 — the 60% discount this tool's own
        // description sells. Reading the field back from the row would publish
        // the wrong catalogue number under the right name.
        return billedFree(result as unknown as Record<string, unknown>, 0.002);
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
        structuredContent: { results, count: results.length },
      };
    },
  );

  server.registerTool(
    'lookup_bic',
    {
      title: 'Lookup BIC/SWIFT',
      description:
        'Resolve a BIC / SWIFT code into the underlying bank: name, country, city, LEI, and registered head-office address (where available). ' +
        'USE WHEN: the user already has a BIC/SWIFT (8 or 11 chars, alphanumeric, e.g., "UBSWCHZH80A", "DEUTDEFF") ' +
        'and asks which bank it belongs to, where the bank is, or its LEI for compliance/regulatory matching. ' +
        'DO NOT USE for IBAN inputs — call validate_iban instead, it resolves the BIC for you. ' +
        `BACKED BY: ${bicDirectorySentence({ withCount: true })} ${F.claim.lei} of the rows carry an LEI from GLEIF. ` +
        `SOURCE: ${bicSourceNote({ withMonth: true })} ` +
        costLine('$0.003 per call'),
      inputSchema: {
        bic: z.string().describe('BIC/SWIFT code (8 or 11 chars)'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.lookup_bic,
      annotations: { title: 'Lookup BIC/SWIFT', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ bic }) => {
      const validation = validateBIC(bic);
      if (!validation.valid) {
        const errorPayload = { bic: validation.bic, valid: false, error: validation.error };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(errorPayload, null, 2),
            },
          ],
          structuredContent: errorPayload as unknown as Record<string, unknown>,
        };
      }
      // Une fiche complète ou introuvable, comme GET /v1/bic/:code (25/09/2026).
      const row = namedRow(lookup(validation.bic11!));
      const result = {
        bic: validation.bic,
        bic8: validation.bic8,
        bic11: validation.bic11,
        valid_format: true,
        found: row !== null,
        institution: row?.institution ?? null,
        country_code: validation.country_code,
        country_name: row?.country_name ?? null,
        // Aligned on the REST shape (GET /v1/bic/:code returns country: {code, name}),
        // which validate_iban already used on both surfaces. The flat pair stays
        // for now so no agent breaks mid-conversation; it is deprecated and dated
        // in the tool description.
        //
        // The two keep DIFFERENT null semantics on purpose. REST gives the ISO
        // name (the code only when no name exists) when the row carries none; the
        // flat MCP key has always answered null. Mirroring REST into `country.name` while leaving
        // `country_name: null` is the honest reading of both histories: the nested
        // object is the aligned one, the flat pair is preserved exactly as it was.
        country: {
          code: validation.country_code,
          name: bicCountryName(row, validation.country_code!),
        },
        city: nonEmpty(row?.city),
        branch_code: validation.branch_code,
        branch_info: row?.branch_info ?? null,
        lei: row?.lei ?? null,
        lei_status: row?.lei_status ?? null,
        is_test_bic: validation.is_test_bic,
        // La source de la ligne, que cet outil ne rendait pas du tout, et la
        // trace du BIC8 dans une liste de ce cycle : mêmes champs que REST.
        source: row?.source ?? null,
        ...bicSourceFields(row, validation.bic8!),
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'check_compliance',
    {
      title: 'Compliance Check',
      description:
        'Run a pre-flight compliance triage on an IBAN before sending a SEPA / cross-border payment. ' +
        'USE WHEN: the user is about to send a payment / payout / refund and wants to triage risk first, ' +
        "asks whether the payee's bank or its country is under sanctions, asks if a SEPA Instant transfer can reach the bank, " +
        'or needs a numeric risk score for an internal payment-approval workflow. ' +
        'NOT A REGULATED AML/CFT PRODUCT — informational triage only. For regulated screening use Refinitiv, Acuris, or ComplyAdvantage. ' +
        `CHECKS: IBAN validity + ${BANK_LEVEL_SANCTIONS} + FATF status + SEPA Instant reachability + whether the EPC Verification of Payee (VoP) register lists the bank as ready; the name check itself is done by the payee's bank, never here. ` +
        'RETURNS: the full validate enrichment plus a compliance object with risk_score (0-100, 0 = safest), risk_level (low/medium/elevated/high/critical), sanctions matched_lists + fatf_status, reachability, vop status, and flags[] (e.g. sanctioned_country, fatf_grey_list, emi_issuer, no_vop). ' +
        `${COMPLIANCE_HONEST_NAMES} ` +
        costLine('$0.02 per call'),
      inputSchema: {
        iban: z.string().describe('IBAN to check'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.check_compliance,
      annotations: { title: 'Compliance Check', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iban }) => {
      // Shared with the REST route and the stdio MCP server. See
      // src/lib/compliance-response.ts. This copy was the one that omitted
      // `meta`, so the surface agents actually reach never carried the
      // disclaimer saying the screening is on the bank, not the beneficiary.
      const combined = billedFree({ ...buildComplianceResponse(iban), cost_usdc: 0.02 });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(combined, null, 2) }],
        structuredContent: combined,
      };
    },
  );

  server.registerTool(
    'validate_payment_reference',
    {
      title: 'Validate Payment Reference',
      description:
        'Validate a structured payment reference and, when an IBAN is supplied, decide whether the two may legally travel together. ' +
        'USE WHEN: assembling a payment instruction from an invoice, a QR-bill or a remittance advice; whenever a Swiss IBAN and a reference appear together (the pairing rule is what most integrations get wrong); ' +
        'or when the user pastes an "RF..." string, a 27-digit number, a +++123/4567/89012+++ block, or asks whether a payment reference is correct. ' +
        'DO NOT USE to validate the IBAN itself — that is validate_iban. ' +
        'SCHEMES: RF Creditor Reference (ISO 11649, "SCOR" in Swiss Payment Standards, mod 97-10); Swiss QR reference ("QRR", 27 digits, modulo 10 recursive); Belgian OGM/VCS (12 digits, modulo 97, a remainder of 0 written 97); Finnish viitenumero (4-20 digits, weights 7-3-1 from the right). ' +
        'Norwegian KID and Swedish OCR are RECOGNISED but never judged: they answer valid: null with status unverifiable_without_creditor_config, because modulus type and length are configured per creditor account by the beneficiary bank and are not a property of the string. NEVER relay those to a user as "invalid" — say the check needs the creditor bank configuration. ' +
        'AMBIGUITY: only a leading "RF" and a 27-digit length pin a scheme down. A bare 12-digit string is both a Belgian OGM and a legal Finnish length, so the more specific reading is returned and the other appears in also_valid_as. Pass reference_type when you know the country. ' +
        "THE PAIRING RULE — the part no checksum library reproduces: pass an iban and you also get a pairing verdict. Per the Swiss Implementation Guidelines a QRR reference may ONLY be used with a QR-IBAN (institution identifier in the SIX range 30000-31999), and an ISO 11649 reference may NOT be used with one. Outside CH and LI, pairing is not_applicable — there is no QR-IBAN to pair against — and that does not affect the reference's own checksum verdict. " +
        'IMPORTANT: valid and pairing are INDEPENDENT. A reference can be arithmetically valid and still illegal on that account. Read both, and relay source/as_of — they are what makes the verdict auditable. ' +
        'FREE: the checksums are published commodities. The paid surface is POST /v1/iban/validate, which returns this same pairing block with the full IBAN enrichment. ' +
        costLine('$0 per call, on every surface'),
      inputSchema: {
        reference: z
          .string()
          .describe(
            'The reference as printed; spaces, slashes and the +++…+++ wrapper are stripped',
          ),
        reference_type: z
          .string()
          .optional()
          .describe('Optional hint: rf | scor | qrr | ogm | vcs | viitenumero | kid | ocr'),
        iban: z
          .string()
          .optional()
          .describe('Optional creditor IBAN — supply it to get the pairing verdict'),
      },
      // 🚨 Every field the handler can emit MUST be named here. The SDK
      // validates output against this schema and Zod SILENTLY STRIPS what it
      // does not name, so an omitted field vanishes from structuredContent with
      // no error at all — including `source`, which carries the provenance this
      // whole feature is built on. See the note above NEXT_STEPS_SCHEMA in
      // ../mcp/output-schemas.js.
      outputSchema: TOOL_OUTPUT_SCHEMAS.validate_payment_reference,
      annotations: { title: 'Validate Payment Reference', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ reference, reference_type, iban }) => {
      const payload = iban
        ? buildReferenceCheck(validateIBAN(iban), reference, reference_type ?? null)
        : validatePaymentReference(reference, reference_type ?? null);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'check_swiss_qr_bill',
    {
      title: 'Check Swiss QR-bill Payload',
      description:
        "Check a Swiss QR-bill payload, the text a QR-bill's code carries (starts with SPC), rule by rule, each finding citing the SIX document it comes from. USE WHEN: an agent, an ERP or an accounting tool holds a scanned or generated QR-bill and must know before paying or issuing it whether it is well-formed, whether the reference type matches the IBAN (QRR needs a QR-IBAN, IID 30000-31999), and above all whether the creditor and debtor addresses are STRUCTURED (type S) or still COMBINED (type K): the standard removed type K on 21.11.2025 and banks stop processing payments built on it from 14.11.2026. DO NOT USE to learn which bank holds the account or its payment-rail participation: that is the paid validate_iban. RETURNS: { valid, ready_for_2026_11_14, creditor_iban { value, valid, country, qr_iban, iid }, creditor { present, address, structured, sps_check, proposed_structured }, ultimate_debtor, amount, currency, reference { type, value, valid, note }, findings [{ code, severity, field, detail, source }], next_steps, source }. A combined address comes back with proposed_structured, the S-type fields derived from the combined lines, to relay as a fix. IMPORTANT: relay each finding's source string. " +
        costLine('$0 per call, on every surface'),
      inputSchema: {
        payload: z
          .string()
          .min(1)
          .max(4000)
          .describe(
            'The Swiss QR Code text with real line breaks: SPC, 0200, 1, IBAN, creditor (7 lines), ultimate creditor (7 empty lines), amount, currency, ultimate debtor (7 lines), reference type, reference, message, EPD, optional billing information and alternative schemes.',
          ),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.check_swiss_qr_bill,
      annotations: { title: 'Check Swiss QR-bill Payload', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ payload }) => {
      const result = checkSwissQrBill(payload);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'check_postal_address',
    {
      title: 'Check ISO 20022 Postal Address',
      description:
        "Check a structured ISO 20022 postal address against a payment rail's published address rules, rule by rule, each verdict citing the document it comes from. " +
        'USE WHEN: assembling a payment instruction (pain.001, a Fedwire message, a T2 transfer) with a creditor or debtor address, to learn whether the rail accepts it BEFORE submitting. The November 2026 changes (SIC 20.11, Fedwire 16.11, T2 R2026.NOV) remove the fully unstructured address option — this check tells you whether an address survives them. ' +
        'DO NOT USE to verify that a street or town EXISTS: this checks conformity with the message format rules, not postal reality. ' +
        "SCHEMES: 'sps' (Swiss Payment Standards, SIX), 'hvps_plus' (HVPS+ / T2, ECB), 'fedwire' (Federal Reserve). There is deliberately NO 'cbpr+' scheme: that guideline sits behind swift.com, unreachable to automated readers, and a conformity boolean quoting an unread document would be a guess dressed as a verdict — the note field restates this on every answer. " +
        'VERDICTS: pass, fail, and not_applicable — the last marks a rule whose precondition is not met and never counts as a pass. conforms is true when no finding failed. ' +
        "IMPORTANT: relay each finding's source string — it names the exact document, version and validity date the rule is quoted from. They are what makes the verdict auditable. " +
        'FREE: the rules are published commodities. The paid surface is the postal_address block that /v1/bic and /v1/iban/validate return for the resolved institution. ' +
        costLine('$0 per call, on every surface'),
      inputSchema: {
        scheme: z
          .enum(ADDRESS_SCHEMES as [AddressScheme, ...AddressScheme[]])
          .describe("Which rail's rules to check against: sps | hvps_plus | fedwire"),
        address: z
          .object({
            twn_nm: z.string().optional().describe('TwnNm — town name'),
            ctry: z.string().optional().describe('Ctry — ISO 3166-1 alpha-2 country code'),
            pst_cd: z.string().optional().describe('PstCd — postal code'),
            strt_nm: z.string().optional().describe('StrtNm — street name'),
            bldg_nb: z.string().optional().describe('BldgNb — building number'),
            adr_tp: z.string().optional().describe('AdrTp — address type (SPS forbids sending it)'),
            adr_line: z
              .array(z.string())
              .optional()
              .describe('AdrLine — free-text lines of the hybrid address'),
          })
          .strict()
          .describe('The ISO 20022 PostalAddress under test, in ISO tag vocabulary (snake_cased).'),
      },
      // 🚨 Every field the handler can emit MUST be named here — the SDK
      // silently strips what the output schema does not name, `source` and
      // `detail` included, which are the whole point of the findings.
      outputSchema: TOOL_OUTPUT_SCHEMAS.check_postal_address,
      annotations: { title: 'Check ISO 20022 Postal Address', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ scheme, address }) => {
      const payload = checkPostalAddress(scheme, address);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'lookup_ch_clearing',
    {
      title: 'Swiss Clearing Lookup',
      description:
        'Resolve a Swiss BC-Nummer / IID (1 to 5 digits) into the underlying institution. ' +
        'USE WHEN: the user mentions a Swiss bank by BC-Nummer or IID, pastes a CH or LI IBAN clearing code, ' +
        'asks routing details for a Swiss instant transfer (SIC, euroSIC), asks about QR-bill QR-IID resolution, ' +
        'or needs to classify a Swiss financial institution (bank vs PFS vs SIC-only participant). ' +
        'EVERY IID OF THE SIX BANKMASTER, with its full payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus QR-IID allocation, not just a name lookup. ' +
        `BACKED BY: ${F.claim.chClearing} SIX BankMaster entries (Swiss official source, refreshed monthly). ` +
        'RETURNS: institution { name, type, iid_type, headquarters_iid }, address, bic, payment_services { sic, rtgs_chf, instant_payments_chf, eurosic, lsv_bdd_chf, lsv_bdd_eur }, sic_iid, qr_iid, valid_on. ' +
        'Only relevant for CH and LI accounts. ' +
        costLine('$0.003 per call'),
      inputSchema: {
        iid: z.string().describe('Swiss IID (1-5 digit number)'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.lookup_ch_clearing,
      annotations: { title: 'Swiss Clearing Lookup', ...READ_ONLY_ANNOTATIONS },
    },
    async ({ iid }) => {
      if (!/^\d{1,5}$/.test(iid)) {
        const errorPayload = {
          error: 'invalid_iid_format',
          message: 'IID must be a 1-5 digit number.',
        };
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(errorPayload, null, 2),
            },
          ],
          structuredContent: errorPayload as unknown as Record<string, unknown>,
        };
      }
      const normalizedIid = normalizeIid(iid);
      const entry = lookupClearingByBankCode(normalizedIid);
      if (!entry) {
        const notFoundPayload = billedFree({
          iid: normalizedIid,
          found: false,
          error: 'clearing_not_found',
          message: `IID ${normalizedIid} not found in Swiss BankMaster database.`,
          cost_usdc: 0.003,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(notFoundPayload, null, 2),
            },
          ],
          structuredContent: notFoundPayload,
        };
      }
      const result: Record<string, unknown> = {
        iid: entry.iid,
        found: true,
        institution: {
          name: entry.name,
          type: entry.institution_type,
          iid_type: entry.iid_type,
          headquarters_iid: entry.headquarters_iid,
        },
        address: entry.address,
        bic: entry.bic,
        payment_services: entry.payment_services,
        sic_iid: entry.sic_iid,
        qr_iid: entry.qr_iid,
        valid_on: entry.valid_on,
        cost_usdc: 0.003,
      };
      if (entry.redirected_from) {
        result.redirected_from = entry.redirected_from;
        result.note = `IID ${entry.redirected_from} has been merged into IID ${entry.iid}.`;
      }
      const payload = billedFree(result);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  // ── Resources ──────────────────────────────────────────────────────────────

  server.registerResource(
    'countries',
    'ibanforge://countries',
    {
      title: 'Supported Countries',
      description:
        'List of all 89 countries supported by IBANforge with IBAN length, SEPA membership, VoP status, and country risk classification.',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'ibanforge://countries',
          mimeType: 'application/json',
          text: JSON.stringify(buildCountriesPayload(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    'pricing',
    'ibanforge://pricing',
    {
      title: 'Pricing',
      description:
        'Per-call pricing for IBANforge API endpoints (USDC on Base L2 via x402 protocol).',
      mimeType: 'application/json',
    },
    async () => ({
      contents: [
        {
          uri: 'ibanforge://pricing',
          mimeType: 'application/json',
          text: JSON.stringify(buildPricingPayload(), null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    'send_feedback',
    {
      title: 'Send Feedback to IBANforge',
      description:
        'Report a problem or a need directly to the IBANforge operators: incorrect validation result, stale or missing BIC/bank data, ' +
        'latency, or anything blocking you from using or PAYING for the service (missing network, unclear pricing, quota shape). ' +
        'USE WHEN: a result looks wrong, data you need is missing, or you hit a wall (quota, payment, capability) and want it fixed. ' +
        'This tool is free and does NOT count against the free allowance — it works even after the allowance is spent. ' +
        'A human reads every report; verified data errors on paid x402 calls are refunded on-chain.',
      inputSchema: {
        error_type: z
          .enum(FEEDBACK_ERROR_TYPES)
          .describe(
            'Category of the report. Use "other" for product feedback, pricing/payment blockers or feature needs.',
          ),
        notes: z
          .string()
          .min(3)
          .max(4000)
          .describe('What happened, what you needed, or what blocked you — free text.'),
        endpoint: z
          .string()
          .max(200)
          .optional()
          .describe('Endpoint or tool concerned, e.g. /v1/iban/batch.'),
        expected: z.string().max(1000).optional().describe('What you expected (for data errors).'),
        got: z
          .string()
          .max(1000)
          .optional()
          .describe('What you received instead (for data errors).'),
        contact: z
          .string()
          .max(255)
          .optional()
          .describe('Where we may answer you (e-mail) — optional, reports can be anonymous.'),
        agent: z
          .string()
          .max(120)
          .optional()
          .describe('Which agent/model is reporting, e.g. "claude-sonnet-5 via MCP".'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.send_feedback,
      annotations: { title: 'Send Feedback to IBANforge' },
    },
    async ({ error_type, notes, endpoint, expected, got, contact, agent }) => {
      const id = recordFeedbackRow({
        error_type,
        notes,
        endpoint: endpoint ?? null,
        expected,
        got,
        contact: contact ?? null,
        agent: agent ?? 'mcp',
        // Was `null` until the call context landed (2026-09-15), which made
        // every report from this transport untraceable. Free benefit of the
        // signature change, taken because it was free.
        ipHash: mcpFingerprint(ctx),
      });
      const payload = { ok: true, id };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  // ── Device grant (RFC 8628) ────────────────────────────────────────────────
  //
  // 🚨 Ces deux outils appellent le module EN DIRECT, sans HTTP, comme
  // send_feedback — et en passant par `openGrant()`, qui porte la réservation
  // par réseau et le plafond horaire. Aucune serrure n'est recopiée ici : une
  // garde laissée dans le handler serait une porte sans plafond et sans journal
  // pour les deux autres surfaces.
  //
  // 🚨 Ni l'un ni l'autre ne porte `costLine()`. Un outil dont le rôle est de
  // DONNER la clé ne peut pas afficher « ou prenez une clé gratuite » : ce
  // serait une boucle. Ils le disent dans leurs propres mots à la place.

  server.registerTool(
    'request_api_key',
    {
      title: 'Request an IBANforge API key',
      description:
        'Start the process that gives this session its own free IBANforge API key, without any e-mail address and without leaving your conversation. ' +
        'USE WHEN: you used up the free allowance, a call answers 402, or you are about to run more than a handful of validations. ' +
        'WHAT YOU MUST DO WITH THE RESULT: read `status` first — `ok` means a code was issued, anything else means no code exists and `display_to_human` tells you and your human what to do instead. ' +
        'On `ok`, show `display_to_human` to your human VERBATIM (the user_code and the link) and say, in your own words, that opening the link and approving takes about fifteen seconds and asks for nothing. ' +
        'Do NOT open the link yourself, do NOT fill anything in on their behalf, and do NOT invent an e-mail address: the page gives a key with no address at all, and your human may add one if THEY choose. ' +
        'Then call poll_api_key. ' +
        'This tool is free and does NOT count against the free allowance — it works even after the allowance is spent.',
      inputSchema: {
        client_name: z
          .string()
          .max(60)
          .optional()
          .describe('Optional. Who is asking, shown to the human on the approval page.'),
        reason: z
          .string()
          .max(200)
          .optional()
          .describe('Optional. What the key is for, shown to the human on the approval page.'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.request_api_key,
      annotations: {
        title: 'Request an IBANforge API key',
        // It writes a row, so it is not read-only — the same reasoning as
        // send_feedback, which deliberately carries no READ_ONLY either.
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ client_name, reason }) => {
      const result = openGrant({
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        // Cleaned here because both will be SHOWN TO A HUMAN on a page they
        // believe is ours. A field that survives none of the cleaning is not an
        // error: it becomes null and the page shows its fallback label.
        clientName: sanitizeDisplayField(client_name, 60),
        reason: sanitizeDisplayField(reason, 200),
        source: 'mcp-device',
      });

      if (!result.ok) {
        // 🚨 NI `isError` NI une erreur d'outil. Depuis que `openGrant()` porte
        // la réservation sur les trois surfaces, cet outil PEUT être refusé, et
        // un agent qui reçoit un échec dur conclut à une panne au lieu de
        // prendre le chemin de repli — l'essai sans clé, x402 — que ce module
        // existe précisément pour ouvrir. Le refus arrive donc peuplé, avec son
        // `display_to_human`.
        const refused = {
          status: result.error,
          user_code: null,
          verification_uri: null,
          verification_uri_complete: null,
          expires_in: null,
          interval: null,
          display_to_human: displayToHuman({ status: result.error }),
        };
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(refused) }],
          structuredContent: refused as unknown as Record<string, unknown>,
        };
      }

      // 🚨 Le `device_code` va dans la mémoire de session, JAMAIS dans la
      // sortie. C'est le porteur unique de la clé, et une sortie d'outil
      // traverse le transcript du modèle, les journaux du client et les
      // copier-coller de rapport d'incident.
      const id = sessionKey();
      if (id) {
        sessionDeviceCode.set(id, {
          deviceCode: result.deviceCode,
          ipHash: mcpFingerprint(ctx),
        });
      }

      const verificationUriComplete = `${DEVICE_VERIFICATION_URI}?code=${encodeURIComponent(result.userCode)}`;
      const payload = {
        status: 'ok' as const,
        user_code: result.userCode,
        verification_uri: DEVICE_VERIFICATION_URI,
        verification_uri_complete: verificationUriComplete,
        expires_in: result.expiresIn,
        interval: DEVICE_POLL_INTERVAL_SECONDS,
        display_to_human: displayToHuman({
          status: 'ok',
          userCode: result.userCode,
          verificationUriComplete,
        }),
      };
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    'poll_api_key',
    {
      title: 'Collect the approved IBANforge API key',
      description:
        'Collect the API key once a human has approved the request opened by request_api_key. ' +
        'USE WHEN: you have called request_api_key and shown the code to your human. ' +
        'HOW TO CALL IT: leave `device_code` empty to reuse the last request from this session. ' +
        'The server usually waits up to thirty seconds before answering, and sometimes answers at once when it is busy — either way, calling it once per minute is enough, never in a tight loop. ' +
        'WHAT THE ANSWERS MEAN: `authorization_pending` is normal and means nobody has approved yet — wait `retry_in_seconds` and call again; ' +
        '`approved` carries the key ONCE and never again, so hand it to your human immediately together with `config_line`; ' +
        '`access_denied` means somebody refused — tell your human, ask THEM whether to try again, and open at most ONE more request; ' +
        '`expired_token` means the code timed out — you may call request_api_key ONE more time, and if that expires too, stop and keep using the keyless allowance or x402; ' +
        '`invalid_grant` means this code can no longer be used at all — stop. ' +
        'This tool is free and does NOT count against the free allowance.',
      inputSchema: {
        device_code: z
          .string()
          .optional()
          .describe('Optional. Leave it empty to reuse the last request from this session.'),
      },
      outputSchema: TOOL_OUTPUT_SCHEMAS.poll_api_key,
      annotations: {
        title: 'Collect the approved IBANforge API key',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async ({ device_code }) => {
      const id = sessionKey();
      const remembered = id ? sessionDeviceCode.get(id) : undefined;
      const explicit = typeof device_code === 'string' && device_code.trim() !== '';
      let answer: PollAnswer;

      if (explicit) {
        answer = await collectDeviceGrant(device_code!.trim(), mcpFingerprint(ctx));
      } else if (!remembered) {
        answer = pollAnswer({ status: 'invalid_grant', message: DEVICE_TEXTS.invalid_grant });
      } else if (remembered.ipHash !== mcpFingerprint(ctx)) {
        // 🚨 LA LIAISON À L'EMPREINTE, et c'est elle qui empêche l'identifiant
        // de session de devenir un porteur de clé API. Sans elle, le vol d'un
        // `mcp-session-id` — qui voyage en clair dans un en-tête à travers les
        // passerelles d'agents et les proxys MCP — donnerait une clé vivante,
        // retirée par un `poll_api_key` sans argument.
        answer = pollAnswer({ status: 'invalid_grant', message: DEVICE_TEXTS.invalid_grant });
      } else {
        answer = await collectDeviceGrant(remembered.deviceCode, remembered.ipHash);
      }

      // Purgée au PREMIER retrait réussi : le grant ne se retire qu'une fois de
      // toute façon, et laisser l'entrée ferait répondre « clé déjà remise »
      // sur un grant que l'agent croit encore ouvert.
      if (id && answer.status === 'approved') sessionDeviceCode.delete(id);

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(answer) }],
        structuredContent: answer as unknown as Record<string, unknown>,
      };
    },
  );

  // ── Prompts ────────────────────────────────────────────────────────────────

  server.registerPrompt(
    'validate_and_explain',
    {
      title: 'Validate and Explain IBAN',
      description:
        'Validate an IBAN and generate a human-readable explanation suitable for non-technical users.',
      argsSchema: {
        iban: z.string().describe('The IBAN to validate and explain'),
      },
    },
    async ({ iban }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: buildValidateAndExplainPrompt(iban),
          },
        },
      ],
    }),
  );

  return server;
}

/**
 * The tool names this server really registers, read back from one throwaway
 * instance and then cached.
 *
 * `_registeredTools` is private to the SDK's McpServer, which publishes no
 * read-back of its own catalogue (checked against @modelcontextprotocol/sdk
 * 1.30.0 on 2026-09-01). The alternative is a second, hand-kept list — which is
 * exactly the drift MCP-13 found: the discovery hint listed 7 tools while
 * tools/list served 8. So we read the real one, and a test pins the result
 * against tools/list: the day the SDK renames that field this returns an empty
 * array and the test goes red, instead of the document going quietly stale.
 */
let toolNamesCache: string[] | null = null;
function registeredToolNames(): string[] {
  if (toolNamesCache) return toolNamesCache;
  // An empty context and no session: this instance only ever has its catalogue
  // read, no handler of it ever runs. Handing it a real caller would be a lie
  // about who asked.
  const probe = createMcpServer({ ip: null, userAgent: null }, () => undefined) as unknown as {
    _registeredTools?: Record<string, unknown>;
  };
  toolNamesCache = Object.keys(probe._registeredTools ?? {});
  return toolNamesCache;
}

// ── MCP tool call rate limiting ───────────────────────────────────────────────
// Free MCP access is limited to a handful of tool calls per source per ISO week
// (UTC, reset on Monday 00:00 UTC) since 24/09/2026; it was ten a day before.
// Discovery (initialize, tools/list, resources/list) is unlimited.
//
// This is the ONE path where an assistant reaches a complete, correct answer
// on its first try — including the paid Swiss clearing data — without a key or
// a wallet (reco-IA audit, 2026-07-25). It is deliberately kept open as the
// product's shop window, but it also hands out priced data for free, so the
// allowance is a taster, not a tier: enough calls to evaluate the service and
// far too few to run on. Announce it wherever it is offered — an undocumented
// free path converts nobody.
export { MCP_WEEKLY_LIMIT } from '../lib/mcp-limits.js';
/**
 * Opening a session is not a tool call, so until 2026-09-01 it was counted by
 * nothing at all — and it is the expensive one (a whole McpServer, see the
 * store above). 30 a day per address is far above what any client needs (one
 * per process, re-opened after a redeploy) and far below what it takes to fill
 * a container. Same ledger as the tool-call allowance, separate key.
 */
export { MCP_SESSIONS_PER_IP_DAY } from '../lib/mcp-limits.js';

// The sessions nobody ever closed (SEC-01/MCP-08). It used to share a tick with
// the call counter; since the counter moved to src/lib/daily-ip-ledger.ts —
// where the REST trial reads it too — the store keeps its own interval. Two
// unrelated lifetimes in one timer is how one of them ends up cancelled with
// the other.
setInterval(() => mcpSessions.sweep(), 10 * 60 * 1000).unref();

/**
 * The keyless allowance of the TOOL CALLS, counted by the ISO week in UTC since
 * 24/09/2026 (Claude-Alain's decision: 25 a week per source, as the REST
 * trial, and the two never shared).
 *
 * `units` is the number of billable units this HTTP request carries — a
 * JSON-RPC batch bills every element, not one, and a `batch_validate_iban`
 * bills one per IBAN (see `mcpToolUnits`).
 *
 * The counting reuses the REST trial's weekly ledger (`trial_weekly`), in a
 * bucket of its own: the bare source hash, where the REST trial writes
 * `rest:<hash>`. The daily row of the same bucket is still written for the
 * trace (`trial_daily.mcp_buckets`, `mcp_units`). The entry grows even when the
 * answer is a refusal, which is what stops a refused caller from retrying the
 * cheap request all week.
 *
 * `now` is the same instant the refusal quotes its reset from: the week that
 * counts the call and the week whose end it announces must be one, Sunday
 * 23:59:59 included.
 */
function checkMcpToolAllowance(
  key: string,
  units: number,
  now: Date,
): { allowed: boolean; used: number; remaining: number; degraded?: true } {
  return countWeeklyTrialUnits(key, units, MCP_WEEKLY_LIMIT, now);
}

/**
 * Session openings, on `init:<source>`, against their own DAILY ceiling. Not
 * part of the free allowance: it bounds the memory of the container (one
 * McpServer per session), so it stays counted by the day in the daily ledger.
 */
function checkMcpSessionLimit(key: string): {
  allowed: boolean;
  used: number;
  remaining: number;
  degraded?: true;
} {
  return countDailyUnits(key, 1, MCP_SESSIONS_PER_IP_DAY);
}

/**
 * The JSON-RPC refusal of a tool call past the keyless allowance.
 *
 * A function, not an inline literal, so that the free-doors guard can read the
 * exact sentences served (src/routes/free-doors-claims.test.ts). Each allowance
 * is named, and the week's figure and the key's monthly figure never share a
 * sentence.
 */
/**
 * The refusal when the keyless allowance could not be counted at all.
 *
 * It used to say "use an API key or x402 to continue" on /mcp, which reads
 * neither (review of 24/09/2026): the ways to continue are the REST API and the
 * npm package.
 */
export const MCP_ACCOUNTING_UNAVAILABLE =
  'Free-tier accounting is temporarily unavailable on this transport, which reads no key. ' +
  'To continue, call the REST API (https://api.ibanforge.com/v1) with a key or an x402 payment, ' +
  'or run the npm package ibanforge-mcp with IBANFORGE_API_KEY set.';

export function mcpAllowanceRefusal(
  used: number,
  now: Date = new Date(),
): {
  code: number;
  message: string;
  data: { used: number; limit: number; remaining: number; period: 'week'; resets_at: string };
} {
  const resetsAt = trialResetsAt(now);
  return {
    code: -32000,
    message:
      `Weekly MCP free tier limit reached: ${MCP_WEEKLY_LIMIT} units a week per source address on this transport, ` +
      `one per tool call and one per IBAN in batch_validate_iban; it resets on ${TRIAL_RESET} (${resetsAt}). ` +
      'You can take a key without giving anyone an e-mail: POST ' +
      `${KEY_GENERATE_URL} with no body at all returns an ifk_ key worth ` +
      `${ANONYMOUS_MONTHLY_LIMIT} REST calls/month, on the spot. ` +
      `POST ${KEY_CLAIM_URL} lifts that same key to ${FREE_TIER_MONTHLY_LIMIT} a month: a 6-digit code ` +
      'on an address your human gives you for this, or an x402 payment on the key — that rail grants ' +
      `${FREE_TIER_MONTHLY_LIMIT} once, not ${FREE_TIER_MONTHLY_LIMIT} a month. ` +
      'See https://api.ibanforge.com/.well-known/x402',
    data: { used, limit: MCP_WEEKLY_LIMIT, remaining: 0, period: 'week', resets_at: resetsAt },
  };
}

/**
 * The ledger bucket for one SOURCE on this transport.
 *
 * 🚨 Exactly the gesture the REST trial makes, from the same module, and both
 * doors have to make it: the IPv6 collapsed to its /64 first, then hashed. A
 * single routed /64 otherwise yields an unbounded number of allowances, and the
 * bucket keys land in the file that holds the API keys.
 *
 * The `unknown` fallback is namespaced but stays memory-only in the ledger, so
 * a handful of unplaceable callers cannot shut the door for a whole day.
 */
function mcpBucket(ip: string, prefix: '' | 'init:'): string {
  return ledgerBucket(ip, prefix);
}

/**
 * What one `tools/call` message costs against the free allowance.
 *
 * Counting calls rather than data made the anonymous path 150x more generous
 * than the signed-up one: 10 calls of `batch_validate_iban` at 100 IBANs each
 * is 1,000 enriched validations per IP per day, against 200 REST calls a month
 * for a verified free key (MCP-07, audit 2026-09-01). The batch tool bills per
 * IBAN everywhere else it exists — the x402 price and `billableUnits` in the
 * API-key middleware both do — so this is the one surface that disagreed.
 *
 * send_feedback stays free ON PURPOSE, and stays free past the cap: it is the
 * only way a refused agent can tell us WHY it is leaving, and capping the
 * complaint box with the limit that produced the complaint would silence
 * exactly the reports it was built for.
 */

/**
 * The tools that are free all the way: they keep being served AFTER the cap,
 * because each of them is the only way out of the dead end the cap just
 * created.
 *
 * 🚨 A named set rather than three `name === '…'` tests, because the same list
 * is needed in two places that must never disagree: `mcpToolUnits` below, and
 * the exclusion list of the "names a cost in every tool description" test. A
 * tool free in one and not the other is either billed silently or documented
 * wrong.
 */
export const MCP_FREE_TOOLS: ReadonlySet<string> = ALLOWANCE_EXEMPT_TOOLS;
function mcpToolUnits(params: { name?: unknown; arguments?: unknown } | undefined): number {
  const name = typeof params?.name === 'string' ? params.name : '';
  if (MCP_FREE_TOOLS.has(name)) return 0;
  if (name !== 'batch_validate_iban') return 1;
  const args = params?.arguments as { ibans?: unknown } | undefined;
  const ibans = args?.ibans;
  if (!Array.isArray(ibans) || ibans.length === 0) return 1;
  // Capped at the tool's own max: a schema-refused oversize batch must not be
  // able to quote a shortfall no accepted call could ever bill.
  return Math.min(ibans.length, 100);
}

/**
 * Host allow-list for the transport, or nothing at all.
 *
 * The MCP spec asks a remote server to refuse a Host it does not serve, because
 * a page on an attacker's origin can point its own hostname at this container
 * (DNS rebinding). The SDK implements it, but only when
 * `enableDnsRebindingProtection` is set as well — `allowedHosts` alone is a
 * no-op, which is how this can look done and not be. SEC-07 / MCP-14, 2026-09-01.
 *
 * Read per transport rather than once at import, so a test can flip NODE_ENV.
 * `MCP_ALLOWED_HOSTS` (comma-separated) is the escape hatch the day a second
 * hostname legitimately serves /mcp; the Railway domain is accepted by default
 * because the platform's own address answers the same app.
 */
function mcpDnsRebindingOptions(): {
  allowedHosts?: string[];
  enableDnsRebindingProtection?: boolean;
} {
  const configured = process.env.MCP_ALLOWED_HOSTS?.split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) {
    return { allowedHosts: configured, enableDnsRebindingProtection: true };
  }
  if (process.env.NODE_ENV !== 'production') return {};
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN?.trim();
  return {
    allowedHosts: ['api.ibanforge.com', ...(railway ? [railway] : [])],
    enableDnsRebindingProtection: true,
  };
}

// Handle POST /mcp (client → server messages)
mcpHttp.post('/mcp', async (c) => {
  // Parse the body to check if this is a tools/call (rate-limited)
  // vs. discovery (unlimited). We clone the request so the transport
  // can still read the original body.
  const cloned = c.req.raw.clone();
  let toolUnits = 0;
  let toolName: string | null = null;
  let rpcId: unknown = null;
  // 🚨 Le NOMBRE d'appels d'outils, distinct de leur COÛT. Zéro unité n'est pas
  // zéro événement : `request_api_key` coûte 0 et reste un appel à mesurer.
  // Hissé ici parce que `calls` vit dans le `try` ci-dessous.
  let toolCalls = 0;
  // 🚨 Les appels de `request_api_key`, comptés SÉPARÉMENT et depuis le même
  // parse (chantier « mesure agents », 15/09). C'est la seule mesure du haut de
  // l'entonnoir qu'aucune source existante ne peut rendre : `request_log` ne
  // garde que le chemin `/mcp:tools-call`, jamais le nom de l'outil, et le
  // registre journalier ne compte que des UNITÉS — or cet outil coûte zéro unité
  // (`MCP_FREE_TOOLS`), donc il y est parfaitement invisible.
  let keyRequests = 0;
  // Any tools/call at all, known tool or not: what the no-session answer below
  // reads, so that no session is opened for a call that cannot be served.
  let anyToolCall = false;
  try {
    const body = await cloned.json();
    // JSON-RPC allows a BATCH: the body may be an array of messages. On an
    // array `body.method` is undefined, so the previous single-object check
    // scored a 60-call batch as zero tool calls — the daily allowance was
    // bypassed outright by wrapping the calls in `[...]`, and the global
    // per-IP rate limiter only ever saw one HTTP request, so nothing else
    // bounded it either. Count every element instead.
    // Security audit 2026-07-25, finding 2.
    const messages: Array<{
      method?: unknown;
      id?: unknown;
      params?: { name?: unknown; arguments?: unknown };
    }> = Array.isArray(body) ? body : [body];
    const calls = messages.filter((m) => m?.method === 'tools/call');
    anyToolCall = calls.length > 0;
    // Only a tool this server registers can be served (review of 24/09/2026):
    // a call to an unknown name gets "tool not found" from the SDK, so it is
    // neither charged nor counted as a served call.
    const servable = calls.filter(
      (m) => typeof m?.params?.name === 'string' && MCP_TOOL_NAMES.has(m.params.name),
    );
    toolCalls = servable.length;
    keyRequests = servable.filter((m) => m?.params?.name === 'request_api_key').length;
    toolUnits = servable.reduce((sum, m) => sum + mcpToolUnits(m?.params), 0);
    toolName =
      calls
        .map((m) => (typeof m?.params?.name === 'string' ? m.params.name : null))
        .find((n) => n !== null) ?? null;
    rpcId = calls[0]?.id ?? messages[0]?.id ?? null;
  } catch {
    // Not JSON or malformed — let the transport handle the error
  }

  // Spoof-resistant extraction (trusted-proxy last hop), same rule as the
  // global rate limiter — the FIRST X-Forwarded-For segment is chosen by the
  // caller. Audit 2026-07-25, rejected-but-fix-anyway item.
  const ip =
    extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
      'x-real-ip': c.req.header('x-real-ip') ?? null,
    }) ?? 'unknown';

  // 🚨 Le NOM de l'outil, posé AVANT la porte du plafond — et c'est justement
  // l'inverse de l'ordre du drapeau `mcpToolCall` vingt lignes plus bas.
  //
  // Le drapeau décide du CHEMIN : posé trop tôt, un refus se lisait comme un
  // appel servi (MCP-04, audit du 01/09/2026), et c'est pour cela qu'il attend
  // la sortie de cette porte. Le nom ne décide de rien — le chemin a déjà
  // séparé `/mcp:tools-call` de `/mcp:tools-call:refused`. Posé après la
  // porte, un appel REFUSÉ perdrait son nom, et « sur quel outil le palier
  // gratuit renvoie-t-il les agents » redeviendrait la question sans réponse
  // que cette colonne existe pour fermer.
  if (toolName) c.set('mcpToolName', toolName);

  // 🚨 LA SESSION D'ABORD, LE DÉBIT ENSUITE (relecture du 24/09/2026, D1).
  //
  // L'allocation se débitait avant de savoir si la session existait : un
  // `tools/call` sur une session inconnue (après chaque redéploiement, après
  // 30 min d'inactivité, après une éviction) payait ses unités, un lot de 20
  // IBAN en payait 20, puis recevait un 404 sans qu'aucun outil ait tourné. Au
  // jour, l'unité perdue revenait le lendemain ; à la semaine, elle ne revient
  // que le lundi. Aucun outil ne peut servir une requête sans session : on ne
  // débite donc qu'une fois la session trouvée.
  const sessionId = c.req.header('mcp-session-id');
  let transport = sessionId ? mcpSessions.get(sessionId) : undefined;

  if (sessionId && !transport) {
    // The SDK answers this case `400 Bad Request: Server not initialized`, which
    // describes the server rather than the session — and an LLM reading it
    // concludes the service is broken instead of re-opening a session. It
    // happens after every redeploy (the store is in memory) and now after an
    // idle sweep too, so the message has to name the remedy. 404 is what the
    // streamable-HTTP spec reserves for an unknown session id, and a compliant
    // client re-sends `initialize` on it. MCP-09, audit 2026-09-01.
    return c.json(
      {
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32001,
          message:
            'Session expired or server redeployed. Send initialize again to open a new session.',
          data: { session_id: sessionId, idle_timeout_minutes: MCP_SESSION_IDLE_MS / 60000 },
        },
      },
      404,
    );
  }

  if (!sessionId && anyToolCall) {
    // Un `tools/call` sans session, seul ou dans un lot avec `initialize`. Le
    // SDK le refuse en 400 (« Server not initialized », « Only one
    // initialization request is allowed ») ; le laisser aller jusqu'à lui
    // consommait une ouverture de session, construisait un McpServer pour rien
    // et, avant la correction ci-dessus, débitait l'allocation. On répond tôt,
    // sans rien débiter, avec le geste qui marche.
    return c.json(
      {
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message:
            'Bad Request: no session. Send initialize alone first, then send tools/call with the ' +
            'mcp-session-id header that initialize returned.',
        },
      },
      400,
    );
  }

  // The transport refuses with 406 a POST whose Accept header does not list
  // both application/json and text/event-stream: the same substring test as
  // the SDK (@modelcontextprotocol/sdk 1.30.0, handlePostRequest). Such a call
  // is never served, so it is neither charged nor counted (review of
  // 24/09/2026). Mirrored rather than paraphrased: were the SDK to relax its
  // test, the worst case is an unserved call left uncharged.
  const accept = c.req.header('accept');
  if (!accept?.includes('application/json') || !accept.includes('text/event-stream')) {
    toolUnits = 0;
    toolCalls = 0;
    keyRequests = 0;
  }

  if (toolUnits > 0) {
    const now = new Date();
    const limit = checkMcpToolAllowance(mcpBucket(ip, ''), toolUnits, now);
    if (limit.degraded) {
      // La comptabilité est morte, pas le plafond : dire « Weekly MCP free tier
      // limit reached » serait un mensonge sur un compte qui n'a pas été tenu.
      // Message distinct, et `degraded` dans les données pour que le client
      // sache qu'il ne s'agit pas de sa consommation.
      c.header('X-MCP-Outcome', 'rate_limited');
      return c.json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message: MCP_ACCOUNTING_UNAVAILABLE,
          data: { degraded: true },
        },
      });
    }
    if (!limit.allowed) {
      // A refusal used to be indistinguishable from a success in request_log:
      // both landed as `POST /mcp:tools-call 200`, because the marker below was
      // set BEFORE this check (MCP-04, audit 2026-09-01). The outcome now rides
      // on a response header the telemetry middleware reads, so nobody has to
      // guess whether the free tier is turning agents away.
      c.header('X-MCP-Outcome', 'rate_limited');
      // Return a proper JSON-RPC error so the MCP client understands
      return c.json({
        jsonrpc: '2.0',
        id: rpcId,
        error: mcpAllowanceRefusal(limit.used, now),
      });
    }
  }

  // Mark the request for the stats middleware: /mcp alone cannot tell a
  // handshake from real usage, and 14k discovery requests once read as a
  // traffic spike nobody could explain.
  //
  // 🚨 Conditionné au NOMBRE d'appels, pas à leur coût, et c'est le seul des
  // deux blocs à bouger. Un `request_api_key` coûte zéro unité et reste un
  // appel d'outil : laissé sous `toolUnits > 0`, il disparaissait de la
  // télémétrie, et la porte de sortie du plafond était la seule chose qu'on ne
  // mesurait pas. La garde `toolUnits > 0` RESTE autour de `checkMcpToolAllowance`
  // au-dessus : la déplacer ferait entrer les outils gratuits dans la branche
  // de refus, et comme `allowed = count <= limit` est faux dès le quota
  // dépassé, `request_api_key` serait refusé APRÈS le plafond — l'inverse exact
  // de ce que cet outil existe pour faire.
  if (toolCalls > 0) c.set('mcpToolCall', true);

  // ─── Le haut de l'entonnoir MCP distant, par jour ─────────────────────────
  // (chantier « mesure agents », 15/09)
  //
  // 🚨 APRÈS la porte du plafond, exprès, et ce n'est pas un détail de
  // placement : `daily-ip-ledger.ts` tient une carte `overLimit` en mémoire
  // pour que le coût serveur d'un appelant refusé reste exactement zéro
  // écriture, alors que le limiteur global lui laisse cent requêtes par
  // minute. Compter ici les TENTATIVES aurait rendu à un refusé une écriture
  // par requête dans le fichier qui porte `api_keys`, les crédits et les traces
  // de paiement. `tool_calls` compte donc les appels SERVIS ; les refus se
  // lisent déjà à part, sous `/mcp:tools-call:refused` dans `request_log`.
  // Depuis le 24/09/2026 (D1), ce point n'est atteint qu'avec une session
  // vivante : un appel sur une session inconnue (404) ou sans session (400)
  // repart plus haut et n'est plus compté ici.
  //
  // Une seule écriture par requête `/mcp`, sur une table d'une ligne par jour.
  if (toolCalls > 0) bumpMcpRemoteDaily({ toolCalls, keyRequests });

  // 🚨 LE PORTEUR EST PRÉPARÉ ICI, AVANT QU'UNE SESSION NEUVE SOIT CRÉÉE, et
  // l'ordre des gestes est la moitié de la correction.
  //
  // Sur une requête `initialize`, `sessionId` N'EXISTE PAS ENCORE : il vient de
  // l'en-tête, et il n'est engendré qu'à l'intérieur du constructeur du
  // transport, donc APRÈS. On prépare donc un objet, on le MUTE, et on ne
  // l'enregistre qu'à l'ouverture de session, dans le crochet
  // `onsessioninitialized`. C'est cet objet-là que les fermetures des outils
  // tiennent.
  //
  // ⚠️ Mutation, JAMAIS remplacement. `sessionCtx.set(id, { ...ip })` à chaque
  // requête laisserait les outils sur l'objet de l'ouverture, c'est-à-dire
  // exactement l'empreinte figée que ce bloc existe pour éviter.
  const known = sessionId ? sessionCtx.get(sessionId) : undefined;
  const callCtx: McpCallContext = known ?? { ip: null, userAgent: null };
  callCtx.ip = ip === 'unknown' ? null : ip;
  callCtx.userAgent = c.req.header('user-agent') ?? null;

  if (!transport) {
    // Opening a session costs a full McpServer, so it is metered like the tool
    // calls are (SEC-01, audit 2026-09-01). Checked here rather than on the
    // `initialize` method alone: this is the exact line where the memory is
    // about to be spent, whatever the body claims to be.
    const initBucket = mcpBucket(ip, 'init:');
    let opened = checkMcpSessionLimit(initBucket);
    if (opened.degraded) {
      // 🚨 Cette porte ne peut PAS être fail-open. Ce qui borne déjà : le
      // magasin plafonné à MCP_MAX_SESSIONS (LRU d'abord), la balayeuse d'idle
      // et le limiteur global. Ce qui manque quand même sous panne : la borne
      // PAR ADRESSE — sans elle, un seul appelant remplit le magasin et
      // l'éviction LRU jette les sessions de tout le monde. On bascule donc sur
      // le compteur mémoire au même plafond : par instance et perdu au
      // redéploiement, c'est-à-dire exactement le comportement d'avant le
      // portage. On ne dégrade pas en dessous de l'existant.
      opened = countDailyUnitsInMemory(initBucket, 1, MCP_SESSIONS_PER_IP_DAY);
    }
    if (!opened.allowed) {
      c.header('X-MCP-Outcome', 'session_rate_limited');
      return c.json({
        jsonrpc: '2.0',
        id: rpcId,
        error: {
          code: -32000,
          message:
            `Daily MCP session limit reached (${MCP_SESSIONS_PER_IP_DAY} new sessions/day). ` +
            'Reuse the mcp-session-id returned by initialize instead of opening a session per call, ' +
            `or move to the REST API: POST ${KEY_GENERATE_URL} with no body at all returns an ifk_ key ` +
            `with no e-mail, ${ANONYMOUS_MONTHLY_LIMIT} REST calls/month.`,
          data: { used: opened.used, limit: MCP_SESSIONS_PER_IP_DAY, remaining: 0 },
        },
      });
    }
    // La session est ACCORDÉE : la franchise vient d'être débitée et le
    // McpServer va être construit. Comptée ici et pas sur la méthode
    // `initialize`, pour la même raison que le plafond l'est ici — c'est la
    // ligne où la mémoire est dépensée, quoi que prétende le corps. Les refus
    // se lisent sous `/mcp:session:refused` dans `request_log`
    // (chantier « mesure agents », 15/09).
    bumpMcpRemoteDaily({ sessions: 1 });

    // New session — create transport and connect server
    transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      // Defence in depth against DNS rebinding, and ONLY in production: a
      // browser page on an attacker's origin can resolve its own hostname to
      // this container, and the SDK's own guard is the cheapest answer. It stays
      // off in dev and in tests, where the Host header is `localhost` and a
      // strict list would refuse every local probe. MCP-14 / SEC-07, 2026-09-01.
      ...mcpDnsRebindingOptions(),
      onsessioninitialized: (id) => {
        mcpSessions.set(id, transport!);
        // Le MÊME objet que celui muté au-dessus, désormais joignable par
        // l'en-tête de session. Un `{ ...callCtx }` ici couperait le lien avec
        // ce que les outils tiennent.
        sessionCtx.set(id, callCtx);
      },
      // Purge the session as soon as the SDK reports it closed. This is the
      // fastest door, not the only one: most MCP clients and directory crawlers
      // (Smithery, Glama, MCP.so) open a session and walk away WITHOUT sending
      // DELETE, so this hook never fires for them — the idle sweep and the cap
      // in the store above are what catch those.
      onsessionclosed: (id) => {
        mcpSessions.delete(id);
        sessionCtx.delete(id);
        // Avec le device_code mémorisé : une session fermée ne doit pas laisser
        // derrière elle un porteur de clé que le prochain occupant du même
        // identifiant pourrait retirer.
        sessionDeviceCode.delete(id);
      },
    });

    const localTransport = transport;
    transport.onclose = () => {
      if (localTransport.sessionId) {
        mcpSessions.delete(localTransport.sessionId);
        sessionCtx.delete(localTransport.sessionId);
        sessionDeviceCode.delete(localTransport.sessionId);
      }
    };

    // Le porteur, pas une copie. Et l'identifiant de session est lu PARESSEUSEMENT :
    // il n'existe pas encore à cet instant, le SDK le pose sur le transport à
    // l'`initialize`.
    const server = createMcpServer(callCtx, () => localTransport.sessionId);
    await server.connect(transport);
  }

  const response = await transport.handleRequest(c.req.raw);
  // The outcome rides on the response OBJECT, not on `c.header()`: the SDK
  // builds its own Response and returning it bypasses the context's prepared
  // headers, so a served tool call reached the telemetry middleware carrying
  // nothing at all. The refusals above go through `c.json()` and keep theirs.
  // 🚨 DEUXIÈME édition du point « zéro unité n'est pas zéro événement », et
  // c'est bien un second bloc : l'en-tête est posé ICI, sur l'objet Response du
  // SDK. `X-MCP-Tool` passe sous le NOMBRE d'appels, pour qu'un
  // `request_api_key` gratuit nomme quand même l'outil qui a tourné ;
  // `X-MCP-Outcome: ok` reste sur le coût, puisque c'est le compteur d'unités
  // qu'il raconte.
  if (toolUnits > 0) response.headers.set('X-MCP-Outcome', 'ok');
  if (toolCalls > 0 && toolName) response.headers.set('X-MCP-Tool', toolName);
  return response;
});

// Handle GET /mcp (SSE stream for server → client notifications, OR discovery hint)
mcpHttp.get('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? mcpSessions.get(sessionId) : undefined;

  if (!transport) {
    // No session: either a dev probing with curl, or an SSE client trying to
    // open the server→client stream. The MCP streamable-http spec answers 405
    // here when the server offers no standalone SSE stream — and the status is
    // load-bearing: this endpoint used to answer 200 with this same JSON, and
    // SSE clients treated that as a broken stream to retry at once, no backoff.
    // One looping client produced ~45k GETs in a day, ten times the API's whole
    // organic traffic. A 405 tells them to stop; the JSON body keeps the
    // endpoint discoverable for the human with a browser.
    c.header('Allow', 'POST, DELETE');
    return c.json(
      {
        protocol: 'mcp',
        // Read from the SDK and from the server itself, never typed by hand:
        // this document announced protocol 2024-11-05 and 7 tools while the
        // server negotiated 2025-06-18 and served 8 (MCP-13, audit 2026-09-01).
        // Two hand-kept values in the one document a curious developer opens in
        // a browser.
        version: LATEST_PROTOCOL_VERSION,
        supported_versions: SUPPORTED_PROTOCOL_VERSIONS,
        transport: 'streamable-http',
        endpoint: 'https://api.ibanforge.com/mcp',
        message:
          'This is the IBANforge MCP HTTP endpoint. To use it, send a POST with a JSON-RPC initialize request, then keep the returned mcp-session-id header on subsequent requests.',
        quickstart: {
          stdio_npx:
            'npx -y ibanforge-mcp  # easiest path: run our stdio server, no HTTP session juggling',
          claude_desktop_config: {
            mcpServers: {
              ibanforge: { command: 'npx', args: ['-y', 'ibanforge-mcp'] },
            },
          },
          claude_code_cli:
            'claude mcp add ibanforge --transport http https://api.ibanforge.com/mcp',
          curl_initialize: `curl -X POST https://api.ibanforge.com/mcp -H 'Content-Type: application/json' -H 'Accept: application/json,text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"${LATEST_PROTOCOL_VERSION}","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}' -i`,
        },
        tools: registeredToolNames(),
        free_tier: {
          // 24/09/2026 : l'accès sans clé se compte à la semaine ISO (UTC).
          // `mcp_daily_limit` et `mcp_daily_limit_unit` sont retirés plutôt que
          // gardés : ils auraient porté un chiffre de la semaine sous un nom du
          // jour, et un champ nommé qui ment reste affiché par les annuaires.
          mcp_weekly_limit: MCP_WEEKLY_LIMIT,
          mcp_weekly_limit_unit:
            'one unit per tool call, one per IBAN in batch_validate_iban, per source address',
          mcp_period: 'week',
          mcp_resets: TRIAL_RESET,
          mcp_resets_at: trialResetsAt(),
          mcp_sessions_per_day: MCP_SESSIONS_PER_IP_DAY,
          session_idle_timeout_minutes: MCP_SESSION_IDLE_MS / 60000,
          anonymous_key: `POST /v1/keys/generate with no body at all — no e-mail, ${ANONYMOUS_MONTHLY_LIMIT} REST req/month`,
          claim_to_full: `POST /v1/keys/claim — a mailed code or an x402 payment on the key; lifts that same key to ${FREE_TIER_MONTHLY_LIMIT} req/month`,
          // `rest_api_signup` conservé en DOUBLON d'`anonymous_key` : les
          // moissonneurs d'annuaires (Glama, Smithery, MCP.so) affichent des
          // champs NOMMÉS, donc retirer un nom qu'ils lisent déjà efface la
          // porte gratuite de leur fiche. On ajoute sans retirer.
          rest_api_signup: `POST /v1/keys/generate with no body at all — no e-mail, ${ANONYMOUS_MONTHLY_LIMIT} REST req/month`,
          // AJOUTÉ à côté, jamais à la place : les moissonneurs d'annuaires
          // affichent des champs NOMMÉS, donc on ajoute sans retirer. C'est la
          // seule porte qui ne demande RIEN à l'agent — pas même de savoir
          // poster sur une route REST : deux appels d'outil et un humain qui
          // clique.
          device_grant: `Call the request_api_key tool, show the code to a human, then poll_api_key — a human approves in a browser, the agent never handles an address. The code lives ${DEVICE_CODE_TTL_SECONDS / 60} minutes and the key comes back at ${ANONYMOUS_MONTHLY_LIMIT} REST req/month, or ${FREE_TIER_MONTHLY_LIMIT} if the human adds an address on that page.`,
        },
        x402: 'https://api.ibanforge.com/.well-known/x402',
        documentation: 'https://ibanforge.com/docs',
        llms_txt: 'https://api.ibanforge.com/llms.txt',
        // Served by the API host only — the www host 404s on this path.
        server_card: 'https://api.ibanforge.com/.well-known/mcp/server-card.json',
        registry: 'https://registry.modelcontextprotocol.io/v0/servers?search=ibanforge',
      },
      405,
    );
  }

  const response = await transport.handleRequest(c.req.raw);
  return response;
});

// Handle DELETE /mcp (close session)
mcpHttp.delete('/mcp', async (c) => {
  const sessionId = c.req.header('mcp-session-id');
  const transport = sessionId ? mcpSessions.get(sessionId) : undefined;

  if (!transport) {
    return c.json({ error: 'No active session.' }, 400);
  }

  const response = await transport.handleRequest(c.req.raw);
  mcpSessions.delete(sessionId!);
  return response;
});

export { mcpHttp };
