/**
 * Playground examples — REAL API responses captured live from
 * api.ibanforge.com (2026-07-07) so the page renders a rich, truthful answer
 * on arrival with zero network round-trip. Each tab ships one pre-filled
 * default payload plus a row of quick-example chips that fetch live on click.
 *
 * Verified facts baked in:
 *  - CH1000230000000012345 (UBS HQ, IID 00230) → clearing POPULATED in validate.
 *  - NTSBDEB1 (N26) → full GLEIF address + active LEI.
 *  - DE89370400440532013000 → compliance risk 0/low, honest scope disclaimer.
 *  - GET /v1/ch/clearing/230 (UBS) → richest, exclusive Swiss dataset.
 */

export type PlaygroundMode = 'iban' | 'bic' | 'compliance' | 'clearing';

export const MODES: PlaygroundMode[] = ['iban', 'bic', 'compliance', 'clearing'];

/** Pre-filled input value for each tab (matches its default payload). */
export const DEFAULT_INPUT: Record<PlaygroundMode, string> = {
  iban: 'CH1000230000000012345',
  bic: 'NTSBDEB1',
  compliance: 'DE89370400440532013000',
  clearing: '230',
};

export interface Chip {
  /** i18n key under playground.chips.* */
  key: string;
  /** value sent to the proxy (IBAN / BIC / IID) */
  value: string;
  /** dot color */
  tone: 'ok' | 'warn' | 'err' | 'info';
  /** if set, clicking switches to this tab before fetching (cross-tab demo) */
  toMode?: PlaygroundMode;
}

export const CHIPS: Record<PlaygroundMode, Chip[]> = {
  iban: [
    { key: 'ibanCh', value: 'CH1000230000000012345', tone: 'ok' },
    { key: 'ibanEmi', value: 'BE92967000000000', tone: 'warn' },
    { key: 'ibanInvalid', value: 'CH9300762011623852958', tone: 'err' },
    { key: 'ibanSanctions', value: 'RU0204452560040702810412345678901', tone: 'err', toMode: 'compliance' },
  ],
  bic: [
    { key: 'bicN26', value: 'NTSBDEB1', tone: 'info' },
    { key: 'bicUbs', value: 'UBSWCHZH', tone: 'ok' },
    { key: 'bicWise', value: 'TRWIBEB1', tone: 'warn' },
  ],
  compliance: [
    { key: 'compClean', value: 'DE89370400440532013000', tone: 'ok' },
    { key: 'compMedium', value: 'GB90MODR00000000000000', tone: 'warn' },
    { key: 'compHigh', value: 'RU0204452560040702810412345678901', tone: 'err' },
  ],
  clearing: [
    { key: 'clUbs', value: '230', tone: 'ok' },
    { key: 'clPostfinance', value: '9000', tone: 'info' },
    { key: 'clZkb', value: '700', tone: 'info' },
    { key: 'clSnb', value: '100', tone: 'info' },
  ],
};

/** Default payloads — REAL captured responses (see file header). */
export const DEFAULT_RESULT: Record<PlaygroundMode, Record<string, unknown>> = {
  iban: {
    iban: 'CH1000230000000012345',
    valid: true,
    country: { code: 'CH', name: 'Switzerland' },
    check_digits: '10',
    bban: { bank_code: '00230', account_number: '000000012345' },
    sepa: { member: true, schemes: ['SCT', 'SDD'], vop_required: false },
    formatted: 'CH10 0023 0000 0000 1234 5',
    cost_usdc: 0,
    bic: { code: 'UBSWCHZH', bank_name: 'UBS Switzerland AG', city: 'Zürich' },
    issuer: { type: 'bank', name: 'UBS Switzerland AG' },
    risk_indicators: {
      issuer_type: 'bank',
      country_risk: 'standard',
      test_bic: false,
      sepa_reachable: true,
      vop_coverage: false,
    },
    clearing: {
      iid: '00230',
      name: 'UBS Switzerland AG',
      type: 'bank',
      town: 'Zürich',
      sic: true,
      instant_payments_chf: true,
      eurosic: true,
      qr_iid: null,
    },
    processing_ms: 0.41,
  },
  bic: {
    bic: 'NTSBDEB1',
    bic8: 'NTSBDEB1',
    bic11: 'NTSBDEB1XXX',
    found: true,
    valid_format: true,
    institution: 'N26 Bank SE',
    country: { code: 'DE', name: 'Germany' },
    city: 'Berlin',
    address: {
      type: 'registered',
      street: 'Voltairestraße 8',
      post_code: '10179',
      region: 'DE-BE',
      city: 'Berlin',
      country: 'DE',
      romanized: 'Voltairestraße 8',
      romanization: 'original_latin',
      source: 'GLEIF',
      language: 'de',
      as_of: '2025-09-11',
    },
    address_available: true,
    branch_code: 'XXX',
    branch_info: null,
    lei: '529900JB9XYZ8E87N345',
    lei_status: 'ACTIVE',
    is_test_bic: false,
    source: 'gleif',
    cost_usdc: 0,
    processing_ms: 0.32,
  },
  compliance: {
    iban: 'DE89370400440532013000',
    valid: true,
    country: { code: 'DE', name: 'Germany' },
    check_digits: '89',
    bban: { bank_code: '37040044', account_number: '0532013000' },
    sepa: { member: true, schemes: ['SCT', 'SDD', 'SCT_INST'], vop_required: true },
    formatted: 'DE89 3704 0044 0532 0130 00',
    cost_usdc: 0,
    bic: { code: 'COBADEFF', bank_name: 'COMMERZBANK Aktiengesellschaft', city: 'Frankfurt am Main' },
    issuer: { type: 'bank', name: 'COMMERZBANK Aktiengesellschaft' },
    risk_indicators: {
      issuer_type: 'bank',
      country_risk: 'standard',
      test_bic: false,
      sepa_reachable: true,
      vop_coverage: true,
    },
    compliance: {
      sanctions: {
        country_sanctioned: false,
        bank_sanctioned: false,
        matched_lists: [],
        fatf_status: 'member',
      },
      reachability: { sepa_instant: true, sct: true, sdd: true },
      vop: { participant: true, status: 'active' },
      risk_score: 0,
      risk_level: 'low',
      flags: [],
    },
    meta: {
      scope: 'bank_bic_only',
      disclaimer:
        'Informational triage only — NOT a regulated AML/CFT product. Sanctions screening is performed at the BANK (BIC8) level: it flags the holding institution, NOT the beneficiary / account-holder name. Most sanctions designations target persons and companies, which this does not screen. Use a regulated provider (Refinitiv, ComplyAdvantage, etc.) for name-level KYC/AML obligations.',
      sanctions_as_of: '2026-07-05T04:29:13.136Z',
      fatf_as_of: '2026-02',
      sources: 'OFAC,FATF,EPC-SCT,EPC-SDD,EPC-SCT_INST',
    },
    processing_ms: 0.3,
  },
  clearing: {
    iid: '00230',
    found: true,
    institution: {
      name: 'UBS Switzerland AG',
      type: 'bank',
      iid_type: 'headquarters',
      headquarters_iid: '00230',
    },
    address: {
      street: 'Bahnhofstrasse',
      building_number: '45',
      post_code: '8098',
      town: 'Zürich',
      country: 'CH',
    },
    bic: 'UBSWCHZH80A',
    payment_services: {
      sic: true,
      rtgs_chf: true,
      instant_payments_chf: true,
      eurosic: true,
      lsv_bdd_chf: true,
      lsv_bdd_eur: true,
    },
    sic_iid: '002301',
    qr_iid: null,
    valid_on: '2026-07-01',
    cost_usdc: 0,
    processing_ms: 0.31,
  },
};
