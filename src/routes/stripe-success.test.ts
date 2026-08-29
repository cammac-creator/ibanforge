import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { stripeSuccess } from './stripe-success.js';
import {
  ACCOUNT_PAGE,
  FIRST_CALL_ENDPOINT,
  FIRST_CALL_EXPECTED_LINE_1,
  FIRST_CALL_EXPECTED_LINE_2,
  FIRST_CALL_IBAN,
} from '../lib/first-call.js';

/**
 * This page is the first thing a buyer sees after paying, and since the
 * first-call block was factored out it renders constants that live in another
 * file. That is a coupling nothing else guards.
 *
 * The dangerous shape is precise: the constants are interpolated by TypeScript
 * into a JS string literal delimited by SINGLE quotes, inside a <script>, inside
 * a template literal. An apostrophe added to one of those constants tomorrow
 * would close the string early and break the page with a syntax error, in the
 * browser, for a customer who has just been charged, while every other test in
 * the suite stayed green.
 */
async function render(): Promise<string> {
  const app = new Hono();
  app.route('/', stripeSuccess);
  const res = await app.request('/stripe/success');
  expect(res.status).toBe(200);
  return res.text();
}

describe('GET /stripe/success', () => {
  it('serves the same first-call block as the delivery emails', async () => {
    const html = await render();
    expect(html).toContain(FIRST_CALL_ENDPOINT);
    expect(html).toContain(FIRST_CALL_IBAN);
    expect(html).toContain(FIRST_CALL_EXPECTED_LINE_1);
    expect(html).toContain(FIRST_CALL_EXPECTED_LINE_2);
    expect(html).toContain(ACCOUNT_PAGE);
  });

  it('keeps the interpolated constants free of apostrophes', async () => {
    // Not a style rule: an apostrophe here is a JS syntax error on the page.
    for (const line of [FIRST_CALL_EXPECTED_LINE_1, FIRST_CALL_EXPECTED_LINE_2, ACCOUNT_PAGE, FIRST_CALL_ENDPOINT, FIRST_CALL_IBAN]) {
      expect(line, `"${line}" is inlined into a single-quoted JS string`).not.toContain("'");
      expect(line).not.toContain('\\');
    }
  });

  it('still renders a page a browser can parse', async () => {
    const html = await render();
    // Cheap structural checks: the script block opens and closes once, and the
    // key placeholder the client script fills is still wired up.
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).toContain('/v1/stripe/key/');
    expect(html).toContain('Authorization: Bearer ');
  });
});
