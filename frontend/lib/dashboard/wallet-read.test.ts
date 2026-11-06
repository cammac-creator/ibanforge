import { describe, expect, it } from 'vitest';
import { readWalletBalance, readWalletHistory } from './wallet-read';
const hash = `0x${'ab'.repeat(32)}`;
const payload = () => ({ network: 'base', asset: 'USDC', read_at: '2030-01-02T09:30:00.000Z', balance_usdc: 0,
  total_received_usdc: 12.5, received_external_usdc: 10, received_internal_usdc: 2.5, internal_payers_configured: true,
  transaction_count: 1, recent: [{ hash, from: `0x${'cd'.repeat(20)}`, value_usdc: 12.5, time: null, explorer: `https://basescan.org/tx/${hash}` }],
  chunks_total: 3, chunks_attempted: 2, chunks_failed: 0, chunks_skipped: 1, scan_complete: false, block_range: { from: 1, to: 20000 } });
describe('le portefeuille valide la source avant d’afficher des montants', () => {
  it('accepte zéro, absence du solde et dates de transfert inconnues', () => {
    expect(readWalletBalance(payload())?.balance_usdc).toBe(0);
    expect(readWalletBalance({ ...payload(), balance_usdc: null })?.balance_usdc).toBeNull();
    expect(readWalletHistory(payload())?.scan_complete).toBe(false);
    expect(readWalletHistory({ ...payload(), received_external_usdc: null, received_internal_usdc: null, internal_payers_configured: false })).not.toBeNull();
  });
  it.each([{ balance_usdc: -1 }, { balance_usdc: '0' }, { read_at: '2030-02-30T00:00:00Z' }, { read_at: undefined }, { network: 'ailleurs' }])('refuse le solde malformé', (over) => {
    expect(readWalletBalance({ ...payload(), ...over })).toBeNull();
  });
  it.each([{ scan_complete: true }, { chunks_skipped: 0 }, { chunks_failed: 3 }, { transaction_count: 0 }, { transaction_count: undefined },
    { received_external_usdc: 13 }, { received_internal_usdc: null }, { recent: {} }, { recent: [null] }])('refuse un historique incohérent', (over) => {
    expect(readWalletHistory({ ...payload(), ...over })).toBeNull();
  });
  it('refuse les liens injectés, doublons de transaction et dates impossibles', () => {
    const p = payload();
    expect(readWalletHistory({ ...p, recent: [{ ...p.recent[0], explorer: 'javascript:alert(1)' }] })).toBeNull();
    expect(readWalletHistory({ ...p, transaction_count: 2, recent: [p.recent[0], p.recent[0]] })).toBeNull();
    expect(readWalletHistory({ ...p, recent: [{ ...p.recent[0], time: '2030-02-30T00:00:00Z' }] })).toBeNull();
  });
});
