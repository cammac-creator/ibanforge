/**
 * Creditor-file audit: the engine behind the paid "audit de fichier".
 *
 * A CSV or XLSX of creditors comes in; every row goes through the same
 * validation and enrichment the API serves per call (validateIBAN +
 * enrichResult, in-process, no HTTP, no key, no quota), plus the checks a
 * single-IBAN call cannot make because they need the whole file: duplicates,
 * the BIC the file carries against the BIC the register derives, the address
 * country against the IBAN country, and the ISO 20022 postal-address
 * conformity the SIX deadline of 14.11.2026 makes urgent for Swiss creditor
 * files.
 *
 * Nothing here touches storage: the caller decides what to keep and for how
 * long. Findings carry stable codes; the labels are rendered per language at
 * the edge (workbook, preview) so the engine stays language-free.
 */
import * as XLSX from 'xlsx';
import { validateIBAN } from './iban.js';
import { createEnrichCache, enrichResult } from './enrich.js';
import { checkPostalAddress, type AddressScheme } from './address-conformity.js';
import type { IBANValidationResult } from '../types.js';

export const AUDIT_MAX_ROWS = 20_000;
export const AUDIT_MAX_BYTES = 5 * 1024 * 1024;
/** Price tiers, in CHF. The tier is decided by the row count, nothing else. */
export const AUDIT_TIERS = [
  { max_rows: 5_000, price_chf: 149, code: 'standard' },
  { max_rows: AUDIT_MAX_ROWS, price_chf: 349, code: 'large' },
] as const;
export type AuditTierCode = (typeof AUDIT_TIERS)[number]['code'];

export type AuditLang = 'en' | 'fr' | 'de';

export type FindingCode =
  | 'iban_missing'
  | 'iban_invalid'
  | 'bank_code_not_allocated'
  | 'modulus_check_failed'
  | 'sepa_not_reachable'
  | 'test_bic'
  | 'bic_mismatch'
  | 'country_mismatch'
  | 'duplicate'
  | 'issuer_not_bank'
  | 'country_risk'
  | 'address_not_structured'
  | 'verify_payee_name';

export type RowStatus = 'ok' | 'warning' | 'error';

/** Which finding codes stop a payment (error) versus deserve a look (warning). */
const ERROR_CODES: ReadonlySet<FindingCode> = new Set([
  'iban_missing',
  'iban_invalid',
  'bank_code_not_allocated',
  'modulus_check_failed',
]);

export interface AuditFinding {
  code: FindingCode;
  /** Free-text detail in English, for the workbook's "detail" column and the JSON. */
  detail: string;
}

export interface AuditColumnMap {
  iban: number;
  name?: number;
  bic?: number;
  street?: number;
  building?: number;
  postal?: number;
  city?: number;
  country?: number;
}

export interface AuditRow {
  /** 1-based line in the source sheet, header excluded. */
  line: number;
  iban_input: string;
  iban: string | null;
  status: RowStatus;
  findings: AuditFinding[];
  country: string | null;
  bank_name: string | null;
  bic_registry: string | null;
  bic_file: string | null;
  sepa_reachable: boolean | null;
  address_verdict: 'pass' | 'fail' | 'not_applicable' | null;
  next_steps: string[];
}

export interface AuditSummary {
  rows: number;
  ok: number;
  warning: number;
  error: number;
  by_code: Partial<Record<FindingCode, number>>;
  countries: Array<{ code: string; rows: number }>;
  columns_detected: Array<keyof AuditColumnMap>;
  address_checked: boolean;
  tier: AuditTierCode;
  price_chf: number;
}

export interface AuditResult {
  headers: string[];
  columns: AuditColumnMap;
  rows: AuditRow[];
  source_rows: string[][];
  summary: AuditSummary;
}

export class AuditFileError extends Error {
  constructor(
    public readonly code: 'unreadable' | 'empty' | 'too_many_rows' | 'no_iban_column',
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Reading the file
// ---------------------------------------------------------------------------

/** Parse a CSV or XLSX buffer into a header row and string cells. */
export function readTable(buffer: Buffer, filename = ''): { headers: string[]; rows: string[][] } {
  let wb: XLSX.WorkBook;
  try {
    const isCsv = /\.(csv|txt|tsv)$/i.test(filename) || looksLikeText(buffer);
    wb = isCsv
      ? XLSX.read(buffer.toString('utf8'), { type: 'string', raw: true })
      : XLSX.read(buffer, { type: 'buffer', raw: true, cellDates: false });
  } catch (e) {
    throw new AuditFileError(
      'unreadable',
      `The file could not be read as CSV or XLSX (${(e as Error).message}).`,
    );
  }
  const first = wb.SheetNames[0];
  if (!first) throw new AuditFileError('empty', 'The workbook has no sheet.');
  const sheet = wb.Sheets[first];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: '',
    raw: false,
    blankrows: false,
  });
  const table = aoa.map((r) => (Array.isArray(r) ? r : []).map((v) => cellToString(v)));
  // Drop fully empty rows and trailing empty columns.
  const nonEmpty = table.filter((r) => r.some((v) => v !== ''));
  if (nonEmpty.length === 0) throw new AuditFileError('empty', 'The sheet is empty.');
  const width = Math.max(...nonEmpty.map((r) => r.length));
  const padded = nonEmpty.map((r) => [...r, ...Array.from({ length: width - r.length }, () => '')]);
  const headers = padded[0]!.map((h, i) => (h.trim() === '' ? `col_${i + 1}` : h.trim()));
  const rows = padded.slice(1);
  if (rows.length === 0)
    throw new AuditFileError('empty', 'The sheet has a header but no data rows.');
  if (rows.length > AUDIT_MAX_ROWS) {
    throw new AuditFileError(
      'too_many_rows',
      `The sheet has ${rows.length} rows; the audit takes at most ${AUDIT_MAX_ROWS}.`,
    );
  }
  return { headers, rows };
}

function looksLikeText(buffer: Buffer): boolean {
  // XLSX is a zip (PK header); XLS starts with the OLE signature. Anything
  // else that is mostly printable is treated as delimited text.
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) return false;
  if (buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf) return false;
  const sample = buffer.subarray(0, 512);
  let printable = 0;
  for (const b of sample)
    if (b === 9 || b === 10 || b === 13 || (b >= 32 && b < 127) || b >= 128) printable++;
  return sample.length > 0 && printable / sample.length > 0.9;
}

function cellToString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

// ---------------------------------------------------------------------------
// Finding the columns
// ---------------------------------------------------------------------------

const IBAN_SHAPE = /^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/;

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const HEADER_HINTS: Record<Exclude<keyof AuditColumnMap, 'iban'>, RegExp[]> = {
  name: [
    /^(name|nom|beneficiaire|beneficiary|creancier|creditor|supplier|fournisseur|lieferant|empfaenger|empfanger|payee|raison sociale|firma|company|societe)\b/,
  ],
  bic: [/^(bic|swift|bic swift|swift bic|bic code)\b/],
  street: [/^(street|rue|strasse|str|address line 1|adresse|address|anschrift|strt nm)\b/],
  building: [/^(building|bldg|number|numero|hausnummer|no|nr|bldg nb)\b/],
  postal: [/^(zip|postal code|postcode|post code|plz|npa|cp|code postal|pst cd|postleitzahl)\b/],
  city: [/^(city|ville|ort|town|lieu|localite|stadt|twn nm)\b/],
  country: [/^(country|pays|land|ctry|country code|iso country)\b/],
};

/** Decide which column holds what. The IBAN column is found by content when no header says it. */
export function detectColumns(headers: string[], rows: string[][]): AuditColumnMap {
  const normalized = headers.map(norm);
  let iban = normalized.findIndex((h) => /^iban\b/.test(h) || /\biban\b/.test(h));
  if (iban === -1) {
    // Content scan: the column whose first 50 non-empty cells look most like IBANs.
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < headers.length; c++) {
      let hits = 0;
      let seen = 0;
      for (const r of rows) {
        const v = (r[c] ?? '').replace(/\s+/g, '').toUpperCase();
        if (v === '') continue;
        seen++;
        if (IBAN_SHAPE.test(v)) hits++;
        if (seen >= 50) break;
      }
      if (seen > 0 && hits / seen > 0.5 && hits > bestScore) {
        best = c;
        bestScore = hits;
      }
    }
    iban = best;
  }
  if (iban === -1) {
    throw new AuditFileError(
      'no_iban_column',
      'No column holds IBANs: name one "IBAN" or make sure the account column contains IBANs.',
    );
  }
  const map: AuditColumnMap = { iban };
  for (const key of Object.keys(HEADER_HINTS) as Array<keyof typeof HEADER_HINTS>) {
    const idx = normalized.findIndex(
      (h, i) => i !== iban && HEADER_HINTS[key].some((re) => re.test(h)),
    );
    if (idx !== -1) map[key] = idx;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Auditing the rows
// ---------------------------------------------------------------------------

function schemeFor(country: string | null): AddressScheme | null {
  if (!country) return null;
  if (country === 'CH' || country === 'LI') return 'sps';
  if (country === 'US') return null; // no IBAN there; never reached
  return 'hvps_plus';
}

function countryOfInput(raw: string): string | null {
  const v = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(v)) return v;
  const names: Record<string, string> = {
    SUISSE: 'CH',
    SCHWEIZ: 'CH',
    SWITZERLAND: 'CH',
    SVIZZERA: 'CH',
    FRANCE: 'FR',
    FRANKREICH: 'FR',
    ALLEMAGNE: 'DE',
    DEUTSCHLAND: 'DE',
    GERMANY: 'DE',
    ITALIE: 'IT',
    ITALIEN: 'IT',
    ITALY: 'IT',
    ITALIA: 'IT',
    AUTRICHE: 'AT',
    OSTERREICH: 'AT',
    AUSTRIA: 'AT',
    LIECHTENSTEIN: 'LI',
    BELGIQUE: 'BE',
    BELGIEN: 'BE',
    BELGIUM: 'BE',
    'PAYS-BAS': 'NL',
    NIEDERLANDE: 'NL',
    NETHERLANDS: 'NL',
    ESPAGNE: 'ES',
    SPANIEN: 'ES',
    SPAIN: 'ES',
    PORTUGAL: 'PT',
    LUXEMBOURG: 'LU',
    LUXEMBURG: 'LU',
    'ROYAUME-UNI': 'GB',
    'UNITED KINGDOM': 'GB',
    GROSSBRITANNIEN: 'GB',
    UK: 'GB',
  };
  return names[v.normalize('NFD').replace(/[̀-ͯ]/g, '')] ?? null;
}

export function auditTable(
  headers: string[],
  rows: string[][],
  columns?: AuditColumnMap,
): AuditResult {
  const cols = columns ?? detectColumns(headers, rows);
  const cache = createEnrichCache();
  const seen = new Map<string, number>();
  const out: AuditRow[] = [];
  const hasAddress =
    cols.postal !== undefined || cols.city !== undefined || cols.street !== undefined;

  rows.forEach((r, i) => {
    const line = i + 1;
    const rawIban = (r[cols.iban] ?? '').trim();
    const findings: AuditFinding[] = [];
    const row: AuditRow = {
      line,
      iban_input: rawIban,
      iban: null,
      status: 'ok',
      findings,
      country: null,
      bank_name: null,
      bic_registry: null,
      bic_file: cols.bic !== undefined ? (r[cols.bic] ?? '').trim().toUpperCase() || null : null,
      sepa_reachable: null,
      address_verdict: null,
      next_steps: [],
    };
    if (rawIban === '') {
      findings.push({ code: 'iban_missing', detail: 'The IBAN cell is empty.' });
    } else {
      const result: IBANValidationResult = validateIBAN(rawIban);
      if (!result.valid) {
        findings.push({
          code: 'iban_invalid',
          detail: result.error_detail ?? result.error ?? 'The IBAN does not validate.',
        });
      } else {
        enrichResult(result, cache);
        const compact = rawIban.replace(/\s+/g, '').toUpperCase();
        row.iban = compact;
        row.country = result.country?.code ?? compact.slice(0, 2);
        row.bank_name = result.bic?.bank_name ?? result.issuer?.name ?? null;
        row.bic_registry = result.bic?.code ?? null;
        row.sepa_reachable = result.risk_indicators?.sepa_reachable ?? result.sepa?.member ?? null;
        row.next_steps = (result.next_steps ?? []).map((s) => s.code);

        const dup = seen.get(compact);
        if (dup !== undefined) {
          findings.push({ code: 'duplicate', detail: `Same IBAN as line ${dup}.` });
        } else {
          seen.set(compact, line);
        }
        if (
          result.bank_code_check?.status === 'not_in_register' &&
          result.bank_code_check.authoritative
        ) {
          findings.push({
            code: 'bank_code_not_allocated',
            detail: `Bank code ${result.bank_code_check.value} is absent from the national register.`,
          });
        }
        if (result.modulus_check && result.modulus_check.passed === false) {
          findings.push({
            code: 'modulus_check_failed',
            detail: 'The account number fails the UK modulus check.',
          });
        }
        if (row.sepa_reachable === false) {
          findings.push({
            code: 'sepa_not_reachable',
            detail: 'No SEPA credit transfer to this account: outside the SEPA zone.',
          });
        }
        if (result.risk_indicators?.test_bic) {
          findings.push({
            code: 'test_bic',
            detail: 'The BIC on record is a test BIC (position 8 is 0).',
          });
        }
        if (result.risk_indicators && result.risk_indicators.country_risk !== 'standard') {
          findings.push({
            code: 'country_risk',
            detail: `Country risk ${result.risk_indicators.country_risk}.`,
          });
        }
        if (
          result.issuer?.type &&
          result.issuer.type !== 'bank' &&
          result.issuer.type !== 'digital_bank'
        ) {
          findings.push({
            code: 'issuer_not_bank',
            detail: `Held at a ${result.issuer.type.replace('_', ' ')}: ${result.issuer.name}.`,
          });
        }
        if (row.bic_file && row.bic_registry) {
          const a = row.bic_file.replace(/\s+/g, '').slice(0, 8);
          const b = row.bic_registry.slice(0, 8);
          if (a !== b) {
            findings.push({
              code: 'bic_mismatch',
              detail: `File says ${row.bic_file}, the register derives ${row.bic_registry}.`,
            });
          }
        }
        if (cols.country !== undefined) {
          const c = countryOfInput(r[cols.country] ?? '');
          if (c && row.country && c !== row.country) {
            findings.push({
              code: 'country_mismatch',
              detail: `Address country ${c}, IBAN country ${row.country}.`,
            });
          }
        }
        if (hasAddress) {
          const scheme = schemeFor(row.country);
          if (scheme) {
            const check = checkPostalAddress(scheme, {
              strt_nm: cols.street !== undefined ? r[cols.street] || undefined : undefined,
              bldg_nb: cols.building !== undefined ? r[cols.building] || undefined : undefined,
              pst_cd: cols.postal !== undefined ? r[cols.postal] || undefined : undefined,
              twn_nm: cols.city !== undefined ? r[cols.city] || undefined : undefined,
              ctry:
                cols.country !== undefined
                  ? (countryOfInput(r[cols.country] ?? '') ?? undefined)
                  : (row.country ?? undefined),
            });
            row.address_verdict = check.conforms ? 'pass' : 'fail';
            if (!check.conforms) {
              const what = check.findings
                .filter((f) => f.verdict === 'fail')
                .map((f) => f.rule)
                .slice(0, 3)
                .join(', ');
              findings.push({
                code: 'address_not_structured',
                detail: `Postal address does not meet ${scheme === 'sps' ? 'the Swiss structured-address rules (SIX, 14.11.2026)' : 'ISO 20022 structured-address rules'}${what ? `: ${what}` : ''}.`,
              });
            }
          }
        }
      }
    }
    row.status = findings.some((f) => ERROR_CODES.has(f.code))
      ? 'error'
      : findings.length > 0
        ? 'warning'
        : 'ok';
    out.push(row);
  });

  const byCode: Partial<Record<FindingCode, number>> = {};
  const countries = new Map<string, number>();
  for (const row of out) {
    for (const f of row.findings) byCode[f.code] = (byCode[f.code] ?? 0) + 1;
    if (row.country) countries.set(row.country, (countries.get(row.country) ?? 0) + 1);
  }
  const tier = tierFor(out.length);
  const summary: AuditSummary = {
    rows: out.length,
    ok: out.filter((r) => r.status === 'ok').length,
    warning: out.filter((r) => r.status === 'warning').length,
    error: out.filter((r) => r.status === 'error').length,
    by_code: byCode,
    countries: [...countries.entries()]
      .map(([code, n]) => ({ code, rows: n }))
      .sort((a, b) => b.rows - a.rows),
    columns_detected: (Object.keys(cols) as Array<keyof AuditColumnMap>).filter(
      (k) => cols[k] !== undefined,
    ),
    address_checked: hasAddress,
    tier: tier.code,
    price_chf: tier.price_chf,
  };
  return { headers, columns: cols, rows: out, source_rows: rows, summary };
}

export function tierFor(rows: number): (typeof AUDIT_TIERS)[number] {
  return AUDIT_TIERS.find((t) => rows <= t.max_rows) ?? AUDIT_TIERS[AUDIT_TIERS.length - 1]!;
}

/** Full audit from a raw upload. */
export function auditFile(buffer: Buffer, filename = ''): AuditResult {
  const { headers, rows } = readTable(buffer, filename);
  return auditTable(headers, rows);
}

// ---------------------------------------------------------------------------
// Rendering: labels, preview, workbook
// ---------------------------------------------------------------------------

const LABELS: Record<AuditLang, Record<FindingCode, string>> = {
  en: {
    iban_missing: 'IBAN missing',
    iban_invalid: 'IBAN invalid',
    bank_code_not_allocated: 'Bank code not in the national register',
    modulus_check_failed: 'UK account checksum fails',
    sepa_not_reachable: 'Not reachable by SEPA transfer',
    test_bic: 'Test BIC',
    bic_mismatch: 'BIC in file differs from the register',
    country_mismatch: 'Address country differs from IBAN country',
    duplicate: 'Duplicate IBAN',
    issuer_not_bank: 'Held at a payment institution, not a bank',
    country_risk: 'Elevated country risk',
    address_not_structured: 'Address not structured (ISO 20022)',
    verify_payee_name: 'Verify the payee name (VoP)',
  },
  fr: {
    iban_missing: 'IBAN manquant',
    iban_invalid: 'IBAN invalide',
    bank_code_not_allocated: 'Code banque absent du registre national',
    modulus_check_failed: 'Contrôle de compte britannique en échec',
    sepa_not_reachable: "Hors de portée d'un virement SEPA",
    test_bic: 'BIC de test',
    bic_mismatch: 'BIC du fichier différent du registre',
    country_mismatch: "Pays de l'adresse différent du pays de l'IBAN",
    duplicate: 'IBAN en doublon',
    issuer_not_bank: 'Compte chez un établissement de paiement, pas une banque',
    country_risk: 'Risque pays élevé',
    address_not_structured: 'Adresse non structurée (ISO 20022)',
    verify_payee_name: 'Vérifier le nom du bénéficiaire (VoP)',
  },
  de: {
    iban_missing: 'IBAN fehlt',
    iban_invalid: 'IBAN ungültig',
    bank_code_not_allocated: 'Bankleitzahl nicht im nationalen Register',
    modulus_check_failed: 'Britische Kontoprüfziffer fehlgeschlagen',
    sepa_not_reachable: 'Per SEPA-Überweisung nicht erreichbar',
    test_bic: 'Test-BIC',
    bic_mismatch: 'BIC in der Datei weicht vom Register ab',
    country_mismatch: 'Adressland weicht vom IBAN-Land ab',
    duplicate: 'Doppelte IBAN',
    issuer_not_bank: 'Konto bei einem Zahlungsinstitut, nicht bei einer Bank',
    country_risk: 'Erhöhtes Länderrisiko',
    address_not_structured: 'Adresse nicht strukturiert (ISO 20022)',
    verify_payee_name: 'Empfängernamen prüfen (VoP)',
  },
};

const STATUS_LABELS: Record<AuditLang, Record<RowStatus, string>> = {
  en: { ok: 'OK', warning: 'Check', error: 'Do not pay' },
  fr: { ok: 'OK', warning: 'À vérifier', error: 'Ne pas payer' },
  de: { ok: 'OK', warning: 'Prüfen', error: 'Nicht zahlen' },
};

const COLS: Record<AuditLang, string[]> = {
  en: [
    'Status',
    'Findings',
    'Bank (register)',
    'BIC (register)',
    'IBAN country',
    'SEPA',
    'Address ISO 20022',
    'Detail',
  ],
  fr: [
    'Statut',
    'Constats',
    'Banque (registre)',
    'BIC (registre)',
    'Pays IBAN',
    'SEPA',
    'Adresse ISO 20022',
    'Détail',
  ],
  de: [
    'Status',
    'Befunde',
    'Bank (Register)',
    'BIC (Register)',
    'IBAN-Land',
    'SEPA',
    'Adresse ISO 20022',
    'Detail',
  ],
};

export function findingLabel(code: FindingCode, lang: AuditLang): string {
  return LABELS[lang][code];
}

export function statusLabel(status: RowStatus, lang: AuditLang): string {
  return STATUS_LABELS[lang][status];
}

/** Mask an IBAN for the free preview: country, check digits, last four. */
export function maskIban(iban: string | null, input: string): string {
  const v = (iban ?? input).replace(/\s+/g, '').toUpperCase();
  if (v.length < 8) return v === '' ? '' : '****';
  return `${v.slice(0, 4)} **** ${v.slice(-4)}`;
}

export interface PreviewRow {
  line: number;
  iban_masked: string;
  status: RowStatus;
  findings: FindingCode[];
  bank_name: string | null;
}

/** The free look: the first rows that need attention, masked, then the first OK ones. */
export function previewRows(result: AuditResult, limit = 20): PreviewRow[] {
  const flagged = result.rows.filter((r) => r.status !== 'ok');
  const fine = result.rows.filter((r) => r.status === 'ok');
  return [...flagged, ...fine].slice(0, limit).map((r) => ({
    line: r.line,
    iban_masked: maskIban(r.iban, r.iban_input),
    status: r.status,
    findings: r.findings.map((f) => f.code),
    bank_name: r.bank_name,
  }));
}

/** The paid deliverable: the source columns, then the audit columns, plus a summary sheet. */
export function buildWorkbook(
  result: AuditResult,
  lang: AuditLang,
  generatedAt = new Date(),
): Buffer {
  const l = LABELS[lang];
  const header = [...result.headers, ...COLS[lang]];
  const body = result.rows.map((row, i) => {
    const src = result.source_rows[i] ?? [];
    return [
      ...result.headers.map((_, c) => src[c] ?? ''),
      STATUS_LABELS[lang][row.status],
      row.findings.map((f) => l[f.code]).join(' ; '),
      row.bank_name ?? '',
      row.bic_registry ?? '',
      row.country ?? '',
      row.sepa_reachable === null ? '' : row.sepa_reachable ? 'SEPA' : 'non-SEPA',
      row.address_verdict === null
        ? ''
        : row.address_verdict === 'pass'
          ? 'OK'
          : row.address_verdict === 'fail'
            ? 'KO'
            : 'n/a',
      row.findings.map((f) => f.detail).join(' | '),
    ];
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([header, ...body]);
  ws['!cols'] = header.map((h, i) => ({
    wch: i < result.headers.length ? Math.min(34, Math.max(10, h.length + 2)) : 22,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    ws,
    lang === 'fr' ? 'Audit' : lang === 'de' ? 'Prüfung' : 'Audit',
  );

  const s = result.summary;
  const t = SUMMARY_LABELS[lang];
  const summaryRows: Array<[string, string | number]> = [
    [t.generated, generatedAt.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'],
    [t.rows, s.rows],
    [t.ok, s.ok],
    [t.warning, s.warning],
    [t.error, s.error],
    ['', ''],
    [t.by_finding, ''],
    ...(Object.entries(s.by_code) as Array<[FindingCode, number]>)
      .sort((a, b) => b[1] - a[1])
      .map(([code, n]) => [l[code], n] as [string, number]),
    ['', ''],
    [t.by_country, ''],
    ...s.countries.map((c) => [c.code, c.rows] as [string, number]),
    ['', ''],
    [t.method, ''],
    [t.method_1, ''],
    [t.method_2, ''],
    [t.method_3, ''],
  ];
  const ws2 = XLSX.utils.aoa_to_sheet(summaryRows);
  ws2['!cols'] = [{ wch: 60 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, ws2, t.sheet);
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const SUMMARY_LABELS: Record<AuditLang, Record<string, string>> = {
  en: {
    sheet: 'Summary',
    generated: 'Generated',
    rows: 'Rows audited',
    ok: 'OK',
    warning: 'To check',
    error: 'Do not pay',
    by_finding: 'Findings by type',
    by_country: 'Rows by IBAN country',
    method: 'Method',
    method_1:
      'Structure and check digits (ISO 13616), bank code against the national register, BIC and bank name from the register (SIX, Bundesbank, EBA and others, see ibanforge.com/sources).',
    method_2:
      'SEPA reachability by country; Verification of Payee flag from the EPC register where served.',
    method_3:
      'Postal address checked against the Swiss Payment Standards structured-address rules (CH/LI) or ISO 20022 HVPS+ (other countries) when address columns are present.',
  },
  fr: {
    sheet: 'Synthèse',
    generated: 'Généré le',
    rows: 'Lignes contrôlées',
    ok: 'OK',
    warning: 'À vérifier',
    error: 'Ne pas payer',
    by_finding: 'Constats par type',
    by_country: "Lignes par pays de l'IBAN",
    method: 'Méthode',
    method_1:
      'Structure et clé de contrôle (ISO 13616), code banque contre le registre national, BIC et nom de banque tirés du registre (SIX, Bundesbank, EBA et autres, voir ibanforge.com/sources).',
    method_2:
      'Joignabilité SEPA par pays ; signal Verification of Payee tiré du registre EPC là où il est servi.',
    method_3:
      "Adresse postale contrôlée contre les règles d'adresse structurée des Swiss Payment Standards (CH/LI) ou ISO 20022 HVPS+ (autres pays) quand des colonnes d'adresse sont présentes.",
  },
  de: {
    sheet: 'Zusammenfassung',
    generated: 'Erstellt am',
    rows: 'Geprüfte Zeilen',
    ok: 'OK',
    warning: 'Prüfen',
    error: 'Nicht zahlen',
    by_finding: 'Befunde nach Typ',
    by_country: 'Zeilen nach IBAN-Land',
    method: 'Methode',
    method_1:
      'Struktur und Prüfziffer (ISO 13616), Bankleitzahl gegen das nationale Register, BIC und Bankname aus dem Register (SIX, Bundesbank, EBA und weitere, siehe ibanforge.com/sources).',
    method_2:
      'SEPA-Erreichbarkeit nach Land; Verification-of-Payee-Hinweis aus dem EPC-Register, wo vorhanden.',
    method_3:
      'Postadresse gegen die Regeln für strukturierte Adressen der Swiss Payment Standards (CH/LI) bzw. ISO 20022 HVPS+ (andere Länder) geprüft, wenn Adressspalten vorhanden sind.',
  },
};
