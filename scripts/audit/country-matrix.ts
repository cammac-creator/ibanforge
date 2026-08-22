/**
 * Per-country field matrix: what does a validate answer actually carry?
 *
 * Runs against the local libraries, never against production: a live sweep
 * would burn credits, trip the anti-farm guard, and — worse — write test rows
 * into operations.country_code, the very table used to decide which countries
 * deserve the work.
 *
 * Ships in the repo rather than living in a scratch directory: it reads only
 * data the image already carries, and an audit instrument that exists on one
 * machine is one nobody re-runs. Print the summary with:
 *   npx tsx scripts/audit/country-matrix.ts > /dev/null
 * (the TSV goes to stdout, the aggregate to stderr, so either can be kept alone)
 */
import { validateIBAN } from '../../src/lib/iban.js';
import { enrichResult } from '../../src/lib/enrich.js';
import { probes } from './real-codes.js';

interface Row {
  cc: string;
  /** false = probed with the ISO example IBAN, whose bank code may be invented. */
  realCode: boolean;
  bankCode: boolean;
  bic: boolean;
  bicSource: string;
  bankName: boolean;
  city: boolean;
  regInstitution: boolean;
  regStreet: boolean;
  regPostTown: boolean;
  lei: boolean;
  authoritative: boolean;
  checkStatus: string;
  issuerType: string;
  schemes: number;
  vop: boolean;
  clearing: boolean;
}

const rows: Row[] = [];

for (const probe of probes()) {
  const { cc, iban } = probe;
  let r: Record<string, unknown>;
  try {
    r = validateIBAN(iban) as unknown as Record<string, unknown>;
    if (r.valid) enrichResult(r as never);
  } catch {
    continue;
  }
  if (!r.valid) continue;

  const bban = r.bban as Record<string, unknown> | undefined;
  const bic = r.bic as Record<string, unknown> | undefined;
  const sepa = r.sepa as Record<string, unknown> | undefined;
  const check = r.bank_code_check as Record<string, unknown> | undefined;
  const inst = check?.institution as Record<string, unknown> | undefined;
  const issuer = r.issuer as Record<string, unknown> | undefined;

  rows.push({
    cc,
    realCode: probe.realCode,
    bankCode: !!bban?.bank_code,
    bic: !!bic?.code,
    bicSource: String(bic?.source ?? '-'),
    bankName: !!bic?.bank_name,
    city: !!bic?.city,
    regInstitution: !!inst?.name,
    regStreet: !!inst?.street,
    regPostTown: !!inst?.post_code || !!inst?.town,
    lei: !!inst?.lei || !!bic?.lei,
    authoritative: check?.authoritative === true,
    checkStatus: String(check?.status ?? '-'),
    issuerType: String(issuer?.type ?? '-'),
    schemes: Array.isArray(sepa?.schemes) ? (sepa!.schemes as unknown[]).length : 0,
    vop: sepa?.vop_participant === true,
    clearing: !!r.ch_clearing || !!r.clearing,
  });
}

const y = (b: boolean) => (b ? '1' : '0');
console.log(
  ['cc', 'real', 'bank', 'bic', 'name', 'city', 'reg_inst', 'street', 'posttown', 'lei',
    'auth', 'status', 'issuer', 'schemes', 'vop', 'clr', 'bic_source'].join('\t'),
);
for (const x of rows) {
  console.log(
    [x.cc, y(x.realCode), y(x.bankCode), y(x.bic), y(x.bankName), y(x.city), y(x.regInstitution),
      y(x.regStreet), y(x.regPostTown), y(x.lei), y(x.authoritative), x.checkStatus,
      x.issuerType, String(x.schemes), y(x.vop), y(x.clearing), x.bicSource].join('\t'),
  );
}

const n = rows.length;
const pct = (f: (r: Row) => boolean) => `${Math.round((rows.filter(f).length / n) * 100)}%`;
const cnt = (f: (r: Row) => boolean) => rows.filter(f).length;
console.error(`\n=== ${n} pays valides ===`);
const line = (label: string, f: (r: Row) => boolean) =>
  console.error(`  ${label.padEnd(26)} ${String(cnt(f)).padStart(3)}/${n}  ${pct(f)}`);
line('bank_code extrait', (r) => r.bankCode);
line('BIC resolu', (r) => r.bic);
line('nom de banque', (r) => r.bankName);
line('ville (BIC)', (r) => r.city);
line('institution du registre', (r) => r.regInstitution);
line('rue', (r) => r.regStreet);
line('code postal ou ville', (r) => r.regPostTown);
line('LEI', (r) => r.lei);
line('authoritative', (r) => r.authoritative);
line('classification emetteur', (r) => r.issuerType !== '-');
line('schemes SEPA connus', (r) => r.schemes > 0);
line('VoP participant', (r) => r.vop);
line('clearing national', (r) => r.clearing);

console.error('\n=== statuts de bank_code_check ===');
const byStatus = new Map<string, number>();
for (const r of rows) byStatus.set(r.checkStatus, (byStatus.get(r.checkStatus) ?? 0) + 1);
for (const [s, c] of [...byStatus].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${s.padEnd(26)} ${String(c).padStart(3)}`);
}

console.error('\n=== sources de BIC ===');
const bySource = new Map<string, number>();
for (const r of rows) bySource.set(r.bicSource, (bySource.get(r.bicSource) ?? 0) + 1);
for (const [s, c] of [...bySource].sort((a, b) => b[1] - a[1])) {
  console.error(`  ${s.slice(0, 44).padEnd(46)} ${String(c).padStart(3)}`);
}
