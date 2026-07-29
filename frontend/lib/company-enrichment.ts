/**
 * Lightweight, instant company enrichment from a customer email.
 *
 * Source priority:
 *  1. CURATED — companies behind known customer domains, supplied privately at
 *     runtime (see loadCurated below). Hand-curated because it catches rebrands
 *     and acquisitions that a frozen third-party database would still get wrong.
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

type CuratedEntry = Omit<CompanyInfo, 'isBusiness' | 'source'>;

/**
 * Curated domain → company map, loaded at runtime from a private environment
 * variable. It used to be a literal in this file, which published the customer
 * list to anyone reading this public repository. Set CRM_CURATED_COMPANIES to a
 * JSON object of the same shape.
 *
 * An unset or unparseable value disables curated enrichment and falls through
 * to DERIVED. That is the safe direction: a slightly worse label in the CRM,
 * never a crash and never a leak.
 */
function loadCurated(): Record<string, CuratedEntry> {
  const raw = process.env.CRM_CURATED_COMPANIES;
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, CuratedEntry>;
  } catch {
    console.warn('[crm] CRM_CURATED_COMPANIES is not valid JSON — curated enrichment disabled');
    return {};
  }
}

const CURATED: Record<string, CuratedEntry> = loadCurated();

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
