/**
 * Une clé IBANforge présentée au transport MCP hébergé (`/mcp`).
 *
 * Décision de Claude-Alain du 07.10.2026 (point 7 de la page « État des
 * lieux ») : un agent connecté à `/mcp` peut présenter sa clé de la façon
 * standard, `Authorization: Bearer ifk_…` ou `X-API-Key: ifk_…`, avec LES MÊMES
 * quotas et LE MÊME comptage que l'API REST pour cette clé. Aucun quota
 * nouveau, aucun plafond changé, aucune exception.
 *
 * ## Pourquoi l'appel passe par le middleware REST lui-même
 *
 * Le débit d'une clé tient en trois chemins (allocation, crédits, les deux),
 * avec le remboursement d'un 4xx, l'observation du mois, l'avertissement des
 * 80 % et celui des 10 % de crédits, les textes de refus selon le palier et la
 * révocation pour rafale. Le recopier ici, c'était ouvrir un second endroit où
 * l'argent se compte, et le jour où l'un bouge sans l'autre, la même clé coûte
 * autre chose selon la porte. Chaque appel d'outil payé est donc rejoué, en
 * mémoire, comme la requête REST qui sert la même réponse (`restRoute` de
 * l'inventaire), à travers `apiKeyMiddleware()` exactement tel que `/v1/*` le
 * monte. Le « gestionnaire de route » de ce petit serveur est l'outil MCP : il
 * rend 200, ou 400 là où la route REST refuse l'entrée (et le middleware
 * rembourse, comme sur REST), et un outil qui lève une erreur rend 500 (débité,
 * comme un 5xx REST).
 *
 * Rien de cette requête rejouée ne sort du processus : pas de réseau, pas de
 * journal, pas de télémétrie (ce serveur n'a que le middleware de clé).
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne lit pas la clé : `src/routes/mcp-http.ts` la prend dans les en-têtes de
 * CHAQUE requête HTTP et la passe au SDK par `authInfo`, que le SDK attache aux
 * messages de cette seule requête. Rien n'est rangé dans la session : deux
 * requêtes d'une même session portent chacune leur clé, ou aucune.
 */
import { Hono, type MiddlewareHandler } from 'hono';
import type { HonoEnv, PaywallCause } from '../types.js';
import { apiKeyMiddleware, INVALID_KEY_DETAIL } from '../middleware/api-key.js';
import { validateBIC } from '../lib/bic-validator.js';
import { MCP_TOOLS, ALLOWANCE_EXEMPT_TOOLS } from './inventory.js';

/** La requête REST qui sert la même réponse qu'un appel d'outil. */
export interface RestEquivalent {
  method: 'GET' | 'POST';
  path: string;
  body?: Record<string, unknown>;
  /** L'outil n'a pas de prix (`price: 'free'` dans l'inventaire). */
  free: boolean;
  /**
   * La route REST refuserait cette entrée par un 400, donc la rembourserait.
   * Les entrées qu'un schéma refuse n'arrivent jamais ici : le SDK répond avant
   * l'outil, et rien n'est débité.
   */
  refusedInput: boolean;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const seg = (v: unknown): string => encodeURIComponent(str(v).trim()) || '_';

/**
 * Les outils de donnée, et la requête REST de chacun.
 *
 * Les refus d'entrée suivent les routes : `POST /v1/iban/validate` et
 * `/v1/iban/compliance` refusent un IBAN vide (400), `GET /v1/bic/:code` un BIC
 * mal formé (400), `GET /v1/ch/clearing/:iid` un IID qui n'est pas 1 à 5
 * chiffres (400). Un IBAN invalide, un BIC ou un IID introuvable répondent 200
 * sur REST, donc se paient ici aussi.
 */
const EQUIVALENTS: Record<string, (a: Record<string, unknown>) => Omit<RestEquivalent, 'free'>> = {
  validate_iban: (a) => ({
    method: 'POST',
    path: '/v1/iban/validate',
    body: { iban: a.iban },
    refusedInput: str(a.iban).trim() === '',
  }),
  batch_validate_iban: (a) => ({
    method: 'POST',
    path: '/v1/iban/batch',
    body: { ibans: a.ibans },
    refusedInput: false,
  }),
  lookup_bic: (a) => ({
    method: 'GET',
    path: `/v1/bic/${seg(a.bic)}`,
    refusedInput: !validateBIC(str(a.bic)).valid,
  }),
  check_compliance: (a) => ({
    method: 'POST',
    path: '/v1/iban/compliance',
    body: { iban: a.iban },
    refusedInput: str(a.iban).trim() === '',
  }),
  lookup_ch_clearing: (a) => ({
    method: 'GET',
    path: `/v1/ch/clearing/${seg(a.iid)}`,
    refusedInput: !/^\d{1,5}$/.test(str(a.iid)),
  }),
  validate_payment_reference: () => ({
    method: 'POST',
    path: '/v1/reference/validate',
    refusedInput: false,
  }),
  check_postal_address: () => ({
    method: 'POST',
    path: '/v1/address/check',
    refusedInput: false,
  }),
  check_swiss_qr_bill: () => ({
    method: 'POST',
    path: '/v1/ch/qr-bill/check',
    refusedInput: false,
  }),
};

/** Les outils comptés sur la clé : tous ceux de l'inventaire, sauf les trois sorties gratuites. */
export const KEY_METERED_TOOLS: readonly string[] = Object.keys(EQUIVALENTS);

/**
 * La requête REST d'un appel d'outil, ou `null` pour un outil que rien ne
 * compte : `send_feedback`, `request_api_key`, `poll_api_key`, dont les routes
 * REST sont montées avant le middleware de clé.
 */
export function restEquivalent(tool: string, args: Record<string, unknown>): RestEquivalent | null {
  if (ALLOWANCE_EXEMPT_TOOLS.has(tool)) return null;
  const build = EQUIVALENTS[tool];
  if (!build) return null;
  const listed = MCP_TOOLS.find((t) => t.name === tool);
  return { ...build(args), free: listed?.price === 'free' };
}

interface MeterBindings {
  /** Fait tourner l'outil et rend le statut que la route REST aurait rendu. */
  run: () => Promise<number>;
  free: boolean;
  refused: PaywallCause | null;
}

type MeterEnv = { Variables: HonoEnv['Variables']; Bindings: MeterBindings };

/** Le refus quand le middleware n'a posé aucune cause : ne devrait pas arriver, jamais muet. */
const UNKNOWN_KEY_CAUSE: PaywallCause = { reason: 'invalid_api_key', detail: INVALID_KEY_DETAIL };

const meter = new Hono<MeterEnv>();
// Le MÊME middleware que `app.use('/v1/*', apiKeyMiddleware())` dans src/app.ts.
meter.use('*', apiKeyMiddleware() as unknown as MiddlewareHandler<MeterEnv>);
meter.all('*', async (c) => {
  // Comme sur REST : une route payante n'est servie qu'à une clé authentifiée
  // (le rail x402 n'existe pas ici), une route gratuite l'est toujours, même à
  // une clé invalide, parce que la route REST l'est sans aucune clé.
  if (!c.get('apiKeyAuthenticated') && !c.env.free) {
    c.env.refused = c.get('paywallCause') ?? UNKNOWN_KEY_CAUSE;
    return c.body(null, 402);
  }
  return c.body(null, (await c.env.run()) as 200);
});

export type MeteredCall<T> = { served: true; result: T } | { served: false; cause: PaywallCause };

/**
 * Compte un appel d'outil sur la clé présentée, puis le sert, ou dit pourquoi
 * il ne l'est pas.
 *
 * `null` : l'outil n'est compté sur aucune clé (les trois sorties gratuites),
 * à servir tel quel. Une erreur levée par l'outil remonte telle quelle, après
 * que le middleware a traité l'appel comme un 500 REST.
 */
export async function meterToolCall<T>(
  key: string,
  tool: string,
  args: Record<string, unknown>,
  run: () => T | Promise<T>,
): Promise<MeteredCall<T> | null> {
  const eq = restEquivalent(tool, args);
  if (!eq) return null;

  let ran = false;
  let result: T | undefined;
  let failure: unknown = null;
  const env: MeterBindings = {
    free: eq.free,
    refused: null,
    run: async () => {
      try {
        result = await run();
        ran = true;
        return eq.refusedInput ? 400 : 200;
      } catch (err) {
        failure = err ?? new Error('tool failed');
        return 500;
      }
    },
  };

  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  if (eq.body) headers['Content-Type'] = 'application/json';
  await meter.fetch(
    new Request(`http://mcp-key-meter.invalid${eq.path}`, {
      method: eq.method,
      headers,
      body: eq.body ? JSON.stringify(eq.body) : undefined,
    }),
    env,
  );

  if (failure !== null) throw failure;
  if (ran) return { served: true, result: result as T };
  return { served: false, cause: env.refused ?? UNKNOWN_KEY_CAUSE };
}

/**
 * Ce qu'un agent lit quand sa clé ne paie pas cet appel : la cause et le texte
 * de l'API REST pour cette clé, mot pour mot, et la seule différence de cette
 * porte, dite une fois.
 *
 * 🚨 Jamais de repli sur l'allocation sans clé, et ce texte n'y renvoie pas :
 * apprendre à un client à retirer sa clé pour retrouver des appels détruirait la
 * seule identité stable qu'on ait de lui (même doctrine que `serveFromAllowance`).
 */
export function keyRefusalPayload(cause: PaywallCause): Record<string, unknown> {
  return {
    error: cause.reason,
    message: cause.detail,
    ...(cause.quota ? { quota: cause.quota } : {}),
    ...(cause.credits ? { credits: cause.credits } : {}),
    note:
      'This transport reads the key and counts this call on it exactly as the REST API does. ' +
      'x402 payments and credit purchases are made on the REST API (https://api.ibanforge.com/v1).',
  };
}
