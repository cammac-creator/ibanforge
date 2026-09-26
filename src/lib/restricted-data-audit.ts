/**
 * Les contrôles de données qui ont suivi la famille dans la porte privée.
 *
 * ## Pourquoi ce fichier existe
 *
 * Plusieurs tests de ce dépôt confrontaient un texte ou une table écrits à la
 * main à la VRAIE donnée sous conditions : les crédits de la Bank of England
 * (le mois de la liste PRA est une condition de la permission), les exemples
 * officiels de la démo (tous refusés par leur registre), les pays SEPA que la
 * bibliothèque ignore (lus dans le registre EPC). Depuis l'étape du retrait
 * (25/09/2026), la base de ce dépôt ne porte plus ces données : sur elle, ces
 * tests ne peuvent que se sauter. Leurs auteurs avaient écrit où ils devaient
 * aller : « dans la porte de qualité privée, avec la liste ».
 *
 * `npm run overlay -- check` (scripts/restricted-overlay.ts), lancé par le dépôt
 * privé à chaque reconstruction, appelle `auditOverlayData` sur la surcouche
 * qu'il vient de produire, avec la copie du code public qu'il a sous la main.
 * Chaque écart devient une annotation `::warning::` sur la page du passage : un
 * signal pour qu'un humain corrige le texte public, jamais un refus de la
 * surcouche (la donnée servie n'a rien de faux ; c'est un texte public qui
 * retarde).
 *
 * Aucune valeur de la famille dans les messages : des mois, des codes pays, des
 * codes d'exemple déjà publics (src/routes/demo.ts), des noms de fichiers.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type DatabaseType from 'better-sqlite3';
import { SEPA_MEMBERS_EXTRA, SEPA_MEMBERS_EXTRA_AS_OF } from './countries.js';
import type { OverlayKind } from './restricted-family.js';

const require = createRequire(import.meta.url);

/**
 * Chaque surface statique qui crédite la liste PRA, et doit la créditer datée :
 * la permission du 25/08/2026 exige la Bank of England ET le mois de la liste.
 * Une surface statique ne peut pas appeler praAttribution() : c'est ce contrôle
 * qui la tient à jour. Partagé avec src/routes/pra-attribution.test.ts.
 */
export const PRA_CREDIT_SURFACES: readonly string[] = [
  'frontend/public/llms.txt',
  'frontend/public/llms-full.txt',
  'frontend/messages/en.json',
  'frontend/messages/fr.json',
  'frontend/messages/de.json',
  'frontend/content/en/docs/data-sources.mdx',
  'frontend/content/fr/docs/data-sources.mdx',
  'frontend/content/de/docs/data-sources.mdx',
];

/** La forme exacte du crédit, mois compris. */
export const PRA_CREDIT = /Bank of England \(List of Banks, (\d{4}-\d{2})\)/g;

/** Les mois de crédit PRA qu'écrit une surface (chemin relatif à `root`). */
export function praCreditMonths(root: string, relative: string): string[] {
  const text = readFileSync(join(root, relative), 'utf8');
  return [...text.matchAll(PRA_CREDIT)].map((m) => m[1]!);
}

/** Chaque crédit de surface qui nomme un autre mois que `month`, « fichier: mois ». */
export function stalePraCredits(root: string, month: string): string[] {
  return PRA_CREDIT_SURFACES.flatMap((relative) =>
    praCreditMonths(root, relative)
      .filter((m) => m !== month)
      .map((m) => `${relative}: ${m}`),
  );
}

/**
 * Les exemples officiels du registre ISO 13616 que la démo publie comme « refusés
 * par leur registre national » (src/routes/demo.ts, OFFICIAL_EXAMPLE_IBANS) :
 * pays, code bancaire. Écrits ici en clair, sans importer la route : ce module
 * tourne dans la chaîne privée, qui n'a pas à charger l'application.
 * src/lib/restricted-data-audit.test.ts vérifie qu'ils suivent la démo.
 */
export const DEMO_REFUSED_EXAMPLES: ReadonlyArray<{ iban: string; country: string; code: string }> =
  [
    { iban: 'BE68539007547034', country: 'BE', code: '539' },
    { iban: 'AT611904300234573201', country: 'AT', code: '19043' },
  ];

function open(path: string): DatabaseType.Database {
  const Database = require('better-sqlite3') as typeof DatabaseType;
  return new Database(path, { readonly: true, fileMustExist: true });
}

function tableExists(db: DatabaseType.Database, table: string): boolean {
  return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
}

/**
 * Les écarts entre la surcouche `overlayPath` et les textes du code public situé
 * à `root`. Une liste vide : rien à signaler. Ne lève jamais pour un écart ; lève
 * si le fichier ne s'ouvre pas (le contrôle du chargeur l'aura déjà refusé).
 */
export function auditOverlayData(kind: OverlayKind, overlayPath: string, root: string): string[] {
  const warnings: string[] = [];
  const db = open(overlayPath);
  try {
    if (kind === 'bic') {
      if (tableExists(db, 'pra_banks')) {
        const { month } = db.prepare('SELECT MAX(list_month) AS month FROM pra_banks').get() as {
          month: string | null;
        };
        const present = PRA_CREDIT_SURFACES.filter((s) => existsSync(join(root, s)));
        if (month && present.length > 0) {
          const stale = stalePraCredits(root, month);
          if (stale.length > 0)
            warnings.push(
              `Crédit Bank of England : la liste servie est celle de ${month}, mais ` +
                `${stale.length} crédit(s) public(s) nomment un autre mois (${stale.join(' ; ')}). ` +
                'Le mois est une condition de la permission : corriger ces fichiers dans le dépôt public.',
            );
        }
      }
      if (tableExists(db, 'national_bank_codes')) {
        const allocated = db.prepare(
          'SELECT 1 AS ok FROM national_bank_codes WHERE country = ? AND code = ?',
        );
        for (const example of DEMO_REFUSED_EXAMPLES) {
          if (allocated.get(example.country, example.code))
            warnings.push(
              `Démo : l'exemple officiel ${example.iban} (code ${example.code}) est désormais ` +
                `attribué par le registre ${example.country} ; la démo le présente comme refusé. ` +
                "Retirer l'exemple de src/routes/demo.ts (OFFICIAL_EXAMPLE_IBANS).",
            );
        }
      }
    }
    if (kind === 'compliance' && tableExists(db, 'sepa_participants')) {
      const countries = Object.keys(SEPA_MEMBERS_EXTRA);
      const rows = db
        .prepare(
          `SELECT substr(bic8, 5, 2) AS cc, scheme FROM sepa_participants
           WHERE substr(bic8, 5, 2) IN (${countries.map(() => '?').join(', ')})
           GROUP BY cc, scheme`,
        )
        .all(...countries) as Array<{ cc: string; scheme: string }>;
      const fromRegister = new Map<string, Set<string>>();
      for (const row of rows) {
        if (!fromRegister.has(row.cc)) fromRegister.set(row.cc, new Set());
        fromRegister.get(row.cc)!.add(row.scheme);
      }
      for (const [cc, schemes] of Object.entries(SEPA_MEMBERS_EXTRA)) {
        const register = [...(fromRegister.get(cc) ?? [])].sort();
        const table = [...schemes].sort();
        if (register.join(',') !== table.join(','))
          warnings.push(
            `SEPA : ${cc} porte ${table.join(', ') || 'aucun schéma'} dans SEPA_MEMBERS_EXTRA ` +
              `(src/lib/countries.ts, relu en ${SEPA_MEMBERS_EXTRA_AS_OF}) mais ` +
              `${register.join(', ') || 'aucun schéma'} au registre EPC servi. Mettre la table à jour.`,
          );
      }
    }
  } finally {
    db.close();
  }
  return warnings;
}
