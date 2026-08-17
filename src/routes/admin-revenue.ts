import { Hono } from 'hono';
import { timingSafeEqual } from 'node:crypto';
import { getStatsDB } from '../lib/db.js';

const adminRevenue = new Hono();

const USDC_BASE_CONTRACT = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const BASE_RPC_URL = process.env.BASE_RPC_URL ?? 'https://mainnet.base.org';
const USDC_DECIMALS = 6;
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
// keccak256("balanceOf(address)")[:4] — ERC-20 balance read.
const BALANCE_OF_SELECTOR = '0x70a08231';
// Max block span per eth_getLogs call. Public mainnet.base.org caps this at
// 10k; dedicated RPCs (e.g. base.publicnode.com) allow 50k — set
// RPC_LOG_CHUNK_SIZE to match so the full history scan needs 5x fewer calls.
const CHUNK_SIZE = BigInt(process.env.RPC_LOG_CHUNK_SIZE ?? '10000');
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
  if (!token || !authHeader) return false;
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(authHeader);
  return expected.length === got.length && timingSafeEqual(expected, got);
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

async function fetchLogsChunk(
  from: bigint,
  to: bigint,
  recipientTopic: string,
): Promise<{ logs: RpcLog[]; failed: boolean }> {
  const params = [
    {
      address: USDC_BASE_CONTRACT,
      fromBlock: '0x' + from.toString(16),
      toBlock: '0x' + to.toString(16),
      topics: [TRANSFER_TOPIC, null, recipientTopic],
    },
  ];
  try {
    return { logs: await rpcCall<RpcLog[]>('eth_getLogs', params), failed: false };
  } catch {
    await new Promise((r) => setTimeout(r, 250));
    try {
      return { logs: await rpcCall<RpcLog[]>('eth_getLogs', params), failed: false };
    } catch {
      return { logs: [], failed: true };
    }
  }
}

/**
 * Live on-chain USDC balance of the wallet via a single `balanceOf` eth_call.
 * Instant (one RPC round-trip) and always exact — unlike summing Transfer logs,
 * it needs no block-range scan, so it surfaces funds received OUTSIDE the
 * lookback window. Returns null if the RPC call fails.
 */
async function fetchBalanceUsdc(wallet: string): Promise<number | null> {
  try {
    const data = BALANCE_OF_SELECTOR + wallet.slice(2).padStart(64, '0').toLowerCase();
    const hex = await rpcCall<string>('eth_call', [{ to: USDC_BASE_CONTRACT, data }, 'latest']);
    if (!hex || hex === '0x') return 0;
    return rawToUsdc(BigInt(hex));
  } catch {
    return null;
  }
}

function topicToAddress(topic: string): string {
  return '0x' + topic.slice(-40).toLowerCase();
}

// ---------------------------------------------------------------------------
// Transaction cache
//
// Public Base RPCs cap eth_getLogs ranges and silently drop chunks under load,
// so a single full scan returns a NONDETERMINISTIC subset (5, 8, 13…). We
// persist every transfer a scan ever sees (keyed by tx hash) and serve the
// accumulated union — so the history converges to complete and then stays
// stable, independent of per-call RPC flakiness. A dedicated BASE_RPC_URL makes
// each scan complete on its own, but the cache means we don't depend on it.
// ---------------------------------------------------------------------------
interface CachedTx {
  hash: string;
  from_addr: string;
  value_usdc: number;
  block: number;
  ts: string | null;
}

function ensureTxCache(): void {
  getStatsDB().exec(
    `CREATE TABLE IF NOT EXISTS wallet_transactions (
       hash TEXT PRIMARY KEY,
       from_addr TEXT,
       value_usdc REAL NOT NULL,
       block INTEGER NOT NULL,
       ts TEXT
     )`,
  );
}

function cacheTxs(
  rows: Array<{ hash: string; from: string; value_usdc: number; block: number; time: string }>,
): void {
  if (rows.length === 0) return;
  const db = getStatsDB();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO wallet_transactions (hash, from_addr, value_usdc, block, ts) VALUES (?, ?, ?, ?, ?)',
  );
  db.transaction((rs: typeof rows) => {
    for (const r of rs) stmt.run(r.hash, r.from, r.value_usdc, r.block, r.time);
  })(rows);
}

function readCachedTxs(): CachedTx[] {
  return getStatsDB()
    .prepare('SELECT hash, from_addr, value_usdc, block, ts FROM wallet_transactions ORDER BY block DESC')
    .all() as CachedTx[];
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

  // Fast path: live balance only (single eth_call, no Transfer-log scan).
  // The full scan below can take ~25s; the dashboard headline uses this so the
  // page never blocks on log fetching.
  if (c.req.query('balance_only') === 'true') {
    return c.json({
      wallet,
      network: 'base',
      asset: 'USDC',
      contract: USDC_BASE_CONTRACT,
      balance_usdc: await fetchBalanceUsdc(wallet),
      balance_only: true,
    });
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
    for (const r of results) {
      if (r.failed) failedChunks += 1;
      allLogs.push(...r.logs);
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

  // Persist this (best-effort, possibly partial) scan, then serve the union of
  // everything ever seen — converges to the complete history and stays stable.
  ensureTxCache();
  cacheTxs(
    txs.map((tx) => ({
      hash: tx.hash,
      from: tx.from,
      value_usdc: rawToUsdc(tx.value),
      block: Number(tx.blockNumber),
      time: new Date(tx.timestamp * 1000).toISOString(),
    })),
  );
  const cached = readCachedTxs();

  const totalUsdc = cached.reduce((s, t) => s + t.value_usdc, 0);
  const byDay: Record<string, number> = {};
  for (const t of cached) {
    const day = (t.ts ?? '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] ?? 0) + t.value_usdc;
  }

  // Our own settlements land in this wallet like anyone else's. Test campaigns
  // (lighting up a catalog, bisecting a facilitator rejection) can therefore
  // BE the whole of a week's "revenue", and reporting that as income is how a
  // debugging session gets read as traction.
  //
  // The addresses live in env, not here: this repo is public, and pinning our
  // operational payer wallet in it would let anyone label our test traffic
  // on-chain. Unset means "cannot tell", which the caller must print as such —
  // reporting the full amount as external is the error this exists to stop.
  const internalPayers = new Set(
    (process.env.X402_INTERNAL_PAYERS ?? '')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean),
  );
  const isInternalPayer = (addr: string) => internalPayers.has(addr.trim().toLowerCase());
  const internalUsdc = internalPayers.size
    ? cached.filter((t) => isInternalPayer(t.from_addr)).reduce((s, t) => s + t.value_usdc, 0)
    : 0;
  const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

  const recent = cached.slice(0, 20).map((t) => ({
    hash: t.hash,
    from: t.from_addr,
    value_usdc: t.value_usdc,
    block: t.block,
    time: t.ts,
    explorer: `https://basescan.org/tx/${t.hash}`,
  }));

  const sortedByDay = Object.fromEntries(Object.entries(byDay).sort((a, b) => b[0].localeCompare(a[0])));

  return c.json({
    wallet,
    network: 'base',
    asset: 'USDC',
    contract: USDC_BASE_CONTRACT,
    balance_usdc: await fetchBalanceUsdc(wallet),
    total_received_usdc: totalUsdc,
    internal_payers_configured: internalPayers.size > 0,
    received_internal_usdc: internalPayers.size ? round6(internalUsdc) : null,
    received_external_usdc: internalPayers.size ? round6(totalUsdc - internalUsdc) : null,
    transaction_count: cached.length,
    internal_transaction_count: internalPayers.size
      ? cached.filter((t) => isInternalPayer(t.from_addr)).length
      : null,
    scanned_this_call: txs.length,
    block_range: {
      from: Number(startBlock),
      to: Number(head),
      approx_days: (Number(head - startBlock) * BASE_BLOCK_TIME_SEC) / 86400,
    },
    elapsed_ms: Date.now() - t0,
    chunks_total: chunks.length,
    chunks_failed: failedChunks,
    accuracy_note:
      failedChunks > 0
        ? `${failedChunks}/${chunks.length} chunks failed (RPC rate-limit) — total may be under-reported. Configure BASE_RPC_URL with a dedicated endpoint for full accuracy.`
        : 'all chunks succeeded',
    by_day: sortedByDay,
    recent,
    docs: 'Pass Bearer STATS_TOKEN. Queries USDC Transfer events to the wallet via Base mainnet RPC (no API key needed). Override range with ?blocks=N. Note: public RPC rate-limits cause silent chunk drops on aggressive lookbacks — for full history use a dedicated RPC URL via BASE_RPC_URL env var.',
  });
});

export { adminRevenue };
