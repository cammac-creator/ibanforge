// Moved to the open-source library (t23). Imported under the npm alias
// `iban-core` — this package is itself named "ibanforge", so a bare
// 'ibanforge' specifier would self-resolve to our own dist/index.js.
export { classifyIssuer, normalizeIssuerName } from 'iban-core';
export type { IssuerType, IssuerInfo } from 'iban-core';
