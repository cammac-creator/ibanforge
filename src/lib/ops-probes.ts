/**
 * Les sondes horaires de l'alerting OPS (audit B3, 20/08/2026).
 *
 * Séparé de `ops-alert.ts` volontairement : ce fichier connaît le MÉTIER
 * (volume, 5xx, fraîcheur compliance), l'autre ne connaît que le TRANSPORT et
 * l'anti-tempête. Chaque sonde est indépendante et ne jette jamais : une sonde
 * cassée ne doit pas empêcher les autres de tourner.
 *
 * ⚠️ `startOpsProbes()` n'est appelé que depuis `src/index.ts`, JAMAIS depuis
 * `buildApp()` : `src/app.ts` est importé par les tests, et un timer qui part
 * chercher Telegram dans le runner est exactement ce qui rend une suite
 * capricieuse.
 */
import { statfs } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getStatsDB } from './db.js';
import { getComplianceMeta } from './compliance-db.js';
import { FATF_AS_OF } from './compliance-static.js';
import { opsFail, opsOk, checkHeartbeats } from './ops-alert.js';

/**
 * Le point de montage du volume Railway (`railway.toml` → mountPath /app/data).
 *
 * Dérivé de STATS_DB_PATH quand il est posé — c'est la SEULE variable de chemin
 * que ce dépôt connaît (`src/lib/db.ts:48`, `.env.example:45`). Inventer un
 * `DATA_DIR` qui ressemble à une convention maison sans en être une enverrait
 * le prochain lecteur chercher une variable qui n'existe nulle part.
 */
const DATA_DIR = process.env.STATS_DB_PATH ? dirname(process.env.STATS_DB_PATH) : '/app/data';

/**
 * S4 — remplissage du volume Railway.
 *
 * Un chemin absent (poste de dev, mount pas encore monté) est une ABSENCE DE
 * SIGNAL, jamais une alerte : `statfs` jette ENOENT, on logue et on sort.
 */
async function probeVolume(): Promise<void> {
  try {
    const s = await statfs(DATA_DIR);
    const total = Number(s.blocks) * Number(s.bsize);
    const free = Number(s.bavail) * Number(s.bsize);
    if (!total || !Number.isFinite(total)) return;
    const usedPct = Math.round(((total - free) / total) * 100);
    // 92 % : à ce niveau SQLite peut déjà échouer sur un checkpoint WAL, qui a
    // besoin de place pour réécrire — attendre 100 % serait attendre la panne.
    if (usedPct >= 92) {
      await opsFail('volume:critical', `Volume ${DATA_DIR} à ${usedPct} % — purger request_log ou agrandir le volume.`);
    } else if (usedPct >= 80) {
      await opsFail('volume:warn', `Volume ${DATA_DIR} à ${usedPct} %.`);
    } else {
      await opsOk('volume:warn');
      await opsOk('volume:critical');
    }
  } catch (err) {
    console.error('[ops-probe] volume:', err instanceof Error ? err.message : err);
  }
}

/**
 * S5 — taux de 5xx sur la dernière heure.
 *
 * Double condition volontaire : un POURCENTAGE seul ferait hurler la sonde sur
 * un service au repos (1 requête, 1 erreur = 100 %). Le plancher de 5 erreurs
 * absolues est ce qui rend le seuil lisible la nuit.
 * `src/lib/stats.ts` pose la doctrine : « 5xx — real problems, must stay at 0 ».
 *
 * ✅ Le dénominateur est propre — revérifié le 21/08/2026. Railway sonde /health
 * en continu (`railway.toml`) ; si ces appels atterrissaient dans request_log
 * ils domineraient `total` et dilueraient le seuil de 2 % jusqu'à ce qu'il ne se
 * déclenche JAMAIS (une vraie tempête de 5xx sur /v1/* resterait sous 1 % d'un
 * dénominateur fait de pings). Ce n'est pas le cas : `/health` et `/ping` sont
 * dans `SKIP_TRACKING` et ne sont jamais enregistrés (`src/app.ts`).
 * ⚠️ Si quelqu'un retire `/health` de ce Set un jour, cette sonde devient muette
 * en silence — scoper alors la requête sur `path LIKE '/v1/%'`.
 */
async function probeServerErrors(): Promise<void> {
  try {
    const row = getStatsDB()
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN status >= 500 THEN 1 ELSE 0 END) AS s5xx
           FROM request_log
          WHERE created_at >= datetime('now', '-1 hour')`,
      )
      .get() as { total: number; s5xx: number | null } | undefined;
    const total = row?.total ?? 0;
    const s5xx = row?.s5xx ?? 0;
    if (total === 0) return;
    const pct = (s5xx / total) * 100;
    if (s5xx >= 5 && pct > 2) {
      await opsFail('http:5xx', `${s5xx} réponses 5xx sur ${total} requêtes (${pct.toFixed(1)} %) en 1 h.`);
    } else {
      await opsOk('http:5xx');
    }
  } catch (err) {
    console.error('[ops-probe] 5xx:', err instanceof Error ? err.message : err);
  }
}

/**
 * S7 — fraîcheur des listes de sanctions.
 *
 * Le refresh est hebdomadaire (.github/workflows/refresh-compliance.yml).
 * 9 jours = 7 + 2 de marge. Au-delà, `check_compliance` continue de facturer
 * 0,02 $ un score calculé sur des listes périmées, sous une étiquette
 * "pre-payout screening" : c'est le seul angle mort qui abîme la promesse
 * produit sans rien casser techniquement.
 *
 * ⚠️ `sanctions-claims.test.ts` protège contre le COMMIT d'une donnée
 * dégradée ; il ne protège pas contre l'ABSENCE de commit. C'est ce trou-là que
 * cette sonde ferme — et c'est aussi la raison pour laquelle la cadence du cron
 * n'a PAS été accélérée (voir E5-execution.md, chantier 6) : le problème
 * n'était pas la fréquence, c'était le silence.
 */
async function probeComplianceAge(): Promise<void> {
  try {
    // `getComplianceMeta()` (src/lib/compliance-db.ts) lit la table `metadata` ;
    // `sanctions_as_of` y vaut la clé `last_refresh`.
    const meta = getComplianceMeta();
    const asOf = meta.sanctions_as_of;
    if (!asOf) {
      await opsFail('compliance:age', 'sanctions_as_of absent de la base compliance.');
      return;
    }
    const ageDays = (Date.now() - new Date(asOf).getTime()) / 86_400_000;
    if (!Number.isFinite(ageDays)) return;
    if (ageDays > 9) {
      await opsFail('compliance:age', `Listes de sanctions vieilles de ${ageDays.toFixed(1)} j (refresh hebdo attendu).`);
    } else {
      await opsOk('compliance:age', `Listes rafraîchies (${ageDays.toFixed(1)} j).`);
    }
  } catch (err) {
    console.error('[ops-probe] compliance age:', err instanceof Error ? err.message : err);
  }
}

/**
 * Les listes FATF sont maintenues À LA MAIN (compliance-static.ts) et datées
 * par FATF_AS_OF. Leur seule garde était un console.warn dans le script de
 * refresh — un run CI VERT, que ni l'alerte Telegram (déclenchée sur failure
 * seulement) ni le heartbeat ne voyaient. Et la sonde compliance:age ne
 * surveille que sanctions_as_of, que le cron hebdo re-tamponne à chaque run,
 * y compris quand il ré-embarque des listes FATF périmées.
 *
 * Cadence FATF : trois plénières par an (février, juin, octobre). À plus de
 * cinq mois, une plénière a forcément été manquée — la sonde échoue et le
 * canal d'alerte existant s'en charge.
 */
async function probeFatfAge(): Promise<void> {
  try {
    const asOf = new Date(`${FATF_AS_OF}-01T00:00:00Z`);
    const ageDays = (Date.now() - asOf.getTime()) / 86_400_000;
    if (!Number.isFinite(ageDays)) {
      await opsFail('compliance:fatf-age', `FATF_AS_OF illisible: ${FATF_AS_OF}`);
      return;
    }
    if (ageDays > 150) {
      await opsFail(
        'compliance:fatf-age',
        `Listes FATF datées de ${FATF_AS_OF} (${Math.round(ageDays)} j) — une plénière est passée. ` +
          `Recalibrer compliance-static.ts et bump FATF_AS_OF.`,
      );
    } else {
      await opsOk('compliance:fatf-age', `Listes FATF de ${FATF_AS_OF} (${Math.round(ageDays)} j).`);
    }
  } catch (err) {
    console.error('[ops-probe] fatf age:', err instanceof Error ? err.message : err);
  }
}

/** Tick horaire unique : toutes les sondes + les hommes morts. */
async function tick(): Promise<void> {
  await checkHeartbeats();
  await probeVolume();
  await probeServerErrors();
  await probeComplianceAge();
  await probeFatfAge();
}

const TICK_MS = 60 * 60 * 1000;
const BOOT_DELAY_MS = 7 * 60 * 1000; // après les 4 radars (3/4/5/6 min)

export function startOpsProbes(): void {
  if (process.env.OPS_PROBES_DISABLED === '1') {
    console.warn('[ops-probe] désactivé par OPS_PROBES_DISABLED=1');
    return;
  }
  const safeTick = (): void => {
    void tick().catch((err) => console.error('[ops-probe] tick failed:', err instanceof Error ? err.message : err));
  };
  setTimeout(safeTick, BOOT_DELAY_MS).unref();
  setInterval(safeTick, TICK_MS).unref();
}
