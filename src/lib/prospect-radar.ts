/**
 * Prospect enrichment, the pure half (same split as forum-radar / -server).
 *
 * Two gaps this closes, both left behind by every weekly harvest: prospects
 * with a website but no address yet, and prospects with an address but no
 * written mail. The doctrine is the harvest's, mechanised:
 *
 * - An address is never guessed. It must be SEEN on a page of the prospect's
 *   own site, and the page URL is stored as proof (email_source_url).
 * - Only addresses on the prospect's own domain qualify. A gmail found on
 *   someone's site proves nothing about who reads it.
 * - The mail: 80-130 words, three short paragraphs, one specific hook, one
 *   whitelisted product fact at most, a reply-level ask (never a call), the
 *   exact opt-out line, no long dashes anywhere.
 */

import { PRODUCT_FACTS } from './forum-draft-gen.js';

// ---------------------------------------------------------------- addresses

/** Pages worth probing for a published address, in probe order. */
export const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about', '/imprint', '/impressum', '/legal'];

/** Local parts that reach a machine or the wrong desk, never a founder. */
const BANNED_LOCALPARTS = new Set([
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notifications', 'notification',
  'abuse', 'spam', 'postmaster', 'webmaster', 'hostmaster', 'mailer-daemon',
  'jobs', 'careers', 'hr', 'recruiting', 'press', 'media', 'pr',
  'privacy', 'dpo', 'gdpr', 'legal', 'compliance', 'billing', 'invoice', 'invoices',
  'unsubscribe', 'security', 'cert',
  // form placeholders and demo strings seen in the wild
  'example', 'test', 'demo', 'user', 'name', 'firstname', 'lastname', 'email', 'your', 'you', 'someone', 'john.doe', 'jane.doe',
]);

/** File suffixes the naive regex mistakes for mail domains (logo@2x.png). */
const ASSET_TLDS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'css', 'js', 'woff', 'woff2']);

/** Generic inboxes ranked by how likely a human founder reads them. */
const PREFERRED_LOCALPARTS = ['contact', 'hello', 'hi', 'hey', 'info', 'team', 'founders', 'mail'];
const FALLBACK_LOCALPARTS = new Set(['sales', 'support', 'help', 'office', 'admin', 'service']);

const EMAIL_RE = /[A-Z0-9][A-Z0-9._%+-]*@[A-Z0-9][A-Z0-9.-]*\.[A-Z]{2,}/gi;

/** Every address VISIBLE in a page: mailto: links plus plain-text mentions. */
export function extractEmails(html: string): string[] {
  // The cheap obfuscations first, so the regex sees plain addresses.
  const decoded = html
    .replace(/&#0*64;|&#x0*40;/gi, '@')
    .replace(/&#0*46;|&#x0*2e;/gi, '.')
    .replace(/%40/g, '@')
    .replace(/&amp;/gi, '&');
  const out = new Set<string>();
  for (const m of decoded.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase().replace(/^mailto:/, '');
    const tld = email.slice(email.lastIndexOf('.') + 1);
    if (ASSET_TLDS.has(tld)) continue;
    out.add(email);
  }
  return [...out];
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Same organisation: exact host, or one is a subdomain of the other. */
export function sameOrg(emailDomain: string, siteHost: string): boolean {
  const d = emailDomain.toLowerCase().replace(/^www\./, '');
  if (d === siteHost) return true;
  return d.endsWith(`.${siteHost}`) || siteHost.endsWith(`.${d}`);
}

/**
 * The one address worth writing to, or null. Own-domain only, banned desks
 * out, generic human inboxes first, then personal-looking addresses, then
 * the service desks.
 */
export function pickEmail(candidates: string[], siteUrl: string): string | null {
  const host = hostOf(siteUrl);
  if (!host) return null;
  const rank = (local: string): number => {
    const i = PREFERRED_LOCALPARTS.indexOf(local);
    if (i !== -1) return i;
    if (FALLBACK_LOCALPARTS.has(local)) return 40;
    return 20; // likely a person
  };
  const eligible = candidates
    .map((e) => e.toLowerCase())
    .filter((e) => {
      const [local, domain] = e.split('@');
      if (!local || !domain) return false;
      if (BANNED_LOCALPARTS.has(local)) return false;
      return sameOrg(domain, host);
    })
    .sort((a, b) => rank(a.split('@')[0]) - rank(b.split('@')[0]) || a.localeCompare(b));
  return eligible[0] ?? null;
}

// ---------------------------------------------------------------- the mail

export interface ProspectForMail {
  id: string;
  company: string;
  website: string | null;
  country: string | null;
  segment: string | null;
  what_they_do: string | null;
  fit_reason: string | null;
  buying_signal: string | null;
  signal_source_url: string | null;
  personalization_hook: string | null;
  contact_name: string | null;
  contact_role: string | null;
}

/** FR for the francophone home markets, EN everywhere else. */
export function recommendedLang(country: string | null): 'fr' | 'en' {
  return country && ['FR', 'CH', 'BE', 'LU', 'MC'].includes(country.toUpperCase()) ? 'fr' : 'en';
}

export const PROSPECT_MAIL_SYSTEM = `You write ONE cold outreach email (EN and FR versions) for IBANforge (ibanforge.com), an IBAN/BIC validation API. The reader is a busy founder or developer who has never heard of us.

Hard rules, in order:
1. Body: 80 to 130 words, EXACTLY three short paragraphs, plain text, no bullet lists, no links other than ibanforge.com.
2. Paragraph 1: ONE specific sentence about THEIR product, grounded in the facts provided (what they do, the buying signal). Be honest about where we saw them when a source is given. Never flatter, never "I love what you're building".
3. Paragraph 2: the concrete failure mode IBANforge removes IN THEIR PIPELINE (an invalid IBAN or a wrong BIC means a failed or misrouted SEPA payout discovered days later). At most ONE product fact from the whitelist below, stated plainly. Mention ibanforge.com exactly once.
4. Paragraph 3: a reply-level ask ("worth a look?" / « est-ce pertinent pour vous ? »). NEVER propose a call, a meeting or a demo. Then this exact opt-out line: "If this isn't relevant, tell me and I won't write again." (FR: « Si ce n'est pas pertinent, dites-le moi et je ne vous recontacterai pas. »)
5. Greeting: "Hi {first name}," only when a contact name is provided; otherwise "Hi," (FR: « Bonjour {prénom}, » / « Bonjour, »). Use ONLY the first name, and only if one was provided.
6. Sign exactly (both versions):
Claude-Alain Martin
IBANforge · ibanforge.com
7. Use ONLY these product facts, never invent numbers or capabilities:
${PRODUCT_FACTS}
8. FORBIDDEN: em dashes and en dashes anywhere (use commas or periods), superlatives ("best", "leading"), urgency ("limited", "act now"), claiming they need us, more than one product fact, any invented detail about them.
9. The FR version is a natural rewrite in French (vouvoiement), not a word-for-word translation. Subjects: lowercase, concrete, under 60 characters, no colon-hype.

Output STRICTLY in this format (raw text between markers, nothing outside them):
===SUBJECT_EN===
(subject line, English)
===BODY_EN===
(full email body, English, greeting to signature)
===SUBJECT_FR===
(subject line, French)
===BODY_FR===
(full email body, French, greeting to signature)
===END===`;

export function buildProspectMailPrompt(p: ProspectForMail): string {
  const lines: string[] = [
    `Company: ${p.company}`,
    p.website ? `Website: ${p.website}` : '',
    p.country ? `Country: ${p.country}` : '',
    p.segment ? `Segment: ${p.segment}` : '',
    p.what_they_do ? `What they do: ${p.what_they_do}` : '',
    p.fit_reason ? `Why they fit IBANforge: ${p.fit_reason}` : '',
    p.buying_signal ? `Buying signal: ${p.buying_signal}` : '',
    p.signal_source_url ? `Where we saw the signal: ${p.signal_source_url}` : '',
    p.personalization_hook ? `Personalisation hook: ${p.personalization_hook}` : '',
    p.contact_name ? `Contact: ${p.contact_name}${p.contact_role ? ` (${p.contact_role})` : ''}` : 'Contact: unknown (use the neutral greeting)',
  ].filter(Boolean);
  return `Write the outreach email for this prospect.\n\n${lines.join('\n')}`;
}

export interface ProspectMail {
  subjectEn: string;
  bodyEn: string;
  subjectFr: string;
  bodyFr: string;
}

// ------------------------------------------------------- describing a site

/**
 * The useful text of a page, for a describe prompt: title, meta description,
 * then the visible body with markup stripped — capped, because a pricing
 * page's tail adds tokens, not identity.
 */
export function pageGist(html: string, cap = 1600): string {
  const title = /<title[^>]*>([^<]{1,200})/i.exec(html)?.[1] ?? '';
  const meta =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']{1,400})/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']{1,400})["'][^>]*name=["']description["']/i.exec(html)?.[1] ??
    /<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']{1,400})/i.exec(html)?.[1] ??
    '';
  const body = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return [title && `TITLE: ${title.trim()}`, meta && `META: ${meta.trim()}`, body && `BODY: ${body}`]
    .filter(Boolean)
    .join('\n')
    .slice(0, cap);
}

/**
 * One factual sentence about a company, in French — the language every
 * existing profile in the CRM already speaks.
 */
export const DESCRIBE_SYSTEM = `You identify what a company does from its website text, for an internal CRM.

Rules:
1. Output FRENCH. One or two factual sentences (max 260 characters total) describing what the company does and for whom. No marketing adjectives, no guessing beyond the text.
2. If the text does not clearly identify a real organisation's activity (parked domain, login-only page, mailbox provider, error page), output UNKNOWN for DESC.
3. COMPANY = the organisation's name as the site states it (short). COUNTRY = ISO 3166-1 alpha-2 if the text makes it clear, else UNKNOWN.
4. No em dashes or en dashes anywhere.

Output STRICTLY in this format:
===COMPANY===
(name or UNKNOWN)
===COUNTRY===
(two-letter code or UNKNOWN)
===DESC===
(the French description, or UNKNOWN)
===END===`;

export function buildDescribePrompt(siteUrl: string, gist: string): string {
  return `Website: ${siteUrl}\n\n${gist}`;
}

export interface SiteDescription {
  company: string | null;
  country: string | null;
  desc: string | null;
}

export function parseDescribeOutput(text: string): SiteDescription | null {
  const grab = (name: string, next: string): string | null => {
    const m = text.match(new RegExp(`===${name}===\\s*([\\s\\S]*?)\\s*===${next}===`));
    if (!m) return null;
    const v = m[1].trim();
    return !v || /^unknown$/i.test(v) ? null : v;
  };
  const company = grab('COMPANY', 'COUNTRY');
  const country = grab('COUNTRY', 'DESC');
  const desc = grab('DESC', 'END');
  if (!text.includes('===DESC===')) return null;
  return { company, country: country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null, desc };
}

/**
 * Marker format, never JSON: a multi-line body inside a JSON string is exactly
 * the failure mode that killed 5 of 6 forum generations in production.
 */
export function parseProspectMail(text: string): ProspectMail | null {
  const grab = (name: string, next: string): string | null => {
    const m = text.match(new RegExp(`===${name}===\\s*([\\s\\S]*?)\\s*===${next}===`));
    return m ? m[1].trim() : null;
  };
  const subjectEn = grab('SUBJECT_EN', 'BODY_EN');
  const bodyEn = grab('BODY_EN', 'SUBJECT_FR');
  const subjectFr = grab('SUBJECT_FR', 'BODY_FR');
  const bodyFr = grab('BODY_FR', 'END');
  if (!subjectEn || !bodyEn || !subjectFr || !bodyFr) return null;
  return { subjectEn, bodyEn, subjectFr, bodyFr };
}
