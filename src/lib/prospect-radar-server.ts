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
  PROSPECT_MAIL_SYSTEM,
  buildProspectMailPrompt,
  extractEmails,
  parseProspectMail,
  pickEmail,
  recommendedLang,
  type ProspectForMail,
  type ProspectMail,
} from './prospect-radar.js';

const TICK_MS = 60 * 60 * 1000;
const BOOT_DELAY_MS = 4 * 60 * 1000; // offset from the lifecycle (5') and forum (3') radars
const DUE_AFTER_MS = 6 * 60 * 60 * 1000;
const ENRICH_PER_RUN = 6;
const DRAFT_PER_RUN = 6;
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
  errors: string[];
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'ibanforge-radar/1.0 (+https://ibanforge.com)', Accept: 'text/html' },
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
export async function enrichOne(website: string): Promise<{ email: string; sourceUrl: string } | null> {
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

/** One Anthropic call, one EN+FR mail. Null when no API key is configured. */
export async function draftOne(p: ProspectForMail): Promise<ProspectMail | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';
  if (!apiKey) return null;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1500,
      system: PROSPECT_MAIL_SYSTEM,
      messages: [{ role: 'user', content: buildProspectMailPrompt(p) }],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Anthropic HTTP ${res.status}: ${detail.slice(0, 120)}`);
  }
  const data = (await res.json()) as { content?: Array<{ type: string; text?: string }>; stop_reason?: string };
  const text = (data.content ?? []).map((c) => c.text ?? '').join('');
  const mail = parseProspectMail(text);
  if (!mail) throw new Error(`mail generation unparseable (stop_reason=${data.stop_reason ?? '?'})`);
  return {
    subjectEn: stripDashes(mail.subjectEn),
    bodyEn: stripDashes(mail.bodyEn),
    subjectFr: stripDashes(mail.subjectFr),
    bodyFr: stripDashes(mail.bodyFr),
  };
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
  opts: { enrichLimit?: number; draftLimit?: number } = {},
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
        }
      } catch (err) {
        report.errors.push(`enrich ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    kvSet(KV_MISSES, JSON.stringify(misses));

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
          .run(mail.subjectEn, mail.bodyEn, mail.subjectFr, mail.bodyFr, recommendedLang(p.country), p.id);
        if (r.changes > 0) report.drafted.written++;
      } catch (err) {
        report.errors.push(`draft ${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (report.enriched.found + report.drafted.written > 0) {
      try {
        await sendTelegramShort(
          `🌱 Prospects IBANforge : ${report.enriched.found} adresse(s) trouvée(s), ${report.drafted.written} brouillon(s) prêt(s) à relire dans le CRM.`,
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
        `${report.drafted.written}/${report.drafted.tried} brouillons, ${report.errors.length} erreur(s)`,
    );
    return report;
  } finally {
    running = false;
  }
}

export function lastProspectBackfillReport(): { last_run_at: string | null; report: BackfillReport | null } {
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
