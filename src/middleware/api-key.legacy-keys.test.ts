/**
 * Les clés payantes d'AVANT le chantier « clé unique » (lot B1) ne perdent rien.
 *
 * La migration du lot B1 écrit `monthly_limit = 0` sur toute clé née d'un achat
 * de pack (jusqu'ici NULL, relu « 200 » par défaut), crée le registre des achats
 * et en fait le rattrapage. Ce fichier prouve, sur une base au schéma d'avant et
 * aux lignes inventées, que les porteurs existants reçoivent la même réponse
 * qu'avant : même statut, même solde, même allocation réellement opposée, même
 * cause de refus.
 *
 * Les valeurs attendues ont été RELEVÉES sur le code d'avant le changement
 * (main à 373bf71b), par ce même scénario, puis gravées ici. Ce qui a changé
 * volontairement est listé dans `CHANGED_BY_DESIGN` avec son motif : jamais en
 * silence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

const WALLET = '0x00000000000000000000000000000000000000A1';
const VALID_IBAN = 'CH9300762011623852957';
const BATCH = ['CH9300762011623852957', 'DE89370400440532013000', 'GB29NWBK60161331926819'];
const MONTH = new Date().toISOString().slice(0, 7);

function raw(fill: string): string {
  return 'ifk_' + fill.repeat(64 / fill.length);
}
function sha(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Les porteurs d'avant, tous inventés. */
const KEYS = {
  pack_card: raw('a1'),
  pack_usdc_zero: raw('b2'),
  pack_rotated: raw('c3'),
  pro: raw('d4'),
  free: raw('e5'),
  anon: raw('f6'),
  paid_once: raw('a7'),
  shield: raw('b8'),
  granted: raw('c9'),
} as const;
type KeyName = keyof typeof KEYS;

/** La forme de `api_keys` telle que main la crée à 373bf71b, colonne pour colonne. */
const LEGACY_API_KEYS = `
  CREATE TABLE api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key_hash TEXT UNIQUE NOT NULL,
    key_prefix TEXT NOT NULL,
    email TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    active INTEGER DEFAULT 1,
    monthly_limit INTEGER,
    source TEXT,
    credits_remaining INTEGER,
    credits_total INTEGER,
    stripe_session_id TEXT,
    raw_key_one_time_view TEXT,
    stripe_subscription_id TEXT,
    deactivated_at TEXT,
    amount_paid_minor INTEGER,
    amount_paid_currency TEXT,
    no_recredit INTEGER NOT NULL DEFAULT 0,
    issued_by_us INTEGER NOT NULL DEFAULT 0,
    x402_payment_ref TEXT,
    tier TEXT NOT NULL DEFAULT 'email',
    claimed_at TEXT,
    claim_method TEXT,
    email_norm TEXT,
    origin_prefix TEXT,
    shield_episode TEXT,
    lineage_hash TEXT
  );
  CREATE TABLE api_usage (
    key_hash TEXT NOT NULL,
    month TEXT NOT NULL,
    count INTEGER DEFAULT 0,
    PRIMARY KEY (key_hash, month)
  );`;

function seedLegacyDatabase(path: string): void {
  const db = new Database(path);
  db.exec(LEGACY_API_KEYS);
  const insert = db.prepare(
    `INSERT INTO api_keys (key_hash, key_prefix, email, email_norm, created_at, active, monthly_limit, source,
                           credits_remaining, credits_total, stripe_session_id, stripe_subscription_id,
                           amount_paid_minor, amount_paid_currency, no_recredit, issued_by_us, x402_payment_ref,
                           tier, claimed_at, claim_method, origin_prefix, shield_episode, lineage_hash, deactivated_at)
     VALUES (@hash, @prefix, @email, @email, @created, @active, @limit, @source, @remaining, @total, @session, @sub,
             @amount, @currency, @noRecredit, @issued, @x402, @tier, @claimedAt, @claimMethod, @origin, @shield,
             @lineage, @deactivated)`,
  );
  const base: Record<string, unknown> = {
    created: '2026-09-01 08:00:00',
    active: 1,
    limit: null,
    source: null,
    remaining: null,
    total: null,
    session: null,
    sub: null,
    amount: null,
    currency: null,
    noRecredit: 0,
    issued: 0,
    x402: null,
    tier: 'email',
    claimedAt: null,
    claimMethod: null,
    origin: null,
    shield: null,
    deactivated: null,
  };
  const row = (name: KeyName, fields: Record<string, unknown> & { email: string }) => {
    const hash = sha(KEYS[name]);
    insert.run({ ...base, ...fields, hash, prefix: KEYS[name].slice(0, 12), lineage: hash });
  };
  // Un pack par carte, entamé.
  row('pack_card', {
    email: 'acme@example.com',
    tier: 'paid',
    source: 'stripe-pack',
    remaining: 950,
    total: 1000,
    session: 'cs_test_legacy_pack_card',
    amount: 400,
    currency: 'usd',
  });
  // Un pack USDC vidé jusqu'au dernier crédit.
  row('pack_usdc_zero', {
    email: 'credits-buyer',
    tier: 'paid',
    source: 'x402-pack',
    remaining: 0,
    total: 1000,
    x402: 'aa'.repeat(16),
  });
  // Un pack tourné : la ligne d'origine (inactive, porte la session) et sa copie active.
  const rotatedOrigin = sha('ifk_' + '0d'.repeat(32));
  insert.run({
    ...base,
    hash: rotatedOrigin,
    prefix: 'ifk_0d0d0d0d',
    email: 'rotated@alpha.example.net',
    tier: 'paid',
    source: 'stripe-pack',
    remaining: 4000,
    total: 5000,
    session: 'cs_test_legacy_pack_rotated',
    amount: 2000,
    currency: 'usd',
    active: 0,
    deactivated: '2026-09-10 09:00:00',
    lineage: rotatedOrigin,
  });
  insert.run({
    ...base,
    hash: sha(KEYS.pack_rotated),
    prefix: KEYS.pack_rotated.slice(0, 12),
    email: 'rotated@alpha.example.net',
    tier: 'paid',
    source: 'stripe-pack',
    remaining: 4000,
    total: 5000,
    origin: 'ifk_0d0d0d0d',
    lineage: rotatedOrigin,
    created: '2026-09-10 09:00:00',
  });
  // Un abonné Pro.
  row('pro', {
    email: 'pro@alpha.example.net',
    tier: 'paid',
    source: 'stripe-subscription',
    limit: 10_000,
    session: 'cs_test_legacy_pro',
    sub: 'sub_legacy_pro',
    amount: 2900,
    currency: 'usd',
  });
  // Une clé gratuite ordinaire (plafond NULL, lu 200).
  row('free', { email: 'free@alpha.example.net' });
  // Une clé anonyme (25 par mois, écrit).
  row('anon', { email: 'anonymous', tier: 'anonymous', limit: 25 });
  // Une clé promue par un paiement à l'appel : 200 une fois.
  row('paid_once', {
    email: 'anonymous',
    tier: 'paid',
    limit: 200,
    noRecredit: 1,
    claimedAt: '2026-09-02 10:00:00',
    claimMethod: 'x402',
  });
  // Une clé née sous le bouclier du disjoncteur.
  row('shield', {
    email: 'shield@alpha.example.net',
    limit: 5,
    noRecredit: 1,
    shield: 'episode-legacy-1',
  });
  // Un pack offert (pilote), sans référence de paiement.
  row('granted', {
    email: 'pilot@alpha.example.net',
    tier: 'paid',
    remaining: 300,
    total: 500,
    issued: 1,
  });
  const usage = db.prepare('INSERT INTO api_usage (key_hash, month, count) VALUES (?, ?, ?)');
  usage.run(sha(KEYS.free), MONTH, 150);
  usage.run(sha(KEYS.anon), MONTH, 24);
  usage.run(sha(KEYS.paid_once), '2026-08', 150);
  usage.run(sha(KEYS.paid_once), MONTH, 49);
  usage.run(sha(KEYS.shield), MONTH, 4);
  usage.run(sha(KEYS.pro), MONTH, 1234);
  usage.run(sha(KEYS.pack_card), MONTH, 50);
  db.close();
}

// ─── Le facilitateur local (seulement /supported : personne ne paie ici) ─────

let facilitator: Server;
const originalEnv = { ...process.env };
type AppModule = typeof import('../app.js');
let buildApp: AppModule['buildApp'];
let closeAll: () => void;

beforeAll(async () => {
  facilitator = createServer((req, res) => {
    if (req.url === '/supported') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
          extensions: [],
          signers: {},
        }),
      );
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise<void>((resolve) => facilitator.listen(0, '127.0.0.1', resolve));
  process.env.NODE_ENV = 'test';
  process.env.X402_ENABLED = 'true';
  process.env.WALLET_ADDRESS = WALLET;
  process.env.FACILITATOR_URL = `http://127.0.0.1:${(facilitator.address() as AddressInfo).port}`;
  delete process.env.CDP_API_KEY_ID;
  delete process.env.CDP_API_KEY_SECRET;
  delete process.env.IBANFORGE_FREE_MODE;
  // La base au schéma d'avant, posée AVANT le premier import de db.ts : c'est
  // l'ouverture par le code courant qui joue la migration, comme en production.
  seedLegacyDatabase(process.env.STATS_DB_PATH as string);
  ({ buildApp } = await import('../app.js'));
  ({ closeAll } = await import('../lib/db.js'));
});

afterAll(async () => {
  await new Promise<void>((resolve) => facilitator.close(() => resolve()));
  process.env = originalEnv;
  closeAll?.();
});

const HEADERS = [
  'x-credits-remaining',
  'x-credits-total',
  'x-credits-charged',
  'x-credits-exhausted',
  'x-credits-insufficient',
  'x-credits-required',
  'x-quota-used',
  'x-quota-limit',
  'x-quota-remaining',
  'x-quota-exhausted',
  'x-quota-insufficient',
  'x-quota-basis',
  'x-quota-charged',
];

type Observation = Record<string, unknown>;

let ipCounter = 0;
async function call(
  key: string,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<Observation> {
  ipCounter += 1;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    'x-real-ip': `198.51.100.${ipCounter}`,
  };
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await buildApp().request(`https://api.ibanforge.com${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const out: Observation = { status: res.status };
  for (const h of HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) out[h] = v;
  }
  const text = await res.text();
  let body: Record<string, unknown> | null;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    body = null;
  }
  if (res.status === 402 && body) {
    const cause = body.cause as Record<string, unknown> | undefined;
    out.cause_reason = cause?.reason ?? null;
    if (cause?.credits) {
      const credits = cause.credits as Record<string, unknown>;
      out.cause_credits = {
        required: credits.required,
        remaining: credits.remaining,
        total: credits.total,
      };
    }
    if (cause?.quota) {
      const quota = cause.quota as Record<string, unknown>;
      out.cause_quota = {
        used: quota.used,
        limit: quota.limit,
        remaining: quota.remaining,
        required: quota.required,
      };
    }
  }
  if (path === '/v1/credits/balance' && body) {
    out.balance = {
      type: body.type,
      credits_remaining: body.credits_remaining,
      credits_total: body.credits_total,
      credits_used: body.credits_used,
    };
  }
  if ((path === '/v1/keys/usage' || path.startsWith('/v1/keys/report')) && body) {
    const usage = (path === '/v1/keys/usage' ? body : body.usage) as Record<string, unknown>;
    out.usage = {
      used: usage.used,
      limit: usage.limit,
      remaining: usage.remaining,
      basis: usage.basis,
      tier: usage.tier,
      credits_remaining: usage.credits_remaining,
      credits_total: usage.credits_total,
    };
  }
  return out;
}

async function observeAll(): Promise<Record<string, Observation>> {
  const o: Record<string, Observation> = {};
  const validate = { method: 'POST', body: { iban: VALID_IBAN } };
  for (const name of Object.keys(KEYS) as KeyName[]) {
    const key = KEYS[name];
    o[`${name}.usage.before`] = await call(key, '/v1/keys/usage');
    o[`${name}.validate`] = await call(key, '/v1/iban/validate', validate);
    if (name === 'pack_card') {
      o[`${name}.batch`] = await call(key, '/v1/iban/batch', {
        method: 'POST',
        body: { ibans: BATCH },
      });
    }
    if (name === 'pack_usdc_zero') {
      o[`${name}.format`] = await call(key, `/v1/iban/format?iban=${VALID_IBAN}`);
    }
    // Les clés posées à une unité de leur plafond : le deuxième appel est le mur.
    if (name === 'anon' || name === 'paid_once' || name === 'shield') {
      o[`${name}.validate.wall`] = await call(key, '/v1/iban/validate', validate);
    }
    // Acheter un pack en présentant sa clé, sans paiement : le rail exige le paiement.
    if (name === 'pack_usdc_zero' || name === 'free') {
      o[`${name}.buy.unpaid`] = await call(key, '/v1/credits/buy/1k', { method: 'POST', body: {} });
    }
    o[`${name}.balance`] = await call(key, '/v1/credits/balance');
    o[`${name}.usage.after`] = await call(key, '/v1/keys/usage');
    o[`${name}.report`] = await call(key, '/v1/keys/report?days=1');
  }
  return o;
}

/**
 * Relevé sur main à 373bf71b, AVANT tout changement du lot B1, par ce même
 * scénario (statut, en-têtes de solde et de quota, cause d'un refus, blocs de
 * solde et d'usage). Aucune valeur n'est recopiée à la main depuis le code.
 */
const BASELINE_373BF71B: Record<string, Observation> = {
  'pack_card.usage.before': {
    status: 200,
    usage: {
      used: 50,
      limit: 200,
      remaining: 150,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 950,
      credits_total: 1000,
    },
  },
  'pack_card.validate': { status: 200, 'x-credits-remaining': '949', 'x-credits-total': '1000' },
  'pack_card.batch': {
    status: 200,
    'x-credits-remaining': '946',
    'x-credits-total': '1000',
    'x-credits-charged': '3',
  },
  'pack_card.balance': {
    status: 200,
    balance: {
      type: 'credit_bundle',
      credits_remaining: 946,
      credits_total: 1000,
      credits_used: 54,
    },
  },
  'pack_card.usage.after': {
    status: 200,
    usage: {
      used: 54,
      limit: 200,
      remaining: 146,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 946,
      credits_total: 1000,
    },
  },
  'pack_card.report': {
    status: 200,
    usage: {
      used: 54,
      limit: 200,
      remaining: 146,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 946,
      credits_total: 1000,
    },
  },
  'pack_usdc_zero.usage.before': {
    status: 200,
    usage: {
      used: 0,
      limit: 200,
      remaining: 200,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 0,
      credits_total: 1000,
    },
  },
  'pack_usdc_zero.validate': {
    status: 402,
    'x-credits-remaining': '0',
    'x-credits-total': '1000',
    'x-credits-exhausted': 'true',
    'x-credits-required': '1',
    cause_reason: 'credits_exhausted',
    cause_credits: { required: 1, remaining: 0, total: 1000 },
  },
  'pack_usdc_zero.format': { status: 200, 'x-credits-remaining': '0', 'x-credits-total': '1000' },
  'pack_usdc_zero.buy.unpaid': {
    status: 402,
    'x-credits-remaining': '0',
    'x-credits-total': '1000',
    'x-credits-exhausted': 'true',
    'x-credits-required': '1',
    cause_reason: 'credits_exhausted',
    cause_credits: { required: 1, remaining: 0, total: 1000 },
  },
  'pack_usdc_zero.balance': {
    status: 200,
    balance: {
      type: 'credit_bundle',
      credits_remaining: 0,
      credits_total: 1000,
      credits_used: 1000,
    },
  },
  'pack_usdc_zero.usage.after': {
    status: 200,
    usage: {
      used: 0,
      limit: 200,
      remaining: 200,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 0,
      credits_total: 1000,
    },
  },
  'pack_usdc_zero.report': {
    status: 200,
    usage: {
      used: 0,
      limit: 200,
      remaining: 200,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 0,
      credits_total: 1000,
    },
  },
  'pack_rotated.usage.before': {
    status: 200,
    usage: {
      used: 0,
      limit: 200,
      remaining: 200,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 4000,
      credits_total: 5000,
    },
  },
  'pack_rotated.validate': {
    status: 200,
    'x-credits-remaining': '3999',
    'x-credits-total': '5000',
  },
  'pack_rotated.balance': {
    status: 200,
    balance: {
      type: 'credit_bundle',
      credits_remaining: 3999,
      credits_total: 5000,
      credits_used: 1001,
    },
  },
  'pack_rotated.usage.after': {
    status: 200,
    usage: {
      used: 1,
      limit: 200,
      remaining: 199,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 3999,
      credits_total: 5000,
    },
  },
  'pack_rotated.report': {
    status: 200,
    usage: {
      used: 1,
      limit: 200,
      remaining: 199,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 3999,
      credits_total: 5000,
    },
  },
  'pro.usage.before': {
    status: 200,
    usage: { used: 1234, limit: 10000, remaining: 8766, basis: 'monthly', tier: 'paid' },
  },
  'pro.validate': {
    status: 200,
    'x-quota-used': '1235',
    'x-quota-limit': '10000',
    'x-quota-remaining': '8765',
  },
  'pro.balance': { status: 200, balance: { type: 'subscription' } },
  'pro.usage.after': {
    status: 200,
    usage: { used: 1235, limit: 10000, remaining: 8765, basis: 'monthly', tier: 'paid' },
  },
  'pro.report': {
    status: 200,
    usage: { used: 1235, limit: 10000, remaining: 8765, basis: 'monthly', tier: 'paid' },
  },
  'free.usage.before': {
    status: 200,
    usage: { used: 150, limit: 200, remaining: 50, basis: 'monthly', tier: 'email' },
  },
  'free.validate': {
    status: 200,
    'x-quota-used': '151',
    'x-quota-limit': '200',
    'x-quota-remaining': '49',
  },
  'free.buy.unpaid': {
    status: 402,
    'x-quota-used': '151',
    'x-quota-limit': '200',
    'x-quota-remaining': '49',
    cause_reason: null,
  },
  'free.balance': { status: 200, balance: { type: 'subscription' } },
  'free.usage.after': {
    status: 200,
    usage: { used: 151, limit: 200, remaining: 49, basis: 'monthly', tier: 'email' },
  },
  'free.report': {
    status: 200,
    usage: { used: 151, limit: 200, remaining: 49, basis: 'monthly', tier: 'email' },
  },
  'anon.usage.before': {
    status: 200,
    usage: { used: 24, limit: 25, remaining: 1, basis: 'monthly', tier: 'anonymous' },
  },
  'anon.validate': {
    status: 200,
    'x-quota-used': '25',
    'x-quota-limit': '25',
    'x-quota-remaining': '0',
  },
  'anon.validate.wall': {
    status: 402,
    'x-quota-used': '25',
    'x-quota-limit': '25',
    'x-quota-remaining': '0',
    'x-quota-exhausted': 'true',
    'x-quota-basis': 'month',
    cause_reason: 'monthly_quota_exhausted',
    cause_quota: { used: 25, limit: 25, remaining: 0, required: 1 },
  },
  'anon.balance': { status: 200, balance: { type: 'subscription' } },
  'anon.usage.after': {
    status: 200,
    usage: { used: 25, limit: 25, remaining: 0, basis: 'monthly', tier: 'anonymous' },
  },
  'anon.report': {
    status: 200,
    usage: { used: 25, limit: 25, remaining: 0, basis: 'monthly', tier: 'anonymous' },
  },
  'paid_once.usage.before': {
    status: 200,
    usage: { used: 199, limit: 200, remaining: 1, basis: 'lifetime', tier: 'paid' },
  },
  'paid_once.validate': {
    status: 200,
    'x-quota-used': '200',
    'x-quota-limit': '200',
    'x-quota-remaining': '0',
  },
  'paid_once.validate.wall': {
    status: 402,
    'x-quota-used': '200',
    'x-quota-limit': '200',
    'x-quota-remaining': '0',
    'x-quota-exhausted': 'true',
    'x-quota-basis': 'lifetime',
    cause_reason: 'monthly_quota_exhausted',
    cause_quota: { used: 200, limit: 200, remaining: 0, required: 1 },
  },
  'paid_once.balance': { status: 200, balance: { type: 'subscription' } },
  'paid_once.usage.after': {
    status: 200,
    usage: { used: 200, limit: 200, remaining: 0, basis: 'lifetime', tier: 'paid' },
  },
  'paid_once.report': {
    status: 200,
    usage: { used: 200, limit: 200, remaining: 0, basis: 'lifetime', tier: 'paid' },
  },
  'shield.usage.before': {
    status: 200,
    usage: { used: 4, limit: 5, remaining: 1, basis: 'lifetime', tier: 'email' },
  },
  'shield.validate': {
    status: 200,
    'x-quota-used': '5',
    'x-quota-limit': '5',
    'x-quota-remaining': '0',
  },
  'shield.validate.wall': {
    status: 402,
    'x-quota-used': '5',
    'x-quota-limit': '5',
    'x-quota-remaining': '0',
    'x-quota-exhausted': 'true',
    'x-quota-basis': 'lifetime',
    cause_reason: 'monthly_quota_exhausted',
    cause_quota: { used: 5, limit: 5, remaining: 0, required: 1 },
  },
  'shield.balance': { status: 200, balance: { type: 'subscription' } },
  'shield.usage.after': {
    status: 200,
    usage: { used: 5, limit: 5, remaining: 0, basis: 'lifetime', tier: 'email' },
  },
  'shield.report': {
    status: 200,
    usage: { used: 5, limit: 5, remaining: 0, basis: 'lifetime', tier: 'email' },
  },
  'granted.usage.before': {
    status: 200,
    usage: {
      used: 0,
      limit: 200,
      remaining: 200,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 300,
      credits_total: 500,
    },
  },
  'granted.validate': { status: 200, 'x-credits-remaining': '299', 'x-credits-total': '500' },
  'granted.balance': {
    status: 200,
    balance: {
      type: 'credit_bundle',
      credits_remaining: 299,
      credits_total: 500,
      credits_used: 201,
    },
  },
  'granted.usage.after': {
    status: 200,
    usage: {
      used: 1,
      limit: 200,
      remaining: 199,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 299,
      credits_total: 500,
    },
  },
  'granted.report': {
    status: 200,
    usage: {
      used: 1,
      limit: 200,
      remaining: 199,
      basis: 'credits',
      tier: 'paid',
      credits_remaining: 299,
      credits_total: 500,
    },
  },
};

/** Les clés sans allocation propre : nées d'un achat de pack, ou pack offert. */
const CREDIT_ONLY: ReadonlySet<string> = new Set([
  'pack_card',
  'pack_usdc_zero',
  'pack_rotated',
  'granted',
]);

/**
 * Ce qui change VOLONTAIREMENT pour un porteur existant, et pourquoi. Aucun de
 * ces champs ne décide de ce qu'une clé reçoit.
 *
 * 1. `usage.limit` et `usage.remaining` d'une clé à crédits passent de 200 à 0.
 *    Leur `basis` est `credits` et leur note dit que rien ne leur est opposé :
 *    le 200 venait du repli `NULL → 200` sur une clé qui n'a jamais eu de
 *    plafond mensuel. La migration écrit 0, l'allocation propre d'une clé née
 *    d'un achat (spec §5.2).
 * 2. Acheter un pack en présentant une clé vide ne facture plus d'unité (la
 *    route de vente entre dans les routes gratuites du middleware des clés) :
 *    la réponse reste un 402 qui demande le paiement, sans la cause
 *    « crédits épuisés » que l'unité facturée faisait naître.
 */
function expectedAfterB1(name: string, before: Observation): Observation {
  const [key] = name.split('.');
  const after: Observation = JSON.parse(JSON.stringify(before)) as Observation;
  if (CREDIT_ONLY.has(key) && after.usage) {
    const usage = after.usage as Record<string, unknown>;
    usage.limit = 0;
    usage.remaining = 0;
  }
  if (name === 'pack_usdc_zero.buy.unpaid') {
    for (const field of ['cause_credits', 'x-credits-exhausted', 'x-credits-required']) {
      delete after[field];
    }
    // Un 402 sans cause : le paywall demande le paiement, rien d'autre.
    after.cause_reason = null;
  }
  return after;
}

/** Les champs relevés avant, lus dans le relevé d'après : un champ neuf n'est pas un écart. */
function project(observed: Observation, like: Observation): Observation {
  const out: Observation = {};
  for (const field of Object.keys(like)) {
    const value = observed[field];
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      out[field] = project(value as Observation, like[field] as Observation);
    } else {
      out[field] = value;
    }
  }
  // Un champ du relevé d'avant qui a disparu doit rester visible comme tel.
  for (const field of Object.keys(observed)) {
    if (!(field in like) && field in BASELINE_FIELDS_WATCHED) out[field] = observed[field];
  }
  return out;
}

/** Les champs qu'un relevé d'après ne doit pas faire APPARAÎTRE sans motif. */
const BASELINE_FIELDS_WATCHED: Record<string, true> = {
  cause_reason: true,
  cause_credits: true,
  cause_quota: true,
  'x-credits-exhausted': true,
  'x-quota-exhausted': true,
};

describe('les porteurs payants d’avant la migration B1', () => {
  let observed: Record<string, Observation>;

  beforeAll(async () => {
    observed = await observeAll();
  });

  it('reçoivent la même réponse qu’avant : statut, solde, allocation opposée, cause', () => {
    expect(Object.keys(observed).sort()).toEqual(Object.keys(BASELINE_373BF71B).sort());
    for (const [name, before] of Object.entries(BASELINE_373BF71B)) {
      const expected = expectedAfterB1(name, before);
      expect(project(observed[name], expected), name).toEqual(expected);
    }
  });

  it('la migration écrit 0 sur les clés nées d’un pack, et ne touche à rien d’autre', async () => {
    const { getStatsDB } = await import('../lib/db.js');
    const limit = (fill: KeyName) =>
      (
        getStatsDB()
          .prepare('SELECT monthly_limit FROM api_keys WHERE key_hash = ?')
          .get(sha(KEYS[fill])) as { monthly_limit: number | null }
      ).monthly_limit;
    expect(limit('pack_card')).toBe(0);
    expect(limit('pack_usdc_zero')).toBe(0);
    expect(limit('pack_rotated')).toBe(0);
    expect(limit('granted')).toBe(0);
    expect(limit('pro')).toBe(10_000);
    expect(limit('free')).toBeNull();
    expect(limit('anon')).toBe(25);
    expect(limit('paid_once')).toBe(200);
    expect(limit('shield')).toBe(5);
  });

  it('le rattrapage inscrit chaque achat une fois, sans montant USDC inventé ni vente pour un pack offert', async () => {
    const { getStatsDB } = await import('../lib/db.js');
    const rows = getStatsDB()
      .prepare(
        'SELECT payment_ref, rail, kind, outcome, credits, amount_minor, currency, backfilled FROM key_purchases ORDER BY payment_ref',
      )
      .all() as Array<Record<string, unknown>>;
    expect(rows).toEqual([
      {
        payment_ref: 'stripe:cs_test_legacy_pack_card',
        rail: 'card',
        kind: 'pack',
        outcome: 'minted',
        credits: 1000,
        amount_minor: 400,
        currency: 'usd',
        backfilled: 1,
      },
      {
        payment_ref: 'stripe:cs_test_legacy_pack_rotated',
        rail: 'card',
        kind: 'pack',
        outcome: 'minted',
        credits: 5000,
        amount_minor: 2000,
        currency: 'usd',
        backfilled: 1,
      },
      {
        payment_ref: 'stripe:cs_test_legacy_pro',
        rail: 'card',
        kind: 'subscription',
        outcome: 'minted',
        credits: null,
        amount_minor: 2900,
        currency: 'usd',
        backfilled: 1,
      },
      {
        payment_ref: `x402:${'aa'.repeat(16)}`,
        rail: 'usdc',
        kind: 'pack',
        outcome: 'minted',
        credits: 1000,
        amount_minor: null,
        currency: null,
        backfilled: 1,
      },
    ]);
  });
});
