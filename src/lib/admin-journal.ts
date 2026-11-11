/**
 * Le journal des entrées d'administration (C10, audit SEC-01#3, 11.11.2026).
 *
 * ## Pourquoi
 *
 * Un secret d'administration copié dans plusieurs environnements, et des clés à
 * portée qui ouvrent chacune une liste de routes : jusqu'ici, aucun de leurs
 * usages ne laissait de trace propre. Une fuite pouvait créer des clés, lire le
 * registre des clients ou poser un brouillon sans que rien ne le dise.
 *
 * ## Ce qui est écrit, et où
 *
 * Une ligne de `admin_calls` (schéma : `migrateAdminCalls`, src/lib/db.ts) par
 * passage à la porte, accepté ou refusé (401, 403) : la route sous sa forme de
 * gabarit, la méthode, le nom de la clé reconnue (`full`, ou le nom de la
 * variable d'une clé à portée ; jamais sa valeur ni son empreinte), si un en-tête
 * a été présenté, l'empreinte salée de l'adresse IP (`hashIp`, la même que le
 * journal des requêtes), le statut de la réponse et la date. Jamais un corps de
 * requête, jamais l'adresse demandée ni sa chaîne de requête (`?to=` d'un essai
 * d'envoi porte une adresse, `:session_id` un identifiant de paiement).
 *
 * Branché à UN endroit : la porte (`authorizeAdmin`, src/lib/admin-auth.ts), par
 * le crochet `setAdminCallSink`, posé au chargement des routes d'administration
 * (`installAdminJournal`, appelé par src/routes/api-keys.ts). Jamais dans
 * `adminDecision` ni `isAdminAuthorizedFor` : le limiteur de débit les appelle
 * aussi, et chaque requête ferait deux lignes.
 *
 * ## Le statut de la réponse
 *
 * La porte passe AVANT le gestionnaire : le 201 d'une création de clé n'existe pas
 * encore. La ligne est donc écrite à la porte, statut vide, et complétée quand la
 * réponse est posée sur le contexte. Hono la pose par `c.res = …` à la sortie du
 * gestionnaire, et aussi pour la réponse d'une exception (le 403 de la porte) :
 * un accesseur posé sur CE contexte, qui délègue à celui de Hono, la voit passer.
 * Seule la première affectation compte (un intergiciel peut en reposer une
 * copie plus tard). Si Hono changeait cette mécanique, la ligne resterait écrite,
 * statut vide, et `admin-journal.test.ts` le dirait.
 *
 * 🚨 Hono ne pose PAS la réponse sur le contexte quand une seule fonction répond
 * à la requête (aucun intergiciel global) : il la rend directement. Sur une
 * telle application, chaque ligne resterait sans statut, et les alertes qui
 * exigent un 2xx se tairaient. L'application de production a des intergiciels
 * globaux, et un test le vérifie sous le vrai serveur Node ; une ligne restée
 * sans statut dix minutes après son écriture est en outre dite en console, au
 * passage suivant à la porte (`warnRowsWithoutStatus`).
 *
 * ## Les alertes
 *
 * Le journal remet chaque passage et chaque réponse à `src/lib/admin-alerts.ts` :
 * rafale de refus, clé créée ou importée, plafond relevé, sauvegarde hors de sa
 * plage. Elles ne dépendent pas de l'écriture de la ligne.
 *
 * ## Ce que le journal ne fait jamais
 *
 * Faire échouer une requête d'administration : chaque écriture est gardée, une
 * erreur part en console et la requête continue. Ni compteur qui verrouille, ni
 * refus fondé sur le journal (écarté par l'audit : risque de fermer son propre
 * tableau de bord).
 *
 * ## Rétention
 *
 * Douze mois, la durée du journal des requêtes (`purgeOldRequestLog`) : même
 * nature de ligne (une requête, une empreinte d'adresse), même durée. Purgé au
 * démarrage et chaque jour par src/index.ts (`purgeAdminCalls`).
 */
import type { Context } from 'hono';
import { noteAdminResponse, noteGatePassage } from './admin-alerts.js';
import { setAdminCallSink, type AdminGateCall } from './admin-auth.js';
import { getStatsDB } from './db.js';
import { extractClientIp, hashIp } from './stats.js';

/** Douze mois, comme le journal des requêtes. */
export const ADMIN_CALLS_RETENTION_MONTHS = 12;

/** `2026-11-11T08:00:00.123Z` → `2026-11-11 08:00:00`, la forme de `datetime('now')`. */
function sqlTime(at: Date): string {
  return at.toISOString().replace('T', ' ').slice(0, 19);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** L'empreinte salée de l'adresse de l'appelant, lue comme le journal des requêtes. */
function sourceOf(c: Context): string | null {
  return hashIp(
    extractClientIp({
      'x-forwarded-for': c.req.header('x-forwarded-for') ?? null,
      'x-real-ip': c.req.header('x-real-ip') ?? null,
    }),
  );
}

/**
 * Appelle `done` avec le statut de la PREMIÈRE réponse posée sur ce contexte.
 * Faux si l'accesseur de Hono est introuvable (la ligne garde alors un statut vide).
 */
function onFirstResponse(c: Context, done: (status: number) => void): boolean {
  let proto: object | null = Object.getPrototypeOf(c) as object | null;
  let desc: PropertyDescriptor | undefined;
  while (proto && !desc) {
    desc = Object.getOwnPropertyDescriptor(proto, 'res');
    proto = Object.getPrototypeOf(proto) as object | null;
  }
  const get = desc?.get;
  const set = desc?.set;
  if (!get || !set) return false;
  let seen = false;
  Object.defineProperty(c, 'res', {
    configurable: true,
    enumerable: desc?.enumerable ?? false,
    get(this: Context) {
      return get.call(this) as Response;
    },
    set(this: Context, value: Response) {
      set.call(this, value);
      if (seen || !value) return;
      seen = true;
      try {
        done(value.status);
      } catch (err) {
        console.error('[admin-journal] statut non écrit :', message(err));
      }
    },
  });
  return true;
}

/**
 * Au-delà, une ligne sans statut est dite en console : bien plus long que toute
 * réponse d'administration, sauvegarde comprise.
 */
export const ADMIN_CALL_STATUS_LATE_MS = 10 * 60_000;
/** Les lignes écrites qui attendent leur statut, au plus ce nombre (les plus anciennes sortent). */
const MAX_AWAITING_STATUS = 1_000;
/** Identifiant de ligne → instant d'écriture, dans l'ordre d'écriture. */
const awaitingStatus = new Map<number, number>();

/**
 * Dit en console les lignes restées sans statut plus de ADMIN_CALL_STATUS_LATE_MS
 * après leur écriture, et les oublie. Appelée à chaque passage à la porte. Rend
 * leur nombre. Ne jette jamais.
 */
export function warnRowsWithoutStatus(now: number = Date.now()): number {
  let late = 0;
  for (const [id, at] of awaitingStatus) {
    if (now - at < ADMIN_CALL_STATUS_LATE_MS) break;
    awaitingStatus.delete(id);
    late++;
  }
  if (late > 0) {
    console.warn(
      `[admin-journal] ${late} ligne(s) de admin_calls sans statut ${ADMIN_CALL_STATUS_LATE_MS / 60_000} minutes ` +
        'après leur écriture : la réponse n’a pas été vue sur le contexte (application sans intergiciel ' +
        'global ?). Les alertes qui exigent un 2xx se taisent pour ces lignes.',
    );
  }
  return late;
}

/** Une étape gardée : son échec part en console, jamais dans la requête. */
function guarded(what: string, step: () => void): void {
  try {
    step();
  } catch (err) {
    console.error(`[admin-journal] ${what} :`, message(err));
  }
}

/**
 * Le crochet de la porte : écrit la ligne, compte un refus pour les rafales
 * (`src/lib/admin-alerts.ts`), puis complète la ligne du statut de la réponse et
 * lève l'alerte d'événement de la route s'il y en a une. Les alertes ne
 * dépendent pas de l'écriture : une base en panne n'éteint pas le signal.
 * Ne jette jamais.
 */
export function recordAdminCall(c: Context, call: AdminGateCall): void {
  const at = new Date();
  guarded('lignes sans statut non relevées', () => warnRowsWithoutStatus(at.getTime()));
  const source = sourceOf(c);
  let rowId: number | null = null;
  try {
    const info = getStatsDB()
      .prepare(
        `INSERT INTO admin_calls (created_at, method, route, scope, presented, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(sqlTime(at), call.method, call.route, call.key, call.presented ? 1 : 0, source);
    rowId = Number(info.lastInsertRowid);
  } catch (err) {
    console.error('[admin-journal] ligne non écrite :', message(err));
  }
  guarded('rafale non comptée', () => noteGatePassage(call, source, at.getTime()));
  const hooked = onFirstResponse(c, (status) => {
    if (rowId !== null) {
      awaitingStatus.delete(rowId);
      guarded('statut non écrit', () => {
        getStatsDB().prepare('UPDATE admin_calls SET status = ? WHERE id = ?').run(status, rowId);
      });
    }
    guarded('alerte non levée', () => noteAdminResponse(call, status, at, rowId));
  });
  if (!hooked) console.error('[admin-journal] statut de la réponse illisible : ligne sans statut');
  else if (rowId !== null) {
    awaitingStatus.set(rowId, at.getTime());
    while (awaitingStatus.size > MAX_AWAITING_STATUS) {
      const oldest = awaitingStatus.keys().next().value;
      if (oldest === undefined) break;
      awaitingStatus.delete(oldest);
    }
  }
}

/** Branche le journal sur la porte. Idempotent. */
export function installAdminJournal(): void {
  setAdminCallSink(recordAdminCall);
}

/**
 * Efface les lignes de plus de `months` mois. Rend le nombre de lignes effacées.
 * Appelée par la purge de rétention de src/index.ts, au démarrage et chaque jour.
 */
export function purgeAdminCalls(months: number = ADMIN_CALLS_RETENTION_MONTHS): number {
  return getStatsDB()
    .prepare(`DELETE FROM admin_calls WHERE created_at < datetime('now', '-' || ? || ' months')`)
    .run(months).changes;
}
