import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftOne } from './prospect-radar-server.js';
import type { ProspectForMail } from './prospect-radar.js';

const PROSPECT: ProspectForMail = {
  id: 'p_test',
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

const FULL_OUTPUT = [
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

/** Truncated mid-generation: BODY_FR opened, ===END=== never emitted. */
const TRUNCATED_OUTPUT = FULL_OUTPUT.slice(0, FULL_OUTPUT.indexOf('===END==='));

function anthropicResponse(text: string, stopReason: string): Response {
  return new Response(
    JSON.stringify({
      content: [
        { type: 'thinking', thinking: 'reasoning tokens' },
        { type: 'text', text },
      ],
      stop_reason: stopReason,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('draftOne retry on unparseable generation', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('retries once when the first generation is truncated, then parses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(anthropicResponse(TRUNCATED_OUTPUT, 'max_tokens'))
      .mockResolvedValueOnce(anthropicResponse(FULL_OUTPUT, 'end_turn'));
    vi.stubGlobal('fetch', fetchMock);

    const mail = await draftOne(PROSPECT);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mail).not.toBeNull();
    expect(mail?.subjectEn).toBe('sepa exports from alpha');
    expect(mail?.bodyFr).toContain('Corps FR.');
  });

  it('throws with the stop_reason after two unparseable generations', async () => {
    // A fresh Response per call: a body only reads once.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(anthropicResponse(TRUNCATED_OUTPUT, 'max_tokens')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(draftOne(PROSPECT)).rejects.toThrow(/unparseable \(stop_reason=max_tokens\)/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
