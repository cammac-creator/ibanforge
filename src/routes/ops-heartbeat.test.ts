/**
 * La porte de l'homme mort.
 *
 * Cette route existe parce qu'un workflow qui NE TOURNE PAS n'échoue jamais :
 * aucune notification n'existe ni ne peut exister pour un run qui n'a pas eu
 * lieu (`refresh-bic` a sauté mai ET juin 2026 en silence, audit D2). Les crons
 * pointent donc ici, et le backend crie quand un battement se périme.
 *
 * Ce que ce fichier garde, dans l'ordre d'importance :
 *
 * 1. **Elle refuse tout sans jeton.** Si elle s'ouvrait, n'importe qui pourrait
 *    pointer à la place d'un cron mort — l'exact contraire du but : la sonde
 *    confirmerait la vie de ce qu'elle surveille.
 * 2. **Le jeton est `HEARTBEAT_TOKEN`, jamais `ADMIN_SECRET`.** Le dépôt est
 *    public, et `ADMIN_SECRET` ouvre le dashboard et le registre client. Le
 *    test le vérifie explicitement, parce que « réutiliser la variable qui
 *    existe déjà » est la pente naturelle et qu'elle est ici interdite.
 * 3. **Liste blanche des noms.** Un nom libre poserait un battement que
 *    `checkHeartbeats()` ne regarde jamais : un homme mort qu'on croit posé et
 *    qui ne surveille rien est pire que pas d'homme mort.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { buildApp } from '../app.js';
import { HEARTBEATS } from '../lib/ops-alert.js';
import { kvGet } from '../lib/forum-radar-server.js';

// Notre propre seau dans le limiteur de débit en mémoire (100 req/min par IP,
// partagé par toute la suite). TEST-NET-3, jamais routable.
const IP = '203.0.113.77';
const TOKEN = 'hb_test_only_not_a_real_secret';

const app = buildApp();
const ORIGINAL = process.env.HEARTBEAT_TOKEN;

async function post(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.request(path, { method: 'POST', headers: { 'x-real-ip': IP, ...headers } });
}

beforeEach(() => {
  process.env.HEARTBEAT_TOKEN = TOKEN;
});

afterAll(() => {
  if (ORIGINAL === undefined) delete process.env.HEARTBEAT_TOKEN;
  else process.env.HEARTBEAT_TOKEN = ORIGINAL;
});

describe('POST /internal/heartbeat/:name — la porte', () => {
  it('refuse sans jeton', async () => {
    expect((await post('/internal/heartbeat/weekly-veille')).status).toBe(401);
  });

  it('refuse un mauvais jeton', async () => {
    expect((await post('/internal/heartbeat/weekly-veille', { 'x-heartbeat-token': 'wrong' })).status).toBe(401);
  });

  it('refuse un jeton de la bonne longueur mais faux (comparaison à temps constant)', async () => {
    const sameLength = 'x'.repeat(TOKEN.length);
    expect((await post('/internal/heartbeat/weekly-veille', { 'x-heartbeat-token': sameLength })).status).toBe(401);
  });

  it("refuse tout quand HEARTBEAT_TOKEN n'est pas posé — jamais ouverte par défaut", async () => {
    delete process.env.HEARTBEAT_TOKEN;
    expect((await post('/internal/heartbeat/weekly-veille', { 'x-heartbeat-token': TOKEN })).status).toBe(401);
    // Et surtout : une valeur vide ne doit pas non plus ouvrir la porte.
    process.env.HEARTBEAT_TOKEN = '';
    expect((await post('/internal/heartbeat/weekly-veille', { 'x-heartbeat-token': '' })).status).toBe(401);
  });

  it("n'accepte PAS ADMIN_SECRET — mauvais rayon d'explosion sur un dépôt public", async () => {
    const admin = 'admin_secret_test_value';
    const previous = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = admin;
    try {
      expect((await post('/internal/heartbeat/weekly-veille', { 'x-heartbeat-token': admin })).status).toBe(401);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = previous;
    }
  });

  it('refuse un nom hors liste blanche, même avec le bon jeton', async () => {
    const res = await post('/internal/heartbeat/pas-un-cron', { 'x-heartbeat-token': TOKEN });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe('unknown_heartbeat');
  });
});

describe('POST /internal/heartbeat/:name — le battement', () => {
  it('accepte les quatre crons déclarés et écrit leur battement dans kv_state', async () => {
    // La liste blanche EST le contrat : les noms des étapes YAML doivent lui
    // correspondre exactement, sinon le cron pointe dans le vide.
    expect(HEARTBEATS.map((h) => h.name).sort()).toEqual([
      'refresh-bic',
      'refresh-compliance',
      'weekly-reco-baseline',
      'weekly-veille',
    ]);

    for (const h of HEARTBEATS) {
      const before = Date.now();
      const res = await post(`/internal/heartbeat/${h.name}`, { 'x-heartbeat-token': TOKEN });
      expect(res.status, `${h.name} refusé`).toBe(200);
      expect(await res.json()).toEqual({ ok: true, name: h.name });

      const beat = Number(kvGet(`ops:beat:${h.name}`));
      expect(Number.isFinite(beat), `aucun battement écrit pour ${h.name}`).toBe(true);
      expect(beat).toBeGreaterThanOrEqual(before - 1000);
    }
  });

  it('chaque seuil laisse une marge franche sur la cadence du cron', () => {
    // Le but est de détecter une automatisation QUI NE TOURNE PLUS, pas une qui
    // traîne : un seuil serré transformerait un runner GitHub lent en fausse
    // alerte, et trois fausses alertes suffisent à faire couper les alertes.
    const byName = new Map(HEARTBEATS.map((h) => [h.name, h.maxAgeMs]));
    const DAY = 24 * 3600_000;
    expect(byName.get('weekly-veille')).toBeGreaterThanOrEqual(8 * DAY);
    expect(byName.get('weekly-reco-baseline')).toBeGreaterThanOrEqual(8 * DAY);
    expect(byName.get('refresh-compliance')).toBeGreaterThanOrEqual(8 * DAY);
    // Mensuel : il faut couvrir un mois long ET un runner en retard.
    expect(byName.get('refresh-bic')).toBeGreaterThanOrEqual(32 * DAY);
  });
});
