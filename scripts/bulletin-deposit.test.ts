import { describe, expect, it, vi } from 'vitest';
import {
  LINE_MAX,
  VEILLE_NOTHING_READABLE,
  depositToBulletin,
  recoPayload,
  toLine,
  veilleLines,
} from './bulletin-deposit.js';
import { validateFeedPayload } from '../src/lib/bulletin-feed.js';

/**
 * Le dépôt des veilles du lundi (étape B). Textes inventés ; `fetch` simulé, rien ne
 * part sur le réseau.
 */
const RESEARCH = [
  '🧩 CE QUE DISENT LES CHIFFRES DE CONVERSION',
  '• Une lecture inventée des chiffres, avec un domaine alpha.example.net.',
  '',
  "🚪 PORTES QUI S'OUVRENT",
  '• Porte une — pourquoi maintenant. Action : agir. Source : https://alpha.example.net/1',
  '• Porte deux — pourquoi maintenant. Action : agir. Source : https://alpha.example.net/2',
  '• Porte trois — pourquoi maintenant.',
  '• Porte quatre — de trop.',
  '',
  '🔭 PISTES À CREUSER',
  '• Une piste inventée.',
].join('\n');

describe('les lignes de la veille', () => {
  it('prend les trois premières portes, jamais le bloc des chiffres', () => {
    const lines = veilleLines(RESEARCH);
    expect(lines).toEqual([
      'Porte une — pourquoi maintenant. Action : agir. Source : https://alpha.example.net/1',
      'Porte deux — pourquoi maintenant. Action : agir. Source : https://alpha.example.net/2',
      'Porte trois — pourquoi maintenant.',
    ]);
    expect(lines.join(' ')).not.toContain('lecture inventée des chiffres');
    expect(validateFeedPayload('weekly-veille', { lines })).toMatchObject({ ok: true });
  });

  it('s’arrête à la section suivante, même avec moins de trois portes', () => {
    const short = "🚪 PORTES QUI S'OUVRENT\n• Seule porte.\n\n🔭 PISTES À CREUSER\n• Une piste.";
    expect(veilleLines(short)).toEqual(['Seule porte.']);
  });

  it('dit que la recherche n’a rien rendu de lisible plutôt que de déposer du vide', () => {
    expect(
      veilleLines("🚪 PORTES QUI S'OUVRENT\n(recherche indisponible cette semaine : délai)"),
    ).toEqual([VEILLE_NOTHING_READABLE]);
    expect(veilleLines('rien du tout')).toEqual([VEILLE_NOTHING_READABLE]);
  });

  it('coupe une ligne trop longue à la limite de la route, sans caractère de contrôle', () => {
    const long = toLine(`• ${'mot '.repeat(100)}`);
    expect([...long].length).toBe(LINE_MAX);
    expect(long.endsWith('…')).toBe(true);
    expect(toLine('a\tb\u0007c')).toBe('a b c');
  });
});

describe('le dépôt de la mesure des IA', () => {
  it('donne le score et où l’on apparaît, en trois lignes au plus', () => {
    const payload = recoPayload([
      { query: 'IBAN validation API', present: true },
      { query: 'IBAN to BIC API', present: false },
      { query: 'Swiss QR-IID lookup', present: true },
      { query: 'free IBAN API for developers', present: false, error: 'délai' },
    ]);
    expect(payload).toEqual({
      lines: [
        'Présent sur : IBAN validation API ; Swiss QR-IID lookup',
        'Absent de : IBAN to BIC API',
        '1 requête en erreur : score partiel.',
      ],
      score: { value: 2, out_of: 4, errors: 1 },
    });
    expect(validateFeedPayload('weekly-reco-baseline', payload)).toMatchObject({ ok: true });
  });

  it('dit « aucune » quand rien n’apparaît', () => {
    const payload = recoPayload([{ query: 'q', present: false }]);
    expect(payload.lines[0]).toBe('Présent sur aucune des requêtes de référence lues.');
    expect(payload.score).toEqual({ value: 0, out_of: 1, errors: 0 });
  });
});

describe('depositToBulletin', () => {
  const payload = { lines: ['Une ligne inventée avec un chiffre secret 4242.'] };

  it('saute le dépôt sans jeton, avec un avertissement, sans appeler le réseau', async () => {
    const fetchImpl = vi.fn();
    const log = vi.fn();
    const out = await depositToBulletin('weekly-veille', payload, {
      apiBase: 'http://api.invalid',
      token: undefined,
      fetchImpl,
      log,
    });
    expect(out).toBe('skipped');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log.mock.calls[0][0]).toMatch(/^::warning::/);
  });

  it('envoie la charge avec le jeton, et n’écrit jamais son contenu dans le journal', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"ok":true}', { status: 200 }));
    const log = vi.fn();
    const out = await depositToBulletin('weekly-veille', payload, {
      apiBase: 'http://api.invalid',
      token: 'jeton-factice',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log,
    });
    expect(out).toBe('sent');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.invalid/internal/bulletin/weekly-veille');
    expect(init.headers).toMatchObject({ 'x-bulletin-token': 'jeton-factice' });
    expect(JSON.parse(String(init.body))).toEqual(payload);
    const written = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(written).not.toContain('4242');
    expect(written).not.toContain('jeton-factice');
  });

  it('réessaie une panne passagère, et ne fait jamais échouer le run', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 502 }))
      .mockRejectedValueOnce(new Error('coupure'))
      .mockResolvedValueOnce(new Response('', { status: 503 }));
    const log = vi.fn();
    const out = await depositToBulletin('weekly-reco-baseline', payload, {
      apiBase: 'http://api.invalid',
      token: 'jeton-factice',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      waitMs: 0,
      log,
    });
    expect(out).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(log.mock.calls.at(-1)?.[0]).toMatch(/^::warning::.*HTTP 503.*non bloquant/);
  });

  it('ne réessaie pas un refus de jeton ou de forme', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 401 }));
    const out = await depositToBulletin('weekly-veille', payload, {
      apiBase: 'http://api.invalid',
      token: 'jeton-factice',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      waitMs: 0,
      log: () => undefined,
    });
    expect(out).toBe('failed');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
