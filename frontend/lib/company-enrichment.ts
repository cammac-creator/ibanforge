/**
 * Lightweight, instant company enrichment from a customer email.
 *
 * Source priority:
 *  1. CURATED — real companies behind known customer domains (verified live by
 *     the discovery scouts on 2026-06-26, incl. rebrands like netguardians→Vyntra
 *     and saphirstein→Fiat24 that a frozen DB would miss).
 *  2. DERIVED — for any other business domain: a capitalised name + website link.
 *  3. PERSONAL — public/disposable mailbox → not a company, not enriched.
 *
 * No network call (page renders instantly). Live website scraping + Zefix is a
 * documented future upgrade; this map covers the customers that actually matter.
 */

export type EnrichmentSource = 'curated' | 'derived' | 'personal';

export interface CompanyInfo {
  company: string | null;
  sector: string | null;
  website: string | null;
  linkedin: string | null;
  country: string | null;
  isBusiness: boolean;
  source: EnrichmentSource;
}

// Public / disposable mailbox domains → the email is a person, not a company.
const PERSONAL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'yahoo.com', 'yahoo.fr', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
  'gmx.ch', 'gmx.net', 'gmx.de', 'bluewin.ch', 'sunrise.ch', 'hispeed.ch',
  'aol.com', 'qq.com', '163.com', '126.com', 'web.de', 't-online.de',
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'yopmail.com',
  'trashmail.com', 'tempmail.com', 'getnada.com', 'sharklasers.com',
]);

// Real customer companies, keyed by email domain. name/sector verified live.
const CURATED: Record<string, Omit<CompanyInfo, 'isBusiness' | 'source'>> = {
  'saphirstein.com': { company: 'Fiat24', sector: 'Banque on-chain', website: 'https://www.fiat24.com', linkedin: 'https://www.linkedin.com/company/fiat24', country: 'CH' },
  'fiat24.com': { company: 'Fiat24', sector: 'Banque on-chain', website: 'https://www.fiat24.com', linkedin: 'https://www.linkedin.com/company/fiat24', country: 'CH' },
  'netguardians.ch': { company: 'Vyntra (ex-NetGuardians)', sector: 'Fincrime / AML', website: 'https://www.vyntra.com', linkedin: 'https://www.linkedin.com/company/vyntra', country: 'CH' },
  'apiax.com': { company: 'Apiax', sector: 'RegTech', website: 'https://www.apiax.com', linkedin: 'https://www.linkedin.com/company/apiax', country: 'CH' },
  'relio.ch': { company: 'Relio', sector: 'Néobanque B2B (IBAN suisse)', website: 'https://www.relio.ch', linkedin: 'https://www.linkedin.com/company/relioch', country: 'CH' },
  'yapeal.ch': { company: 'YAPEAL', sector: 'FinTech / embedded finance', website: 'https://www.yapeal.ch', linkedin: 'https://www.linkedin.com/company/yapeal', country: 'CH' },
  'bivial.com': { company: 'Bivial', sector: 'Comptes multi-devises', website: 'https://www.bivial.com', linkedin: null, country: 'CH' },
  'polixis.com': { company: 'Polixis', sector: 'RegTech / AML', website: 'https://www.polixis.com', linkedin: null, country: 'CH' },
  'kycspider.com': { company: 'KYC Spider', sector: 'Compliance / KYC', website: 'https://www.kycspider.com', linkedin: null, country: 'CH' },
  'amnistreasury.com': { company: 'Amnis', sector: 'Trésorerie / FX PME', website: 'https://www.amnistreasury.com', linkedin: 'https://www.linkedin.com/company/amnis-treasury', country: 'CH' },
  'ib4.net': { company: 'IB4', sector: 'Services bancaires', website: 'https://www.ib4.net', linkedin: null, country: 'CH' },
  'neusoft.com': { company: 'Neusoft', sector: 'IT / logiciels', website: 'https://www.neusoft.com', linkedin: 'https://www.linkedin.com/company/neusoft', country: 'CN' },
};

function tldCountry(domain: string): string | null {
  if (domain.endsWith('.ch')) return 'CH';
  if (domain.endsWith('.de')) return 'DE';
  if (domain.endsWith('.fr')) return 'FR';
  if (domain.endsWith('.cn')) return 'CN';
  if (domain.endsWith('.uk') || domain.endsWith('.co.uk')) return 'GB';
  return null;
}

/** Capitalise the registrable part of a domain ("acme-pay.io" → "Acme Pay"). */
function deriveName(domain: string): string {
  const base = domain.split('.').slice(0, -1).join('.') || domain;
  return base
    .replace(/[-_.]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function enrichEmail(email: string | null | undefined): CompanyInfo {
  const empty: CompanyInfo = { company: null, sector: null, website: null, linkedin: null, country: null, isBusiness: false, source: 'personal' };
  if (!email || !email.includes('@')) return empty;
  const domain = email.split('@')[1]?.trim().toLowerCase();
  if (!domain) return empty;

  if (PERSONAL_DOMAINS.has(domain)) {
    return { ...empty, country: tldCountry(domain), source: 'personal' };
  }

  const curated = CURATED[domain];
  if (curated) {
    return { ...curated, isBusiness: true, source: 'curated' };
  }

  // Unknown business domain → derive a usable label + website to qualify in 1 click.
  return {
    company: deriveName(domain),
    sector: null,
    website: `https://${domain}`,
    linkedin: null,
    country: tldCountry(domain),
    isBusiness: true,
    source: 'derived',
  };
}
