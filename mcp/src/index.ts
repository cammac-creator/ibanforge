#!/usr/bin/env node
/**
 * IBANforge MCP Server
 *
 * Exposes 8 tools backed by the IBANforge HTTP API (api.ibanforge.com):
 *   - validate_iban
 *   - batch_validate_iban
 *   - lookup_bic
 *   - lookup_ch_clearing
 *   - check_compliance
 *   - validate_payment_reference
 *   - check_postal_address
 *   - send_feedback
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

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const API_BASE = process.env.IBANFORGE_API_BASE ?? 'https://api.ibanforge.com';
const API_KEY = process.env.IBANFORGE_API_KEY;

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
      'RETURNS: valid (boolean), country { code, name }, bic { code, bank_name, city }, ' +
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
      'COST: 0.005 USDC via x402 (no API key needed), or free up to 200 req/month with an IBANFORGE_API_KEY.',
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
        bic: {
          type: 'object',
          description: 'Resolved BIC/SWIFT (when BBAN→BIC mapping exists). null if unresolved.',
          properties: {
            code: { type: 'string' },
            bank_name: { type: 'string' },
            city: { type: 'string' },
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
            classification: { type: 'string', enum: ['curated', 'default'] },
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
          type: 'object',
          description: 'Swiss clearing data when country is CH or LI (null otherwise).',
          properties: {
            iid: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string' },
            town: { type: 'string' },
            sic: { type: 'boolean' },
            instant_payments_chf: { type: 'boolean' },
            eurosic: { type: 'boolean' },
            qr_iid: { type: 'string' },
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
              bic: { type: 'object' },
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
        institution: { type: 'string', description: 'Bank legal name.' },
        country: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            name: { type: 'string' },
          },
        },
        city: { type: 'string' },
        lei: { type: 'string', description: 'Legal Entity Identifier (ISO 17442) if available.' },
        address: {
          type: 'object',
          description: 'Registered head-office address object (present when available).',
          properties: {
            type: { type: 'string' },
            street: { type: 'string' },
            post_code: { type: 'string' },
            region: { type: 'string' },
            city: { type: 'string' },
            country: { type: 'string' },
            source: { type: 'string' },
            as_of: { type: 'string' },
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
            street: { type: 'string' },
            building_number: { type: 'string' },
            post_code: { type: 'string' },
            town: { type: 'string' },
            country: { type: 'string' },
          },
        },
        bic: { type: 'string', description: 'BIC if mapped.' },
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
        sic_iid: { type: 'string' },
        qr_iid: { type: 'string', description: 'QR-IID allocation, null when none.' },
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
        scheme: {
          type: 'string',
          enum: ['rf', 'qrr', 'ogm', 'viitenumero', 'kid', 'ocr'],
          description: 'Null when no supported scheme matches.',
        },
        valid: {
          type: 'boolean',
          description:
            'null means recognised but uncheckable without the creditor bank configuration (KID, OCR). Never report null as false.',
        },
        status: { type: 'string', enum: ['checked', 'unverifiable_without_creditor_config', 'unrecognised'] },
        check_digit_expected: {
          type: 'string',
          description: 'A STRING, so a two-digit value beginning with zero survives ("03", "97").',
        },
        also_valid_as: { type: 'object', description: 'The second reading of an ambiguous string, with its own verdict.' },
        source: { type: 'string', description: 'The document publishing the rule. Relay it.' },
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
        bic: { type: 'object', properties: { code: { type: 'string' }, bank_name: { type: 'string' }, city: { type: 'string' } } },
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
                fatf_status: { type: 'string', enum: ['member', 'grey_list', 'black_list', 'non_member'] },
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
            risk_score: { type: 'number', minimum: 0, maximum: 100, description: '0 = safest, 100 = highest.' },
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
            sanctions_as_of: { type: 'string', description: 'ISO timestamp of the last data refresh.' },
            fatf_as_of: { type: 'string', description: 'YYYY-MM of the FATF plenary reflected.' },
            sources: { type: 'string' },
          },
        },
        cost_usdc: { type: 'number' },
      },
      required: ['iban', 'valid', 'compliance'],
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
];

interface JsonRecord {
  [k: string]: unknown;
}

async function apiCall(method: 'GET' | 'POST', path: string, body?: JsonRecord): Promise<JsonRecord> {
  const headers: Record<string, string> = {
    'User-Agent': `ibanforge-mcp/${pkg.version}`,
    Accept: 'application/json',
  };
  if (API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
  }
  if (body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }

  if (!res.ok) {
    const obj = parsed as JsonRecord;
    // The API tells us WHY the paywall triggered (exhausted quota/credits,
    // broken key) via a `cause` object in the 402 body — relay that truth
    // instead of the generic "set a key" advice, which is wrong (and
    // confusing) when a key is already configured.
    const cause = (obj?.cause ?? undefined) as { reason?: string; detail?: string } | undefined;
    return {
      _error: true,
      status: res.status,
      ...(obj || {}),
      _hint:
        res.status === 402
          ? (cause?.detail ??
            'Payment required. Set IBANFORGE_API_KEY (Bearer ifk_*) for the free 200 req/month tier, or pay per call via x402 (price in the `accepts` array). See https://api.ibanforge.com/.well-known/x402')
          : res.status === 429
            ? 'Rate limited (per-IP, 100 req/min). Wait for `retry_after` seconds, then retry.'
            : undefined,
    };
  }

  return parsed as JsonRecord;
}

const server = new Server(
  { name: 'ibanforge', version: pkg.version },
  { capabilities: { tools: {} } },
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

  // Fallback message appended to anonymous-mode results so MCP inspectors
  // and discovery tools (Glama, Smithery, MCP.so) get a useful payload
  // without requiring an API key while still surfacing the upgrade path.
  const ANON_NOTE =
    'Anonymous mode — basic format validation only. For BIC, SEPA reachability, ' +
    'issuer classification, sanctions, Swiss BC-Nummer and risk score: get a ' +
    'free API key (200 req/month) by POSTing your email to /v1/keys/generate, ' +
    'or pay per call via x402 (see https://api.ibanforge.com/.well-known/x402).';

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
        if (result._error && result.status === 402) {
          const free = await apiCall('GET', `/v1/iban/format?iban=${encodeURIComponent(a.iban)}`);
          if (!free._error) {
            return out({ ...free, _note: degradedNote(result) });
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
        if (!Array.isArray(a.ibans) || a.ibans.length === 0) {
          return fail({ error: 'invalid_input', message: 'Argument `ibans` must be a non-empty array of strings.' });
        }
        if (a.ibans.length > 100) {
          return fail({ error: 'too_many_ibans', message: 'Max 100 IBANs per batch. Split your input.' });
        }
        const result = await apiCall('POST', '/v1/iban/batch', { ibans: a.ibans as string[] });
        if (result._error && result.status === 402) {
          const ibans = a.ibans as string[];
          const results = await Promise.all(
            ibans.map((iban) => apiCall('GET', `/v1/iban/format?iban=${encodeURIComponent(iban)}`)),
          );
          const validCount = results.filter((r) => r.valid === true).length;
          return out({
            results,
            count: results.length,
            valid_count: validCount,
            _note: degradedNote(result),
          });
        }
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

process.stderr.write('IBANforge MCP server ready (stdio). 8 tools exposed.\n');
