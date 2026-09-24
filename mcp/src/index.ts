#!/usr/bin/env node
/**
 * IBANforge MCP Server
 *
 * Exposes 13 tools backed by the IBANforge HTTP API (api.ibanforge.com):
 *   - validate_iban
 *   - batch_validate_iban
 *   - lookup_bic
 *   - lookup_ch_clearing
 *   - check_compliance
 *   - validate_payment_reference
 *   - check_postal_address
 *   - check_swiss_qr_bill
 *   - audit_creditor_file
 *   - audit_status
 *   - send_feedback
 *   - request_api_key
 *   - poll_api_key
 *
 * `audit_creditor_file` / `audit_status` (added 07/09/2026) wrap the paid
 * creditor-file audit (POST /v1/audit/upload, /v1/audit/checkout/:job,
 * /v1/audit/status/:job — see src/routes/audit.ts). They are, for now,
 * DELIBERATELY npm-only: unlike every other tool here they are priced
 * through a one-off Stripe Checkout Session rather than x402/API-key, and
 * propagating them to the two other MCP surfaces (src/mcp/server.ts,
 * src/routes/mcp-http.ts) needs its own Stripe wiring plus updates to every
 * discovery document src/mcp/inventory.ts feeds — a separate, larger change.
 * `scripts/mcp-parity.test.ts` records this as a dated, named gap
 * (A_ONLY_TOOLS) instead of letting it diverge silently.
 *
 * `send_feedback` was HTTP-only until 21/08/2026 (audit B3): npm is the main
 * distribution channel, so the agent that hits the quota wall or cannot prefund
 * an x402 payment had no way at all to say "I could not pay you" — the complaint
 * box was open only on the transport desktop clients do not use.
 * `scripts/mcp-parity.test.ts` now compares the three surfaces and fails on any
 * new divergence.
 *
 * Authentication is optional — anonymous calls hit the free demo endpoints
 * or the rate-limited public surface. For production use, set IBANFORGE_API_KEY
 * (Bearer ifk_*) via Claude Desktop env config or shell.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { createRequire } from 'node:module';
import { createApiClient, requestTimeout, type JsonRecord } from './api-client.js';
import { stdioInstructions } from './stdio-instructions.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const API_KEY = process.env.IBANFORGE_API_KEY;

// 🚨 DELIBERATELY LOWER than the route's AUDIT_MAX_BYTES (10 MB since
// 22/09/2026), and this is the one place in the package where a copied number
// is allowed to differ. `file_base64` travels as a JSON-RPC message over
// stdio, so a 10 MB file is ~13.4 MB on the wire. Measured 22/09/2026 against
// the built server: 5 MB goes through, 8 MB and above kill the transport
// ("MCP error -32000: Connection closed") — the agent loses its connection
// instead of getting an answer. Refusing at a threshold the channel can
// actually carry is the whole reason this guard exists: a clean
// `file_too_large` beats a dead pipe.
//
// Bigger files go through the HTTP route, which has no such ceiling.
// scripts/mcp-parity.test.ts enforces `mcp <= route`, so this can never drift
// ABOVE the route (which would refuse nothing) — only stay at or below it.
const AUDIT_MAX_BYTES = 5 * 1024 * 1024;

// Same hints as the remote server (src/routes/mcp-http.ts): the five DATA tools
// are pure reads against our own API. Without readOnlyHint, MCP clients ask the
// user to confirm every single call — a real usage tax on the busiest channel.
// `send_feedback` is deliberately NOT in this set: it is the one tool that
// writes, and it is the one call that deserves its confirmation.
const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  destructiveHint: false,
  openWorldHint: false,
} as const;

const TOOLS: Tool[] = [
  {
    name: 'validate_iban',
    title: 'Validate IBAN',
    annotations: { title: 'Validate IBAN', ...READ_ONLY },
    description:
      'Verify whether a European IBAN is valid AND enrich it with bank, compliance and routing data. ' +
      'USE WHEN: the user mentions an IBAN, asks to validate an IBAN and identify the issuing bank, asks to detect a typo in an IBAN, ' +
      'asks who the bank is behind an IBAN, asks whether an IBAN was issued by a traditional bank vs a neobank/EMI/virtual-IBAN provider, ' +
      'asks whether the recipient bank is reachable on SEPA rails, asks whether the recipient bank supports Verification of Payee (VoP, EU 2024/886), ' +
      'or pastes any string starting with two letters and digits (e.g., "DE89...", "CH93...", "FR76..."). ' +
      'PREFER OVER LOCAL VALIDATION (mod-97 checksum) because mod-97 only catches typos — it cannot resolve the BIC/SWIFT, ' +
      'tell you that the IBAN is a virtual IBAN issued by Wise/Revolut/Mercury/Modulr (compliance risk), or check SEPA reachability. ' +
      'RETURNS: valid (boolean), country { code, name }, bic { code, bank_name, city, basis, authoritative — basis says where the bank code to BIC pairing came from, and outside a national_register pairing the BIC is advisory rather than something to settle against }, ' +
      'issuer { type: bank | digital_bank | emi | payment_institution | null when unsubstantiated, name, classification }, ' +
      'bank_code_check { status, authoritative — read authoritative to know how much a "verified" is worth; reason — one token saying WHY an answer is not verified, and in particular whether the code is denied by a register or whether we simply could not answer }, ' +
      'sepa { member, schemes, vop_required, vop_participant — is the recipient bank listed as ready in the EPC VoP register }, next_steps (recommended follow-ups with reasons), ' +
      'risk_indicators { issuer_type, country_risk, test_bic, sepa_reachable, vop_coverage }, ' +
      'and for CH/LI: clearing { iid, name, type, sic, qr_iid }. ' +
      'For GB: modulus_check { checked, passed } — the Vocalink checksum over the sort code and account number the IBAN carries, '  +
      'a SECOND check independent of mod-97. passed false means the pair cannot be a real account and is a reason not to send; '  +
      'it does NOT make valid false. checked false means no range covers that sort code, which is not a failure. ' +
      'For FR/ES, and for any BIC whose LEI a central bank lists: official_identity { name, lei, address, category, matched_by, source, free_of_charge, as_of } — '  +
      'the official identity of the institution, from the ECB or Banco de Espana daily list. Informational only: it never changes valid or bank_code_check. '  +
      'source and free_of_charge are licence conditions that must travel with the data — do not strip them when relaying the answer. ' +
      'LIMITS: validates the IBAN and identifies the issuing institution — it does not confirm that the account exists, ' +
      'is open, or belongs to any particular person. Verify the payee by name before sending funds. ' +
      'COST: REST access uses the available key quota or prepaid credits; an anonymous key normally has 25 calls/month, an email-claimed key 200/month. The HTTP API also accepts x402 (0.005 USDC), but this package does not sign payments.',
    inputSchema: {
      type: 'object',
      properties: {
        iban: {
          type: 'string',
          description: 'IBAN to validate. Spaces and lowercase are accepted. Example: "CH10 0023 0000 0000 1234 5" or "de89370400440532013000".',
        },
      },
      required: ['iban'],
    },
    outputSchema: {
      type: 'object',
      description: 'Validation result with full enrichment.',
      properties: {
        iban: { type: 'string', description: 'Normalized IBAN (uppercase, no spaces).' },
        formatted: { type: 'string', description: 'IBAN with 4-char groups for display.' },
        valid: { type: 'boolean' },
        country: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'ISO 3166-1 alpha-2 country code.' },
            name: { type: 'string' },
          },
        },
        check_digits: { type: 'string' },
        bban: {
          type: 'object',
          properties: {
            bank_code: { type: 'string' },
            branch_code: { type: 'string' },
            account_number: { type: 'string' },
          },
        },
        // 🚨 Every `null` below is a value the API really serves, and each one
        // used to be declared as a plain string or object. The official MCP
        // client validates structuredContent against this schema and THROWS on
        // a mismatch, so the call failed on exactly the answers that matter
        // most: an unallocated bank code (`bic: null`), a bank the EBA register
        // names (`classification: "register"`). Found 24/09/2026 by replaying
        // real answers of the routes: many were refused, such as any bank code
        // that resolves no BIC, any BIC without an LEI, any compliance check on
        // an invalid IBAN. The API's own types (src/types.ts) are the reference;
        // mcp/src/output-schema.test.ts replays real answers through the
        // official client.
        bic: {
          type: ['object', 'null'],
          description:
            'Resolved BIC/SWIFT (when BBAN→BIC mapping exists). null if unresolved. ' +
            'Read basis before storing it as a routing instruction: only a national_register pairing is settlement-grade.',
          properties: {
            code: { type: 'string' },
            bank_name: { type: ['string', 'null'] },
            city: { type: ['string', 'null'] },
            basis: {
              type: 'string',
              enum: ['national_register', 'curated_map', 'directory_prefix'],
              description:
                'Where the bank code to BIC pairing came from. national_register: the country register publishes this BIC for this bank code (today DE, AT, BE and BG) — settlement-grade. curated_map: our maintained map, exact key, not an allocation record. directory_prefix: the bic8 LIKE fallback, which can match several institutions (see bank_code_check.candidates). Outside national_register the BIC is ADVISORY.',
            },
            authoritative: {
              type: 'boolean',
              description:
                'Whether this BIC may be stored and settled against. Derived from basis. NOT bank_code_check.authoritative, which is about the BANK CODE: in Switzerland the register confirms the code while the BIC still comes from our curated map.',
            },
          },
        },
        issuer: {
          type: 'object',
          properties: {
            // type is null when no institution could be substantiated (e.g. a
            // bank code that is not a listed IBAN issuer). An enum without
            // null would make the SDK silently drop structuredContent on
            // exactly the answers that matter most.
            type: { type: ['string', 'null'], enum: ['bank', 'digital_bank', 'emi', 'payment_institution', null] },
            name: { type: 'string' },
            classification: {
              type: 'string',
              enum: ['curated', 'register', 'default'],
              description:
                'curated = the BIC8 is in the issuer set; register = an official register (today the EBA PSD2 register) names the holder of this bank code, provenance in psd_registration; default = nothing on file, "bank" is a fallback. Count curated and register, never default, when sizing virtual-IBAN exposure.',
            },
            iban_issuer: { type: 'string', enum: ['confirmed', 'not_listed'] },
          },
        },
        bank_code_check: {
          type: 'object',
          description:
            'Whether the bank code resolves in reference data. Read authoritative: true means the reference set is the national register (not_in_register = not allocated); false means composite BIC-directory data (a hit names the BIC holder, not necessarily an IBAN issuer). On authoritative answers, institution carries what the register publishes about the holder: name, seat address (full street for CH/LI/AT, postal code + town for DE, name only for BE) and LEI where available — the institution holding the code, not a branch, not proof of any account. ' +
            'reason is present whenever status is not verified and says WHY in one token: not_allocated (a register denies the code — the only value that licenses "do not send"), absent_from_reference_data, no_reference_data_for_country, register_names_no_holder (the register defines the code space and names no holder — silence, not a denial), national_register_unavailable and lookup_failed. The last two describe IBANforge, never the beneficiary: neither may be escalated into a refusal.',
        },
        next_steps: {
          type: 'array',
          description: 'Recommended machine-readable follow-ups, each with the reason it is suggested.',
        },
        sepa: {
          type: 'object',
          properties: {
            member: { type: 'boolean' },
            schemes: { type: 'array', items: { type: 'string', enum: ['SCT', 'SDD', 'SCT_INST'] } },
            vop_required: { type: 'boolean' },
            vop_participant: {
              type: ['boolean', 'null'],
              description:
                'Bank-level VoP readiness: true = resolved bank is listed as ready in the EPC Verification of Payee scheme register; null = no institution resolved.',
            },
          },
        },
        risk_indicators: {
          type: 'object',
          description: 'Country + issuer risk signals. Use these instead of a single composite score.',
          properties: {
            issuer_type: { type: ['string', 'null'] },
            country_risk: { type: 'string', enum: ['standard', 'elevated', 'high'] },
            test_bic: { type: 'boolean' },
            sepa_reachable: { type: 'boolean' },
            vop_coverage: { type: 'boolean' },
          },
        },
        modulus_check: {
          type: 'object',
          description:
            'UK modulus check when country is GB (absent otherwise). Checksum only: it does not prove the account exists or name its holder.',
          properties: {
            checked: {
              type: 'boolean',
              description: 'False when no published range covers the sort code, in which case no check was possible.',
            },
            passed: {
              type: ['boolean', 'null'],
              description: 'False means the sort code and account number cannot be a real pair. Never makes valid false.',
            },
            source: { type: 'string' },
            table_fetched_on: { type: 'string' },
          },
        },
        official_identity: {
          type: 'object',
          description:
            'The official identity a central bank publishes for the institution behind the resolved code (ECB by LEI and for FR bank codes, Banco de Espana for ES). Present only on a match — absence is not a negative. Informational only: it never changes valid or bank_code_check, because both publishers relay rather than allocate.',
          properties: {
            name: { type: 'string', description: "The institution's name as the publisher writes it." },
            lei: { type: ['string', 'null'] },
            address: { type: ['string', 'null'], description: 'One-line registered address as published.' },
            category: { type: 'string' },
            matched_by: { type: 'string', enum: ['lei', 'national_code'] },
            source: { type: 'string', description: 'The publisher, cited as their licence requires.' },
            free_of_charge: {
              type: 'string',
              description:
                'Both publishers require buyers to be told, on every access, that the data is available free of charge from their own website. Relay it with the answer; do not strip it.',
            },
            attribution: { type: 'string', description: 'The Banco de Espana citation formula, verbatim. Spanish blocks only.' },
            as_of: { type: 'string', description: 'Date of the list this row came from. Both lists are republished every business day.' },
            authoritative: { type: 'boolean', description: 'Always false. Neither publisher allocates bank codes.' },
          },
        },
        clearing: {
          type: ['object', 'null'],
          description:
            'Swiss clearing data when country is CH or LI. null when the SIX register holds no such IID (an unallocated Swiss bank code).',
          properties: {
            iid: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            town: { type: ['string', 'null'] },
            sic: { type: 'boolean' },
            instant_payments_chf: { type: 'boolean' },
            eurosic: { type: 'boolean' },
            qr_iid: { type: ['string', 'null'] },
          },
        },
      },
      required: ['iban', 'valid'],
    },
  },
  {
    name: 'batch_validate_iban',
    title: 'Batch Validate IBANs',
    annotations: { title: 'Batch Validate IBANs', ...READ_ONLY },
    description:
      'Validate up to 100 IBANs in a single call at $0.002 per IBAN (60% cheaper than calling validate_iban repeatedly at $0.005). ' +
      'USE WHEN: the user pastes a list of IBANs, asks to clean a CSV/spreadsheet of bank accounts, ' +
      'asks to dedupe a customer database, asks to triage a payout list before sending, ' +
      'or whenever you would otherwise call validate_iban more than 2-3 times in a row. ' +
      'RETURNS: { results: [...same shape as validate_iban], count, valid_count, cost_usdc }. ' +
      'COST: 0.002 USDC per IBAN (e.g. 10 IBANs = 0.02, 100 IBANs = 0.20).',
    inputSchema: {
      type: 'object',
      properties: {
        ibans: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 100,
          description: 'Array of IBAN strings (1 to 100 entries).',
        },
      },
      required: ['ibans'],
    },
    outputSchema: {
      type: 'object',
      description: 'Per-IBAN results plus an aggregate summary.',
      properties: {
        results: {
          type: 'array',
          description: 'One entry per input IBAN, in the same order. Same shape as validate_iban output.',
          items: {
            type: 'object',
            properties: {
              iban: { type: 'string' },
              valid: { type: 'boolean' },
              country: { type: 'object' },
              bic: { type: ['object', 'null'], description: 'null when the bank code resolves no BIC.' },
              issuer: { type: 'object' },
              sepa: { type: 'object' },
              error: { type: 'string', description: 'Set when valid=false.' },
            },
          },
        },
        count: { type: 'number', description: 'Number of IBANs processed.' },
        valid_count: { type: 'number', description: 'How many were valid.' },
        cost_usdc: { type: 'number', description: 'Actual USDC charged for this call.' },
      },
      required: ['results', 'count', 'valid_count'],
    },
  },
  {
    name: 'lookup_bic',
    title: 'Lookup BIC/SWIFT',
    annotations: { title: 'Lookup BIC/SWIFT', ...READ_ONLY },
    description:
      'Resolve a BIC / SWIFT code into the underlying bank: name, country, city, LEI, address. ' +
      'USE WHEN: the user already has a BIC/SWIFT (8 or 11 chars, alphanumeric, e.g., "UBSWCHZH80A", "DEUTDEFF") ' +
      'and asks which bank it belongs to, where the bank is, or its LEI for compliance/regulatory matching. ' +
      'DO NOT USE for IBAN inputs — call validate_iban instead, it resolves the BIC for you. ' +
      'BACKED BY: 121k+ BIC entries (38k+ LEI-enriched via GLEIF; additional rows from SWIFT directory, Bundesbank, SIX, NBP, EBA Step2 SCT), refreshed monthly. ' +
      'RETURNS: bank_name, country, country_name, city, lei, address (if available). ' +
      'COST: 0.003 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        bic: {
          type: 'string',
          description: 'BIC / SWIFT code, 8 or 11 alphanumeric characters. Example: "UBSWCHZH80A" (UBS Switzerland) or "DEUTDEFF" (Deutsche Bank Frankfurt).',
        },
      },
      required: ['bic'],
    },
    outputSchema: {
      type: 'object',
      description: 'BIC/SWIFT lookup result from the GLEIF database.',
      properties: {
        bic: { type: 'string', description: 'Echo of the input, normalized to uppercase.' },
        bic8: { type: 'string', description: '8-char form (institution-level).' },
        bic11: { type: 'string', description: '11-char form including branch.' },
        found: { type: 'boolean' },
        valid_format: { type: 'boolean' },
        // null on `found: false`, and on a found BIC that carries no LEI: the
        // two most common answers of this tool (see the note above validate_iban's bic).
        institution: { type: ['string', 'null'], description: 'Bank legal name. null when the BIC is not found.' },
        country: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
          },
        },
        city: { type: ['string', 'null'] },
        lei: { type: ['string', 'null'], description: 'Legal Entity Identifier (ISO 17442); null when none is on file.' },
        address: {
          type: ['object', 'null'],
          description: 'Registered head-office address (GLEIF). null when the BIC carries no LEI or address.',
          properties: {
            type: { type: 'string' },
            street: { type: ['string', 'null'] },
            post_code: { type: ['string', 'null'] },
            region: { type: ['string', 'null'] },
            city: { type: ['string', 'null'] },
            country: { type: 'string' },
            source: { type: 'string' },
            as_of: { type: ['string', 'null'] },
          },
        },
        address_available: { type: 'boolean' },
      },
      required: ['bic', 'found', 'valid_format'],
    },
  },
  {
    name: 'lookup_ch_clearing',
    title: 'Swiss Clearing Lookup',
    annotations: { title: 'Swiss Clearing Lookup', ...READ_ONLY },
    description:
      'Resolve a Swiss BC-Nummer / IID (1 to 5 digits) into the underlying institution. ' +
      'USE WHEN: the user mentions a Swiss bank by BC-Nummer or IID, pastes a CH or LI IBAN clearing code, ' +
      'asks routing details for a Swiss instant transfer (SIC, euroSIC), asks about QR-bill QR-IID resolution, ' +
      'or needs to classify a Swiss financial institution (bank vs PFS vs SIC-only participant). ' +
      'THE DEEPEST SWISS CLEARING DATA IN ANY PUBLIC API — full SIX BankMaster payment-rail participation (SIC, RTGS CHF, Instant Payments CHF, euroSIC, LSV+/BDD) plus QR-IID allocation, not just a name lookup. ' +
      'BACKED BY: 1,100+ SIX BankMaster entries (Swiss official source, refreshed monthly). ' +
      'RETURNS: institution { name, type, iid_type, headquarters_iid }, address, bic, payment_services { sic, rtgs_chf, instant_payments_chf, eurosic, lsv_bdd_chf, lsv_bdd_eur }, sic_iid, qr_iid, valid_on. ' +
      'COST: 0.003 USDC. Only relevant for CH and LI accounts.',
    inputSchema: {
      type: 'object',
      properties: {
        iid: {
          type: 'string',
          description: 'Swiss IID / BC-Nummer (1 to 5 digits, leading zeros stripped). Example: "230" for UBS Switzerland AG.',
        },
      },
      required: ['iid'],
    },
    outputSchema: {
      type: 'object',
      description: 'Swiss BC-Nummer / IID resolution from the SIX BankMaster database.',
      properties: {
        iid: { type: 'string', description: '5-digit zero-padded BC-Nummer.' },
        found: { type: 'boolean' },
        institution: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            type: {
              type: 'string',
              enum: ['bank', 'cantonal_bank', 'postfinance', 'raiffeisen', 'central_bank', 'foreign_participant'],
            },
            iid_type: { type: 'string', enum: ['headquarters', 'branch', 'other'] },
            headquarters_iid: { type: 'string' },
          },
        },
        address: {
          type: 'object',
          properties: {
            street: { type: ['string', 'null'] },
            building_number: { type: ['string', 'null'] },
            post_code: { type: ['string', 'null'] },
            town: { type: ['string', 'null'] },
            country: { type: 'string' },
          },
        },
        bic: { type: ['string', 'null'], description: 'BIC if mapped, null otherwise.' },
        payment_services: {
          type: 'object',
          properties: {
            sic: { type: 'boolean', description: 'Swiss Interbank Clearing.' },
            rtgs_chf: { type: 'boolean' },
            instant_payments_chf: { type: 'boolean' },
            eurosic: { type: 'boolean' },
            lsv_bdd_chf: { type: 'boolean' },
            lsv_bdd_eur: { type: 'boolean' },
          },
        },
        sic_iid: { type: ['string', 'null'] },
        qr_iid: { type: ['string', 'null'], description: 'QR-IID allocation, null when none.' },
        valid_on: { type: 'string' },
      },
      required: ['iid', 'found'],
    },
  },
  {
    name: 'validate_payment_reference',
    title: 'Validate Payment Reference',
    annotations: { title: 'Validate Payment Reference', ...READ_ONLY },
    description:
      'Validate a structured payment reference and, when an IBAN is supplied, decide whether the two may legally travel together. ' +
      'USE WHEN: assembling a payment instruction from an invoice, a QR-bill or a remittance advice; whenever a Swiss IBAN and a reference appear together; ' +
      'or when the user pastes an "RF..." string, a 27-digit number, or a +++123/4567/89012+++ block. ' +
      'DO NOT USE to validate the IBAN itself — that is validate_iban. ' +
      'SCHEMES: RF Creditor Reference (ISO 11649, "SCOR" in Swiss Payment Standards, mod 97-10); Swiss QR reference ("QRR", 27 digits, modulo 10 recursive); Belgian OGM/VCS (12 digits, modulo 97, a remainder of 0 written 97); Finnish viitenumero (4-20 digits, weights 7-3-1 from the right). ' +
      'Norwegian KID and Swedish OCR are RECOGNISED but never judged: they answer valid: null with status unverifiable_without_creditor_config, because modulus type and length are configured per creditor account by the beneficiary bank. NEVER relay those to a user as "invalid". ' +
      'AMBIGUITY: only a leading "RF" and a 27-digit length pin a scheme down. A bare 12-digit string is both a Belgian OGM and a legal Finnish length, so the more specific reading is returned and the other appears in also_valid_as. Pass reference_type when you know the country. ' +
      'THE PAIRING RULE: pass an iban and you also get a pairing verdict. Per the Swiss Implementation Guidelines a QRR reference may ONLY be used with a QR-IBAN (institution identifier in the SIX range 30000-31999), and an ISO 11649 reference may NOT be used with one. Outside CH and LI, pairing is not_applicable. ' +
      'valid and pairing are INDEPENDENT verdicts — a reference can be arithmetically valid and still illegal on that account. Relay source/as_of: they make the verdict auditable. ' +
      'COST: free without an iban (routed to GET /v1/reference/validate). WITH an iban it is routed to POST /v1/iban/validate and costs 0.005 USDC, which also returns the full IBAN enrichment — the pairing verdict is what that call buys.',
    inputSchema: {
      type: 'object',
      properties: {
        reference: {
          type: 'string',
          description:
            'The reference as printed. Spaces, slashes and the Belgian +++...+++ wrapper are stripped. Examples: "RF18539007547034", "210000000003139471430009017", "+++010/8068/17183+++".',
        },
        reference_type: {
          type: 'string',
          enum: ['rf', 'scor', 'qrr', 'ogm', 'vcs', 'viitenumero', 'kid', 'ocr'],
          description: 'Optional scheme hint, used when the string alone is ambiguous.',
        },
        iban: {
          type: 'string',
          description:
            'Optional creditor IBAN this reference would travel with. Supply it for the pairing verdict; that path is billed at 0.005 USDC.',
        },
      },
      required: ['reference'],
    },
    outputSchema: {
      type: 'object',
      description:
        'Reference verdict. Without an iban this is the free checksum answer; with one it is the reference_check block of a full IBAN validation.',
      properties: {
        reference: { type: 'string', description: 'Normalized: uppercase, separators removed.' },
        // The three nulls the descriptions already promised were typed as
        // non-null, so the client refused the very answers they describe.
        scheme: {
          type: ['string', 'null'],
          enum: ['rf', 'qrr', 'ogm', 'viitenumero', 'kid', 'ocr', null],
          description: 'Null when no supported scheme matches.',
        },
        valid: {
          type: ['boolean', 'null'],
          description:
            'null means recognised but uncheckable without the creditor bank configuration (KID, OCR). Never report null as false.',
        },
        status: { type: 'string', enum: ['checked', 'unverifiable_without_creditor_config', 'unrecognised'] },
        check_digit_expected: {
          type: 'string',
          description: 'A STRING, so a two-digit value beginning with zero survives ("03", "97").',
        },
        also_valid_as: { type: 'object', description: 'The second reading of an ambiguous string, with its own verdict.' },
        source: {
          type: ['string', 'null'],
          description: 'The document publishing the rule. Null only when no scheme matched. Relay it.',
        },
        as_of: { type: 'string', description: 'YYYY-MM of that document.' },
        note: { type: 'string' },
        pairing: {
          type: 'string',
          enum: ['ok', 'qrr_requires_qr_iban', 'scor_forbidden_with_qr_iban', 'not_applicable'],
          description: 'Present only when an iban was supplied.',
        },
        pairing_source: { type: 'string', description: 'A DIFFERENT document from source.' },
        pairing_as_of: { type: 'string' },
      },
      required: ['reference', 'scheme', 'valid', 'status', 'source', 'note'],
    },
  },
  {
    name: 'check_swiss_qr_bill',
    title: 'Check Swiss QR-bill Payload',
    annotations: { title: 'Check Swiss QR-bill Payload', ...READ_ONLY },
    description:
      "Check a Swiss QR-bill payload, the text a QR-bill's code carries (starts with SPC), rule by rule, each finding citing the SIX document it comes from. USE WHEN: an agent, an ERP or an accounting tool holds a scanned or generated QR-bill and must know before paying or issuing it whether it is well-formed, whether the reference type matches the IBAN (QRR needs a QR-IBAN, IID 30000-31999), and above all whether the creditor and debtor addresses are STRUCTURED (type S) or still COMBINED (type K): the standard removed type K on 21.11.2025 and banks stop processing payments built on it from 14.11.2026. DO NOT USE to learn which bank holds the account or its payment-rail participation: that is the paid validate_iban. RETURNS: { valid, ready_for_2026_11_14, creditor_iban { value, valid, country, qr_iban, iid }, creditor { present, address, structured, sps_check, proposed_structured }, ultimate_debtor, amount, currency, reference { type, value, valid, note }, findings [{ code, severity, field, detail, source }], next_steps, source }. A combined address comes back with proposed_structured, the S-type fields derived from the combined lines, to relay as a fix. IMPORTANT: relay each finding's source string. " +
      'COST: free (routed to POST /v1/ch/qr-bill/check).',
    inputSchema: {
      type: 'object',
      properties: {
        payload: {
          type: 'string',
          description:
            'The Swiss QR Code text with real line breaks: SPC, 0200, 1, IBAN, creditor (7 lines), ultimate creditor (7 empty lines), amount, currency, ultimate debtor (7 lines), reference type, reference, message, EPD, optional billing information and alternative schemes.',
        },
      },
      required: ['payload'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        valid: { type: 'boolean', description: 'True when no finding has severity error.' },
        ready_for_2026_11_14: { type: 'boolean', description: 'valid AND every present address is structured (type S).' },
        qr_type: { type: 'string' },
        version: { type: 'string' },
        coding: { type: 'string' },
        creditor_iban: { type: 'object', additionalProperties: true },
        creditor: { type: 'object', additionalProperties: true },
        ultimate_creditor_empty: { type: 'boolean' },
        amount: { type: ['string', 'null'] },
        currency: { type: ['string', 'null'] },
        ultimate_debtor: { type: 'object', additionalProperties: true },
        reference: { type: 'object', additionalProperties: true },
        unstructured_message: { type: ['string', 'null'] },
        trailer: { type: 'string' },
        billing_information: { type: ['string', 'null'] },
        alternative_schemes: { type: 'array', items: { type: 'string' } },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              code: { type: 'string' },
              severity: { type: 'string' },
              field: { type: 'string' },
              detail: { type: 'string' },
              source: { type: 'string' },
            },
            additionalProperties: true,
          },
        },
        next_steps: { type: 'array', items: { type: 'string' } },
        source: { type: 'string' },
      },
      required: ['valid', 'ready_for_2026_11_14', 'findings', 'next_steps', 'source'],
      additionalProperties: true,
    },
  },
  {
    name: 'check_postal_address',
    title: 'Check ISO 20022 Postal Address',
    annotations: { title: 'Check ISO 20022 Postal Address', ...READ_ONLY },
    description:
      "Check a structured ISO 20022 postal address against a payment rail's published address rules, rule by rule, each verdict citing the document it comes from. " +
      'USE WHEN: assembling a payment instruction (pain.001, a Fedwire message, a T2 transfer) with a creditor or debtor address, to learn whether the rail accepts it BEFORE submitting. The November 2026 changes (SIC 20.11, Fedwire 16.11, T2 R2026.NOV) remove the fully unstructured address option — this check tells you whether an address survives them. ' +
      'DO NOT USE to verify that a street or town EXISTS: this checks conformity with the message format rules, not postal reality. ' +
      "SCHEMES: 'sps' (Swiss Payment Standards, SIX), 'hvps_plus' (HVPS+ / T2, ECB), 'fedwire' (Federal Reserve). There is deliberately NO 'cbpr+' scheme: that guideline sits behind swift.com, unreachable to automated readers, and a conformity boolean quoting an unread document would be a guess dressed as a verdict — the note field restates this on every answer. " +
      'VERDICTS per finding: pass, fail, not_applicable — the last marks a rule whose precondition is not met and never counts as a pass. conforms is true when no finding failed. ' +
      "IMPORTANT: relay each finding's source string — it names the exact document, version and validity date the rule is quoted from. That is what makes the verdict auditable. " +
      'COST: free (routed to POST /v1/address/check). The paid surface is the postal_address block that lookup_bic and validate_iban return for the resolved institution.',
    inputSchema: {
      type: 'object',
      properties: {
        scheme: {
          type: 'string',
          enum: ['sps', 'hvps_plus', 'fedwire'],
          description: "Which rail's rules to check against.",
        },
        address: {
          type: 'object',
          description: 'The ISO 20022 PostalAddress under test, in ISO tag vocabulary (snake_cased).',
          properties: {
            twn_nm: { type: 'string', description: 'TwnNm — town name.' },
            ctry: { type: 'string', description: 'Ctry — ISO 3166-1 alpha-2 country code.' },
            pst_cd: { type: 'string', description: 'PstCd — postal code.' },
            strt_nm: { type: 'string', description: 'StrtNm — street name.' },
            bldg_nb: { type: 'string', description: 'BldgNb — building number.' },
            adr_tp: { type: 'string', description: 'AdrTp — address type (SPS forbids sending it).' },
            adr_line: { type: 'array', items: { type: 'string' }, description: 'AdrLine — free-text lines of the hybrid address.' },
          },
        },
      },
      required: ['scheme', 'address'],
    },
    outputSchema: {
      type: 'object',
      description: 'Rule-by-rule conformity verdict for one rail.',
      properties: {
        scheme: { type: 'string', enum: ['sps', 'hvps_plus', 'fedwire'] },
        conforms: {
          type: 'boolean',
          description: 'True when no finding failed. not_applicable findings never count against it.',
        },
        findings: {
          type: 'array',
          description: 'One entry per rule of the scheme, in a stable order.',
          items: {
            type: 'object',
            properties: {
              rule: { type: 'string', description: 'Stable identifier, safe to branch on.' },
              verdict: { type: 'string', enum: ['pass', 'fail', 'not_applicable'] },
              detail: { type: 'string', description: 'What was looked at and what was concluded.' },
              source: { type: 'string', description: 'The document the rule comes from, with its date. Relay it.' },
            },
            required: ['rule', 'verdict', 'detail', 'source'],
          },
        },
        note: { type: 'string', description: "Why 'cbpr+' is not on the menu. Served on every answer." },
      },
      required: ['scheme', 'conforms', 'findings', 'note'],
    },
  },
  {
    name: 'check_compliance',
    title: 'Compliance Check',
    annotations: { title: 'Compliance Check', ...READ_ONLY },
    description:
      'Run a full pre-flight compliance check on an IBAN before sending a SEPA / cross-border payment. ' +
      'USE WHEN: the user is about to send a payment / payout / refund and wants to triage risk first, ' +
      'asks "is this IBAN safe to pay?", asks for sanctions screening, asks whether the recipient bank is reachable for SEPA Instant, ' +
      'or needs a numeric risk score for an internal payment-approval workflow. ' +
      'NOT A REGULATED AML/CFT PRODUCT — informational triage only. For regulated screening use Refinitiv, Acuris, or ComplyAdvantage. ' +
      'SCOPE: sanctions screening is at the BANK (BIC8) level only — it does NOT screen the beneficiary/account-holder name. ' +
      'CHECKS: IBAN validity + bank sanctions (OFAC) + FATF grey/black list + ' +
      'SEPA Instant reachability + VoP (EU 2024/886) participant flag. ' +
      'RETURNS: the validate_iban fields PLUS a nested compliance { sanctions, reachability, vop, risk_score (0-100), risk_level, flags[] }. ' +
      'COST: 0.02 USDC.',
    inputSchema: {
      type: 'object',
      properties: {
        iban: {
          type: 'string',
          description: 'IBAN to run the compliance check against.',
        },
      },
      required: ['iban'],
    },
    outputSchema: {
      type: 'object',
      description: 'Compliance triage result. Informational, not a regulated AML/CFT product.',
      properties: {
        iban: { type: 'string' },
        valid: { type: 'boolean' },
        country: { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } } },
        bic: {
          type: ['object', 'null'],
          description: 'null when the bank code resolves no BIC; the bank-level sanctions check then has no bank to screen (compliance.sanctions.bank_screened: false).',
          properties: { code: { type: 'string' }, bank_name: { type: ['string', 'null'] }, city: { type: ['string', 'null'] } },
        },
        issuer: { type: 'object', properties: { type: { type: ['string', 'null'] }, name: { type: 'string' } } },
        sepa: {
          type: 'object',
          properties: {
            member: { type: 'boolean' },
            schemes: { type: 'array', items: { type: 'string' } },
            vop_required: { type: 'boolean' },
          },
        },
        risk_indicators: { type: 'object' },
        compliance: {
          type: 'object',
          description: 'The compliance bundle. Read the score at compliance.risk_score / compliance.risk_level.',
          properties: {
            sanctions: {
              type: 'object',
              properties: {
                country_sanctioned: { type: 'boolean' },
                bank_sanctioned: { type: 'boolean', description: 'Bank-BIC level only — NOT the beneficiary.' },
                matched_lists: { type: 'array', items: { type: 'string' }, description: 'e.g. ["OFAC","EU"].' },
                fatf_status: { type: 'string', enum: ['member', 'suspended', 'grey_list', 'black_list', 'non_member'] },
              },
            },
            reachability: {
              type: 'object',
              properties: { sepa_instant: { type: 'boolean' }, sct: { type: 'boolean' }, sdd: { type: 'boolean' } },
            },
            vop: {
              type: 'object',
              properties: { participant: { type: 'boolean' }, status: { type: 'string' } },
            },
            risk_score: {
              type: ['number', 'null'],
              minimum: 0,
              maximum: 100,
              description: '0 = safest, 100 = highest. null when the IBAN failed validation: there was nothing to score (risk_level: unassessable).',
            },
            risk_level: {
              type: 'string',
              enum: ['low', 'medium', 'elevated', 'high', 'critical', 'unassessable'],
              description: 'unassessable = the IBAN failed validation, no screening was possible. Never treat it as low.',
            },
            flags: { type: 'array', items: { type: 'string' } },
          },
        },
        meta: {
          type: 'object',
          description: 'Scope + freshness disclosure. Read this before trusting the result.',
          properties: {
            scope: { type: 'string', enum: ['bank_bic_only'], description: 'Sanctions are screened at the bank BIC, NOT the beneficiary name.' },
            disclaimer: { type: 'string' },
            // null when the compliance database has no metadata to read
            // (getComplianceMeta in src/lib/compliance-db.ts): the answer is
            // still served, with its dates unknown rather than invented.
            sanctions_as_of: { type: ['string', 'null'], description: 'ISO timestamp of the last data refresh; null when unknown.' },
            fatf_as_of: { type: ['string', 'null'], description: 'YYYY-MM of the FATF plenary reflected; null when unknown.' },
            sources: { type: ['string', 'null'], description: 'Comma-separated data sources; null when unknown.' },
          },
        },
        cost_usdc: { type: 'number' },
      },
      required: ['iban', 'valid', 'compliance'],
    },
  },
  {
    name: 'audit_creditor_file',
    title: 'Audit Creditor File',
    // NOT read-only: a successful call stores a job server-side, and with
    // checkout:true it also creates a Stripe Checkout Session. Same reasoning
    // as send_feedback below — the tool in this pair that writes gets its
    // confirmation; audit_status, a pure read, does not.
    annotations: { title: 'Audit Creditor File' },
    description:
      'Audit an entire creditor/supplier payment file (CSV or XLSX) row by row: IBAN structure and checksum, bank code against the national register, bank name and BIC, SEPA reachability and issuer type — plus checks a single IBAN call cannot make because they need the whole file: duplicate IBANs, the BIC the file carries against the BIC the register derives, address country against IBAN country, and Swiss structured-address conformity ahead of the 14 November 2026 deadline. ' +
      'USE WHEN: the user has a spreadsheet or export of creditor/supplier bank accounts (accounts-payable file, vendor master, payment batch) and wants it checked before sending payments, or asks to "audit my creditor file" / "check this supplier list" / "validate this payment batch". ' +
      'HOW: base64-encode the file bytes and pass them as `file_base64`, with the original `filename` (its extension decides CSV vs XLSX parsing). ' +
      `LIMITS: rejects files decoding to more than ${AUDIT_MAX_BYTES / 1024 / 1024} MB — checked locally, before any network call, because a larger base64 payload breaks the stdio channel; the HTTP route itself accepts up to 10 MB — and sheets over 20,000 rows, which the route rejects (400 too_many_rows). ` +
      'RETURNS a FREE PREVIEW ONLY, never the full report: `job` (the id to reuse with audit_status), `rows`, `paid` (always false from this call), `price` / `currency` naming what the full report costs, `summary` (counts by status and finding code, countries seen, columns detected), and `preview` (the first flagged rows then the first OK ones, up to 20, IBANs masked like "CH10 **** 2346"). ' +
      'The annotated .xlsx report is a PAID deliverable — $149 up to 5,000 rows, $349 up to 20,000 — settled through a one-off Stripe Checkout Session. This tool NEVER pays automatically: pass `checkout: true` to also receive a Checkout URL for a HUMAN to open, then poll audit_status with the same `job` id to learn when it is paid and get the download link. ' +
      'COST: free. Only the full report is paid, and only once a human completes the Stripe checkout.',
    inputSchema: {
      type: 'object',
      properties: {
        file_base64: {
          type: 'string',
          description: 'The CSV or XLSX file content, base64-encoded — the raw payload only, no "data:" URL prefix.',
        },
        filename: {
          type: 'string',
          description: 'Original filename with its extension, e.g. "creditors.csv" or "suppliers.xlsx". The extension decides how the file is parsed.',
        },
        lang: {
          type: 'string',
          enum: ['en', 'fr', 'de'],
          description: 'Language for the summary labels and, later, the annotated report. Defaults to "en".',
        },
        checkout: {
          type: 'boolean',
          description: 'When true, immediately create a Stripe Checkout Session after the upload and return its URL for a human to open and pay. Defaults to false. Never pays anything by itself.',
        },
      },
      required: ['file_base64', 'filename'],
    },
    outputSchema: {
      type: 'object',
      description: 'The free preview of the audit: job id, summary and first rows. Never the full report.',
      properties: {
        job: { type: 'string', description: 'Job id — pass to audit_status to poll payment and get the download link.' },
        rows: { type: 'number' },
        tier: { type: 'string', enum: ['standard', 'large'] },
        price: { type: 'number', description: 'Price of the full report, in the currency given by `currency` (USD), decided by row count alone.' },
        currency: { type: 'string' },
        lang: { type: 'string', enum: ['en', 'fr', 'de'] },
        paid: { type: 'boolean', description: 'Always false from this tool — nothing has been paid yet.' },
        retention: { type: 'string', description: 'How long the job is kept before it purges.' },
        summary: {
          type: 'object',
          description: 'Counts by status and finding code, countries seen, columns detected. Mirrors AuditSummary in the API.',
          additionalProperties: true,
        },
        preview: {
          type: 'array',
          description: 'First flagged rows then first OK rows, up to 20. IBANs are masked.',
          items: {
            type: 'object',
            properties: {
              line: { type: 'number' },
              iban_masked: { type: 'string' },
              status: { type: 'string', enum: ['ok', 'warning', 'error'] },
              findings: { type: 'array', items: { type: 'string' } },
              bank_name: { type: ['string', 'null'] },
            },
          },
        },
        checkout: { type: ['string', 'null'], description: 'Route to call for payment, e.g. "POST /v1/audit/checkout/{job}". Null once paid.' },
        download: { type: ['string', 'null'], description: 'Set only once paid and with the matching session — always null from this tool.' },
        checkout_url: { type: 'string', description: 'Present only when `checkout: true` was passed and the session was created: a Stripe Checkout URL for a human to open.' },
        checkout_session_id: { type: 'string', description: 'Present alongside checkout_url — pass it to audit_status as `session_id` right after a human pays.' },
        _note: { type: 'string', description: 'Plain-language reminder that this is a free preview and how to get the paid report.' },
      },
      required: ['job', 'rows', 'paid', 'summary', 'preview'],
      additionalProperties: true,
    },
  },
  {
    name: 'audit_status',
    title: 'Audit Job Status',
    annotations: { title: 'Audit Job Status', ...READ_ONLY },
    description:
      'Check the status of a creditor-file audit job created by audit_creditor_file: whether it is paid, and the download link once it is. ' +
      'USE WHEN: following up on a `job` id after a human may have paid through the Checkout URL, to learn whether the full report is ready. ' +
      'RETURNS: the same free-preview fields as audit_creditor_file, plus `paid`, `paid_at`, and `download` — a `GET /v1/audit/report/{job}?session_id=...` path, non-null only once paid AND `session_id` matches the paying session. ' +
      "Pass the `session_id` from the Checkout URL's success redirect (its `session_id=` query parameter) so a just-completed payment is confirmed immediately instead of waiting for the webhook. " +
      'COST: free.',
    inputSchema: {
      type: 'object',
      properties: {
        job: { type: 'string', description: 'The job id returned by audit_creditor_file.' },
        session_id: {
          type: 'string',
          description: 'The Stripe Checkout session id, from the success redirect (?session_id=...). Confirms payment immediately when the webhook has not landed yet.',
        },
      },
      required: ['job'],
    },
    outputSchema: {
      type: 'object',
      description: 'Same shape as the free preview from audit_creditor_file, plus payment state.',
      properties: {
        job: { type: 'string' },
        rows: { type: 'number' },
        tier: { type: 'string', enum: ['standard', 'large'] },
        price: { type: 'number' },
        currency: { type: 'string' },
        lang: { type: 'string', enum: ['en', 'fr', 'de'] },
        paid: { type: 'boolean' },
        paid_at: { type: ['string', 'null'] },
        expires_at: { type: 'string' },
        retention: { type: 'string' },
        summary: { type: 'object', additionalProperties: true },
        preview: { type: 'array', items: { type: 'object', additionalProperties: true } },
        checkout: { type: ['string', 'null'] },
        download: { type: ['string', 'null'], description: 'GET path for the .xlsx report. Non-null only when paid and session_id matched.' },
      },
      required: ['job', 'paid'],
      additionalProperties: true,
    },
  },
  {
    name: 'send_feedback',
    title: 'Send Feedback to IBANforge',
    // PAS de READ_ONLY ici : c'est le seul outil de ce serveur qui ÉCRIT.
    // Le déclarer read-only ferait sauter la confirmation utilisateur sur la
    // seule opération de ce serveur qui en mérite une.
    annotations: { title: 'Send Feedback to IBANforge' },
    description:
      'Report a problem or a need directly to the IBANforge operators: incorrect validation result, stale or missing BIC/bank data, ' +
      'latency, or anything blocking you from using or PAYING for the service (missing network, unclear pricing, quota shape). ' +
      'USE WHEN: a result looks wrong, data you need is missing, or you hit a wall (quota, payment, capability) and want it fixed. ' +
      'This tool is free and does NOT count against the daily free-tier limit — it works even after the limit is reached. ' +
      'A human reads every report; verified data errors on paid x402 calls are refunded on-chain.',
    inputSchema: {
      type: 'object',
      properties: {
        error_type: {
          type: 'string',
          // ⚠️ Cette liste est le miroir de FEEDBACK_ERROR_TYPES
          // (src/routes/feedback.ts) : ce paquet est publié séparément et ne
          // peut pas importer depuis src/. `scripts/mcp-parity.test.ts`
          // compare les deux et casse si elles divergent.
          enum: ['wrong_validation', 'stale_bic', 'missing_data', 'incorrect_classification', 'latency', 'other'],
          description: 'Category of the report. Use "other" for product feedback, pricing/payment blockers or feature needs.',
        },
        notes: {
          type: 'string',
          minLength: 3,
          maxLength: 4000,
          description: 'What happened, what you needed, or what blocked you — free text.',
        },
        endpoint: { type: 'string', maxLength: 200, description: 'Endpoint or tool concerned, e.g. /v1/iban/batch.' },
        expected: { type: 'string', maxLength: 1000, description: 'What you expected (for data errors).' },
        got: { type: 'string', maxLength: 1000, description: 'What you received instead (for data errors).' },
        contact: { type: 'string', maxLength: 255, description: 'Where we may answer you (e-mail) — optional, reports can be anonymous.' },
        agent: { type: 'string', maxLength: 120, description: 'Which agent/model is reporting, e.g. "claude-sonnet-5 via MCP".' },
      },
      required: ['error_type', 'notes'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        id: { type: 'number', description: 'Report id — check status at GET /v1/feedback/{id}.' },
      },
      required: ['ok', 'id'],
    },
  },
  // ── Device grant (RFC 8628) ──────────────────────────────────────────────
  //
  // PAS de READ_ONLY : ces deux outils écrivent une ligne, comme
  // send_feedback. Relayés vers POST /v1/keys/device et
  // POST /v1/keys/device/token, donc ils héritent de la réservation par réseau
  // que `openGrant()` porte dans la route — ce paquet est publié séparément et
  // ne connaît que l'API HTTP, il n'a aucune serrure à écrire.
  {
    name: 'request_api_key',
    title: 'Request an IBANforge API key',
    annotations: { title: 'Request an IBANforge API key' },
    description:
      'Start the process that gives this session its own free IBANforge API key, without any e-mail address and without leaving your conversation. ' +
      'USE WHEN: you hit the daily free allowance, a call answers 402, or you are about to run more than a handful of validations. ' +
      'WHAT YOU MUST DO WITH THE RESULT: read `status` first — `ok` means a code was issued, anything else means no code exists and `display_to_human` tells you and your human what to do instead. ' +
      'On `ok`, show `display_to_human` to your human VERBATIM (the user_code and the link) and say, in your own words, that opening the link and approving takes about fifteen seconds and asks for nothing. ' +
      'Do NOT open the link yourself, do NOT fill anything in on their behalf, and do NOT invent an e-mail address: the page gives a key with no address at all, and your human may add one if THEY choose. ' +
      'Then call poll_api_key. ' +
      'This tool is free and does NOT count against the daily free-tier limit — it works even after the limit is reached.',
    inputSchema: {
      type: 'object',
      properties: {
        client_name: {
          type: 'string',
          maxLength: 60,
          description: 'Optional. Who is asking, shown to the human on the approval page.',
        },
        reason: {
          type: 'string',
          maxLength: 200,
          description: 'Optional. What the key is for, shown to the human on the approval page.',
        },
      },
    },
    // 🚨 `device_code` n'est PAS dans ce schéma, et ce n'est pas un oubli : il
    // est le porteur unique de la clé, et une sortie d'outil traverse le
    // transcript du modèle. `poll_api_key` reprend le dernier code demandé.
    outputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['ok', 'device_rate_limited', 'device_unavailable'],
          description:
            'ok means a code was issued. Anything else: read display_to_human and fall back.',
        },
        user_code: {
          type: ['string', 'null'],
          description: 'Show this to the human, exactly as written, e.g. WDJB-MJHT.',
        },
        verification_uri: {
          type: ['string', 'null'],
          description: 'The page the human opens. Never open it yourself.',
        },
        verification_uri_complete: {
          type: ['string', 'null'],
          description: 'Same page with the code pre-filled. This is the one to show.',
        },
        expires_in: { type: ['number', 'null'], description: 'Seconds until the code stops working.' },
        interval: {
          type: ['number', 'null'],
          description: 'Minimum seconds between two poll_api_key calls.',
        },
        display_to_human: {
          type: 'string',
          description: 'A ready-made block of text to show verbatim. Do not paraphrase it.',
        },
      },
      required: ['status', 'display_to_human'],
    },
  },
  {
    name: 'poll_api_key',
    title: 'Collect the approved IBANforge API key',
    annotations: { title: 'Collect the approved IBANforge API key' },
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
      'This tool is free and does NOT count against the daily free-tier limit.',
    inputSchema: {
      type: 'object',
      properties: {
        device_code: {
          type: 'string',
          description: 'Optional. Leave it empty to reuse the last request from this session.',
        },
      },
    },
    outputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: [
            'authorization_pending',
            'approved',
            'access_denied',
            'expired_token',
            'invalid_grant',
          ],
          description: 'authorization_pending is normal: wait `retry_in_seconds` and call again.',
        },
        api_key: {
          type: ['string', 'null'],
          description: 'Present exactly once, on the first approved poll.',
        },
        key_prefix: { type: ['string', 'null'] },
        tier: {
          type: ['string', 'null'],
          enum: ['anonymous', 'email', 'claimed', 'paid', null],
          description: 'anonymous = the entry allowance, email/claimed/paid = the raised one.',
        },
        monthly_limit: { type: ['number', 'null'] },
        email: {
          type: ['string', 'null'],
          description: 'Absent on the anonymous tier: no address was ever given.',
        },
        retry_in_seconds: { type: ['number', 'null'] },
        expires_in: { type: ['number', 'null'] },
        config_line: {
          type: ['string', 'null'],
          description: 'The exact command line to give the human. Do not run it yourself.',
        },
        message: { type: 'string', description: 'One sentence for the human.' },
      },
      required: ['status', 'message'],
    },
  },
];

const apiCall = createApiClient({
  baseUrl: API_BASE,
  apiKey: API_KEY,
  version: pkg.version,
  timeoutMs: requestTimeout(process.env.IBANFORGE_TIMEOUT_MS),
});

/**
 * 🚨 L'ATTENTE DU CLIENT DOIT DÉPASSER CELLE DU SERVEUR, et le défaut ne le
 * faisait pas.
 *
 * `POST /v1/keys/device/token` retient la requête jusqu'à `DEVICE_POLL_WAIT_MS`
 * (30 s en production) : c'est un long-polling, c'est voulu, et c'est ce qui
 * évite à l'agent de boucler. Or `DEFAULT_TIMEOUT_MS` de ce paquet vaut
 * exactement 30 s aussi. Le client perdait donc la course à l'instant près — il
 * abandonnait pendant que le serveur répondait —, `poll_api_key` rendait un
 * `request_timeout` au premier tour, et l'agent renonçait avant même que
 * l'humain n'ait cliqué. Exactement le défaut que ce module existe pour éviter,
 * par une porte que rien ne nommait.
 *
 * D'où un second client, réglé plus large que le serveur, et pour ces deux
 * outils SEULEMENT : les autres gardent le délai réglable de l'utilisateur, un
 * appel de validation qui traîne trente secondes est une panne.
 *
 * ⚠️ La valeur ne passe PAS par `requestTimeout()` : cette lecture borne à
 * 120 s et retombe sur le défaut hors bornes, donc elle annulerait en silence
 * la marge qu'on vient de poser. `scripts/mcp-parity.test.ts` vérifie que ce
 * nombre reste supérieur au `DEVICE_POLL_WAIT_MS` de
 * `src/lib/device-grant.ts` — c'est le même idiome que `AUDIT_MAX_BYTES` : un
 * nombre recopié, mais gardé.
 */
const DEVICE_POLL_TIMEOUT_MS = 45_000;

const deviceApiCall = createApiClient({
  baseUrl: API_BASE,
  apiKey: API_KEY,
  version: pkg.version,
  timeoutMs: DEVICE_POLL_TIMEOUT_MS,
});

/**
 * Le dernier `device_code` demandé, pour que `poll_api_key` marche sans
 * argument.
 *
 * Une variable de module suffit, et ce n'est pas un raccourci : ce processus
 * appartient à un seul humain, il n'y a aucun locataire à isoler. La liaison à
 * l'empreinte de réseau est propre à la surface HTTP distante, la seule qui
 * soit multi-locataire.
 */
let lastDeviceCode: string | null = null;

/**
 * Best-effort content type for the multipart part carrying the uploaded
 * file. The route decides CSV vs XLSX by filename extension (readTable in
 * src/lib/audit-file.ts), not by this header — it only makes the request a
 * politely-typed one.
 */
function contentTypeFor(filename: string): string {
  return /\.(xlsx|xls)$/i.test(filename)
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';
}

/**
 * The `instructions` block an MCP client injects into its model's context at
 * connect time. Verbatim copy of `src/mcp/instructions.ts` in the API repo:
 * this package is a separate npm project and cannot import from `src/`, so the
 * copy is kept honest by a character-for-character parity test
 * (`src/mcp/instructions.test.ts`).
 *
 * Until 2026-09-01 this surface — the main distribution channel — answered
 * `initialize` with no instructions at all, while the HTTP transport had them
 * (audit MCP-11).
 */
const INSTRUCTIONS =
  'Start with validate_iban on any IBAN-looking string (e.g. DE89370400440532013000) — one call returns validity, the issuing bank + BIC, virtual-IBAN/EMI detection, SEPA reachability and VoP readiness. ' +
  // 2026-09-15 : cette phrase s'ouvrait sur {"email":…}. Un agent l'a lue comme
  // « inscris ton utilisateur quelque part » et a refusé tout le chemin (test en
  // aveugle du 08/09). L'e-mail est devenu OPTIONNEL et passe en second ; le
  // corps vide passe en premier.
  //
  // 🚨 Les chiffres sont écrits, pas interpolés, et ce n'est pas un oubli :
  // l'extracteur de `src/mcp/instructions.test.ts` ne reconnaît que des chaînes
  // entre apostrophes simples, donc un gabarit à backticks casserait les trois
  // tests de parité avec la copie du paquet npm. Deux assertions du même
  // fichier relient ces chiffres à `src/lib/tiers.ts`.
  //
  // 🚨 Aucun outil qui n'existe pas n'est nommé ici : ce bloc est injecté dans
  // le contexte du modèle AVANT `tools/list`, donc citer un outil absent
  // apprendrait à l'agent que la documentation mente. Un test vérifie que tout
  // nom d'outil cité est bien enregistré.
  'Free tier: 10 tool calls/IP/day here, no signup. For sustained use, POST https://api.ibanforge.com/v1/keys/generate with no body at all — no e-mail, no card, nothing to confirm — and an ifk_ key worth 25 REST calls/month comes back on the spot. ' +
  'POST https://api.ibanforge.com/v1/keys/claim lifts that same key to 200 REST calls/month — send the key as "Authorization: Bearer ifk_...", not in the body, once it has served at least one call. Two ways: a 6-digit code mailed to an address your human gave you FOR THIS (ask in their words, "Use my address you@company.com to create a free IBANforge key", and never send an address your human has not handed you for this purpose), or an x402 payment made on the key. The mailed code gives 200 every month; a payment gives 200 once. ' +
  // 2026-09-15 : copie CARACTÈRE POUR CARACTÈRE de la phrase device grant de
  // src/mcp/instructions.ts. Ce paquet est publié séparément et ne peut pas
  // importer depuis src/ ; `src/mcp/instructions.test.ts` compare les deux.
  'Or ask for a durable key with request_api_key then poll_api_key: a human approves in a browser, the agent never handles an address, and both tools keep answering after the daily limit. ' +
  'Prepaid credit packs from $4 per 1,000 calls, no expiry. ' +
  'Missing data, wrong result, or something blocking you from paying? Call send_feedback — a human reads every report. ' +
  'Paying as an agent (wallet, USDC on Base, prepaid packs): https://ibanforge.com/docs/pay-as-an-agent — ' +
  'Docs and code samples: https://ibanforge.com/docs/recipes';

const server = new Server(
  { name: 'ibanforge', version: pkg.version },
  { capabilities: { tools: {} }, instructions: stdioInstructions(INSTRUCTIONS) },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const a = (args ?? {}) as JsonRecord;

  // Every tool here declares an `outputSchema`, and the spec is not optional
  // about what that obliges: a client may refuse a result that has one and
  // carries no `structuredContent`. The official SDKs do exactly that —
  // "Tool <name> has an output schema but did not return structured content"
  // — so for two months every call against this server failed on arrival
  // while `tools/list` kept looking healthy.
  const out = async (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  });

  // Errors take the other branch. Each schema has a `required` list that a
  // rejection payload cannot satisfy, so attaching structuredContent here
  // would swap "missing structured content" for "structured content does not
  // validate". `isError` is the branch the spec reserves for this, and it is
  // what tells a client to skip output-schema validation entirely.
  const fail = async (data: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    isError: true,
  });

  // An upstream non-ok response arrives as `_error: true` from apiCall. It is
  // a failure whatever the tool, and it never matches the success schema.
  const relay = async (data: JsonRecord) => (data._error ? fail(data) : out(data));

  // Le repli de format reste réservé à l'essai sans clé. Une clé épuisée ou
  // une panne ne doivent jamais changer le contrat de validation en silence.
  const wantsFreeFallback = (result: JsonRecord): boolean =>
    !API_KEY && result._error === true &&
    (result.status === 402 || result.code === 'UND_ERR_HEADERS_OVERFLOW');

  // Fallback message appended to anonymous-mode results so MCP inspectors
  // and discovery tools (Glama, Smithery, MCP.so) get a useful payload
  // without requiring an API key while still surfacing the upgrade path.
  const ANON_NOTE =
    'Anonymous mode — basic format validation only. For BIC, SEPA reachability, ' +
    'issuer classification, sanctions, Swiss BC-Nummer and risk score: take a key ' +
    'with no e-mail at all — POST /v1/keys/generate with no body, 25 REST calls a ' +
    'month — then POST /v1/keys/claim with the key in the Authorization header to ' +
    'lift it to 200 a month, or pay per call via x402 ' +
    '(see https://api.ibanforge.com/.well-known/x402).';

  // When the 402 carried a cause (exhausted quota/credits, invalid key), the
  // degraded fallback result must say so: the user HAS a key and would
  // otherwise believe they are anonymous — or worse, that the degraded
  // output is a full validation.
  const degradedNote = (paid: JsonRecord): string => {
    const cause = (paid?.cause ?? undefined) as { reason?: string; detail?: string } | undefined;
    if (!cause?.reason) return ANON_NOTE;
    return (
      `DEGRADED RESULT — basic format validation only (no BIC, SEPA, issuer or risk data). Reason: ${cause.detail ?? cause.reason}`
    );
  };

  try {
    switch (name) {
      case 'validate_iban': {
        if (typeof a.iban !== 'string' || !a.iban.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `iban` must be a non-empty string.' });
        }
        const result = await apiCall('POST', '/v1/iban/validate', { iban: a.iban });
        if (wantsFreeFallback(result)) {
          const free = await apiCall('GET', `/v1/iban/format?iban=${encodeURIComponent(a.iban)}`);
          if (!free._error) {
            return out({
              ...free,
              _degraded: true,
              _scope: 'format_only',
              _upstream_error: { status: result.status, error: result.error },
              _note: degradedNote(result),
            });
          }
          // The free endpoint rejected the input itself (e.g. length out of
          // bounds): that 400 is the real cause — don't mask it as "payment
          // required".
          if (free.status === 400) {
            return fail(free);
          }
        }
        return relay(result);
      }

      case 'batch_validate_iban': {
        if (!Array.isArray(a.ibans) || a.ibans.length === 0 || a.ibans.some((iban) => typeof iban !== 'string' || !iban.trim())) {
          return fail({ error: 'invalid_input', message: 'Argument `ibans` must be a non-empty array of strings.' });
        }
        if (a.ibans.length > 100) {
          return fail({ error: 'too_many_ibans', message: 'Max 100 IBANs per batch. Split your input.' });
        }
        const result = await apiCall('POST', '/v1/iban/batch', { ibans: a.ibans as string[] });
        // Un lot refusé reste un seul appel refusé. Le convertir en cent
        // appels de format épuiserait le quota et masquerait des erreurs par ligne.
        return relay(result);
      }

      case 'lookup_bic': {
        if (typeof a.bic !== 'string' || !/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/.test(a.bic)) {
          return fail({
            error: 'invalid_bic',
            message: 'BIC must be 8 or 11 alphanumeric characters. Example: UBSWCHZH80A.',
          });
        }
        const result = await apiCall('GET', `/v1/bic/${encodeURIComponent(a.bic.toUpperCase())}`);
        return relay(result);
      }

      case 'lookup_ch_clearing': {
        if (typeof a.iid !== 'string' || !/^\d{1,5}$/.test(a.iid)) {
          return fail({
            error: 'invalid_iid',
            message: 'IID must be 1-5 digits. Example: 230 for UBS Switzerland AG.',
          });
        }
        const result = await apiCall('GET', `/v1/ch/clearing/${encodeURIComponent(a.iid)}`);
        return relay(result);
      }

      case 'check_compliance': {
        if (typeof a.iban !== 'string' || !a.iban.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `iban` must be a non-empty string.' });
        }
        const result = await apiCall('POST', '/v1/iban/compliance', { iban: a.iban });
        return relay(result);
      }

      case 'validate_payment_reference': {
        if (typeof a.reference !== 'string' || !a.reference.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `reference` must be a non-empty string.' });
        }
        // Two rails, because the pairing verdict is the paid half. Without an
        // IBAN there is nothing to pair against, so the free endpoint answers
        // in full; with one, the block rides inside the IBAN validation that
        // already carries the SIX register — and that call is billed.
        if (typeof a.iban === 'string' && a.iban.trim()) {
          const full = await apiCall('POST', '/v1/iban/validate', {
            iban: a.iban,
            reference: a.reference,
            ...(typeof a.reference_type === 'string' ? { reference_type: a.reference_type } : {}),
          });
          const block = (full as JsonRecord).reference_check;
          // Relay the whole answer when the block is missing rather than an
          // empty object: an invalid IBAN, or a 402, still produced a real
          // response, and swallowing it would hide the reason. The narrowing is
          // explicit because `reference_check` is `unknown` here — `block ?? full`
          // widens to `{}` and loses the index signature `relay` needs.
          return relay(block !== null && typeof block === 'object' ? (block as JsonRecord) : full);
        }
        const query = new URLSearchParams({ reference: a.reference });
        if (typeof a.reference_type === 'string') query.set('reference_type', a.reference_type);
        const result = await apiCall('GET', `/v1/reference/validate?${query.toString()}`);
        return relay(result);
      }

      case 'check_swiss_qr_bill': {
        if (typeof a.payload !== 'string' || !a.payload.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `payload` must be the Swiss QR Code text (starts with SPC).' });
        }
        const result = await apiCall('POST', '/v1/ch/qr-bill/check', { payload: a.payload });
        return relay(result);
      }

      case 'check_postal_address': {
        if (typeof a.scheme !== 'string' || !a.scheme.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `scheme` must be one of sps, hvps_plus, fedwire.' });
        }
        if (a.address === null || typeof a.address !== 'object' || Array.isArray(a.address)) {
          return fail({ error: 'invalid_input', message: 'Argument `address` must be an object of ISO 20022 tags (twn_nm, ctry, pst_cd, strt_nm, bldg_nb, adr_tp, adr_line[]).' });
        }
        const result = await apiCall('POST', '/v1/address/check', { scheme: a.scheme, address: a.address });
        return relay(result);
      }

      case 'audit_creditor_file': {
        if (typeof a.file_base64 !== 'string' || !a.file_base64.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `file_base64` must be a non-empty base64 string.' });
        }
        if (typeof a.filename !== 'string' || !a.filename.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `filename` must be a non-empty string, e.g. "creditors.csv".' });
        }
        const fileBuffer = Buffer.from(a.file_base64, 'base64');
        if (fileBuffer.length === 0) {
          return fail({ error: 'invalid_input', message: 'Decoded `file_base64` is empty.' });
        }
        // Mirrors src/lib/audit-file.ts AUDIT_MAX_BYTES. This package is
        // published separately and cannot import from src/, so the limit is
        // copied; scripts/mcp-parity.test.ts checks the two stay equal — same
        // pattern as FEEDBACK_ERROR_TYPES above.
        if (fileBuffer.length > AUDIT_MAX_BYTES) {
          return fail({
            error: 'file_too_large',
            message: `The file must be under ${AUDIT_MAX_BYTES / 1024 / 1024} MB (decoded size is ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB).`,
            limits: { max_bytes: AUDIT_MAX_BYTES },
          });
        }
        const lang: 'en' | 'fr' | 'de' = a.lang === 'fr' || a.lang === 'de' ? a.lang : 'en';
        const form = new FormData();
        form.append('file', new Blob([fileBuffer], { type: contentTypeFor(a.filename) }), a.filename);
        form.append('lang', lang);
        const result = await apiCall('POST', '/v1/audit/upload', undefined, form);
        if (result._error) return fail(result);

        let note =
          'This is the FREE preview only (masked IBANs, summary counts) — never the full report. ' +
          `The annotated .xlsx report costs ${String(result.price ?? '')} ${String(result.currency ?? 'USD')} ` +
          'and is settled through a one-off Stripe Checkout Session. Call audit_status with this job id after a ' +
          'human pays, or pass `checkout: true` to this tool to get the Checkout URL right away.';
        const preview: JsonRecord = { ...result };
        if (a.checkout === true) {
          const jobId = typeof result.job === 'string' ? result.job : '';
          const checkoutResult = await apiCall('POST', `/v1/audit/checkout/${encodeURIComponent(jobId)}`, {});
          if (checkoutResult._error) {
            preview.checkout_error = checkoutResult;
          } else {
            preview.checkout_url = checkoutResult.url;
            preview.checkout_session_id = checkoutResult.session_id;
            note += ` Checkout ready: have a human open ${String(checkoutResult.url)} to pay — this tool never pays automatically.`;
          }
        }
        preview._note = note;
        return out(preview);
      }

      case 'audit_status': {
        if (typeof a.job !== 'string' || !a.job.trim()) {
          return fail({ error: 'invalid_input', message: 'Argument `job` must be a non-empty string.' });
        }
        const query =
          typeof a.session_id === 'string' && a.session_id
            ? `?session_id=${encodeURIComponent(a.session_id)}`
            : '';
        const result = await apiCall('GET', `/v1/audit/status/${encodeURIComponent(a.job)}${query}`);
        return relay(result);
      }

      case 'send_feedback': {
        if (typeof a.error_type !== 'string' || typeof a.notes !== 'string' || a.notes.trim().length < 3) {
          return fail({
            error: 'invalid_input',
            message: 'Arguments `error_type` (string) and `notes` (at least 3 characters) are required.',
          });
        }
        // Relayé vers POST /v1/feedback plutôt qu'écrit ici : c'est ce qui donne
        // à cet outil le MÊME plafond que la route publique (quota par source,
        // 20 rapports/heure) et le même hachage d'IP. Un outil gratuit et ouvert
        // qui écrirait en base sans plafond serait une boîte à spam ; et un
        // plafond réimplémenté dans le paquet npm serait un second chiffre à
        // tenir d'accord avec le premier.
        const result = await apiCall('POST', '/v1/feedback', {
          error_type: a.error_type,
          notes: a.notes,
          endpoint: a.endpoint,
          expected: a.expected,
          got: a.got,
          contact: a.contact,
          agent: typeof a.agent === 'string' && a.agent ? a.agent : 'mcp-npm',
        });
        if (result._error) return fail(result);
        // La route répond {ok, id, message, status, next_steps} ; le contrat de
        // l'outil est {ok, id} sur les trois surfaces. On réduit ici, sinon la
        // parité tiendrait sur les noms et mentirait sur la forme.
        return out({ ok: true, id: result.id });
      }

      // ── Device grant (RFC 8628) ──────────────────────────────────────────
      //
      // 🚨 LE PIÈGE LE PLUS PROBABLE DE TOUT CE MODULE, ET IL EST ICI.
      //
      // `apiCall` marque TOUT `!res.ok` en `_error: true`. Or
      // `authorization_pending` et `slow_down` arrivent en 400, et
      // `device_rate_limited` en 429 : ce sont des réponses NORMALES du
      // protocole, pas des pannes. Sans le rattrapage ci-dessous,
      // `poll_api_key` rendrait `isError: true` au premier tour et l'agent
      // abandonnerait avant que l'humain n'ait cliqué, et `request_api_key`
      // présenterait un plafond partagé comme une panne de service. On inspecte
      // donc le champ `error` du CORPS avant de conclure à un échec.

      case 'request_api_key': {
        const result = await apiCall('POST', '/v1/keys/device', {
          client_name: a.client_name,
          reason: a.reason,
          source: 'mcp-npm-device',
        });

        if (result._error) {
          const refused = result.error === 'device_rate_limited';
          // Refus ou panne, l'agent reçoit une DONNÉE lisible et son chemin de
          // repli — jamais un échec d'outil qui lui ferait croire le service
          // cassé. Un transport qui n'a rien rendu du tout garde `fail`.
          if (refused || result.error === 'device_unavailable' || result.status === 503) {
            return out({
              status: refused ? 'device_rate_limited' : 'device_unavailable',
              user_code: null,
              verification_uri: null,
              verification_uri_complete: null,
              expires_in: null,
              interval: null,
              display_to_human:
                typeof result.display_to_human === 'string'
                  ? result.display_to_human
                  : typeof result.message === 'string'
                    ? result.message
                    : 'The key service did not open a request. Validation still works; try again in a minute.',
            });
          }
          return fail(result);
        }

        // Le `device_code` reste DANS ce processus : il arrive par le corps
        // HTTP et n'entre jamais dans la sortie de l'outil.
        lastDeviceCode = typeof result.device_code === 'string' ? result.device_code : null;

        return out({
          status: 'ok',
          user_code: result.user_code ?? null,
          verification_uri: result.verification_uri ?? null,
          verification_uri_complete: result.verification_uri_complete ?? null,
          expires_in: result.expires_in ?? null,
          interval: result.interval ?? null,
          // Construit par le SERVEUR, jamais composé ici : trois compositions
          // locales auraient donné trois textes, et c'est celui qu'un humain
          // lit sur son écran.
          display_to_human: typeof result.display_to_human === 'string' ? result.display_to_human : '',
        });
      }

      case 'poll_api_key': {
        const secret =
          typeof a.device_code === 'string' && a.device_code.trim()
            ? a.device_code.trim()
            : lastDeviceCode;
        if (!secret) {
          return out({
            status: 'invalid_grant',
            api_key: null,
            key_prefix: null,
            tier: null,
            monthly_limit: null,
            email: null,
            retry_in_seconds: null,
            expires_in: null,
            config_line: null,
            message:
              'No device code to collect. Call request_api_key first, and show the code to your human.',
          });
        }

        const result = await deviceApiCall('POST', '/v1/keys/device/token', {
          device_code: secret,
        });

        if (result._error) {
          const PENDING = new Set(['authorization_pending', 'slow_down']);
          const TERMINAL = new Set(['access_denied', 'expired_token', 'invalid_grant']);
          const error = typeof result.error === 'string' ? result.error : '';
          // `slow_down` n'est pas une valeur du schéma : un agent qui poll trop
          // vite est un agent qui doit attendre, ce que
          // `authorization_pending` plus `retry_in_seconds` dit déjà.
          const status = PENDING.has(error)
            ? 'authorization_pending'
            : TERMINAL.has(error)
              ? error
              : null;
          if (status === null) return fail(result);
          return out({
            status,
            api_key: null,
            key_prefix: null,
            tier: null,
            monthly_limit: null,
            email: null,
            retry_in_seconds: result.interval ?? null,
            expires_in: result.expires_in ?? null,
            config_line: null,
            message:
              typeof result.message === 'string'
                ? result.message
                : 'Nobody has approved this code yet. Wait for the interval, then call again.',
          });
        }

        // Retiré une fois, jamais deux : on oublie le code dès qu'il a rendu sa clé.
        lastDeviceCode = null;
        return out({
          status: 'approved',
          api_key: result.api_key ?? null,
          key_prefix: result.key_prefix ?? null,
          tier: result.tier ?? null,
          monthly_limit: result.monthly_limit ?? null,
          email: result.email ?? null,
          retry_in_seconds: null,
          expires_in: null,
          config_line: result.config_line ?? null,
          message:
            typeof result.message === 'string'
              ? result.message
              : 'Save this key — it will not be shown again.',
        });
      }

      default:
        return fail({ error: 'unknown_tool', message: `Tool "${name}" is not implemented.` });
    }
  } catch (err) {
    const e = err as Error;
    return fail({
      _error: true,
      message: e?.message ?? String(err),
      hint: 'Network error reaching api.ibanforge.com. Check connectivity or set IBANFORGE_API_BASE for self-hosted instances.',
    });
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write('IBANforge MCP server ready (stdio). 13 tools exposed.\n');
