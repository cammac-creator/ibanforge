/**
 * Ce que la copie d'avant migration dit à l'exploitation (C18, OPS-25#1).
 *
 * Séparé de pre-migration-copy.ts comme restricted-overlay-ops.ts l'est de la surcouche :
 * ici le TRANSPORT (journal, alertes `opsFail`/`opsOk`), là le mécanisme. Appelé par
 * src/index.ts seulement, jamais par `buildApp()` ; testable sans démarrer le serveur.
 */
import { opsFail, opsOk } from './ops-alert.js';
import { getPreMigrationCopyState, purgeStatsPreMigrationCopies } from './db.js';
import {
  PRE_MIGRATION_COPY_ALERT_KEY,
  describePreMigrationCopy,
  type PreMigrationCopyState,
  type PurgeResult,
} from './pre-migration-copy.js';

/** L'alerte de la purge quotidienne des copies, distincte de celle des autres purges. */
export const PRE_MIGRATION_PURGE_ALERT_KEY = 'retention:pre-migration-copies';

/**
 * Au démarrage, après `initStatsDB` : une migration passée SANS copie (place, borne de
 * taille, échec) n'a pas été bloquée, elle est dite ici, et c'est la seule trace qui quitte
 * la machine. Refermée au démarrage suivant qui n'a rien eu à copier ou qui a copié. Ne
 * jette jamais (`opsFail`/`opsOk` non plus).
 */
export async function reportPreMigrationCopy(
  statsOk: boolean,
  state: PreMigrationCopyState = getPreMigrationCopyState(),
): Promise<void> {
  const report = describePreMigrationCopy(state);
  if (report.alert && report.line) {
    console.error(`[db] ${report.line}`);
    await opsFail(PRE_MIGRATION_COPY_ALERT_KEY, report.line);
    return;
  }
  if (report.line) console.log(`[db] ${report.line}`);
  if (statsOk) {
    await opsOk(PRE_MIGRATION_COPY_ALERT_KEY, 'Démarrage suivant : aucune migration sans copie.');
  }
}

/**
 * Le tick quotidien des copies, dans son propre `try` et sous sa propre clé : une purge de
 * rétention qui échoue ne l'empêche pas de passer, et inversement. Il efface les copies de
 * plus de trente jours même quand le service ne redémarre pas pendant des semaines. Seuil
 * 2, comme la purge de rétention : deux jours sans pouvoir effacer une copie, c'est une
 * promesse de durée qui ne tient plus. Ne jette jamais.
 */
export async function purgePreMigrationCopiesTick(
  purge: () => PurgeResult = purgeStatsPreMigrationCopies,
): Promise<void> {
  try {
    const result = purge();
    if (result.removed.length > 0) {
      console.log(`[db] copies avant migration effacées : ${result.removed.join(', ')}`);
    }
    if (result.failed.length > 0) {
      await opsFail(
        PRE_MIGRATION_PURGE_ALERT_KEY,
        `Copie d’avant migration non effacée : ${result.failed.join(', ')}.`,
        2,
      );
    } else {
      await opsOk(PRE_MIGRATION_PURGE_ALERT_KEY, 'Copies d’avant migration de nouveau purgées.');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[db] purge des copies avant migration en échec :', msg);
    await opsFail(
      PRE_MIGRATION_PURGE_ALERT_KEY,
      `Purge des copies d’avant migration en échec : ${msg}`,
      2,
    );
  }
}
