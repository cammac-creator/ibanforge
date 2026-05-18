import { Hono } from 'hono';

const adminRevenue = new Hono();

const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_RPC_URL = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
const USDC_DECIMALS = 6;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const CHUNK_SIZE = 10_000n;
const DEFAULT_LOOKBACK_BLOCKS = 1_300_000n;
const BASE_BLOCK_TIME_SEC = 2;
const PARALLEL_BATCH = 5;
const RPC_TIMEOUT_MS = 12_000;

interface RpcLog {
  transactionHash: string;
  blockNumber: string;
  topics: string[];
  data: string;
}

interface RpcBlock {
  timestamp: string;
}

function rawToUsdc(raw: bigint): number {
  const divisor = 10n ** BigInt(USDC_DECIMALS);
  const whole = Number(raw / divisor);
  const fraction = Number(raw % divisor) / Number(divisor);
  return whole + fraction;
}

function checkAuth(authHeader: string | undefined): boolean {
  const token = process.env.STATS_TOKEN;
  if (!token) return false;
  return authHeader === `Bearer ${token}`;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(BASE_RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`RPC HTTP ${res.status}`);
  }
  const text = await res.text();
  if (!text.startsWith('{')) {
    throw new Error(`RPC non-JSON response (rate-limited?)`);
  }
  const json = JSON.parse(text) as { result?: T; error?: { message: string } };
  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }
  return json.result as T;
}

async function fetchLogsChunk(from: bigint, to: bigint, recipientTopic: string): Promise<RpcLog[]> {
  try {
    return await rpcCall<RpcLog[]>('eth_getLogs', [
      {
        address: USDC_BASE_CONTRACT,
        fromBlock: '0x' + from.toString(16),
        toBlock: '0x' + to.toString(16),
        topics: [TRANSFER_TOPIC, null, recipientTopic],
      },
    ]);
  } catch {
    await new Promise((r) => setTimeout(r, 250));
    try {
      return await rpcCall<RpcLog[]>('eth_getLogs', [
        {
          address: USDC_BASE_CONTRACT,
          fromBlock: '0x' + from.toString(16),
          toBlock: '0x' + to.toString(16),
          topics: [TRANSFER_TOPIC, null, recipientTopic],
        },
      ]);
    } catch {
      return [];
    }
  }
}

function topicToAddress(topic: string): string {
  return '0x' + topic.slice(-40).toLowerCase();
}

function addressToTopic(addr: string): string {
  return '0x' + addr.slice(2).padStart(64, '0').toLowerCase();
}

adminRevenue.get('/admin/revenue', async (c) => {
  if (!checkAuth(c.req.header('Authorization'))) {
    return c.json({ error: 'unauthorized', message: 'Admin endpoints require Bearer STATS_TOKEN.' }, 403);
  }

  const wallet = process.env.WALLET_ADDRESS;
  if (!wallet || wallet === '0x0000000000000000000000000000000000000000') {
    return c.json({ error: 'no_wallet', message: 'WALLET_ADDRESS not configured.' }, 500);
  }

  const lookbackParam = c.req.query('blocks');
  const lookbackBlocks = lookbackParam ? BigInt(lookbackParam) : DEFAULT_LOOKBACK_BLOCKS;

  let head: bigint;
  let headTimestamp: number;
  try {
    const headHex = await rpcCall<string>('eth_blockNumber', []);
    head = BigInt(headHex);
    const headBlock = await rpcCall<RpcBlock>('eth_getBlockByNumber', [headHex, false]);
    headTimestamp = Number(BigInt(headBlock.timestamp));
  } catch (err) {
    return c.json({ error: 'rpc_unreachable', detail: (err as Error).message }, 502);
  }

  const startBlock = head > lookbackBlocks ? head - lookbackBlocks : 0n;
  const recipientTopic = addressToTopic(wallet);

  const chunks: Array<{ from: bigint; to: bigint }> = [];
  let cursor = startBlock;
  while (cursor <= head) {
    const chunkEnd = cursor + CHUNK_SIZE - 1n > head ? head : cursor + CHUNK_SIZE - 1n;
    chunks.push({ from: cursor, to: chunkEnd });
    cursor = chunkEnd + 1n;
  }

  const allLogs: RpcLog[] = [];
  let failedChunks = 0;
  const t0 = Date.now();

  for (let i = 0; i < chunks.length; i += PARALLEL_BATCH) {
    const batch = chunks.slice(i, i + PARALLEL_BATCH);
    const results = await Promise.all(batch.map((ch) => fetchLogsChunk(ch.from, ch.to, recipientTopic)));
    for (let j = 0; j < results.length; j++) {
      if (results[j].length === 0 && batch[j].to - batch[j].from > 0n) {
        // Note: empty results are normal; we can't distinguish "no events" from "rate-limited retried-and-failed".
        // The retry inside fetchLogsChunk catches the obvious failures.
      }
      allLogs.push(...results[j]);
    }
    if (Date.now() - t0 > 25_000) break;
  }

  const walletLc = wallet.toLowerCase();
  const txs = allLogs
    .filter((l) => l.topics.length >= 3)
    .map((l) => {
      const from = topicToAddress(l.topics[1]);
      const to = topicToAddress(l.topics[2]);
      const value = BigInt(l.data);
      const blockNumber = BigInt(l.blockNumber);
      const timestamp = headTimestamp - Number(head - blockNumber) * BASE_BLOCK_TIME_SEC;
      return { hash: l.transactionHash, from, to, value, blockNumber, timestamp };
    })
    .filter((tx) => tx.to === walletLc)
    .sort((a, b) => Number(b.blockNumber - a.blockNumber));

  let totalRaw = 0n;
  const byDay: Record<string, number> = {};
  for (const tx of txs) {
    totalRaw += tx.value;
    const day = new Date(tx.timestamp * 1000).toISOString().slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + rawToUsdc(tx.value);
  }

  const recent = txs.slice(0, 20).map((tx) => ({
    hash: tx.hash,
    from: tx.from,
    value_usdc: rawToUsdc(tx.value),
    block: Number(tx.blockNumber),
    time: new Date(tx.timestamp * 1000).toISOString(),
    explorer: `https://basescan.org/tx/${tx.hash}`,
  }));

  const sortedByDay = Object.fromEntries(Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])));

  return c.json({
    wallet,
    network: 'base',
    asset: 'USDC',
    contract: USDC_BASE_CONTRACT,
    total_received_usdc: rawToUsdc(totalRaw),
    transaction_count: txs.length,
    block_range: {
      from: Number(startBlock),
      to: Number(head),
      approx_days: (Number(head - startBlock) * BASE_BLOCK_TIME_SEC) / 86400,
    },
    elapsed_ms: Date.now() - t0,
    chunks_failed: failedChunks,
    by_day: sortedByDay,
    recent,
    docs: 'Pass Bearer STATS_TOKEN. Queries USDC Transfer events to the wallet via Base mainnet RPC (no API key needed). Override range with ?blocks=N. Note: public RPC rate-limits cause silent chunk drops on aggressive lookbacks — for full history use a dedicated RPC URL via BASE_RPC_URL env var.',
  });
});

export { adminRevenue };
