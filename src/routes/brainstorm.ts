import { Hono } from 'hono';
import { basicAuth } from 'hono/basic-auth';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const brainstorm = new Hono();

// Basic auth : credentials from env
const username = process.env.BRAINSTORM_USER || 'alain';
const password = process.env.BRAINSTORM_PASSWORD;

brainstorm.use('*', async (c, next) => {
  if (!password) {
    return c.text('BRAINSTORM_PASSWORD not set — endpoint disabled', 503);
  }
  const auth = basicAuth({ username, password });
  return auth(c, next);
});

// Resolve path relative to this file (works both in dist/ and src/)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedHtml: string | null = null;

function loadHtml(): string {
  if (cachedHtml) return cachedHtml;
  // When compiled, file lives at dist/routes/brainstorm.js
  // HTML stays at src/private/brainstorm.html — copied next to dist via postbuild
  const candidates = [
    resolve(__dirname, '../private/brainstorm.html'),      // dist/private
    resolve(__dirname, '../../src/private/brainstorm.html'), // dev src
    resolve(process.cwd(), 'src/private/brainstorm.html'),   // fallback
    resolve(process.cwd(), 'dist/private/brainstorm.html'),  // fallback compiled
  ];
  for (const p of candidates) {
    try {
      cachedHtml = readFileSync(p, 'utf-8');
      return cachedHtml;
    } catch (_) { /* try next */ }
  }
  throw new Error('brainstorm.html not found — check paths');
}

brainstorm.get('/', (c) => {
  try {
    const html = loadHtml();
    return c.html(html);
  } catch (e) {
    return c.text('Failed to load brainstorm page: ' + (e as Error).message, 500);
  }
});

export { brainstorm };
