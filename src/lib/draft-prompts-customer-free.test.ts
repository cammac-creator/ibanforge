import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { upsertCompanyProfile } from './company-profiles.js';
import { getStatsDB } from './db.js';
import { draftSystem, generateDraft } from './forum-draft-gen.js';
import { draftOne } from './prospect-radar-server.js';
import { prospectMailSystem, type ProspectForMail } from './prospect-radar.js';

/**
 * 13 November 2026: no description of a customer enters a draft prompt.
 *
 * Until that day the two draft generators (prospecting mail, forum reply)
 * appended the validated company profiles to their user prompt, as background.
 * The operator had it removed so that the DPA's sentence on customer data
 * ("does not use Controller data to ... build marketing profiles") holds to
 * the letter. This test reads what actually leaves for the model: with a
 * profile of every source in the table, neither request carries a word of any
 * of them, and neither system prompt announces a customer block.
 */
const RUN = Date.now();
const SOURCES = ['manual', 'audit', 'site', 'ua'] as const;
const textOf = (source: string): string => `Rapproche des virements fournisseurs ${source} ${RUN}.`;

const PROSPECT: ProspectForMail = {
  id: `p_${RUN}`,
  company: 'Société Alpha',
  website: 'https://alpha.example.net',
  country: null,
  segment: 'editeurs',
  what_they_do: 'Invoice tooling with SEPA XML exports.',
  fit_reason: null,
  buying_signal: 'npm package updated this week.',
  signal_source_url: 'https://www.npmjs.com/package/alpha-example',
  personalization_hook: null,
  contact_name: null,
  contact_role: null,
};

const MAIL = [
  '===SUBJECT_EN===',
  'sepa exports from alpha',
  '===BODY_EN===',
  'Hi,\n\nBody EN.\n\nClaude-Alain Martin\nIBANforge · ibanforge.com',
  '===SUBJECT_FR===',
  'exports sepa chez alpha',
  '===BODY_FR===',
  'Bonjour,\n\nCorps FR.\n\nClaude-Alain Martin\nIBANforge · ibanforge.com',
  '===END===',
].join('\n');
const REPLY =
  '===DRAFT===\nHello there.\n===DRAFT_FR===\nBonjour.\n===SUMMARY_FR===\nRésumé.\n===END===';

/** Every request body the stubbed fetch received, as text. */
function captureRequests(answer: string): () => string[] {
  const mock = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ content: [{ type: 'text', text: answer }] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  vi.stubGlobal('fetch', mock);
  return () =>
    (mock.mock.calls as unknown as Array<[string, RequestInit]>).map(([, init]) =>
      String(init.body),
    );
}

describe('draft prompts carry nothing about a customer', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    for (const source of SOURCES) {
      upsertCompanyProfile({
        email: `${source}-${RUN}@alpha.example.net`,
        company: `Société ${source} ${RUN}`,
        whatTheyDo: textOf(source),
        source,
      });
    }
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  afterAll(() => {
    getStatsDB().prepare('DELETE FROM company_profiles WHERE email LIKE ?').run(`%-${RUN}@%`);
  });

  const expectCustomerFree = (bodies: string[]): void => {
    expect(bodies.length).toBeGreaterThan(0);
    for (const body of bodies) {
      for (const source of SOURCES) {
        expect(body).not.toContain(textOf(source));
        expect(body).not.toContain(`Société ${source} ${RUN}`);
      }
      expect(body).not.toContain('customer_context');
    }
  };

  it('the prospecting mail request holds the prospect row and no company profile', async () => {
    const bodies = captureRequests(MAIL);
    const mail = await draftOne(PROSPECT);
    expect(mail?.subjectEn).toBe('sepa exports from alpha');
    expectCustomerFree(bodies());
    // The prospect's own row is still there: the prompt was not emptied.
    expect(bodies()[0]).toContain('Invoice tooling with SEPA XML exports.');
  });

  it('the forum reply request holds the thread and no company profile', async () => {
    const bodies = captureRequests(REPLY);
    await generateDraft({
      title: 'IBAN validation fails for one country',
      excerpt: 'Our library rejects a valid IBAN.',
      url: 'https://forum.example.net/t/1',
      lang: 'en',
      source: 'forum',
      notes: '',
    });
    expectCustomerFree(bodies());
    expect(bodies()[0]).toContain('Our library rejects a valid IBAN.');
  });

  it('neither system prompt announces a customer block', () => {
    for (const system of [prospectMailSystem(), draftSystem()]) {
      expect(system).not.toContain('customer_context');
      expect(system).not.toMatch(/organisations that use the product/i);
    }
  });
});
