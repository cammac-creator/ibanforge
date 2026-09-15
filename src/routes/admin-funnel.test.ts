import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { adminFunnel } from './admin-funnel.js';
import { closeAll, getStatsDB } from '../lib/db.js';
import { generateApiKey } from '../lib/api-keys.js';

/**
 * La porte de la route, et ce que son corps promet. Les indicateurs eux-mêmes
 * sont testés sur une horloge fixée dans `src/lib/lineage-funnel.test.ts` :
 * ici on vérifie la porte, l'absence de cache et la forme du corps.
 *
 * 🚨 Toute variable d'environnement touchée est restaurée : une garde d'admin
 * laissée ouverte par un test contaminerait tous les fichiers qui suivent.
 */
vi.hoisted(() => {
  process.env.RADAR_INTERNAL_EMAILS = '';
  process.env.CRM_INTERNAL_EMAILS = '';
});

afterAll(() => closeAll());
afterEach(() => {
  vi.unstubAllEnvs();
});

const app = new Hono();
app.route('/', adminFunnel);
const headers = { 'X-Admin-Secret': 'secret-admin-fictif' };

beforeEach(() => {
  vi.stubEnv('ADMIN_SECRET', 'secret-admin-fictif');
  getStatsDB().exec('DELETE FROM lineage_facts; DELETE FROM api_keys;');
});

describe('GET /v1/admin/funnel', () => {
  it('répond 401 sans secret, et 401 avec un mauvais secret', async () => {
    const bare = await app.request('/v1/admin/funnel');
    expect(bare.status).toBe(401);
    const wrong = await app.request('/v1/admin/funnel', {
      headers: { 'X-Admin-Secret': 'pas-le-bon' },
    });
    expect(wrong.status).toBe(401);
  });

  it('ne se met jamais en cache, et rend les six indicateurs', async () => {
    const res = await app.request('/v1/admin/funnel', { headers });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body.indicators as object).sort()).toEqual([
      'attributable_purchase_30d',
      'first_result_24h',
      'paid_key_delivered',
      'paid_use_7d',
      'return_week_2',
      'unmarked_use_7d',
    ]);
    expect(body).toHaveProperty('unknown_context_share');
    expect(body).toHaveProperty('paid_link_coverage');
    expect(body).toHaveProperty('measurement_started_at');
    expect(body.window).toHaveProperty('from');
    expect(body.window).toHaveProperty('to');
  });

  it('les ajouts du chantier « mesure agents » sont là, et les six indicateurs INTACTS', async () => {
    // 🚨 Rétro-compatibilité : les six clés de `indicators` sont assertées au
    // test précédent et n'ont pas bougé. Ce test-ci ne vérifie que les AJOUTS.
    const res = await app.request('/v1/admin/funnel', { headers });
    const body = (await res.json()) as {
      by_birth_source: Array<{ name: string; lineages: number }>;
      by_first_client: Array<{ name: string }>;
      device: Record<string, unknown>;
    };
    expect(Array.isArray(body.by_birth_source)).toBe(true);
    // Liste FERMÉE : les huit familles plus le seau « jamais activée ».
    expect(body.by_first_client.map((b) => b.name)).toEqual([
      'mcp-npm',
      'sdk-ts',
      'sdk-python',
      'sdk-java',
      'sdk-dotnet',
      'browser',
      'curl',
      'other',
      '(unknown)',
      '(none)',
    ]);
    expect(Object.keys(body.device).sort()).toEqual([
      'by_door',
      'chain',
      'counters',
      'indicators',
      'lineages',
      'mcp_remote',
      'notes',
      'window_days',
    ]);
  });

  it('le corps reste un AGRÉGAT : aucun hachage, aucune adresse, aucun user_code', async () => {
    // Une lignée réelle, avec sa clé, son adresse et son préfixe : rien de tout
    // cela ne doit apparaître dans la réponse.
    const key = generateApiKey(
      `fn-agg-${Date.now()}@alpha.example.net`,
      undefined,
      'mcp-device',
      false,
      {
        ipHash: `fn-agg-${Date.now()}`,
      },
    );
    expect(key).not.toBeNull();
    const res = await app.request('/v1/admin/funnel', { headers });
    const raw = await res.text();
    expect(raw).not.toContain(key!.key_hash);
    expect(raw).not.toContain(key!.key_prefix);
    expect(raw).not.toContain('alpha.example.net');
  });

  it('un `since` mal formé est ignoré, et la réponse DIT ce qui a été demandé', async () => {
    const res = await app.request('/v1/admin/funnel?since=hier&days=7', { headers });
    const body = (await res.json()) as {
      requested: { since: string | null; days: number | null };
      window: { from: string };
    };
    expect(body.requested).toEqual({ since: 'hier', days: 7 });
    // La fenêtre par défaut, pas une fenêtre construite sur « hier ».
    expect(body.window.from).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('une lignée réelle apparaît dans la cohorte', async () => {
    const key = generateApiKey(null, undefined, undefined, false, {
      ipHash: `fn-route-${Date.now()}`,
    });
    expect(key).not.toBeNull();
    // 🚨 Reculée d'une seconde, exprès, et c'est la sémantique qui l'exige :
    // la fenêtre est fermée à droite sur l'instant d'observation, et SQLite
    // horodate à la seconde. Une lignée née DANS la seconde de la lecture n'y
    // est donc pas encore ; elle apparaît à la lecture suivante. Sans ce
    // recul, l'assertion serait vraie ou fausse selon la milliseconde.
    getStatsDB().prepare("UPDATE lineage_facts SET birth_at = datetime('now', '-1 second')").run();
    const res = await app.request('/v1/admin/funnel', { headers });
    const body = (await res.json()) as { lineages: { created: number }; window: { from: string } };
    expect(body.lineages.created).toBe(1);
  });

  it('borne la fenêtre demandée à 366 jours', async () => {
    const res = await app.request('/v1/admin/funnel?since=2026-01-01&days=99999', { headers });
    const body = (await res.json()) as { window: { from: string; to: string } };
    expect(body.window.from).toBe('2026-01-01 00:00:00');
    expect(body.window.to).toBe('2027-01-02 00:00:00');
  });
});
