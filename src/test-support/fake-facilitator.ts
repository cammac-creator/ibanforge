/**
 * Un facilitateur x402 local pour les tests du rail payant (chantier « clé
 * unique », lot B1, 25.09.2026).
 *
 * Le SDK x402 vérifie un paiement auprès du facilitateur, exécute la route,
 * PUIS règle. Tester ce qui se passe quand le règlement est refusé ou reste
 * sans réponse exige donc un facilitateur qui vérifie et qui, au moment de
 * régler, fait ce que le test lui dit : régler, refuser, ou se taire.
 *
 * Depuis la relecture de sécurité de la PR 259, il sait aussi rendre les
 * issues INCONNUES qu'un vrai facilitateur peut rendre (page d'erreur d'une
 * passerelle, 5xx, connexion coupée, `settlement_pending`, transaction
 * diffusée puis annulée), suivre les nonces comme la chaîne (un nonce réglé ne
 * se vérifie ni ne se règle plus), et appeler un crochet juste avant de régler.
 *
 * Aucune dépendance de test ici (pas de vitest) : le contrôle des dépendances
 * d'exécution lit `src/` comme du code de production.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

export type SettleMode =
  /** Réglé : `success: true` et un hash de transaction. */
  | 'success'
  /** Refus propre, avant toute diffusion : `success: false`, fonds insuffisants. */
  | 'refuse'
  /** Aucune réponse : le délai de l'enrobage tombe. */
  | 'hang'
  /** Une passerelle répond à la place du facilitateur : 502 en HTML. */
  | 'html502'
  /** 500 en JSON, sans champ `success`. */
  | 'json500'
  /** 500 en JSON AVEC `success: false` (`unexpected_settle_error`) : la transaction a pu partir. */
  | 'json500success'
  /** La requête de règlement arrive, puis la connexion tombe. */
  | 'reset'
  /** Diffusée, reçu pas encore là : `settlement_pending` avec un hash (le SDK relance une fois). */
  | 'pending'
  /** `settlement_pending` au premier appel, réglé à la relance du SDK. */
  | 'pending_then_success'
  /** Diffusée puis annulée sur la chaîne : `success: false` AVEC un hash de transaction. */
  | 'reverted';

export interface FakeFacilitator {
  url: string;
  /** Ce que fera le prochain règlement. */
  settleMode: SettleMode;
  /**
   * Suivre les nonces comme la chaîne : `verify` refuse un nonce déjà réglé,
   * `settle` aussi (`nonce_already_used`, sans transaction). Désactivé par
   * défaut, pour que les tests de rejeu d'avant restent ce qu'ils étaient.
   */
  trackNonces: boolean;
  /** Les nonces réglés, quand `trackNonces` est posé. */
  settledNonces: Set<string>;
  /** Appelé au moment du règlement, avant la réponse (révoquer une clé en vol, par exemple). */
  onSettle: (() => void | Promise<void>) | null;
  /**
   * Un délai avant chaque réponse de `verify`, en millisecondes : des requêtes
   * parallèles vérifient alors toutes avant le premier règlement, comme en
   * production où `verify` prend des centaines de millisecondes.
   */
  verifyDelayMs: number;
  /** Le dernier hash de transaction rendu, réglé ou diffusé. */
  lastTransaction: string | null;
  calls: { supported: number; verify: number; settle: number };
  close(): Promise<void>;
}

const NETWORK = 'eip155:8453';
const PAYER = '0x00000000000000000000000000000000000000B2';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

/** Le nonce de l'autorisation signée, lu dans le corps que le SDK envoie. */
function nonceOf(raw: string): string | null {
  try {
    const body = JSON.parse(raw) as {
      paymentPayload?: { payload?: { authorization?: { nonce?: unknown } } };
    };
    const nonce = body.paymentPayload?.payload?.authorization?.nonce;
    return typeof nonce === 'string' ? nonce : null;
  } catch {
    return null;
  }
}

function txHash(): string {
  return `0x${randomBytes(32).toString('hex')}`;
}

export async function startFakeFacilitator(): Promise<FakeFacilitator> {
  const hanging: ServerResponse[] = [];
  // Le nombre d'appels de règlement vus pour un même nonce, pour le mode qui
  // règle à la relance.
  const pendingSeen = new Map<string, number>();
  const state: FakeFacilitator = {
    url: '',
    settleMode: 'success',
    trackNonces: false,
    settledNonces: new Set<string>(),
    onSettle: null,
    verifyDelayMs: 0,
    lastTransaction: null,
    calls: { supported: 0, verify: 0, settle: 0 },
    close: async () => undefined,
  };

  async function settle(req: IncomingMessage, res: ServerResponse, raw: string): Promise<void> {
    state.calls.settle += 1;
    const nonce = nonceOf(raw);
    if (state.onSettle) await state.onSettle();
    if (state.trackNonces && (!nonce || state.settledNonces.has(nonce))) {
      json(res, 200, {
        success: false,
        errorReason: 'nonce_already_used',
        transaction: '',
        network: NETWORK,
        payer: PAYER,
      });
      return;
    }
    const settled = (): void => {
      if (state.trackNonces && nonce) state.settledNonces.add(nonce);
      state.lastTransaction = txHash();
      json(res, 200, {
        success: true,
        transaction: state.lastTransaction,
        network: NETWORK,
        payer: PAYER,
      });
    };
    const pending = (): void => {
      state.lastTransaction = txHash();
      json(res, 200, {
        success: false,
        errorReason: 'settlement_pending',
        errorMessage: 'receipt wait timed out',
        transaction: state.lastTransaction,
        network: NETWORK,
        payer: PAYER,
      });
    };
    switch (state.settleMode) {
      case 'hang':
        hanging.push(res);
        return;
      case 'refuse':
        json(res, 200, {
          success: false,
          errorReason: 'insufficient_funds',
          transaction: '',
          network: NETWORK,
          payer: PAYER,
        });
        return;
      case 'html502':
        res.writeHead(502, { 'Content-Type': 'text/html' });
        res.end('<html><body><h1>502 Bad Gateway</h1></body></html>');
        return;
      case 'json500':
        json(res, 500, { error: 'internal_error' });
        return;
      case 'json500success':
        json(res, 500, {
          success: false,
          errorReason: 'unexpected_settle_error',
          transaction: '',
          network: NETWORK,
          payer: PAYER,
        });
        return;
      case 'reset':
        req.socket.destroy();
        return;
      case 'pending':
        pending();
        return;
      case 'pending_then_success': {
        const key = nonce ?? 'no-nonce';
        const seen = (pendingSeen.get(key) ?? 0) + 1;
        pendingSeen.set(key, seen);
        if (seen === 1) pending();
        else settled();
        return;
      }
      case 'reverted':
        state.lastTransaction = txHash();
        json(res, 200, {
          success: false,
          errorReason: 'invalid_exact_evm_transaction_failed',
          transaction: state.lastTransaction,
          network: NETWORK,
          payer: PAYER,
        });
        return;
      default:
        settled();
    }
  }

  const server: Server = createServer((req, res) => {
    void readBody(req).then(async (raw) => {
      if (req.url === '/supported') {
        state.calls.supported += 1;
        json(res, 200, {
          kinds: [{ x402Version: 2, scheme: 'exact', network: NETWORK }],
          extensions: [],
          signers: {},
        });
        return;
      }
      if (req.url === '/verify') {
        state.calls.verify += 1;
        const nonce = nonceOf(raw);
        if (state.trackNonces && nonce && state.settledNonces.has(nonce)) {
          json(res, 200, { isValid: false, invalidReason: 'nonce_already_used', payer: PAYER });
          return;
        }
        if (state.verifyDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, state.verifyDelayMs));
        }
        json(res, 200, { isValid: true, payer: PAYER });
        return;
      }
      if (req.url === '/settle') {
        await settle(req, res, raw);
        return;
      }
      json(res, 404, {});
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  state.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  state.close = () =>
    new Promise<void>((resolve) => {
      for (const res of hanging.splice(0)) res.destroy();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  return state;
}

/** Le payeur que le faux facilitateur annonce, et que l'en-tête signe. */
export const FAKE_PAYER = PAYER;

/**
 * Un en-tête `PAYMENT-SIGNATURE` (x402 v2) qui accepte EXACTEMENT les
 * exigences que le paywall vient d'annoncer. La signature est fictive : c'est
 * le faux facilitateur qui dit si elle est valide. Chaque appel tire un nonce
 * neuf, donc un paiement distinct (et une référence de règlement distincte).
 */
export function paymentHeaderFor(accepted: Record<string, unknown>): string {
  return encodePayment(paymentFor(accepted));
}

/** Le paiement lui-même, avant encodage : pour en fabriquer plusieurs encodages. */
export function paymentFor(accepted: Record<string, unknown>): Record<string, unknown> {
  return {
    x402Version: 2,
    accepted,
    payload: {
      signature: `0x${'ab'.repeat(65)}`,
      authorization: {
        from: PAYER,
        to: accepted.payTo,
        value: accepted.amount,
        validAfter: '0',
        validBefore: '9999999999',
        nonce: `0x${randomBytes(32).toString('hex')}`,
      },
    },
  };
}

/** Encode un paiement en en-tête ; `indent` change l'encodage, pas le paiement. */
export function encodePayment(payment: Record<string, unknown>, indent?: number): string {
  return Buffer.from(JSON.stringify(payment, null, indent)).toString('base64');
}
