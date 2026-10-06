import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Allemagne : la méthode de clé de chaque code banque (BLZ).
 *
 * ## D'où vient la table
 *
 * Du champ 9 de la Bankleitzahlendatei publique de la Bundesbank
 * (« Kennzeichen für Prüfzifferberechnungsmethode », Merkblatt
 * Bankleitzahlendatei, Stand: 20. Dezember 2022). scripts/seed-de-pruefziffer.ts
 * la lit chaque mois (workflow refresh-bic.yml) et l'écrit dans
 * data/de-pruefziffer.json, suivi par git.
 *
 * Fichier séparé, et non une colonne de data/bic.sqlite : un robot recommite la
 * base chaque jour ; un changement de schéma y créerait un conflit quotidien.
 *
 * ## Conditions de la source
 *
 * La Bundesbank permet l'usage professionnel de ses informations sans
 * modification, avec la mention « Quelle: Deutsche Bundesbank »
 * (docs/data-sources.md). La table recopie le code tel quel ; la mention
 * voyage avec chaque verdict (`source` du bloc).
 *
 * ## Où le fichier est lu
 *
 * En développement et en CI : data/de-pruefziffer.json. En production, le
 * volume Railway recouvre data/ : le Dockerfile copie le fichier dans
 * reference/ et `DE_PRUEFZIFFER_PATH` le désigne. Un fichier absent ou
 * illisible ne lève jamais d'erreur : l'Allemagne perd ce contrôle
 * (`not_checked`), comme le Royaume-Uni sans sa table Vocalink.
 */
export interface DeMethodTable {
  /** D'où viennent les codes. */
  source: string;
  /** La mention que la Bundesbank demande. */
  attribution: string;
  /** Le jour où le seeder a lu le fichier de la Bundesbank (AAAA-MM-JJ). */
  fetched_on: string;
  /** Code banque (huit chiffres) → code de méthode (deux caractères). */
  methods: Record<string, string>;
}

/**
 * La source, telle que le bloc `national_check_digits` la cite, avec la mention
 * que la Bundesbank demande en tête.
 */
export const DE_TABLE_SOURCE =
  'Quelle: Deutsche Bundesbank (Bankleitzahlendatei, field 9; Prüfzifferberechnungsmethoden, Stand: Juni 2018)';

/** La mention exacte que la Bundesbank demande. */
export const DE_TABLE_ATTRIBUTION = 'Quelle: Deutsche Bundesbank';

/**
 * En dessous, la table est tronquée : le fichier compte environ 3 500 codes
 * banque. Même plancher que scripts/seed-blz.ts.
 */
export const DE_TABLE_MIN_ENTRIES = 2800;

/**
 * Un code de méthode : deux caractères, chiffres ou lettres, jamais la lettre
 * « O » (Merkblatt, champ 9).
 */
export const DE_METHOD_CODE = /^[0-9A-NP-Z]{2}$/;

/** Vrai quand l'objet a la forme d'une table utilisable. */
export function isDeMethodTable(value: unknown): value is DeMethodTable {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<DeMethodTable>;
  if (typeof t.source !== 'string' || typeof t.attribution !== 'string') return false;
  if (typeof t.fetched_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(t.fetched_on)) return false;
  if (typeof t.methods !== 'object' || t.methods === null || Array.isArray(t.methods)) return false;
  const entries = Object.entries(t.methods);
  if (entries.length < DE_TABLE_MIN_ENTRIES) return false;
  return entries.every(
    ([blz, code]) => /^\d{8}$/.test(blz) && typeof code === 'string' && DE_METHOD_CODE.test(code),
  );
}

const __dirname = dirname(fileURLToPath(import.meta.url));

function tablePath(): string {
  // src/lib/national-check/de/ et dist/lib/national-check/de/ sont tous deux à
  // quatre niveaux de la racine : un seul chemin relatif sert les deux arbres.
  return (
    process.env.DE_PRUEFZIFFER_PATH ?? resolve(__dirname, '../../../../data/de-pruefziffer.json')
  );
}

let table: DeMethodTable | null = null;
let loadAttempted = false;

/** La table, lue une fois par processus ; `null` si le fichier manque ou ne tient pas. */
export function loadDeMethodTable(): DeMethodTable | null {
  if (loadAttempted) return table;
  loadAttempted = true;
  try {
    const parsed: unknown = JSON.parse(readFileSync(tablePath(), 'utf8'));
    table = isDeMethodTable(parsed) ? parsed : null;
  } catch {
    table = null;
  }
  return table;
}

/** Oublie la table lue (tests, ou après un rafraîchissement). */
export function resetDeMethodTable(): void {
  table = null;
  loadAttempted = false;
}

/** L'état de la table pour /health : présence, date de lecture, nombre de codes banque. */
export interface DeMethodTableStatus {
  available: boolean;
  fetched_on: string | null;
  bank_codes: number | null;
}

export function deMethodTableStatus(): DeMethodTableStatus {
  const t = loadDeMethodTable();
  if (!t) return { available: false, fetched_on: null, bank_codes: null };
  return { available: true, fetched_on: t.fetched_on, bank_codes: Object.keys(t.methods).length };
}
