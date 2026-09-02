/**
 * Prospect enrichment, the I/O half — run INSIDE the API process like the
 * other radars (pure logic in prospect-radar.ts, writes here, cadence that
 * survives redeploys via kv_state).
 *
 * What a run does, in order:
 *  1. Prospects with a website but no address: probe the site's contact-ish
 *     pages, keep an own-domain address if one is PUBLISHED there, store the
 *     page URL as proof. Three fruitless full passes and the row is left to
 *     the human (kv miss counter) instead of being probed forever.
 *  2. Prospects with an address but no written mail: draft the EN+FR cold
 *     email (whitelisted facts, opt-out, no dashes) and promote the row to
 *     'a_mailer' — which is what the reservoir gauge counts as "ready".
 *
 * Every step is fail-soft PER PROSPECT: one dead site or one bad generation
 * ends up in the report's errors, never aborts the run.
 */

import { getStatsDB } from './db.js';
import { stripDashes } from './forum-draft-gen.js';
import { kvGet, kvSet, sendTelegramShort } from './forum-radar-server.js';
import {
  CONTACT_PATHS,
  DESCRIBE_SYSTEM,
  PROSPECT_MAIL_SYSTEM,
  buildDescribePrompt,
  buildProspectMailPrompt,
  extractEmails,
  pageGist,
  parseDescribeOutput,
  parseProspectMail,
  pickEmail,
  recommendedLang,
  type ProspectForMail,
  type ProspectMail,
  type SiteDescription,
} from './prospect-radar.js';
import {
  GENERIC_EMAIL_DOMAINS,
  customerContextBlock,
  getCompanyProfiles,
  uaWebsite,
  upsertCompanyProfile,
} from './company-profiles.js';
import { getClientProfiles } from './stats.js';
import { isInternalEmail } from './internal-accounts.js';

const TICK_MS = 60 * 60 * 1000;
const BOOT_DELAY_MS = 4 * 60 * 1000; // offset from the lifecycle (5') and forum (3') radars
const DUE_AFTER_MS = 6 * 60 * 60 * 1000;
const ENRICH_PER_RUN = 6;
const DRAFT_PER_RUN = 6;
const CLIENT_ENRICH_PER_RUN = 4;
const PAGE_TIMEOUT_MS = 12_000;
/** A site probed this many full rounds without revealing an address is the
 *  human's to judge; probing it forever would just be noise in their logs. */
const MAX_ENRICH_MISSES = 3;

const KV_LAST_RUN = 'prospect_radar_last_run';
const KV_LAST_REPORT = 'prospect_backfill_last_report';
const KV_MISSES = 'prospect_enrich_misses';

interface ProspectRowDb extends ProspectForMail {
  contact_email: string | null;
  status: string;
}

export interface BackfillReport {
  finished_at: string;
  enriched: { tried: number; found: number };
  drafted: { tried: number; written: number };
  /** Customer identity pass (company_profiles) — absent in pre-19/08 reports. */
  clients?: { tried: number; identified: number; unresolved: number };
  errors: string[];
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'ibanforge-radar/1.0 (+https://ibanforge.com)',
        Accept: 'text/html',
      },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text.slice(0, 400_000);
  } catch {
    return null;
  }
}

function siteBase(website: string): string {
  return /^https?:\/\//i.test(website) ? website : `https://${website}`;
}

/**
 * The address as the harvest doctrine defines it: SEEN on a page of their own
 * site, own domain only, with the page URL as proof. Null when no probed page
 * publishes one.
 */
export async function enrichOne(
  website: string,
): Promise<{ email: string; sourceUrl: string } | null> {
  const base = siteBase(website);
  for (const path of CONTACT_PATHS) {
    let url: string;
    try {
      url = new URL(path || '/', base).toString();
    } catch {
      return null;
    }
    const html = await fetchPage(url);
    if (!html) continue;
    const hit = pickEmail(extractEmails(html), base);
    if (hit) return { email: hit, sourceUrl: url };
  }
  return null;
}

/** Shared Anthropic call for this radar's generations. Null without a key. */
async function callAnthropic(
  system: string,
  user: string,
): Promise<{ text: string; stopReason: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      // The model's thinking block spends the SAME max_tokens budget as the
      // answer, and the customer-context block lengthens that thinking: at
      // 3000 the ctenifaktur draft came back truncated before ===END=== on
      // every 6h run while an isolated repro (no context block) parsed fine.
      // Headroom is cheap, truncation costs a whole generation.
      model: 'claude-sonnet-5',
      max_tokens: 6000,
      system,
      messages: [{ role: 'user', content: user }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${detail.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
  };
  const text = (data.content ?? []).map((c) => c.text ?? '').join('');
  const stopReason = data.stop_reason ?? '?';
  if (!text.trim()) throw new Error(`generation empty (stop_reason=${stopReason})`);
  return { text, stopReason };
}

/** One Anthropic call, one EN+FR mail. Null when no API key is configured. */
export async function draftOne(p: ProspectForMail): Promise<ProspectMail | null> {
  // The customer-base context sharpens the hook; the block itself forbids
  // naming any customer in the output.
  const user = buildProspectMailPrompt(p) + customerContextBlock();
  // One immediate retry: a malformed generation is usually transient, and
  // without it the prospect stays stuck a full 6h cycle for one bad sample.
  for (let attempt = 1; ; attempt++) {
    const out = await callAnthropic(PROSPECT_MAIL_SYSTEM, user);
    if (out == null) return null;
    const mail = parseProspectMail(out.text);
    if (mail) {
      return {
        subjectEn: stripDashes(mail.subjectEn),
        bodyEn: stripDashes(mail.bodyEn),
        subjectFr: stripDashes(mail.subjectFr),
        bodyFr: stripDashes(mail.bodyFr),
      };
    }
    // The tail is our own generated text about a public prospect — loggable,
    // and the only artifact that says WHY the markers were missing.
    console.warn(
      `[prospect-radar] draft ${p.id} unparseable (attempt ${attempt}, stop_reason=${out.stopReason}, len=${out.text.length}) tail: ${JSON.stringify(out.text.slice(-160))}`,
    );
    if (attempt >= 2) {
      throw new Error(`mail generation unparseable (stop_reason=${out.stopReason})`);
    }
  }
}

/**
 * What does this site's owner do? Fetches the site (home, then /about when
 * the home says little), asks for one factual French sentence. Returns null
 * when the pages hold nothing usable (SPA shell, parked domain, dead site) —
 * that is a fact about the site, not a transient error.
 */
export async function describeSite(siteUrl: string): Promise<SiteDescription | null> {
  let gist = '';
  for (const path of ['', '/about']) {
    let url: string;
    try {
      url = new URL(path || '/', siteUrl).toString();
    } catch {
      return null;
    }
    const html = await fetchPage(url);
    if (html) {
      const g = pageGist(html);
      if (g.length > gist.length) gist = g;
      if (gist.length > 260) break;
    }
  }
  if (gist.length < 40) return null;
  const out = await callAnthropic(DESCRIBE_SYSTEM, buildDescribePrompt(siteUrl, gist));
  if (out == null) return null;
  const parsed = parseDescribeOutput(out.text);
  if (!parsed) throw new Error(`describe output unparseable (stop_reason=${out.stopReason})`);
  return {
    company: parsed.company ? stripDashes(parsed.company) : null,
    country: parsed.country,
    desc: parsed.desc ? stripDashes(parsed.desc) : null,
  };
}

/**
 * The Clients-tab gap of 19/08: signups we never approached had no identity
 * anywhere. For each key-holding address without a profile: probe the mail
 * domain's site when it is a company domain, else the URL a polite
 * User-Agent advertises (how a gmail address turned out to be a Belgian
 * tele-psychology platform). Whatever cannot be resolved is recorded as
 * such, once, so the human sees a judgement instead of a hole.
 */
export async function enrichClientCompanies(limit = CLIENT_ENRICH_PER_RUN): Promise<{
  tried: number;
  identified: number;
  unresolved: number;
  errors: string[];
}> {
  const out = { tried: 0, identified: 0, unresolved: 0, errors: [] as string[] };
  const db = getStatsDB();
  const have = getCompanyProfiles();
  const prospectDescribed = new Set(
    (
      db
        .prepare(
          `SELECT DISTINCT lower(contact_email) AS e FROM prospects
           WHERE contact_email IS NOT NULL AND what_they_do IS NOT NULL AND TRIM(what_they_do) != ''`,
        )
        .all() as Array<{ e: string }>
    ).map((r) => r.e),
  );
  const keyRows = db
    .prepare(
      'SELECT lower(email) AS email, key_prefix FROM api_keys ORDER BY datetime(created_at) DESC',
    )
    .all() as Array<{ email: string; key_prefix: string }>;

  const prefixesByEmail = new Map<string, string[]>();
  const candidates: string[] = [];
  for (const r of keyRows) {
    const arr = prefixesByEmail.get(r.email);
    if (arr) arr.push(r.key_prefix);
    else prefixesByEmail.set(r.email, [r.key_prefix]);
  }
  for (const email of prefixesByEmail.keys()) {
    if (isInternalEmail(email) || have[email] || prospectDescribed.has(email)) continue;
    candidates.push(email);
  }

  // User-agents are the fallback identity source; loaded once, only if some
  // candidate will need them (generic mail domain).
  let uaByPrefix: Record<string, Array<{ ua: string; count: number }>> | null = null;

  for (const email of candidates.slice(0, limit)) {
    out.tried++;
    try {
      const domain = email.split('@')[1] ?? '';
      let siteUrl: string | null = null;
      let source: 'site' | 'ua' = 'site';
      if (domain && !GENERIC_EMAIL_DOMAINS.has(domain) && !domain.endsWith('.invalid')) {
        siteUrl = `https://${domain}`;
      } else {
        if (uaByPrefix == null) {
          const profiles = getClientProfiles(90);
          uaByPrefix = Object.fromEntries(
            Object.entries(profiles).map(([k, p]) => [k, p.user_agents ?? []]),
          );
        }
        for (const prefix of prefixesByEmail.get(email) ?? []) {
          for (const u of uaByPrefix[prefix] ?? []) {
            const url = uaWebsite(u.ua);
            if (url) {
              siteUrl = url;
              source = 'ua';
              break;
            }
          }
          if (siteUrl) break;
        }
      }
      if (!siteUrl) {
        upsertCompanyProfile({ email, source: 'unresolvable' });
        out.unresolved++;
        continue;
      }
      const d = await describeSite(siteUrl);
      if (d?.desc) {
        upsertCompanyProfile({
          email,
          company: d.company ?? domain,
          website: siteUrl,
          country: d.country,
          whatTheyDo: d.desc,
          source,
        });
        out.identified++;
      } else if (d === null) {
        // Nothing readable on the site — a durable fact, recorded once.
        upsertCompanyProfile({ email, website: siteUrl, source: 'unresolvable' });
        out.unresolved++;
      } else {
        // Pages read fine but the model could not name an activity.
        upsertCompanyProfile({ email, website: siteUrl, source: 'unresolvable' });
        out.unresolved++;
      }
    } catch (err) {
      // Transient (network, API) — no row written, retried next run.
      out.errors.push(
        `client ${email.split('@')[1] ?? email}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return out;
}

function readMisses(): Record<string, number> {
  try {
    return JSON.parse(kvGet(KV_MISSES) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

let running = false;

export async function runProspectBackfill(
  opts: { enrichLimit?: number; draftLimit?: number; clientLimit?: number } = {},
): Promise<BackfillReport> {
  const report: BackfillReport = {
    finished_at: '',
    enriched: { tried: 0, found: 0 },
    drafted: { tried: 0, written: 0 },
    errors: [],
  };
  if (running) {
    report.errors.push('already running');
    return report;
  }
  running = true;
  try {
    const db = getStatsDB();
    const misses = readMisses();

    // -- 1. addresses -------------------------------------------------------
    const enrichables = (
      db
        .prepare(
          `SELECT * FROM prospects
           WHERE status = 'a_enrichir'
             AND (contact_email IS NULL OR TRIM(contact_email) = '')
             AND website IS NOT NULL AND TRIM(website) != ''
             AND (outcome IS NULL OR outcome = 'en_discussion')
           ORDER BY datetime(created_at) DESC`,
        )
        .all() as ProspectRowDb[]
    )
      .filter((p) => (misses[p.id] ?? 0) < MAX_ENRICH_MISSES)
      .slice(0, opts.enrichLimit ?? ENRICH_PER_RUN);

    const gaveUpOn: string[] = [];
    for (const p of enrichables) {
      report.enriched.tried++;
      try {
        const hit = await enrichOne(p.website as string);
        if (hit) {
          // The guard re-checks emptiness: never overwrite an address a human
          // (or a parallel run) set while we were probing.
          const r = db
            .prepare(
              `UPDATE prospects SET contact_email = ?, email_source_url = ?, updated_at = datetime('now')
               WHERE id = ? AND (contact_email IS NULL OR TRIM(contact_email) = '')`,
            )
            .run(hit.email, hit.sourceUrl, p.id);
          if (r.changes > 0) {
            report.enriched.found++;
            delete misses[p.id];
          }
        } else {
          misses[p.id] = (misses[p.id] ?? 0) + 1;
          // The moment a row crosses the cap is the ONE time to say so:
          // otherwise it just sits address-less forever with no explanation.
          if (misses[p.id] === MAX_ENRICH_MISSES) gaveUpOn.push(`${p.company} (${p.website})`);
        }
      } catch (err) {
        report.errors.push(`enrich ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    kvSet(KV_MISSES, JSON.stringify(misses));
    if (gaveUpOn.length > 0) {
      try {
        await sendTelegramShort(
          `🔍 Prospects sans adresse publiée après ${MAX_ENRICH_MISSES} passes, à traiter à la main ou écarter :\n${gaveUpOn.join('\n')}`,
        );
      } catch (err) {
        report.errors.push(`telegram: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // -- 2. mails (freshly enriched rows above are already eligible) --------
    const draftables = db
      .prepare(
        `SELECT * FROM prospects
         WHERE status = 'a_enrichir'
           AND contact_email IS NOT NULL AND TRIM(contact_email) != ''
           AND (mail_body_en IS NULL OR TRIM(mail_body_en) = '')
           AND (mail_body_fr IS NULL OR TRIM(mail_body_fr) = '')
           AND (outcome IS NULL OR outcome = 'en_discussion')
         ORDER BY datetime(created_at) DESC
         LIMIT ?`,
      )
      .all(opts.draftLimit ?? DRAFT_PER_RUN) as ProspectRowDb[];

    for (const p of draftables) {
      report.drafted.tried++;
      try {
        const mail = await draftOne(p);
        if (!mail) break; // no API key: skip the whole drafting stage quietly
        // 'a_mailer' is what the reservoir counts as ready; the status guard
        // keeps a row a human moved meanwhile out of our hands.
        const r = db
          .prepare(
            `UPDATE prospects SET mail_subject_en = ?, mail_body_en = ?, mail_subject_fr = ?, mail_body_fr = ?,
               recommended_lang = ?, status = 'a_mailer', updated_at = datetime('now')
             WHERE id = ? AND status = 'a_enrichir'`,
          )
          .run(
            mail.subjectEn,
            mail.bodyEn,
            mail.subjectFr,
            mail.bodyFr,
            recommendedLang(p.country),
            p.id,
          );
        if (r.changes > 0) report.drafted.written++;
      } catch (err) {
        report.errors.push(`draft ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // -- 3. customer identities (Clients tab gap of 19/08) ------------------
    const clients = await enrichClientCompanies(opts.clientLimit ?? CLIENT_ENRICH_PER_RUN);
    report.clients = {
      tried: clients.tried,
      identified: clients.identified,
      unresolved: clients.unresolved,
    };
    report.errors.push(...clients.errors);

    if (report.enriched.found + report.drafted.written + clients.identified > 0) {
      try {
        await sendTelegramShort(
          `🌱 Prospects IBANforge : ${report.enriched.found} adresse(s) trouvée(s), ${report.drafted.written} brouillon(s) prêt(s)` +
            (clients.identified > 0 ? `, ${clients.identified} client(s) identifié(s)` : '') +
            '.',
        );
      } catch (err) {
        report.errors.push(`telegram: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    report.finished_at = new Date().toISOString();
    kvSet(KV_LAST_REPORT, JSON.stringify(report));
    kvSet(KV_LAST_RUN, report.finished_at);
    console.log(
      `[prospect-radar] ${report.enriched.found}/${report.enriched.tried} adresses, ` +
        `${report.drafted.written}/${report.drafted.tried} brouillons, ` +
        `${clients.identified}/${clients.tried} clients identifiés, ${report.errors.length} erreur(s)`,
    );
    return report;
  } finally {
    running = false;
  }
}

export function lastProspectBackfillReport(): {
  last_run_at: string | null;
  report: BackfillReport | null;
} {
  let parsed: BackfillReport | null;
  try {
    parsed = JSON.parse(kvGet(KV_LAST_REPORT) ?? 'null') as BackfillReport | null;
  } catch {
    parsed = null;
  }
  return { last_run_at: kvGet(KV_LAST_RUN) ?? null, report: parsed };
}

export function isProspectBackfillRunning(): boolean {
  return running;
}

/** Hourly tick; a run at most every 6 h. Never throws upward. */
export function startProspectRadar(): void {
  const tick = async (): Promise<void> => {
    try {
      const last = kvGet(KV_LAST_RUN);
      if (last && Date.now() - new Date(last).getTime() < DUE_AFTER_MS) return;
      await runProspectBackfill();
    } catch (err) {
      console.error('[prospect-radar] run failed:', err instanceof Error ? err.message : err);
    }
  };
  setTimeout(() => void tick(), BOOT_DELAY_MS).unref();
  setInterval(() => void tick(), TICK_MS).unref();
}
