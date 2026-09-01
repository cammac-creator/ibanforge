/**
 * One safe wrapper around every stats write, with a counter behind it.
 *
 * ## Why this module exists (quality audit QUA-12, 2026-09-01)
 *
 * The free routes wrap their `recordOperation(...)` call so a broken stats
 * database can never turn a correct answer into a 500. That choice is right and
 * it stays. What was missing is that NOTHING counted those failures: the
 * service would keep answering correctly and quietly stop measuring. In a month
 * whose only open question is "the paying keys made zero calls", the table that
 * answers it going silent is the worst failure mode this service has, because
 * a dead recorder and an idle customer produce exactly the same dashboard.
 *
 * ## The counter is in memory, on purpose
 *
 * Unlike `./ops-alert.ts`, whose own state lives in `kv_state`, the streak here
 * is a module-level Map. `kv_state` is a table inside `stats.sqlite`, so in the
 * very failure this probe watches for it is unreachable too, and a probe that
 * needs the broken thing to report the breakage reports nothing. A restart
 * resetting the streak is the correct trade: five more failures re-arm it.
 *
 * ## What counts as a failure
 *
 * `fn` throwing, or `fn` returning exactly `false`.
 *
 * 🚨 As of 2026-09-01 `recordOperation` (src/lib/stats.ts) catches its own
 * errors and returns `undefined`, so it can neither throw nor return `false`
 * and this probe cannot fire yet. Making it fire is one line there: return
 * `false` from its catch block and `true` at the end. Until that lands, this
 * module gives the routes a single uniform call site and the alerting path is
 * proven by its own tests, not by production. Shipping the counter without
 * saying this would be the "criterion nothing can satisfy" that
 * `src/lib/killline.ts` warns about in its own header.
 *
 * Never throws, never awaits: a probe that breaks the thing it watches, or that
 * adds latency to a served call, is worse than no probe.
 */
import { opsFail, opsOk } from './ops-alert.js';

/** Consecutive failures for one label before the first alert leaves. */
export const RECORD_FAIL_THRESHOLD = 5;

/**
 * Minimum delay between two alerts on this key. Note that `opsFail` applies its
 * own persisted 6 h anti-storm window on top, and only re-sends after an
 * `opsOk` closed the previous alert, so the observed cadence is at most one
 * message per incident and not one per hour.
 */
export const RECORD_ALERT_COOLDOWN_MS = 60 * 60 * 1000;

/** Single ops key for the whole family: a broken stats DB is one incident. */
const OPS_KEY = 'stats:record';

const consecutiveFailures = new Map<string, number>();
let lastAlertAt: number | null = null;
let alertOpen = false;

/**
 * Runs `fn` and swallows what it costs to run it.
 *
 * `label` is technical and never carries customer data: it names the operation
 * being recorded (`iban_validate`, `bic_lookup`, ...) so the alert says which
 * writer is failing without saying who was calling.
 */
export function recordSafely(fn: () => unknown, label: string): void {
  let failed = false;
  try {
    if (fn() === false) failed = true;
  } catch (err) {
    failed = true;
    // Kept: the log line is what a human reads while the alert is what wakes
    // them. Removing either one leaves a gap.
    console.error('[record-safely]', label, 'threw:', err instanceof Error ? err.message : err);
  }

  if (failed) noteFailure(label);
  else noteSuccess(label);
}

function noteFailure(label: string): void {
  const fails = (consecutiveFailures.get(label) ?? 0) + 1;
  consecutiveFailures.set(label, fails);
  if (fails < RECORD_FAIL_THRESHOLD) return;
  const now = Date.now();
  if (lastAlertAt !== null && now - lastAlertAt < RECORD_ALERT_COOLDOWN_MS) return;
  lastAlertAt = now;
  alertOpen = true;
  void opsFail(OPS_KEY, `stats write "${label}" has failed ${fails} times in a row. Measurement is down, the API is not.`, 1);
}

function noteSuccess(label: string): void {
  if ((consecutiveFailures.get(label) ?? 0) > 0) consecutiveFailures.set(label, 0);
  if (!alertOpen) return;
  // A recovered silence and a dead probe look identical, so the healing is
  // said out loud. Only fires for an alert that actually left.
  if (anyStreakOpen()) return;
  alertOpen = false;
  lastAlertAt = null;
  void opsOk(OPS_KEY, 'stats writes are landing again.');
}

function anyStreakOpen(): boolean {
  for (const n of consecutiveFailures.values()) if (n >= RECORD_FAIL_THRESHOLD) return true;
  return false;
}

/** Test-only: the streaks are process-wide, so order between tests would leak. */
export function resetRecordSafely(): void {
  consecutiveFailures.clear();
  lastAlertAt = null;
  alertOpen = false;
}

/** Test-only reader: asserting on the counter beats asserting on a side effect. */
export function recordSafelyFailures(label: string): number {
  return consecutiveFailures.get(label) ?? 0;
}
