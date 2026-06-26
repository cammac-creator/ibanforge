/**
 * Lightweight, instant company enrichment from a customer email.
 *
 * Source priority:
 *  1. CURATED — real companies behind known customer domains (verified live by
 *     the discovery scouts on 2026-06-26, incl. rebrands like customer-f→Customer F
 *     and customer-e→Customer E that a frozen DB would miss).
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
  'customer-e.example': { company: 'Customer E', sector: 'Banque on-chain', website: 'https://www.customer-e.example', linkedin: 'https://www.linkedin.com/company/customer-e', country: 'CH' },
  'customer-e.example': { company: 'Customer E', sector: 'Banque on-chain', website: 'https://www.customer-e.example', linkedin: 'https://www.linkedin.com/company/customer-e', country: 'CH' },
  'customer-f.example': { company: 'Customer F (ex-Customer F)', sector: 'Fincrime / AML', website: 'https://www.customer-f.com', linkedin: 'https://www.linkedin.com/company/customer-f', country: 'CH' },
  'customer-g.example': { company: 'Customer G', sector: 'RegTech', website: 'https://www.customer-g.example', linkedin: 'https://www.linkedin.com/company/customer-g', country: 'CH' },
  'customer-h.example': { company: 'Customer H', sector: 'Néobanque B2B (IBAN suisse)', website: 'https://www.customer-h.example', linkedin: 'https://www.linkedin.com/company/relioch', country: 'CH' },
  'customer-i.example': { company: 'Customer I', sector: 'FinTech / embedded finance', website: 'https://www.customer-i.example', linkedin: 'https://www.linkedin.com/company/customer-i', country: 'CH' },
  'customer-j.example': { company: 'Customer J', sector: 'Comptes multi-devises', website: 'https://www.customer-j.example', linkedin: null, country: 'CH' },
  'customer-k.example': { company: 'Customer K', sector: 'RegTech / AML', website: 'https://www.customer-k.example', linkedin: null, country: 'CH' },
  'customer-l.example': { company: 'Customer L', sector: 'Compliance / KYC', website: 'https://www.customer-l.example', linkedin: null, country: 'CH' },
  'customer-m.example': { company: 'Customer M', sector: 'Trésorerie / FX PME', website: 'https://www.customer-m.example', linkedin: 'https://www.linkedin.com/company/customer-m-treasury', country: 'CH' },
  'customer-n.example': { company: 'Customer N', sector: 'Services bancaires', website: 'https://www.customer-n.example', linkedin: null, country: 'CH' },
  'customer-o.example': { company: 'Customer O', sector: 'IT / logiciels', website: 'https://www.customer-o.example', linkedin: 'https://www.linkedin.com/company/customer-o', country: 'CN' },
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
