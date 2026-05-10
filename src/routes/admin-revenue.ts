import { Hono } from 'hono';

const adminRevenue = new Hono();

const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASESCAN_API = 'https://api.basescan.org/api';
const USDC_DECIMALS = 6;

interface BasescanTx {
  hash: string;
  from: string;
  to: string;
  value: string;
  blockNumber: string;
  timeStamp: string;
}

interface BasescanResponse {
  status: string;
  message?: string;
  result: BasescanTx[] | string;
}

function rawToUsdc(raw: string): number {
  const big = BigInt(raw);
  const divisor = 10n ** BigInt(USDC_DECIMALS);
  const whole = Number(big / divisor);
  const fraction = Number(big % divisor) / Number(divisor);
  return whole + fraction;
}

function checkAuth(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  return authHeader === `Bearer ${token}`;
}

adminRevenue.get('/admin/revenue', async (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Admin endpoints require Bearer STATS_TOKEN.' }, 403);
  }

  const wallet = process.env.WALLET_ADDRESS;
  if (!wallet || wallet === '0x0000000000000000000000000000000000000000') {
    return c.json({ error: 'no_wallet', message: 'WALLET_ADDRESS not configured.' }, 500);
  }

  const apiKey = process.env.BASESCAN_API_KEY ?? '';
  const url =
    `${BASESCAN_API}?module=account&action=tokentx` +
    `&contractaddress=${USDC_BASE_CONTRACT}` +
    `&address=${wallet}` +
    `&page=1&offset=1000&sort=desc` +
    (apiKey ? `&apikey=${apiKey}` : '');

  let data: BasescanResponse;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      return c.json({ error: 'basescan_unreachable', status: res.status }, 502);
    }
    data = (await res.json()) as BasescanResponse;
  } catch (err) {
    return c.json({ error: 'basescan_fetch_failed', detail: (err as Error).message }, 502);
  }

  if (data.status !== '1' || !Array.isArray(data.result)) {
    if (data.status === '0' && data.message === 'No transactions found') {
      return c.json({
        wallet,
        network: 'base',
        asset: 'USDC',
        total_received_usdc: 0,
        transaction_count: 0,
        by_day: {},
        recent: [],
        note: 'No incoming USDC transfers yet on this wallet.',
      });
    }
    return c.json({ error: 'basescan_error', detail: data }, 502);
  }

  const walletLc = wallet.toLowerCase();
  const incoming = data.result.filter((tx) => tx.to.toLowerCase() === walletLc);

  let totalRaw = 0n;
  const byDay: Record<string, number> = {};
  for (const tx of incoming) {
    const valueRaw = BigInt(tx.value);
    totalRaw += valueRaw;
    const day = new Date(Number(tx.timeStamp) * 1000).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + rawToUsdc(tx.value);
  }

  const recent = incoming.slice(0, 20).map((tx) => ({
    hash: tx.hash,
    from: tx.from,
    value_usdc: rawToUsdc(tx.value),
    block: Number(tx.blockNumber),
    time: new Date(Number(tx.timeStamp) * 1000).toISOString(),
    explorer: `https://basescan.org/tx/${tx.hash}`,
  }));

  const sortedByDay = Object.fromEntries(Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])));

  return c.json({
    wallet,
    network: 'base',
    asset: 'USDC',
    contract: USDC_BASE_CONTRACT,
    total_received_usdc: rawToUsdc(totalRaw.toString()),
    transaction_count: incoming.length,
    truncated: incoming.length === 1000,
    by_day: sortedByDay,
    recent,
    docs: 'Pass Bearer STATS_TOKEN. Query the last 1000 incoming USDC transfers from the on-chain wallet via Basescan.',
  });
});

export { adminRevenue };
