/** Lecture du portefeuille : aucun montant de vente n’est déduit d’un transfert. */
export interface WalletBalance { balance_usdc: number | null; read_at: string }
export interface WalletTransfer { hash: string; from: string; value_usdc: number; time: string | null; explorer: string }
export interface WalletHistory extends WalletBalance {
  total_received_usdc: number;
  received_external_usdc: number | null;
  received_internal_usdc: number | null;
  internal_payers_configured: boolean;
  transaction_count: number;
  recent: WalletTransfer[];
  chunks_total: number;
  chunks_attempted: number;
  chunks_failed: number;
  chunks_skipped: number;
  scan_complete: boolean;
  block_range: { from: number; to: number };
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const amount = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const count = (v: unknown): v is number => amount(v) && Number.isSafeInteger(v);
const stamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().replace('.000Z', 'Z') === v.replace('.000Z', 'Z');
export function readWalletBalance(v: unknown): WalletBalance | null {
  if (!object(v) || v.network !== 'base' || v.asset !== 'USDC' || !stamp(v.read_at)
    || !(v.balance_usdc === null || amount(v.balance_usdc))) return null;
  return { balance_usdc: v.balance_usdc, read_at: v.read_at };
}
export function readWalletHistory(v: unknown): WalletHistory | null {
  if (!object(v) || !readWalletBalance(v) || !amount(v.total_received_usdc)
    || !count(v.transaction_count) || typeof v.internal_payers_configured !== 'boolean') return null;
  if (v.internal_payers_configured) {
    if (!amount(v.received_external_usdc) || !amount(v.received_internal_usdc)
      || Math.abs(v.received_external_usdc + v.received_internal_usdc - v.total_received_usdc) > 0.000002) return null;
  } else if (v.received_external_usdc !== null || v.received_internal_usdc !== null) return null;
  if (!count(v.chunks_total) || v.chunks_total < 1 || !count(v.chunks_attempted)
    || !count(v.chunks_failed) || !count(v.chunks_skipped) || v.chunks_attempted + v.chunks_skipped !== v.chunks_total
    || v.chunks_failed > v.chunks_attempted || v.scan_complete !== (v.chunks_failed === 0 && v.chunks_skipped === 0)) return null;
  if (!object(v.block_range) || !count(v.block_range.from) || !count(v.block_range.to) || v.block_range.from > v.block_range.to) return null;
  if (!Array.isArray(v.recent) || v.recent.length > 20 || v.recent.length > v.transaction_count) return null;
  const hashes = new Set();
  for (const tx of v.recent) {
    if (!object(tx) || typeof tx.hash !== 'string' || !/^0x[a-f0-9]{64}$/i.test(tx.hash)
      || hashes.has(tx.hash.toLowerCase()) || typeof tx.from !== 'string' || !/^0x[a-f0-9]{40}$/i.test(tx.from)
      || !amount(tx.value_usdc) || !(tx.time === null || stamp(tx.time))
      || tx.explorer !== `https://basescan.org/tx/${tx.hash}`) return null;
    hashes.add(tx.hash.toLowerCase());
  }
  return v as unknown as WalletHistory;
}
