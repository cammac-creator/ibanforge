/**
 * scripts/wake-bazaar.ts — fresh paid x402 settlements to wake Coinbase Bazaar indexer
 *
 * Why this script exists:
 *   The CDP Bazaar indexer attaches a service to its catalog only after a successful
 *   facilitator-settled tx posts the bazaar discovery extension. Several builders
 *   (AgentOracle, AgentCrush, IBANforge, etc.) have observed in #x402 that the
 *   first settlement isn't always enough — re-settling once after a config change
 *   pushes the entry through. This is the AgentCrush-confirmed remedy.
 *
 * What it does:
 *   - Loads a wallet from PRIVATE_KEY env var
 *   - Sends 3 paid x402 calls covering 3 distinct paid endpoints (validate / bic / compliance),
 *     each one going through the @x402/fetch handshake (initial 402 → signed payment →
 *     re-request → settle on Base mainnet via the CDP facilitator)
 *   - Prints the tx hash from the x-payment-response header for each
 *
 * Usage:
 *   PRIVATE_KEY=0xYourFundedWalletKey npx tsx scripts/wake-bazaar.ts
 *
 *   Wallet must hold at least ~0.05 USDC on Base mainnet
 *   (3 calls × ~0.005-0.02 USDC = ~0.03 USDC + safety margin).
 *
 * Cost:
 *   - /v1/iban/validate     0.005 USDC
 *   - /v1/bic/DEUTDEFF      0.003 USDC
 *   - /v1/iban/compliance   0.020 USDC
 *   Total: ~0.028 USDC + Base L2 gas (negligible)
 */

import { createWalletClient, http, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base } from 'viem/chains';
import { wrapFetchWithPayment, decodeXPaymentResponse } from 'x402-fetch';

const PRIVATE_KEY = process.env.PRIVATE_KEY as `0x${string}` | undefined;
const API_BASE = process.env.API_BASE ?? 'https://api.ibanforge.com';

if (!PRIVATE_KEY) {
  console.error('✗ Missing PRIVATE_KEY env var.');
  console.error('Usage: PRIVATE_KEY=0x... npx tsx scripts/wake-bazaar.ts');
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
console.log(`Wallet: ${account.address}`);
console.log(`API:    ${API_BASE}`);
console.log();

// x402-fetch's SignerWallet type extends both WalletClient + PublicClient,
// so we extend the wallet with publicActions to satisfy it.
const client = createWalletClient({
  account,
  transport: http('https://mainnet.base.org'),
  chain: base,
}).extend(publicActions);

// Allow up to 0.10 USDC per call (way above any of our prices).
// `as any` because x402-fetch v1's Signer type uses an older viem chain shape
// that diverges from our installed viem types — runtime is fine.
const fetchWithPay = wrapFetchWithPayment(fetch, client as any, 100_000n);

interface Call {
  label: string;
  method: 'GET' | 'POST';
  url: string;
  body?: Record<string, unknown>;
}

const calls: Call[] = [
  {
    label: 'validate_iban (CH)',
    method: 'POST',
    url: `${API_BASE}/v1/iban/validate`,
    body: { iban: 'CH9300762011623852957' },
  },
  {
    label: 'lookup_bic (DEUTDEFF)',
    method: 'GET',
    url: `${API_BASE}/v1/bic/DEUTDEFF`,
  },
  {
    label: 'check_compliance (GB)',
    method: 'POST',
    url: `${API_BASE}/v1/iban/compliance`,
    body: { iban: 'GB29NWBK60161331926819' },
  },
];

for (const c of calls) {
  console.log(`→ ${c.label}`);
  console.log(`  ${c.method} ${c.url}`);

  try {
    const init: RequestInit = {
      method: c.method,
      headers: c.body ? { 'Content-Type': 'application/json' } : undefined,
      body: c.body ? JSON.stringify(c.body) : undefined,
    };

    const res = await fetchWithPay(c.url, init);
    console.log(`  HTTP ${res.status}`);

    const xPay = res.headers.get('x-payment-response');
    if (xPay) {
      try {
        const decoded = decodeXPaymentResponse(xPay);
        console.log(`  settled:`, JSON.stringify(decoded, null, 2).split('\n').map((l, i) => i === 0 ? l : '    ' + l).join('\n'));
      } catch {
        console.log(`  x-payment-response (raw): ${xPay.slice(0, 120)}…`);
      }
    } else {
      console.log('  (no x-payment-response header — call did not need payment or facilitator failed)');
    }

    const extResp = res.headers.get('extension-responses');
    if (extResp) {
      try {
        const decoded = JSON.parse(Buffer.from(extResp, 'base64').toString('utf-8'));
        console.log(`  bazaar status:`, JSON.stringify(decoded.bazaar ?? decoded));
      } catch {
        console.log(`  extension-responses (raw): ${extResp.slice(0, 100)}…`);
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`  ERROR: ${msg}`);
  }

  console.log();
}

console.log('Done. The Bazaar indexer should re-attach the service within ~1-2h.');
console.log('Verify with: curl -s https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources | grep ibanforge');
