import { getDemandGaps, ledgerSince } from './demand-gaps.js';
import {
  formatProposalTelegram,
  monthEndedBefore,
  proposeFromDemand,
  type DemandProposal,
} from './demand-proposal.js';
import { kvGet, kvSet } from './forum-radar-server.js';
import { notifyOps } from './ops-alert.js';

/**
 * The monthly tick behind demand-proposal.ts: once per calendar month, the
 * proposal for the month that just ended is stored (kv_state, on the
 * persistent volume) and, when it names a register or a BIC, sent on the ops
 * channel. Hourly tick like the radars, so a deploy on the 1st cannot skip the
 * month: the kv marker, not the clock, decides whether the month is done.
 *
 * The first month of a ledger younger than 28 days is stored but not sent:
 * a proposal built on a few days of traffic would train the reader to ignore
 * the channel before it ever says something worth acting on.
 */
const KV_LAST_MONTH = 'demand_monthly_last';
const KV_PROPOSAL = 'demand_monthly_proposal';
const BOOT_DELAY_MS = 4 * 60 * 1000;
const TICK_MS = 60 * 60 * 1000;
const WINDOW_DAYS = 30;
const LEDGER_MIN_AGE_DAYS = 28;

export interface MonthlyRecord {
  month: string;
  proposed_at: string;
  sent: boolean;
  proposal: DemandProposal | null;
}

/** Pure: is a proposal due for the month `now` opens, given the last month recorded? */
export function monthlyDue(now: Date, lastRecorded: string | undefined): boolean {
  return monthEndedBefore(now) !== lastRecorded;
}

export function readMonthlyRecord(): MonthlyRecord | null {
  try {
    const raw = kvGet(KV_PROPOSAL);
    return raw ? (JSON.parse(raw) as MonthlyRecord) : null;
  } catch {
    return null;
  }
}

/** One pass. Returns what it did, for tests and logs. Never throws. */
export async function runMonthlyDemandProposal(
  now: Date = new Date(),
): Promise<{ done: boolean; sent: boolean; month: string }> {
  const month = monthEndedBefore(now);
  try {
    if (!monthlyDue(now, kvGet(KV_LAST_MONTH))) return { done: false, sent: false, month };
    const proposal = proposeFromDemand(getDemandGaps(WINDOW_DAYS), month);
    const since = ledgerSince();
    const ledgerAgeDays = since
      ? (now.getTime() - Date.parse(since.replace(' ', 'T') + 'Z')) / 86_400_000
      : 0;
    const worthSending =
      proposal !== null &&
      (proposal.kind === 'register' || proposal.kind === 'composite') &&
      ledgerAgeDays >= LEDGER_MIN_AGE_DAYS;
    let sent = false;
    if (worthSending && proposal) sent = await notifyOps(formatProposalTelegram(proposal));
    const record: MonthlyRecord = { month, proposed_at: now.toISOString(), sent, proposal };
    kvSet(KV_PROPOSAL, JSON.stringify(record));
    kvSet(KV_LAST_MONTH, month);
    console.log(
      `[demand-proposal] ${month}: ${proposal ? proposal.kind : 'no demand'}${sent ? ', sent' : ''}`,
    );
    return { done: true, sent, month };
  } catch (err) {
    console.error('[demand-proposal] run failed:', err instanceof Error ? err.message : err);
    return { done: false, sent: false, month };
  }
}

export function startMonthlyDemandLoop(): void {
  setTimeout(() => void runMonthlyDemandProposal(), BOOT_DELAY_MS).unref();
  setInterval(() => void runMonthlyDemandProposal(), TICK_MS).unref();
}
