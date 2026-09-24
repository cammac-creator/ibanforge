import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { closeAll } from '../lib/db.js';
import { REST_TRIAL_WEEKLY_LIMIT, TRIAL_RESET, trialResetsAt } from './trial.js';
import { MCP_DAILY_LIMIT } from './mcp-limits.js';

/**
 * Le chiffre de l'essai, tel qu'il est SERVI.
 *
 * Ce garde pilote les vraies routes, comme `src/routes/example-emails.test.ts`
 * pilote la vraie route d'inscription. Motif : le 10 de l'essai a vécu sur cinq
 * surfaces à la fois, dont un `example: 10` dans le contrat OpenAPI qu'aucune
 * relecture de prose ne voit passer. Un chiffre publié qui n'est pas celui
 * qu'applique le middleware est une promesse fausse, et personne ne s'en
 * aperçoit avant un client.
 *
 * 🚨 Les deux chiffres sont DIFFÉRENTS depuis le 15/09/2026 (REST 25, MCP 10),
 * donc chaque motif dit lequel il attend : un garde qui accepterait « l'un ou
 * l'autre » laisserait passer la confusion même qu'il existe pour empêcher.
 * Et depuis le 24/09/2026 ils n'ont plus la même UNITÉ (REST par semaine, MCP
 * par jour) : chaque motif porte aussi la sienne.
 *
 * Les corps sont comparés espaces NORMALISÉS : une phrase servie peut être
 * coupée par prettier ou par un retour à la ligne YAML sans que sa promesse
 * change.
 */

const app = buildApp();

afterAll(() => closeAll());

async function body(path: string): Promise<string> {
  const res = await app.request(`https://api.ibanforge.com${path}`);
  expect(res.status, `${path} doit répondre 200`).toBe(200);
  return (await res.text()).replace(/\s+/g, ' ');
}

const SERVED = [
  {
    path: '/llms.txt',
    pattern: /\((?<n>\d+) free validations a week per source address\)/,
    expect: 'REST',
  },
  {
    path: '/llms.txt',
    pattern: /Past (?<n>\d+) in the week the route goes back to 402/,
    expect: 'REST',
  },
  {
    path: '/llms.txt',
    pattern: /own allowance, counted by the day \((?<n>\d+) tool calls\/day\)/,
    expect: 'MCP',
  },
  { path: '/llms.txt', pattern: /\((?<n>\d+) free tool calls\/day per IP\)/, expect: 'MCP' },
  {
    path: '/.well-known/rate-limits.yml',
    pattern: /rest_anonymous_trial: requests: (?<n>\d+) window: 1 week/,
    expect: 'REST',
  },
  {
    path: '/.well-known/rate-limits.yml',
    pattern: /mcp_anonymous: requests: (?<n>\d+)/,
    expect: 'MCP',
  },
  {
    path: '/.well-known/auth.md',
    pattern: /is served (?<n>\d+) times per source address per week/,
    expect: 'REST',
  },
  {
    path: '/.well-known/auth.md',
    pattern: /answers (?<n>\d+) full tool calls per IP per day/,
    expect: 'MCP',
  },
  {
    path: '/openapi.json',
    pattern: /the first (?<n>\d+) calls a week from one source address/,
    expect: 'REST',
  },
  {
    path: '/openapi.json',
    pattern: /no API key is served (?<n>\d+) times a week per source address/,
    expect: 'REST',
  },
  // 🚨 L'exemple du schéma : un NOMBRE dans le JSON, invisible pour toute garde
  // de prose. C'est celui qui est resté à 10 le plus longtemps.
  {
    path: '/openapi.json',
    pattern: /"weekly_limit":\{"type":"integer","example":(?<n>\d+)\}/,
    expect: 'REST',
  },
] as const;

describe('les chiffres servis par du code', () => {
  it.each(SERVED)('$path — $pattern', async ({ path, pattern, expect: which }) => {
    const text = await body(path);
    const found = text.match(pattern);
    // 🚨 Assertion 2 de la spec, et c'est le seul mécanisme qui empêche un
    // garde de pourrir en silence : sans elle, reformuler la phrase ferait
    // passer le test au vert en ne vérifiant plus rien.
    expect(found, `motif introuvable sur ${path} — la phrase a été reformulée`).not.toBeNull();
    const wanted = which === 'REST' ? REST_TRIAL_WEEKLY_LIMIT : MCP_DAILY_LIMIT;
    expect(Number(found?.groups?.n)).toBe(wanted);
  });

  it('publie le bloc trial sur /v1, avec les deux plafonds et leur unité', async () => {
    const res = await app.request('https://api.ibanforge.com/v1');
    const json = (await res.json()) as {
      trial?: Record<string, unknown> & {
        weekly_limit?: number;
        period?: string;
        mcp_daily_limit?: number;
        resets?: string;
        resets_at?: string;
      };
    };
    expect(json.trial?.weekly_limit).toBe(REST_TRIAL_WEEKLY_LIMIT);
    expect(json.trial?.period).toBe('week');
    expect(json.trial?.mcp_daily_limit).toBe(MCP_DAILY_LIMIT);
    expect(json.trial?.resets).toBe(TRIAL_RESET);
    expect(json.trial?.resets_at).toBe(trialResetsAt());
    // 🚨 `daily_limit` aurait porté un chiffre de la semaine sous un nom du jour.
    expect(json.trial).not.toHaveProperty('daily_limit');
  });

  it('sert le bloc trial de l’OpenAPI sans aucun champ du jour', async () => {
    const text = await body('/openapi.json');
    expect(text).not.toMatch(/"calls_used_today"|"calls_left_today"|"daily_limit":\{/);
  });

  it('annonce le même plafond MCP dans les instructions de initialize', async () => {
    const res = await app.request('https://api.ibanforge.com/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        'x-real-ip': '198.51.100.31',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'trial-figures', version: '1.0.0' },
        },
      }),
    });
    expect(res.status).toBe(200);
    const text = (await res.text()).replace(/\s+/g, ' ');
    const found = text.match(/Free tier: (?<n>\d+) tool calls\/IP\/day/);
    expect(found, 'la phrase des instructions MCP a été reformulée').not.toBeNull();
    expect(Number(found?.groups?.n)).toBe(MCP_DAILY_LIMIT);
  });
});

/**
 * Le garde frère de `trial-figures-static.test.ts`, sur les surfaces SERVIES :
 * depuis le 24/09/2026, aucune phrase qui parle de l'essai ne relie plus un
 * chiffre au jour. Les motifs exacts ci-dessus ne voient qu'une phrase chacun ;
 * celui-ci voit toutes les autres, y compris celle qu'on écrira demain.
 *
 * Deux quotas du jour vivent dans les mêmes textes et gardent leur chiffre : le
 * MCP hébergé, reconnu à sa phrase et à sa valeur, et la création de clés
 * (« per network »). L'unité est lue par phrase, pas par ligne : l'OpenAPI et
 * la carte MCP sont du JSON sur une seule ligne.
 */
describe('les surfaces servies ne comptent plus l’essai au jour', () => {
  const DAILY =
    /(?<![.,\d$/])(\d+)(?![.,]?\d)(?![kK])[^\d\n]{0,40}?(?:\ba day\b|\bper day\b|\/day\b|\/IP\/day\b)/gi;
  const ABOUT_TRIAL = /keyless|trial|no key|without a key/i;
  const OTHER = /\bMCP\b|tool calls?|tool units?|per network|keys? per/i;

  it.each([
    '/llms.txt',
    '/openapi.json',
    '/.well-known/auth.md',
    '/.well-known/rate-limits.yml',
    '/.well-known/mcp/server-card.json',
    '/v1',
  ])('%s', async (path) => {
    const text = await body(path);
    const offenders: string[] = [];
    let seen = 0;
    for (const sentence of text.split(/(?<=[.!?])\s+/)) {
      if (!ABOUT_TRIAL.test(sentence)) continue;
      seen += 1;
      for (const m of sentence.matchAll(DAILY)) {
        const value = Number(m[1]);
        if (value === MCP_DAILY_LIMIT && OTHER.test(sentence)) continue;
        if (/per network|keys? per/i.test(sentence)) continue;
        if (value === REST_TRIAL_WEEKLY_LIMIT || !OTHER.test(sentence)) {
          offenders.push(`${value} par jour : ${sentence.slice(0, 180)}`);
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
    // Un balayage qui ne voit aucune phrase sur l'essai ne prouve rien.
    expect(seen, `aucune phrase sur l'essai dans ${path}`).toBeGreaterThan(0);
  });

  it('attrape la régression qu’il existe pour attraper', () => {
    const sentence = 'Keyless trial: 25 validations a day per source address.';
    expect([...sentence.matchAll(DAILY)].map((m) => Number(m[1]))).toEqual([25]);
  });
});

describe('les phrases qui ne doivent PAS être publiées', () => {
  // 🚨 « partagé par toutes les instances » n'est ni prouvable aujourd'hui ni
  // tenable demain : le service tourne sur un conteneur unique contre un volume
  // à attachement unique, et SQLite sur ce volume ne suivrait pas une seconde
  // réplique. La phrase casserait exactement le jour où elle compterait.
  // Ce qui est vrai et mesurable : le décompte SURVIT AU REDÉPLOIEMENT.
  const MEMORY_CLAIM = /in memory|per instance/i;
  const SHARING_CLAIM = /shared by every instance|across instances/i;
  // ⚠️ Le filtre de ligne n'est pas une commodité : /llms.txt dit « validation
  // runs in memory » à propos des IBAN qui ne sont jamais stockés, et cette
  // phrase-là est vraie. Un motif appliqué au fichier entier interdirait une
  // promesse de confidentialité pour attraper une promesse de comptabilité.
  const ABOUT_THE_TRIAL = /trial|allowance|keyless|validations\/day|tool calls/i;

  it.each(['/v1', '/llms.txt', '/.well-known/rate-limits.yml', '/.well-known/auth.md'])(
    '%s ne dit ni « en mémoire » ni « partagé par toutes les instances »',
    async (path) => {
      const res = await app.request(`https://api.ibanforge.com${path}`);
      expect(res.status).toBe(200);
      const lines = (await res.text()).split('\n').filter((l) => ABOUT_THE_TRIAL.test(l));
      expect(lines.length, `aucune ligne ne parle de l'essai sur ${path}`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line, path).not.toMatch(MEMORY_CLAIM);
        expect(line, path).not.toMatch(SHARING_CLAIM);
      }
    },
  );

  it('dit ce qui est vrai à la place', async () => {
    const yml = await body('/.well-known/rate-limits.yml');
    expect(yml).toMatch(/survives a redeploy/);
  });
});

/**
 * ⚠️ La cohérence des DEUX 402 de l'essai — `trial_exhausted` et
 * `trial_unavailable`, leur rail gratuit et le chiffre qu'ils citent — est
 * pilotée dans `src/middleware/anonymous-trial.test.ts` et non ici : observer un
 * 402 demande le mode payant, donc un facilitateur de substitution qui écoute
 * sur un port, et ce fichier n'a pas à en ouvrir un pour vérifier des chiffres
 * servis. Le garde reste entier, il est juste réparti selon ce que chaque
 * fichier sait déjà monter.
 */
