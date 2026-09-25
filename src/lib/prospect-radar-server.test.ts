import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draftOne, enrichClientCompanies } from './prospect-radar-server.js';
import type { ProspectForMail } from './prospect-radar.js';
import { generateApiKey } from './api-keys.js';
import { getStatsDB } from './db.js';

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

describe('compteur de dépense du radar', () => {
  beforeEach(() => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('écrit les jetons de chaque génération au journal, jamais son texte', async () => {
    const body = {
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: FULL_OUTPUT }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1830, output_tokens: 412 },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
      ),
    );
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await draftOne(PROSPECT);

    const lines = info.mock.calls.map((c) => String(c[0])).filter((l) => l.startsWith('[usage]'));
    expect(lines).toEqual([
      '[usage] site=prospect-radar model=claude-sonnet-5 input_tokens=1830 output_tokens=412 cache_write=0 cache_read=0 web_search=0',
    ]);
  });
});

describe('le palier anonyme ne produit aucune fiche de prospection', () => {
  it('une clé anonyme n’est pas un candidat ; la même clé au palier gratuit en est un', async () => {
    // 🚨 Le défaut que ce test ferme. La sentinelle du palier anonyme n'est pas
    // interne (elle ne matche aucun terme de la liste des comptes internes),
    // donc elle deviendrait UN prospect unique agrégeant les préfixes de toutes
    // les clés anonymes. Et comme une adresse sans arobase n'a pas de domaine,
    // l'identification basculerait sur le user-agent : un agent de collecte
    // partirait sur le site du premier client venu.
    const db = getStatsDB();
    db.prepare('DELETE FROM api_keys').run();
    const anon = generateApiKey(null, undefined, undefined, false, { ipHash: 'prospect-anon' });
    expect(anon).not.toBeNull();

    const nothing = await enrichClientCompanies(5);
    expect(nothing.tried).toBe(0);
    expect(nothing.unresolved).toBe(0);
    const noProfile = (
      db.prepare("SELECT COUNT(*) AS n FROM company_profiles WHERE email = 'anonymous'").get() as {
        n: number;
      }
    ).n;
    expect(noProfile).toBe(0);

    // Le jumeau POSITIF, sans réseau : la MÊME ligne au palier gratuit devient
    // un candidat. Sans lui, un vert ne prouverait qu'une requête cassée.
    // Aucun appel sortant n'est possible ici — la sentinelle n'a ni domaine ni
    // user-agent, donc la boucle la classe « non résolue » et s'arrête là.
    db.prepare("UPDATE api_keys SET tier = 'email' WHERE key_prefix = ?").run(anon!.key_prefix);
    const found = await enrichClientCompanies(5);
    expect(found.tried).toBe(1);
    expect(found.unresolved).toBe(1);
  });
});
