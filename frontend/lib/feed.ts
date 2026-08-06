import fs from 'fs';
import path from 'path';
import { getAllPosts, type BlogPost } from './blog';

/**
 * RSS 2.0 + Atom feeds for the blog and the release changelog.
 *
 * Why these exist: rss.xml / atom.xml / feed.xml all answered 404 (measured
 * 2026-08-06) while feed readers, content aggregators and AI-retrieval
 * crawlers subscribe to exactly these paths. The feeds are rebuilt on every
 * deploy (force-static route handlers), which matches how content ships here:
 * articles and releases only ever arrive through a deployment.
 *
 * The English post is the canonical entry; every item links its /en/ URL.
 */

const SITE = 'https://ibanforge.com';
const TITLE = 'IBANforge — blog & releases';
const DESCRIPTION =
  'IBAN validation, bank-register data quality, Swiss clearing, SEPA and Verification of Payee — articles and release notes from IBANforge.';

interface FeedItem {
  title: string;
  url: string;
  date: Date;
  description: string;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Blog posts, newest first (getAllPosts already sorts). */
function blogItems(): FeedItem[] {
  return getAllPosts('en').map((p: BlogPost) => ({
    title: p.title,
    url: `${SITE}/en/blog/${p.slug}`,
    date: new Date(p.date),
    description: p.description,
  }));
}

/**
 * Release entries parsed from the repo-root CHANGELOG.md ("## [1.4.3] — 2026-08-06").
 * The file sits one level above the frontend root; if a future build isolates
 * the frontend directory the feed silently degrades to blog-only rather than
 * failing the build.
 */
function changelogItems(): FeedItem[] {
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), '..', 'CHANGELOG.md'), 'utf-8');
    const items: FeedItem[] = [];
    const re = /^## \[(\d+\.\d+\.\d+)\][^\S\n]*[—–-][^\S\n]*(\d{4}-\d{2}-\d{2})/gm;
    for (const m of raw.matchAll(re)) {
      items.push({
        title: `Release ${m[1]}`,
        url: `${SITE}/en/changelog`,
        date: new Date(m[2]),
        description: `IBANforge ${m[1]} — full notes on the changelog page.`,
      });
    }
    return items;
  } catch {
    return [];
  }
}

function allItems(): FeedItem[] {
  return [...blogItems(), ...changelogItems()]
    .filter((i) => !Number.isNaN(i.date.getTime()))
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 50);
}

export function buildRss(): string {
  const items = allItems()
    .map(
      (i) => `    <item>
      <title>${esc(i.title)}</title>
      <link>${esc(i.url)}</link>
      <guid isPermaLink="false">${esc(`${i.url}#${i.date.toISOString().slice(0, 10)}`)}</guid>
      <pubDate>${i.date.toUTCString()}</pubDate>
      <description>${esc(i.description)}</description>
    </item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(TITLE)}</title>
    <link>${SITE}</link>
    <description>${esc(DESCRIPTION)}</description>
    <language>en</language>
    <ttl>1440</ttl>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

export function buildAtom(): string {
  const list = allItems();
  const updated = (list[0]?.date ?? new Date(0)).toISOString();
  const items = list
    .map(
      (i) => `  <entry>
    <title>${esc(i.title)}</title>
    <link href="${esc(i.url)}"/>
    <id>${esc(`${i.url}#${i.date.toISOString().slice(0, 10)}`)}</id>
    <updated>${i.date.toISOString()}</updated>
    <summary>${esc(i.description)}</summary>
  </entry>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>${esc(TITLE)}</title>
  <link href="${SITE}"/>
  <link href="${SITE}/atom.xml" rel="self"/>
  <id>${SITE}/</id>
  <updated>${updated}</updated>
${items}
</feed>
`;
}
