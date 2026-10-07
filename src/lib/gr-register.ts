import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

/**
 * Le registre grec : l'index HEBIC de la Hellenic Bank Association (HBA), servi
 * depuis un fichier PRIVÉ, sur le modèle du registre luxembourgeois
 * (src/lib/lu-register.ts). Aucune ligne HEBIC n'entre dans ce dépôt public,
 * dans data/bic.sqlite, dans un export du site ni dans un paquet.
 *
 * ## Pourquoi un fichier privé (07/10/2026)
 *
 * La permission écrite de la HBA (08/09/2026) porte sur la réutilisation des
 * fichiers HEBIC « in its API responses », normalisés et crédités. C'est la
 * portée de la lettre de l'ABBL, qui a mené au fichier privé luxembourgeois, et
 * la décision de Claude-Alain du 24/09/2026 fait sortir du dépôt public tout ce
 * qui n'y est pas redistribuable. Les anciennes branches `registre-gr-*`
 * (09/09/2026), qui écrivaient les 35 codes dans la base publique, un export et
 * des pages statiques, ne sont pas reprises.
 *
 * ## Pourquoi un registre PARTIEL, jamais dans NATIONAL_REGISTERS
 *
 * La HBA a précisé le 14/09/2026 que HEBIC ne couvre pas les établissements de
 * paiement et de monnaie électronique qui émettent des IBAN grecs (elle renvoie
 * à la Bank of Greece pour leurs codes). Un code présent nomme son titulaire ;
 * un code absent ne dit rien et retombe sur la réponse que la Grèce recevait
 * avant (la carte composite). Le piège est documenté dans enrich.ts : dans
 * NATIONAL_REGISTERS, une absence deviendrait `not_allocated`, et
 * `registerDown = !!national` ferait dire « registre non consulté » à un
 * registre qui a répondu.
 *
 * ## Les deux conditions de la HBA, sur chaque réponse qui sert une ligne HEBIC
 *
 * 1. Le crédit exact « Source: Hellenic Bank Association (HEBIC) ».
 * 2. L'« Important Note » reproduite EN ENTIER, jamais résumée ni traduite.
 * Les deux voyagent dans `bank_code_check.register`, le seul champ présent sur
 * chaque réponse que ce registre décide (le choix déjà fait pour la Banca
 * d'Italia, la ČNB et la BNB). HEBIC ne publie ni BIC ni LEI : le bloc `bic`
 * reste celui de la carte composite, qui ne sert aucune donnée HEBIC.
 *
 * ## Aucune date inventée
 *
 * La HBA ne date pas ses éditions (confirmé le 14/09/2026) : la page nomme
 * l'édition (« Έκδοση 2026 B' τρίμηνο », 2026 T2). Le fichier garde l'édition
 * et le jour où IBANforge l'a lue, séparément ; `as_of` porte le mois de
 * lecture, et le crédit dit « read by IBANforge on », jamais « published ».
 */

/** Le crédit exact demandé par la HBA, mot pour mot. */
export const GR_SOURCE = 'Source: Hellenic Bank Association (HEBIC)';

/**
 * L'Important Note de la HBA, mot pour mot, telle qu'écrite dans sa réponse du
 * 08/09/2026 (docs/data-sources.md). Sans point final : c'est ainsi que la HBA
 * l'a écrite, et une note « en entier » ne se retouche pas.
 */
export const GR_IMPORTANT_NOTE =
  'HBA is not responsible for the accuracy of the data given by the banks. HBA has the right to make any adjustments when necessary and is not responsible for any misuse of the Greek Banking System (HEBIC) index';

export const GR_PUBLICATION = 'https://www.hba.gr/info/hebicmap';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  });

/** Le fichier privé : l'édition, le jour de lecture, l'empreinte du fichier de la HBA, les banques. */
export const grRegisterSchema = z
  .object({
    schema: z.literal(1),
    source: z.literal(GR_SOURCE),
    publication: z.literal(GR_PUBLICATION),
    /** « 2026 Q2 » : l'édition que la page de la HBA nomme. */
    edition: z.string().regex(/^\d{4} Q[1-4]$/),
    /** Le jour où IBANforge a lu le fichier, jamais une date de publication. */
    read_on: date,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    entries: z
      .array(
        z.object({
          code: z.string().regex(/^\d{3}$/),
          name: z.string().trim().min(1),
          street: z.string().trim().min(1).nullable(),
          post_code: z.string().trim().min(1).nullable(),
          town: z.string().trim().min(1).nullable(),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((value, context) => {
    const codes = new Set<string>();
    for (const entry of value.entries) {
      if (codes.has(entry.code)) context.addIssue({ code: 'custom', message: 'Code GR dupliqué' });
      codes.add(entry.code);
    }
  });
export type GrRegister = z.infer<typeof grRegisterSchema>;

/**
 * Ce que `bank_code_check.register` imprime pour une réponse tirée de HEBIC :
 * le crédit exact, l'édition et le jour de lecture, la réserve qui fait de ce
 * registre un registre partiel, puis l'Important Note en entier.
 */
export function grRegisterName(edition: string, readOn: string): string {
  return (
    `${GR_SOURCE}, HEBIC index edition ${edition} (no publication date stated by the HBA; read by IBANforge on ${readOn}). ` +
    'Credit institutions only: payment and e-money institutions issuing Greek IBANs hold codes outside this index, so an absence is not a non-allocation. ' +
    `Important Note: "${GR_IMPORTANT_NOTE}"`
  );
}

let cached:
  { path: string; mtime: number; inode: number; size: number; register: GrRegister } | undefined;

/** Le registre est-il branché sur ce déploiement ? Lu à chaque appel, comme le luxembourgeois. */
export function grRegisterConfigured(): boolean {
  return Boolean(process.env.GR_REGISTER_PATH);
}

/**
 * Le titulaire d'un code bancaire grec (positions 5 à 7 de l'IBAN), ou null.
 *
 * Activation explicite par `GR_REGISTER_PATH`. Une erreur de lecture d'un
 * fichier configuré remonte jusqu'au garde-fou de l'enrichissement ; elle ne
 * devient jamais une non-attribution. Le remplacement atomique du fichier est
 * détecté sans redémarrer l'API.
 */
export function lookupGrCode(code: string):
  | (GrRegister['entries'][number] & {
      register: string;
      edition: string;
      read_on: string;
    })
  | null {
  const path = process.env.GR_REGISTER_PATH;
  if (!path) return null;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Fichier GR invalide');
  if (
    !cached ||
    cached.path !== path ||
    cached.mtime !== stat.mtimeMs ||
    cached.size !== stat.size ||
    cached.inode !== stat.ino
  ) {
    const register = grRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    cached = { path, mtime: stat.mtimeMs, inode: stat.ino, size: stat.size, register };
  }
  const row = cached.register.entries.find((entry) => entry.code === code);
  if (!row) return null;
  const { edition, read_on } = cached.register;
  return { ...row, register: grRegisterName(edition, read_on), edition, read_on };
}
