#!/usr/bin/env node
/**
 * Ping IndexNow after publishing content, so Bing/Copilot-family engines and
 * the other IndexNow participants (7 as of 2026, incl. Internet Archive) see
 * new URLs in minutes instead of at the next crawl. Microsoft's 2026-02-10
 * post ties IndexNow directly to AI answers.
 *
 * Usage:
 *   node scripts/indexnow-ping.mjs https://ibanforge.com/en/blog/my-post [more URLs…]
 *   node scripts/indexnow-ping.mjs --sitemap        # every URL of the live sitemap
 *
 * The sitemap mode exists since 2026-09-06: the only signup of the fortnight
 * came from Bing, the register and country pages number in the thousands,
 * and a weekly resubmission (see .github/workflows/indexnow.yml) is how they
 * get looked at. Google does not take IndexNow; it reads the sitemap.
 */
const KEY = '30fa164b3376b422e39a5e3d2f7b91de';
const HOST = 'ibanforge.com';
const MAX_PER_CALL = 10_000;

let urls = process.argv.slice(2);
if (urls[0] === '--sitemap') {
  const res = await fetch(`https://${HOST}/sitemap.xml`);
  if (!res.ok) {
    console.error(`sitemap: ${res.status}`);
    process.exit(1);
  }
  const xml = await res.text();
  urls = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  console.log(`sitemap: ${urls.length} URLs`);
}
if (urls.length === 0) {
  console.error('usage: node scripts/indexnow-ping.mjs <url> [url…] | --sitemap');
  process.exit(1);
}
let failed = false;
for (let i = 0; i < urls.length; i += MAX_PER_CALL) {
  const chunk = urls.slice(i, i + MAX_PER_CALL);
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: `https://${HOST}/${KEY}.txt`,
      urlList: chunk,
    }),
  });
  console.log(`IndexNow: ${chunk.length} URLs → ${res.status} ${res.statusText}`);
  if (!res.ok) failed = true;
}
if (failed) process.exit(1);
