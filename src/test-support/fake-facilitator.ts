/**
 * Un facilitateur x402 local pour les tests du rail payant (chantier « clé
 * unique », lot B1, 25.09.2026).
 *
 * Le SDK x402 vérifie un paiement auprès du facilitateur, exécute la route,
 * PUIS règle. Tester ce qui se passe quand le règlement est refusé ou reste
 * sans réponse exige donc un facilitateur qui vérifie et qui, au moment de
 * régler, fait ce que le test lui dit : régler, refuser, ou se taire.
 *
 * Aucune dépendance de test ici (pas de vitest) : le contrôle des dépendances
 * d'exécution lit `src/` comme du code de production.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';

export type SettleMode = 'success' | 'refuse' | 'hang';

export interface FakeFacilitator {
  url: string;
  /** Ce que fera le prochain règlement. */
  settleMode: SettleMode;
  calls: { supported: number; verify: number; settle: number };
  close(): Promise<void>;
}

const NETWORK = 'eip155:8453';
const PAYER = '0x00000000000000000000000000000000000000B2';

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function drain(req: IncomingMessage): Promise<void> {
  return new Promise((resolve) => {
    req.on('data', () => undefined);
    req.on('end', () => resolve());
  });
}

export async function startFakeFacilitator(): Promise<FakeFacilitator> {
  const hanging: ServerResponse[] = [];
  const state: FakeFacilitator = {
    url: '',
    settleMode: 'success',
    calls: { supported: 0, verify: 0, settle: 0 },
    close: async () => undefined,
  };
  const server: Server = createServer((req, res) => {
    void drain(req).then(() => {
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
        json(res, 200, { isValid: true, payer: PAYER });
        return;
      }
      if (req.url === '/settle') {
        state.calls.settle += 1;
        if (state.settleMode === 'hang') {
          hanging.push(res);
          return;
        }
        if (state.settleMode === 'refuse') {
          json(res, 200, {
            success: false,
            errorReason: 'insufficient_funds',
            transaction: '',
            network: NETWORK,
            payer: PAYER,
          });
          return;
        }
        json(res, 200, {
          success: true,
          transaction: `0x${randomBytes(32).toString('hex')}`,
          network: NETWORK,
          payer: PAYER,
        });
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

/**
 * Un en-tête `PAYMENT-SIGNATURE` (x402 v2) qui accepte EXACTEMENT les
 * exigences que le paywall vient d'annoncer. La signature est fictive : c'est
 * le faux facilitateur qui dit si elle est valide. Chaque appel tire un nonce
 * neuf, donc un paiement distinct (et une référence de règlement distincte).
 */
export function paymentHeaderFor(accepted: Record<string, unknown>): string {
  const payload = {
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
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}
