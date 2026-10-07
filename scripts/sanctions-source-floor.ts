import { existsSync } from 'node:fs';
import Database from 'better-sqlite3';

/**
 * Le plancher PAR SOURCE des listes de sanctions publiques.
 *
 * ## Le trou que ceci ferme (07.10.2026)
 *
 * Le seul plancher était global : au moins 50 BIC candidats, toutes listes
 * confondues. L'OFAC en fournit plus de 200 à lui seul, si bien qu'une liste
 * qui revenait VIDE passait sans bruit. C'est arrivé à SECO tous les dimanches
 * depuis juillet : téléchargement en échec, rien à reprendre, base publiée sans
 * la liste suisse, robot vert.
 *
 * ## Ce qui est mesuré : la taille de la liste, pas ses BIC
 *
 * L'UE ne désigne que deux banques par un code SWIFT, SECO une dizaine : un
 * plancher en pourcentage de BIC sauterait à la première radiation légitime.
 * La santé d'une SOURCE se lit dans ce qu'elle a publié, compté avant toute
 * extraction : les lignes du fichier SDN pour l'OFAC, les lignes du fichier
 * consolidé pour l'UE, les cibles en vigueur pour SECO. Un fichier tronqué ou
 * vidé y apparaît tout de suite.
 *
 * Une liste est refusée quand :
 * - elle n'a pas pu être lue (téléchargement ou lecture en échec) ;
 * - sa taille est sous le plancher absolu (le premier passage, sans mesure
 *   précédente, n'a que celui-là) ;
 * - sa taille a baissé de plus de `MAX_RECORD_DROP` par rapport à la mesure
 *   inscrite dans la base précédente (`metadata.source_records`) ;
 * - elle ne donne plus aucun BIC alors que la base précédente en portait pour
 *   elle (un changement de format qui laisse le fichier entier).
 *
 * Une liste refusée est traitée comme un téléchargement en échec : reprise de
 * la base précédente si elle a moins de 21 jours (compliance-carry-over.ts),
 * sinon le rafraîchissement échoue et la base en service reste en place. Une
 * liste publique ne part jamais en silence.
 */

/** Les listes publiques que le rafraîchissement du dépôt doit porter. */
export const PUBLIC_SANCTIONS_LISTS = ['EU', 'OFAC', 'SECO'] as const;
export type PublicSanctionsList = (typeof PUBLIC_SANCTIONS_LISTS)[number];

/**
 * Planchers absolus, à peu près la moitié de la taille mesurée. Ils ne servent
 * seuls qu'au premier passage ; ensuite, la comparaison avec la mesure
 * précédente est la règle qui mord.
 */
export const SOURCE_RECORD_FLOORS: Record<PublicSanctionsList, { min: number; unit: string }> = {
  // 19 489 lignes le 04.10.2026.
  OFAC: { min: 10_000, unit: 'SDN rows' },
  // 43 892 lignes le 07.10.2026.
  EU: { min: 20_000, unit: 'CSV lines' },
  // 7 108 cibles en vigueur dans la liste du 28.09.2026.
  SECO: { min: 3_500, unit: 'listed targets' },
};

/**
 * Baisse maximale d'une semaine sur l'autre. Une radiation en masse réelle
 * (un programme levé) reste loin de ce seuil ; un fichier tronqué le franchit.
 */
export const MAX_RECORD_DROP = 0.2;

/** La clé de `metadata` qui garde la taille de chaque liste, en JSON. */
export const SOURCE_RECORDS_KEY = 'source_records';

export interface PreviousSanctions {
  /** Taille de chaque liste au rafraîchissement précédent, quand elle a été inscrite. */
  records: Partial<Record<string, number>>;
  /** Lignes de `sanctioned_entities` par liste dans la base précédente. */
  rows: Partial<Record<string, number>>;
  /** Les autres clés de `metadata` utiles à une reprise (date de liste SECO). */
  meta: Partial<Record<string, string>>;
}

/**
 * Ce que la base en service dit de chaque liste. Ne lève jamais : sans base
 * lisible, seuls les planchers absolus s'appliquent.
 */
export function readPreviousSanctions(previousDbPath: string): PreviousSanctions {
  const empty: PreviousSanctions = { records: {}, rows: {}, meta: {} };
  if (!existsSync(previousDbPath)) return empty;
  let db: Database.Database | null = null;
  try {
    db = new Database(previousDbPath, { readonly: true, fileMustExist: true });
    const out: PreviousSanctions = { records: {}, rows: {}, meta: {} };
    for (const r of db
      .prepare('SELECT source_list, COUNT(*) AS n FROM sanctioned_entities GROUP BY source_list')
      .all() as Array<{ source_list: string; n: number }>) {
      out.rows[r.source_list] = r.n;
    }
    for (const r of db.prepare('SELECT key, value FROM metadata').all() as Array<{
      key: string;
      value: string;
    }>) {
      out.meta[r.key] = r.value;
    }
    const raw = out.meta[SOURCE_RECORDS_KEY];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        for (const [list, n] of Object.entries(parsed)) {
          if (typeof n === 'number' && Number.isFinite(n) && n > 0) out.records[list] = n;
        }
      } catch {
        // Une mesure illisible ne compte pas : les planchers absolus restent.
      }
    }
    return out;
  } catch {
    return empty;
  } finally {
    db?.close();
  }
}

/**
 * Accepte ou refuse une liste qui a été lue. Rend `null` quand elle est
 * acceptée, sinon la raison du refus, écrite pour le journal du robot.
 */
export function judgeSourceSize(
  list: PublicSanctionsList,
  records: number,
  bankRows: number,
  previous: PreviousSanctions,
): string | null {
  const { min, unit } = SOURCE_RECORD_FLOORS[list];
  if (!Number.isFinite(records) || records < min) {
    return `${records} ${unit}, under the absolute floor of ${min}`;
  }
  const before = previous.records[list];
  if (before !== undefined && records < before * (1 - MAX_RECORD_DROP)) {
    const drop = Math.round((1 - records / before) * 100);
    return `${records} ${unit} against ${before} at the previous refresh (down ${drop}%, more than ${Math.round(MAX_RECORD_DROP * 100)}% allowed)`;
  }
  const rowsBefore = previous.rows[list] ?? 0;
  if (bankRows === 0 && rowsBefore > 0) {
    return `no bank BIC read, while the previous database held ${rowsBefore} for this list (format change?)`;
  }
  return null;
}
