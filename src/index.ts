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
import { closeAll, initStatsDB, checkpointStatsWal, getBicDB } from './lib/db.js';
import { getComplianceDB } from './lib/compliance-db.js';
import { buildApp } from './app.js';
import { ensureWalletConfigured } from './middleware/x402.js';
import { purgeOldRequestLog, purgeTerminatedKeyTelemetry } from './lib/stats.js';
import { purgeExpiredVerifications } from './lib/key-creation-guard.js';
import { purgeAccountTables } from './lib/account.js';
import { purgeExpiredDeviceCodes } from './lib/device-grant.js';
import { purgeExpiredAuditJobs } from './lib/audit-jobs.js';
import { purgeLineageFacts } from './lib/lineage-facts.js';
import { reviewLedgerVolume, snapshotTrialDay, sweepDailyLedger } from './lib/daily-ip-ledger.js';
import { startLifecycleRadar } from './lib/lifecycle-radar-server.js';
import { startForumRadar } from './lib/forum-radar-server.js';
import { startProspectRadar } from './lib/prospect-radar-server.js';
import { startCohortRadar } from './lib/cohort-radar-server.js';
import { startMonthlyDemandLoop } from './lib/demand-proposal-server.js';
import { startActivationNudge } from './lib/activation-nudge-server.js';
import { startOpsProbes } from './lib/ops-probes.js';
import { opsFail, opsOk } from './lib/ops-alert.js';
import {
  describeOverlayStatus,
  reloadRestrictedOverlays,
  restrictedOverlayFilesChanged,
  restrictedOverlayStatus,
  type OverlayStatus,
} from './lib/restricted-overlay-runtime.js';
import { recordEvent } from './lib/events.js';

// Fail-fast: refuse to start in production without wallet config
ensureWalletConfigured();

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version: string };

// 🚨 Open the stats database BEFORE buildApp(), and survive it failing.
//
// Audit 2026-09-01, finding PERF-03: a corrupt `stats.sqlite` used to throw
// while `src/app.ts` was still importing (`src/routes/feedback.ts` calls
// getStatsDB() as a module side effect), so this process died before `serve()`.
// No listener, no `/health`, and at `restartPolicyMaxRetries = 3` Railway stops
// trying — while every watchdog we own (`ops-probes`) lives inside the process
// that just died. Measured worst case: a month of downtime with all CI green.
//
// A service that answers a diagnosed 503 is infinitely more useful than a
// container that does not exist. The alert below is the only thing that leaves
// the box; `opsFail` swallows its own errors, so a stats database too broken to
// hold the alert counter cannot re-kill the boot.
const statsState = initStatsDB();
if (!statsState.ok) {
  console.error(`FATAL-BUT-SURVIVED: stats database unusable — ${statsState.error}`);
  void opsFail(
    'db:stats',
    `Base stats illisible au démarrage : ${statsState.error ?? 'cause inconnue'}. ` +
      "L'API écoute et répond 503 sur /health ; clés, quotas et crédits sont hors service.",
  );
}

// ─── Surcouche privée des données sous conditions (étape 3, 25/09/2026) ──────
//
// `entrypoint.sh` vient de recopier les deux bases publiques depuis l'image.
// Ouvrir les deux connexions ICI, avant la première requête, fait la fusion au
// démarrage (src/lib/restricted-overlay-runtime.ts) plutôt qu'au premier
// client, et permet d'en dire le résultat : au journal, et par l'alerte
// d'exploitation quand une surcouche configurée n'a pas pu être servie. Sans
// variable, rien ne change : les bases publiques s'ouvrent comme avant.
//
// Une base publique illisible ne fait pas tomber le démarrage ici : elle lève à
// la première requête, exactement comme avant ce bloc.
function reportRestrictedOverlays(statuses: OverlayStatus[]): void {
  for (const status of statuses) {
    const line = describeOverlayStatus(status);
    const key = `overlay:${status.kind}`;
    if (status.state === 'applied' || status.state === 'off') {
      console.log(line);
      void opsOk(key, status.state === 'applied' ? 'surcouche privée servie' : '');
    } else {
      console.error(line);
      void opsFail(
        key,
        `Surcouche privée ${status.kind} ${status.state === 'partial' ? 'servie en partie' : 'NON servie'} : ` +
          `${
            status.error ??
            status.members
              .filter((m) => m.state !== 'applied')
              .map((m) => `${m.id} (${m.reason})`)
              .join(', ')
          }. ` +
          'Les données manquantes répondent « non consulté ».',
      );
    }
    // Tant que la base publique porte encore la famille (jusqu'à l'étape du
    // retrait), la surcouche REMPLACE des lignes que le robot public rafraîchit
    // chaque semaine (EPC, ONU) et chaque mois (le reste). Une différence veut
    // presque toujours dire une surcouche plus ancienne que le dernier
    // rafraîchissement public : la dire, pour ré-extraire.
    const drift = status.members.filter((m) => m.identical_to_public === false).map((m) => m.id);
    if (drift.length > 0) {
      console.error(`[surcouche] ${status.kind} : différente du public pour ${drift.join(', ')}`);
      void opsFail(
        `overlay:${status.kind}:drift`,
        `Surcouche privée ${status.kind} différente des lignes publiques qu'elle remplace (${drift.join(', ')}) : ` +
          'plus ancienne que le dernier rafraîchissement public ? La ré-extraire et la redéposer.',
      );
    } else if (status.state !== 'off') {
      void opsOk(`overlay:${status.kind}:drift`);
    }
  }
}

try {
  getBicDB();
  getComplianceDB();
} catch (err) {
  console.error(
    'Reference database open failed at boot:',
    err instanceof Error ? err.message : err,
  );
}
reportRestrictedOverlays(restrictedOverlayStatus());

// Un fichier privé remplacé (dépôt manuel, puis tirage automatique à l'étape
// suivante) est rechargé sans redémarrage : un `stat` par base toutes les dix
// minutes, une fusion seulement quand le fichier a changé. Une surcouche neuve
// refusée laisse la précédente en service et prévient.
const OVERLAY_WATCH_MS = 10 * 60 * 1000;
setInterval(() => {
  try {
    if (!restrictedOverlayFilesChanged()) return;
    for (const outcome of reloadRestrictedOverlays()) {
      if (outcome.rejected) {
        console.error(
          `${describeOverlayStatus(outcome.rejected)} — la version précédente reste servie`,
        );
        void opsFail(
          `overlay:${outcome.kind}:reload`,
          `Nouvelle surcouche ${outcome.kind} refusée (${outcome.rejected.error ?? 'membres refusés'}) : la précédente reste servie.`,
        );
      } else if (outcome.changed) {
        reportRestrictedOverlays([outcome.status]);
        void opsOk(`overlay:${outcome.kind}:reload`, 'surcouche rechargée');
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Restricted overlay reload failed:', msg);
    void opsFail('overlay:reload', `Rechargement de la surcouche en échec : ${msg}`);
  }
}, OVERLAY_WATCH_MS).unref();

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
  if (purgedTerminated > 0)
    console.log(
      `Retention: purged ${purgedTerminated} request_log rows of terminated keys (DPA 4.7)`,
    );
  purgeExpiredVerifications();
  // Les codes de connexion expirés et les sessions du compte client expirées
  // ou révoquées depuis plus d'un jour (lot C1) : aux deux mêmes endroits que
  // la purge des vérifications, pour la même raison qu'elle.
  purgeAccountTables();
  // Les grants d'appareil et le journal de leurs tentatives, aux DEUX mêmes
  // endroits que la purge des vérifications. 🚨 L'étape qui révoque une clé
  // approuvée que personne n'est venu chercher est le point le plus facile à
  // oublier : sans elle, chaque approbation dont l'agent est mort entre-temps
  // laisse une clé active que PERSONNE ne détient, invisible dans les
  // statistiques d'usage et impossible à rattacher à quiconque.
  purgeExpiredDeviceCodes();
  // Les faits de mesure de l'essai, alignés sur les 12 mois de request_log et
  // sur AUCUNE promesse nouvelle (lot M). Au démarrage aussi, et pas seulement
  // dans le tick de 24 h : un redéploiement quotidien ferait que le tick ne
  // tombe jamais, et la purge ne s'exécuterait jamais.
  purgeLineageFacts(12);
} catch (err) {
  console.error('Retention purge failed at boot:', err);
}
// Right after the purges, and again on every daily tick: the deletions above
// are exactly what fills the write-ahead log, and nothing else in this service
// ever checkpoints it (audit 2026-09-01, finding PERF-09 — only SQLite's
// passive auto-checkpoint at 1 000 pages ran, and a long-lived reader keeps it
// from truncating). On a Railway volume an unbounded WAL is disk that never
// comes back. Non-throwing by construction: housekeeping must not cost a boot.
checkpointStatsWal();
setInterval(
  () => {
    try {
      purgeOldRequestLog(12);
      purgeTerminatedKeyTelemetry(30);
      purgeExpiredVerifications();
      purgeAccountTables();
      purgeExpiredDeviceCodes();
      purgeLineageFacts(12);
      checkpointStatsWal();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Retention purge failed:', msg);
      // Seuil 2 : la purge tourne toutes les 24 h et porte un engagement DPA
      // (clause 4.7). Deux échecs = 48 h de données qui auraient dû disparaître,
      // et c'est le seul angle mort de l'audit B3 dont la conséquence est
      // juridique. Un `console.error` seul ne prévient personne.
      void opsFail('retention:purge', `Purge de rétention en échec : ${msg}`, 2);
    }
  },
  24 * 60 * 60 * 1000,
).unref();

// ─── Creditor-audit reports: the clock that makes the promise true ──────────
//
// An audit report carries the bank details of the customer's creditors, and
// /audit promises they disappear — two hours after an unpaid upload, twenty-four
// hours after payment. Until 22/09/2026 `purgeExpiredAuditJobs()` was called
// from two places only: the upload route and the status route. A promise of
// erasure whose only clock is the next customer is not a promise: on a quiet
// week an expired report simply stayed on the volume until someone happened to
// upload a file.
//
// Ten minutes rather than the 24 h retention interval above: the shorter of the
// two deadlines is two hours, and a daily sweep would overshoot it twelvefold.
// The call is one indexed DELETE, so its cost is the wake-up.
const AUDIT_PURGE_MS = 10 * 60 * 1000;

function auditReportPurgeTick(): void {
  try {
    const purged = purgeExpiredAuditJobs();
    if (purged > 0) console.log(`Retention: purged ${purged} expired audit report(s)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Audit report purge failed:', msg);
    // Seuil 3 : le tick passe six fois par heure, donc trois échecs de suite ne
    // sont plus un hoquet — c'est une demi-heure sans horloge sur les
    // coordonnées bancaires de tiers, et la page continue de promettre.
    void opsFail('retention:audit', `Purge des rapports d'audit de fichier en échec : ${msg}`, 3);
  }
}
auditReportPurgeTick();
setInterval(auditReportPurgeTick, AUDIT_PURGE_MS).unref();

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

// Monthly turn of the living tool: the demand ledger proposes the next
// register or BIC to plug, once per month (see demand-proposal-server.ts).
startMonthlyDemandLoop();

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

// ─── Registre des franchises d'essai : trace, purge, contre-pression ─────────
//
// Le registre était une Map de niveau module avec son propre `setInterval` ;
// depuis son portage en base (15/09/2026), ce minuteur ne peut plus vivre dans
// le module : il ouvrirait `stats.sqlite` au simple import, y compris dans les
// suites de tests qui n'en veulent pas, et avant `initStatsDB()`. Il vit donc
// ici, avec les autres travaux d'entretien.
//
// 🚨 L'ORDRE est le point : `snapshotTrialDay(hier)` PUIS la purge. Inversé, la
// colonne `rest_attempts_uncounted` — l'ampleur réelle d'une rafale, tenue en
// mémoire — est perdue tous les jours, en silence.
//
// Cadence horaire et pas quotidienne : une journée de rotation de sources peut
// créer beaucoup de lignes, et attendre 24 h pour les rendre est précisément le
// scénario que la contre-pression de volume borne.
function trialLedgerTick(): void {
  try {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    snapshotTrialDay(yesterday);
    const purged = sweepDailyLedger();
    if (purged > 0) console.log(`Retention: swept ${purged} trial ledger entries`);
    reviewLedgerVolume();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('Trial ledger sweep failed:', msg);
    // Seuil 2 : le tick tourne toutes les heures, et deux échecs de suite
    // signifient qu'une journée d'essai part à la purge sans laisser de trace.
    void opsFail('trial:sweep', `Entretien du registre d'essai en échec : ${msg}`, 2);
  }
}
trialLedgerTick();
setInterval(trialLedgerTick, 60 * 60 * 1000).unref();

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
  console.log(
    `\n${signal} received. Draining in-flight requests (max ${DRAIN_TIMEOUT_MS / 1000}s)...`,
  );

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
    console.warn(
      `Shutdown: drain timed out after ${DRAIN_TIMEOUT_MS / 1000}s — closing remaining connections.`,
    );
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
