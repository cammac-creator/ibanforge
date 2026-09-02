import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { stripeSuccess } from './stripe-success.js';
import {
  ACCOUNT_PAGE,
  FIRST_CALL_ENDPOINT,
  FIRST_CALL_EXPECTED_LINE_1,
  FIRST_CALL_EXPECTED_LINE_2,
  FIRST_CALL_IBAN,
  buildFirstCallCurl,
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
    for (const line of [
      FIRST_CALL_EXPECTED_LINE_1,
      FIRST_CALL_EXPECTED_LINE_2,
      ACCOUNT_PAGE,
      FIRST_CALL_ENDPOINT,
      FIRST_CALL_IBAN,
    ]) {
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

/**
 * BIZ-08 (2026-09-01). The funnel measurement of 30/08 put the break AFTER the
 * purchase: most keys never carry a single call. This page held a working
 * command in a <pre> the buyer had to select by hand, and nothing that would
 * run it. The two buttons are the whole correction.
 */
describe('the first call is one click away', () => {
  it('offers a copy button on the command, distinct from the key one', async () => {
    const html = await render();
    expect(html).toContain('id="copybtn"'); // the key, unchanged
    expect(html).toContain('id="copycurl"'); // the command
    expect(html).toContain('Copy command');
    // Two different ids, or one listener would silently overwrite the other.
    expect(html).not.toContain('id="copybtn"><button class="copy" id="copybtn"');
  });

  it('offers a button that runs the call from the page', async () => {
    const html = await render();
    expect(html).toContain('id="runbtn"');
    expect(html).toContain('Run this call now');
    expect(html).toContain('id="runout"');
    // Same-origin relative path: this page is served by the API host, so no
    // CORS question can make a working key look broken.
    expect(html).toContain("fetch('/v1/iban/validate'");
    expect(html).toContain(`iban: '${FIRST_CALL_IBAN}'`);
  });

  /**
   * The clipboard must receive the RAW command, never the HTML-escaped one:
   * a curl full of &quot; fails in a shell, and the buyer would read that as
   * "the API does not work".
   */
  it('copies the command, not its HTML escaping', async () => {
    const html = await render();
    expect(html).toContain('navigator.clipboard.writeText(curl)');
    expect(html).toContain("'<pre id=\"curlbox\">' + escapeHtml(curl) + '</pre>'");
  });

  /**
   * The page is JS assembled inside a TypeScript template literal inside a
   * template literal, so an escaping mistake is a syntax error a customer meets
   * after being charged, while every string assertion above stays green. This
   * parses the emitted script the way a browser would.
   */
  it('emits a script that actually parses', async () => {
    const html = await render();
    const script = /<script>([\s\S]*?)<\/script>/.exec(html);
    expect(script).not.toBeNull();
    expect(() => new Function(script![1])).not.toThrow();
  });

  /**
   * The command shown and the command the emails send must be the same one.
   * Before this change the page emitted backslash-newline sequences that a JS
   * string literal swallows as line continuations, so the <pre> displayed the
   * whole curl flattened onto a single line.
   */
  it('renders the same four-line command the delivery emails carry', async () => {
    const html = await render();
    const src = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    // Lifted out of the page by its braces rather than re-implemented, so this
    // asserts the STRING the browser will build, not a copy of it.
    const start = src.indexOf('function curlFor');
    const end = src.indexOf('\n  }', start) + 4;
    expect(start).toBeGreaterThan(-1);
    const curlFor = new Function(`${src.slice(start, end)}\nreturn curlFor;`)() as (
      k: string,
    ) => string;
    const FAKE_KEY = 'ifk_' + 'a1b2c3d4'.repeat(8);
    expect(curlFor(FAKE_KEY)).toBe(buildFirstCallCurl(FAKE_KEY));
  });
});
