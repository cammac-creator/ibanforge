#!/usr/bin/env node
/**
 * Ping IndexNow after publishing content, so Bing/Copilot-family engines and
 * the other IndexNow participants (7 as of 2026, incl. Internet Archive) see
 * new URLs in minutes instead of at the next crawl. Microsoft's 2026-02-10
 * post ties IndexNow directly to AI answers.
 *
 * Usage: node scripts/indexnow-ping.mjs https://ibanforge.com/en/blog/my-post [more URLs…]
 */
const KEY = '30fa164b3376b422e39a5e3d2f7b91de';
const HOST = 'ibanforge.com';

const urls = process.argv.slice(2);
if (urls.length === 0) {
  console.error('usage: node scripts/indexnow-ping.mjs <url> [url…]');
  process.exit(1);
}
const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: urls,
  }),
});
console.log('IndexNow:', res.status, res.statusText);
if (!res.ok) process.exit(1);
