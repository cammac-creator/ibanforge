type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null;

/** Une absence dans une source partielle ne devient jamais un refus de paiement. */
export function playgroundVerdict(data: RecordValue, mode: 'iban' | 'compliance') {
  const bank = record(data.bank_code_check);
  const bic = record(data.bic);
  const compliance = record(data.compliance);
  const sanctions = record(compliance.sanctions);
  // Clé nationale fausse (clé RIB, CIN, DC, chiffres belges, modulus britannique) :
  // `checks.national_check_digits` vaut `fail` depuis le 25/09/2026, `valid` reste vrai.
  const localCheckInvalid = record(bank.check_digit).valid === false || record(data.modulus_check).passed === false
    || record(data.checks).national_check_digits === 'fail';
  const ambiguous = typeof bank.candidates === 'number' && bank.candidates > 1;
  const bankStatus = data.valid !== true ? 'notChecked'
    : bank.status === 'not_in_register' && bank.authoritative === true && bank.reason === 'not_allocated' ? 'notAllocated'
    : bank.status === 'verified' && bank.retired === true ? 'retired'
    : bank.status === 'verified' && ambiguous ? 'ambiguous'
    : bank.status === 'verified' ? (bank.authoritative === true ? 'verified' : 'matched')
    : 'unknown';
  const screened = mode === 'compliance' && data.valid === true && ['low', 'medium', 'elevated', 'high', 'critical'].includes(String(compliance.risk_level))
    && typeof sanctions.bank_sanctioned === 'boolean';
  return {
    structure: data.valid === true ? 'valid' : data.valid === false ? 'invalid' : 'notChecked',
    bankStatus,
    localCheckInvalid,
    code: text(bank.value) ?? text(record(data.bban).bank_code),
    bankName: text(record(bank.institution).name),
    bicBankName: text(bic.bank_name),
    source: text(bank.register),
    asOf: text(bank.as_of),
    bic: text(bic.code),
    bicSource: text(bic.source),
    bicAsOf: text(bic.as_of),
    sanctions: screened ? (sanctions.bank_sanctioned ? 'matchedSanctions' : 'noMatch') : 'notChecked',
    sanctionsSource: screened ? text(record(data.meta).sources) : null,
    sanctionsAsOf: screened ? text(record(data.meta).sanctions_as_of) : null,
    next: typeof data.valid !== 'boolean' ? 'retry' : data.valid === false ? 'fixStructure' : (bankStatus === 'notAllocated' || localCheckInvalid) ? 'confirmDetails'
      : ['unknown', 'ambiguous', 'retired', 'matched'].includes(bankStatus) ? 'checkBank'
      : screened ? 'reviewScope' : 'screenBank',
  } as const;
}
