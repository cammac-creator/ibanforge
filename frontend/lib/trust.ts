/**
 * The facts of the "Security and trust" page (/trust) that are links or
 * identifiers rather than prose. The prose lives in the `legal.trust` catalogue
 * of messages/{en,de,fr}.json.
 *
 * Every entry here is checked against its source, and `lib/trust.test.ts`
 * keeps it in step with the contractual texts: each Data Privacy Framework
 * entry must also appear in Annex II of the DPA (English and German), and the
 * operator's address must be the one the Legal Notice prints. A register entry
 * changed here and not there fails a test instead of putting two answers
 * online.
 */

/** Day the Data Privacy Framework entries below were read on the official register. */
export const DPF_CHECKED_ON = '2026-10-05';

export type TrustProcessorKey =
  | 'railway'
  | 'vercel'
  | 'stripe'
  | 'coinbase'
  | 'infomaniak'
  | 'github'
  | 'anthropic';

export interface TrustProcessor {
  key: TrustProcessorKey;
  /** The official DPF register entry of the certified entity, when there is one. */
  dpf: string | null;
  /** The document a transfer relies on when there is no DPF entry. */
  basis: string | null;
}

/**
 * Same order and same processors as Privacy Policy §3 and DPA Annex II.
 * Entries read on dataprivacyframework.gov on 2026-10-05, both the EU-US and
 * the Swiss-US frameworks active for each: Railway Corporation, Vercel Inc.,
 * Stripe, LLC (the US affiliate: the processor itself is Stripe Payments
 * Europe, in the EU), Coinbase, Inc., GitHub. Anthropic has no entry.
 */
export const TRUST_PROCESSORS: readonly TrustProcessor[] = [
  { key: 'railway', dpf: 'https://www.dataprivacyframework.gov/participant/2913', basis: null },
  { key: 'vercel', dpf: 'https://www.dataprivacyframework.gov/participant/6847', basis: null },
  { key: 'stripe', dpf: 'https://www.dataprivacyframework.gov/participant/10014', basis: null },
  { key: 'coinbase', dpf: 'https://www.dataprivacyframework.gov/participant/6286', basis: null },
  { key: 'infomaniak', dpf: null, basis: 'https://eur-lex.europa.eu/eli/dec/2000/518/oj' },
  { key: 'github', dpf: 'https://www.dataprivacyframework.gov/participant/6174', basis: null },
  {
    key: 'anthropic',
    dpf: null,
    basis: 'https://www.anthropic.com/legal/data-processing-addendum',
  },
] as const;

/** The postal address printed in the Legal Notice (content/legal/imprint.mdx). */
export const OPERATOR_ADDRESS_LINES = ["Rue de l'Eglise 23", '1045 Ogens'] as const;

export const TRUST_LINKS = {
  dpfList: 'https://www.dataprivacyframework.gov/list',
  adequacySwitzerland: 'https://eur-lex.europa.eu/eli/dec/2000/518/oj',
  adequacyReview: 'https://www.edoeb.admin.ch/en/15012024-eu-adequacy-decision-regarding-switzerland',
  dpfEuUs: 'https://eur-lex.europa.eu/eli/dec_impl/2023/1795/oj',
  railwayVolumes: 'https://docs.railway.com/reference/volumes',
  ci: 'https://github.com/cammac-creator/ibanforge/actions/workflows/ci.yml',
  repo: 'https://github.com/cammac-creator/ibanforge',
  securityPolicy: 'https://github.com/cammac-creator/ibanforge/blob/main/SECURITY.md',
  notice: 'https://github.com/cammac-creator/ibanforge/blob/main/NOTICE',
  corePackage: 'https://www.npmjs.com/package/ibanforge',
  securityTxtSite: 'https://ibanforge.com/.well-known/security.txt',
  securityTxtApi: 'https://api.ibanforge.com/.well-known/security.txt',
} as const;
