/**
 * Les alertes de quota réglées depuis la page du compte (chantier « compte
 * client et alertes », lot 1, 27.11.2026) : seuils, adresses ajoutées avec
 * leur code de confirmation, limites d'envoi, STOP, et la date de remise à zéro.
 *
 * Seules routes du compte qui écrivent. Elles exigent la SESSION (une clé collée
 * ne suffit pas : une clé fuite) et la propriété de la clé. Relais simulé :
 * aucun courrier ne part. Fixtures inventées (dépôt public) : example.net.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

const relay = vi.hoisted(() => ({
  sent: [] as Array<{ to: string; subject: string; text: string; html?: string }>,
}));
vi.mock('../lib/mail-transport.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/mail-transport.js')>();
  return {
    ...actual,
    deliverViaRelay: async (m: { to: string; subject: string; text: string; html?: string }) => {
      relay.sent.push(m);
      return { outcome: 'sent' as const };
    },
  };
});

import { apiKeys } from './api-keys.js';
import { getStatsDB } from '../lib/db.js';
import {
  PRO_MONTHLY_LIMIT,
  generateApiKey,
  generateCreditKey,
  generateOemKey,
  validateApiKey,
} from '../lib/api-keys.js';
import { ACCOUNT_COOKIE, createSession } from '../lib/account.js';
import { normalizeEmail } from '../lib/email-norm.js';
import {
  claimThresholdNotice,
  confirmedRecipients,
  listRecipients,
  readThresholds,
} from '../lib/quota-alerts.js';
import { VERIFICATION_SENDS_PER_EMAIL_DAY } from '../lib/key-creation-guard.js';

const ENV = { ...process.env };
const RUN = Date.now();
let seq = 0;
const SITE = 'https://ibanforge.com';

function makeApp(): Hono {
  const app = new Hono();
  app.route('/', apiKeys);
  return app;
}

/** Un titulaire neuf : une clé et une session ouverte pour son adresse. */
function holder(kind: 'free' | 'pro' = 'free') {
  seq += 1;
  const email = `holder${seq}-${RUN}@alpha.example.net`;
  const made =
    kind === 'pro'
      ? generateOemKey(email, PRO_MONTHLY_LIMIT, `cs_${RUN}_${seq}`, `sub_${RUN}_${seq}`)
      : generateApiKey(email);
  const raw = made!.api_key!;
  const { token } = createSession(normalizeEmail(email) as string, email);
  return {
    email,
    raw,
    prefix: raw.slice(0, 12),
    hash: validateApiKey(raw).keyHash,
    cookie: `${ACCOUNT_COOKIE}=${token}`,
  };
}

/** Une adresse à ajouter, d'un domaine neuf : les plafonds par domaine ne se croisent pas entre tests. */
function outsider(label = 'colleague'): string {
  seq += 1;
  return `${label}@corp${seq}-${RUN}.example.net`;
}

function post(
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
  raw?: string,
): Promise<Response> | Response {
  return makeApp().request(`https://api.ibanforge.com${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-real-ip': '203.0.113.7',
      origin: SITE,
      ...headers,
    },
    body: raw ?? JSON.stringify(body),
  });
}

const codeOf = (to: string): string => {
  const mail = [...relay.sent].reverse().find((m) => m.to === to);
  const code = mail ? /^(\d{6}) /.exec(mail.subject)?.[1] : undefined;
  if (!code) throw new Error(`aucun code pour ${to}`);
  return code;
};

beforeEach(() => {
  relay.sent.length = 0;
  delete process.env.IBANFORGE_ADMIN_TEST_KEYS;
  process.env.CORS_ORIGIN = `${SITE},https://www.ibanforge.com`;
});
afterEach(() => {
  process.env = { ...ENV };
});

const ROUTES = [
  '/v1/account/alerts/thresholds',
  '/v1/account/alerts/recipients',
  '/v1/account/alerts/recipients/confirm',
  '/v1/account/alerts/recipients/remove',
] as const;

describe('qui peut régler les alertes', () => {
  it.each(ROUTES)('%s : sans session, 401, et rien n’est écrit', async (path) => {
    const h = holder();
    const res = await post(path, {
      prefix: h.prefix,
      email: outsider(),
      code: '123456',
      thresholds: [50],
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('signed_out');
    expect(readThresholds(h.hash)).toEqual([80]);
    expect(listRecipients(h.hash)).toEqual([]);
    expect(relay.sent).toEqual([]);
  });

  it('une clé collée ne suffit pas : elle ne peut diriger aucun courrier', async () => {
    const h = holder();
    const target = outsider('victim');
    const res = await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: target },
      { Authorization: `Bearer ${h.raw}`, 'x-api-key': h.raw },
    );
    expect(res.status).toBe(401);
    expect(relay.sent).toEqual([]);
    expect(listRecipients(h.hash)).toEqual([]);
  });

  it.each(ROUTES)(
    '%s : la clé d’une AUTRE adresse répond 404, comme un préfixe inconnu',
    async (path) => {
      const mine = holder();
      const theirs = holder();
      for (const prefix of [theirs.prefix, 'ifk_unknown00']) {
        const res = await post(
          path,
          { prefix, email: outsider(), code: '123456', thresholds: [50] },
          { Cookie: mine.cookie },
        );
        expect(res.status, `${path} ${prefix}`).toBe(404);
      }
      expect(readThresholds(theirs.hash)).toEqual([80]);
      expect(relay.sent).toEqual([]);
    },
  );

  it('les gardes d’écriture du compte s’appliquent : JSON obligatoire, origine contrôlée', async () => {
    const h = holder();
    const asText = await post(
      '/v1/account/alerts/thresholds',
      null,
      { 'content-type': 'text/plain', Cookie: h.cookie },
      JSON.stringify({ prefix: h.prefix, thresholds: [50] }),
    );
    expect(asText.status).toBe(415);
    const evil = await post(
      '/v1/account/alerts/thresholds',
      { prefix: h.prefix, thresholds: [50] },
      { origin: 'https://evil.example', Cookie: h.cookie },
    );
    expect(evil.status).toBe(403);
    expect(readThresholds(h.hash)).toEqual([80]);
  });
});

describe('les seuils', () => {
  it('se règlent depuis la page et la vue d’ensemble les montre', async () => {
    const h = holder();
    const res = await post(
      '/v1/account/alerts/thresholds',
      { prefix: h.prefix, thresholds: [90, 50] },
      { Cookie: h.cookie },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ thresholds: [50, 90] });
    expect(readThresholds(h.hash)).toEqual([50, 90]);
    const overview = (await (
      await makeApp().request('/v1/account/overview', { headers: { Cookie: h.cookie } })
    ).json()) as { keys: Array<{ alert_settings: { thresholds: number[] } }> };
    expect(overview.keys[0].alert_settings.thresholds).toEqual([50, 90]);
  });

  it.each([[[]], [[95]], [['80']], [[0, 80]], ['all'], [null]])(
    'refuse %j : liste fermée, au moins un seuil',
    async (thresholds) => {
      const h = holder();
      const res = await post(
        '/v1/account/alerts/thresholds',
        { prefix: h.prefix, thresholds },
        { Cookie: h.cookie },
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('invalid_thresholds');
      expect(readThresholds(h.hash)).toEqual([80]);
    },
  );
});

describe('les adresses ajoutées', () => {
  it('le code part à la NOUVELLE adresse, sans rien du titulaire, et elle ne reçoit rien tant qu’il n’est pas saisi', async () => {
    const h = holder();
    const target = outsider();
    const res = await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: target },
      { Cookie: h.cookie },
    );
    expect(res.status).toBe(202);
    const sent = (await res.json()) as { status: string; address: string };
    expect(sent.status).toBe('code_sent');
    // L'adresse retenue (normalisée) est rendue : la page montre celle qui recevra.
    expect(sent.address).toBe(target);
    expect(relay.sent).toHaveLength(1);
    const mail = relay.sent[0];
    expect(mail.to).toBe(target);
    const everything = `${mail.subject}\n${mail.text}\n${mail.html ?? ''}`;
    // Ni l'adresse du titulaire, ni le préfixe de sa clé, ni un lien.
    expect(everything).not.toContain(h.email);
    expect(everything).not.toContain(h.prefix);
    expect(everything).not.toMatch(/https?:\/\//);
    expect(/[—–]/.test(everything)).toBe(false);
    expect(mail.text).toContain('ignore this mail');
    // En attente : rien ne lui sera envoyé.
    expect(listRecipients(h.hash)).toEqual([{ email: target, status: 'pending' }]);
    expect(confirmedRecipients(h.hash)).toEqual([]);
  });

  it('le bon code la confirme ; un mauvais code, non ; la clé d’un autre ne la confirme pas', async () => {
    const h = holder();
    const other = holder();
    const target = outsider();
    await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: target },
      { Cookie: h.cookie },
    );
    const code = codeOf(target);

    const wrong = await post(
      '/v1/account/alerts/recipients/confirm',
      { prefix: h.prefix, email: target, code: code === '000000' ? '111111' : '000000' },
      { Cookie: h.cookie },
    );
    expect(wrong.status).toBe(400);
    expect(((await wrong.json()) as { error: string }).error).toBe('invalid_code');
    expect(confirmedRecipients(h.hash)).toEqual([]);

    const stranger = await post(
      '/v1/account/alerts/recipients/confirm',
      { prefix: other.prefix, email: target, code },
      { Cookie: other.cookie },
    );
    expect(stranger.status).toBe(400);

    const ok = await post(
      '/v1/account/alerts/recipients/confirm',
      { prefix: h.prefix, email: target, code },
      { Cookie: h.cookie },
    );
    expect(ok.status).toBe(200);
    expect(confirmedRecipients(h.hash)).toEqual([target]);
  });

  it('trois adresses au plus : la quatrième est refusée et aucun code ne part', async () => {
    const h = holder();
    for (let i = 0; i < 3; i += 1) {
      const res = await post(
        '/v1/account/alerts/recipients',
        { prefix: h.prefix, email: outsider() },
        { Cookie: h.cookie },
      );
      expect(res.status).toBe(202);
    }
    relay.sent.length = 0;
    const fourth = await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: outsider() },
      { Cookie: h.cookie },
    );
    expect(fourth.status).toBe(409);
    expect(((await fourth.json()) as { error: string }).error).toBe('recipients_full');
    expect(relay.sent).toEqual([]);
    expect(listRecipients(h.hash)).toHaveLength(3);
  });

  it('se retire à tout moment, et libère la place', async () => {
    const h = holder();
    const target = outsider();
    await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: target },
      { Cookie: h.cookie },
    );
    const gone = await post(
      '/v1/account/alerts/recipients/remove',
      { prefix: h.prefix, email: target },
      { Cookie: h.cookie },
    );
    expect(gone.status).toBe(200);
    expect(await gone.json()).toEqual({ removed: true });
    expect(listRecipients(h.hash)).toEqual([]);
    const again = await post(
      '/v1/account/alerts/recipients/remove',
      { prefix: h.prefix, email: target },
      { Cookie: h.cookie },
    );
    expect(await again.json()).toEqual({ removed: false });
  });

  it('refuse l’adresse de la clé, une adresse jetable, une forme invalide', async () => {
    const h = holder();
    const own = await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: h.email },
      { Cookie: h.cookie },
    );
    expect(((await own.json()) as { error: string }).error).toBe('own_address');
    const disposable = await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: `someone-${RUN}@mailinator.com` },
      { Cookie: h.cookie },
    );
    expect(disposable.status).toBe(400);
    expect(((await disposable.json()) as { error: string }).error).toBe('disposable_email');
    const shape = await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: 'not-an-address' },
      { Cookie: h.cookie },
    );
    expect(((await shape.json()) as { error: string }).error).toBe('invalid_email');
    expect(relay.sent).toEqual([]);
    expect(listRecipients(h.hash)).toEqual([]);
  });

  it('une adresse qui a répondu STOP ne reçoit pas même un code', async () => {
    const h = holder();
    const target = outsider('stopped');
    getStatsDB()
      .prepare(
        `INSERT INTO email_messages (id, customer_email, direction, msg_date, subject, snippet, body, counterparty)
         VALUES (?, ?, 'in', ?, 'Re: alerts', 'STOP', 'STOP', ?)`,
      )
      .run(
        `stop-${RUN}-${++seq}`,
        target,
        new Date().toISOString().slice(0, 16),
        `"A person" <${target}>`,
      );
    const res = await post(
      '/v1/account/alerts/recipients',
      { prefix: h.prefix, email: target },
      { Cookie: h.cookie },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('address_not_allowed');
    expect(relay.sent).toEqual([]);
    expect(listRecipients(h.hash)).toEqual([]);
  });

  it('mêmes limites d’envoi que les codes de connexion : au-delà, 429 et plus de courrier', async () => {
    const h = holder();
    const target = outsider('flooded');
    let last = 0;
    for (let i = 0; i <= VERIFICATION_SENDS_PER_EMAIL_DAY; i += 1) {
      const res = await post(
        '/v1/account/alerts/recipients',
        { prefix: h.prefix, email: target },
        { Cookie: h.cookie },
      );
      last = res.status;
      if (res.status === 429) break;
    }
    expect(last).toBe(429);
    expect(relay.sent.length).toBeLessThanOrEqual(VERIFICATION_SENDS_PER_EMAIL_DAY);
  });
});

describe('la vue d’ensemble et la date de remise à zéro', () => {
  it('chaque clé mensuelle dit quand son compteur repart, et ses alertes de tous les seuils', async () => {
    const h = holder('pro');
    claimThresholdNotice(h.hash, new Date().toISOString().slice(0, 7), 90);
    const overview = (await (
      await makeApp().request('/v1/account/overview', { headers: { Cookie: h.cookie } })
    ).json()) as {
      keys: Array<{
        resets_at: string | null;
        alerts: Array<{ kind: string }>;
        alert_settings: { thresholds: number[]; recipients: unknown[]; max_recipients: number };
      }>;
    };
    const key = overview.keys[0];
    expect(key.resets_at).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(key.alert_settings).toEqual({ thresholds: [80], recipients: [], max_recipients: 3 });
    expect(key.alerts.map((a) => a.kind)).toContain('quota_90');
  });

  it('une clé à crédits seuls n’a aucune date de remise à zéro', async () => {
    seq += 1;
    const email = `packs${seq}-${RUN}@alpha.example.net`;
    generateCreditKey(email, 1000);
    const { token } = createSession(normalizeEmail(email) as string, email);
    const overview = (await (
      await makeApp().request('/v1/account/overview', {
        headers: { Cookie: `${ACCOUNT_COOKIE}=${token}` },
      })
    ).json()) as { keys: Array<{ resets_at: string | null }> };
    expect(overview.keys[0].resets_at).toBeNull();
  });
});

describe('GET /v1/keys/usage : la date de remise à zéro, additive', () => {
  it('period_start et resets_at en ISO UTC, month inchangé', async () => {
    const h = holder('pro');
    const res = await makeApp().request('https://api.ibanforge.com/v1/keys/usage', {
      headers: { Authorization: `Bearer ${h.raw}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.month).toBe(new Date().toISOString().slice(0, 7));
    expect(body.period_start).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(body.resets_at).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000Z$/);
    expect(new Date(body.resets_at as string).getTime()).toBeGreaterThan(Date.now());
    expect(body.basis).toBe('monthly');
    for (const kept of ['used', 'limit', 'remaining', 'basis', 'tier', 'key_prefix']) {
      expect(body, kept).toHaveProperty(kept);
    }
  });

  it('une clé à crédits seuls ne les a pas : null, jamais une date inventée', async () => {
    seq += 1;
    const made = generateCreditKey(`pack-usage${seq}-${RUN}@alpha.example.net`, 1000);
    const res = await makeApp().request('https://api.ibanforge.com/v1/keys/usage', {
      headers: { Authorization: `Bearer ${made.api_key}` },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.basis).toBe('credits');
    expect(body.period_start).toBeNull();
    expect(body.resets_at).toBeNull();
  });
});
