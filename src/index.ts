/**
 * Process entry point.
 *
 * Everything about WHAT the service answers lives in `src/app.ts`
 * (`buildApp()`, testable). This file owns what a test must never run: the
 * fail-closed wallet check, the listening socket, the background radars, the
 * retention purges and a drained shutdown.
 */
import { serve, type ServerType } from '@hono/node-server';
import { createRequire } from 'node:module';
import { closeAll } from './lib/db.js';
import { buildApp } from './app.js';
import { ensureWalletConfigured } from './middleware/x402.js';
import { purgeOldRequestLog, purgeTerminatedKeyTelemetry } from './lib/stats.js';
import { purgeExpiredVerifications } from './lib/key-creation-guard.js';
import { startLifecycleRadar } from './lib/lifecycle-radar-server.js';
import { startForumRadar } from './lib/forum-radar-server.js';
import { startProspectRadar } from './lib/prospect-radar-server.js';
import { startCohortRadar } from './lib/cohort-radar-server.js';
import { startActivationNudge } from './lib/activation-nudge-server.js';
import { startOpsProbes } from './lib/ops-probes.js';
import { opsFail } from './lib/ops-alert.js';
import { recordEvent } from './lib/events.js';

// Fail-fast: refuse to start in production without wallet config
ensureWalletConfigured();

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

const app = buildApp();

const port = parseInt(process.env.PORT ?? '3000', 10);

const server: ServerType = serve({ fetch: app.fetch, port }, () => {
  console.log(`IBANforge running on http://localhost:${port}`);
});

// Deploy marker for the dashboard charts. recordEvent dedups same-version
// boots within 6 h, so Railway restarts don't stripe the timeline.
try {
  recordEvent('deploy', `v${pkg.version}`);
} catch (err) {
  console.error('Deploy event not recorded:', err);
}

// Retention: purge request metadata older than 12 months (privacy policy
// commitment), and telemetry of terminated customers 30 days after their
// last key was deactivated (DPA clause 4.7 — deletion by default, not on
// request). At boot, then daily.
try {
  const purged = purgeOldRequestLog(12);
  if (purged > 0) console.log(`Retention: purged ${purged} request_log rows older than 12 months`);
  const purgedTerminated = purgeTerminatedKeyTelemetry(30);
  if (purgedTerminated > 0) console.log(`Retention: purged ${purgedTerminated} request_log rows of terminated keys (DPA 4.7)`);
  purgeExpiredVerifications();
} catch (err) {
  console.error('Retention purge failed at boot:', err);
}
setInterval(() => {
  try {
    purgeOldRequestLog(12);
    purgeTerminatedKeyTelemetry(30);
    purgeExpiredVerifications();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Retention purge failed:', msg);
    // Seuil 2 : la purge tourne toutes les 24 h et porte un engagement DPA
    // (clause 4.7). Deux échecs = 48 h de données qui auraient dû disparaître,
    // et c'est le seul angle mort de l'audit B3 dont la conséquence est
    // juridique. Un `console.error` seul ne prévient personne.
    void opsFail('retention:purge', `Purge de rétention en échec : ${msg}`, 2);
  }
}, 24 * 60 * 60 * 1000).unref();

// Daily commercial lifecycle radar, in-process — the customer ledger must not
// transit an external CI runner (see lifecycle-radar-server.ts).
startLifecycleRadar(port);

// Daily community radar: scored forum/issue threads + marketplace presence
// for the CRM "Forums" tab (see forum-radar-server.ts).
startForumRadar();

// Prospect enrichment radar: published own-domain addresses + EN/FR draft
// mails for the harvest's leftovers (see prospect-radar-server.ts).
startProspectRadar();

// Signup cohort radar: collapses a burst of automated signups into one CRM
// dossier and off the monthly reset (see cohort-radar-server.ts).
startCohortRadar();

// Daily first-call pass: one nudge, ever, to a key that never called, and a
// founder draft in the CRM for each new signup (see activation-nudge-server.ts).
// The nudge is the only thing here that leaves on its own; the draft waits for
// a human. Kill switch: ACTIVATION_NUDGE_DISABLED=1.
startActivationNudge();

// Sondes OPS horaires : hommes morts (crons GitHub + les 4 radars, lus dans
// kv_state sans jamais l'écrire), remplissage du volume, taux de 5xx, âge des
// listes de sanctions. Audit B3 (20/08/2026) : les 15 automatisations sont
// fail-soft mais aucune n'avait de sonde de vie — une panne et une semaine
// calme produisaient exactement le même silence.
startOpsProbes();

// ─── Drained shutdown ────────────────────────────────────────────────────────
//
// Until 20/08/2026 this was `closeAll()` + `process.exit(0)`, with the handle
// returned by `serve()` thrown away. At the SIGTERM of a Railway redeploy the
// in-flight requests were therefore cut mid-flight, and the audit named the
// concrete costs: a credit already debited whose 4xx refund never runs, an
// x402 settlement whose response — the freshly minted key, for
// /v1/credits/buy — never reaches the buyer who paid for it, and handlers
// still writing into a database closed under them.
//
// The sequence now is: stop accepting, let what is in flight finish (bounded),
// then close the databases. The retention interval and all four radars are
// already `unref()`ed, so nothing else holds the loop open.
const DRAIN_TIMEOUT_MS = 8_000;

let shuttingDown = false;

function gracefulShutdown(signal: string): void {
  // Railway sends SIGTERM and may repeat it; a second signal must not restart
  // the sequence (nor close the databases while the first drain still runs).
  if (shuttingDown) {
    console.log(`${signal} received again during shutdown — forcing exit.`);
    process.exit(0);
  }
  shuttingDown = true;
  console.log(`\n${signal} received. Draining in-flight requests (max ${DRAIN_TIMEOUT_MS / 1000}s)...`);

  let finished = false;
  const finish = (reason: string): void => {
    if (finished) return;
    finished = true;
    clearTimeout(deadline);
    console.log(`Shutdown: ${reason}. Closing database connections...`);
    closeAll();
    console.log('Shutdown: complete.');
    process.exit(0);
  };

  // Bounded wait. Keep-alive connections would otherwise keep `close()` from
  // ever calling back, so past the deadline we cut the sockets ourselves
  // instead of hanging until the platform kills the container.
  const deadline = setTimeout(() => {
    console.warn(`Shutdown: drain timed out after ${DRAIN_TIMEOUT_MS / 1000}s — closing remaining connections.`);
    (server as { closeAllConnections?: () => void }).closeAllConnections?.();
    finish('drain deadline reached');
  }, DRAIN_TIMEOUT_MS);
  deadline.unref();

  // Stop accepting new connections; the callback fires once every in-flight
  // request has been answered.
  server.close(() => finish('all in-flight requests completed'));
  // Idle keep-alive sockets carry no request — releasing them immediately is
  // what lets the drain finish in milliseconds on a quiet redeploy.
  (server as { closeIdleConnections?: () => void }).closeIdleConnections?.();
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Safety net. The x402 SDK kicks off a facilitator sync when the paywall is
// constructed and detaches that promise on routes that require no payment, so
// with the default Node behavior a CDP outage turns any anonymous hit on a
// free /v1/* route into a process crash — and Railway stops restarting after
// 3 failures, taking paying key holders down with it. Log and stay up.
process.on('unhandledRejection', (reason) => {
  console.error(
    '[unhandledRejection]',
    reason instanceof Error ? (reason.stack ?? reason.message) : reason,
  );
  // 97c0f9a a rendu la panne du facilitator SURVIVABLE — et donc INVISIBLE :
  // avant, Railway redémarrait et l'indisponibilité se remarquait ; depuis, le
  // service répond normalement pendant que les règlements x402 échouent en
  // silence. Cette ligne rend le signal que le correctif de résilience a
  // supprimé. Seuil 3 : un hoquet réseau isolé ne réveille personne.
  //
  // ⚠️ Le filtre ne contient PAS `verify`, que le design B3 proposait. Ce mot
  // apparaît dans des rejets qui n'ont rien à voir avec le paiement — « unable
  // to verify the first certificate » sur n'importe quel appel sortant (les
  // radars appellent Anthropic, GitHub, Telegram), et nos propres chemins de
  // vérification d'e-mail ou de BIC. Le seuil borne la fréquence, pas
  // l'étiquette : trois incidents TLS d'un radar produiraient une alerte
  // intitulée « côté paiement », c'est-à-dire une alerte qui ment. Les trois
  // termes restants ne désignent que le chemin x402.
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (/facilitator|x402|settle/i.test(msg)) {
    void opsFail('x402:facilitator', `Rejet non géré côté paiement : ${msg}`, 3);
  }
});
