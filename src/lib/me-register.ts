import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

/**
 * Le registre monténégrin : les codes d'identification bancaires du système RTGS
 * que publie la Banque centrale du Monténégro (Centralna banka Crne Gore, CBCG),
 * servis depuis un fichier PRIVÉ désigné par `ME_REGISTER_PATH` (modèle de
 * src/lib/gr-register.ts).
 *
 * ## Permission (07/10/2026), et pourquoi un fichier privé
 *
 * Permission reçue de la CBCG, pour une lettre qui demandait de réutiliser ces
 * codes « in our API responses, one entry per request » : l'usage commercial est
 * permis en citant la source « Central Bank of Montenegro », et la mise à jour des
 * données est de notre responsabilité (scripts/seed-me-register.ts, option
 * --check pour comparer sans écrire : un registre relu à la main ne doit pas
 * vieillir en silence). Cette permission porte sur les RÉPONSES DE L'API. La
 * publication de la table entière dans ce dépôt public n'a pas été demandée :
 * aucune ligne n'y entre (décision de la session principale, 08/10/2026), comme
 * pour le Luxembourg et la Grèce. Sans la variable, rien ne change.
 *
 * ## Ce que la page dit, et ne dit pas
 *
 * Le tableau « Banking identification codes in the RTGS system » donne, pour
 * chaque banque, le nom, le BIC et un « fixed no. » de trois chiffres : les trois
 * premiers chiffres d'un numéro de compte monténégrin, donc les positions 5 à 7
 * de l'IBAN. La page ne porte AUCUNE date : le fichier garde le jour où IBANforge
 * l'a lue, et le crédit dit « read by IBANforge on », jamais « published ».
 *
 * La même page liste d'autres participants du RTGS (le Trésor, les douanes, deux
 * banques en faillite) dans un tableau voisin, sans BIC : il n'est pas lu. Les
 * noms sont gardés tels que publiés, « Prva banka Crne Gore AD - Osnovana 1901.
 * godine » compris.
 *
 * ## Un registre PARTIEL, jamais dans NATIONAL_REGISTERS
 *
 * Le tableau liste les banques, pas l'attribution de l'espace des codes : un code
 * absent ne dit rien et garde la réponse d'avant (la carte composite), jamais
 * `not_allocated`. Même régime que la Grèce, l'Italie et Saint-Marin.
 *
 * ## Le BIC est celui de la CBCG
 *
 * La banque centrale publie le BIC à côté du code : l'appariement est le sien,
 * pas le nôtre (base `national_register`). Un BIC de la carte composite qui lui
 * serait contraire perd : le registre passe en premier.
 */

/** Le crédit demandé : la Banque centrale du Monténégro. */
export const ME_SOURCE = 'Source: Central Bank of Montenegro';

export const ME_PUBLICATION =
  'https://www.cbcg.me/en/core-functions/payment-system/cbcg-payment-system/rtgs-system';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  });

export const meRegisterSchema = z
  .object({
    schema: z.literal(1),
    source: z.literal(ME_SOURCE),
    publication: z.literal(ME_PUBLICATION),
    /** Le jour où IBANforge a lu la page, jamais une date de publication : la CBCG n'en donne pas. */
    read_on: date,
    entries: z
      .array(
        z.object({
          /** Positions 5 à 7 de l'IBAN, trois chiffres. */
          code: z.string().regex(/^\d{3}$/),
          /** Verbatim, tel que la CBCG l'écrit. */
          name: z.string().trim().min(1),
          bic: z.string().regex(/^[A-Z]{4}ME[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    const codes = new Set<string>();
    for (const entry of value.entries) {
      if (codes.has(entry.code)) context.addIssue({ code: 'custom', message: 'Code ME dupliqué' });
      codes.add(entry.code);
    }
  });
export type MeRegister = z.infer<typeof meRegisterSchema>;

/**
 * Le crédit : la source, la page, le jour de lecture. C'est ce que `bic.source`
 * imprime : la réserve de `meRegisterName` qualifie le verdict sur le code, pas le
 * BIC (même choix que pour la Bulgarie dans enrich.ts).
 */
export function meCredit(readOn: string): string {
  return (
    `${ME_SOURCE}, banking identification codes in the RTGS system (${ME_PUBLICATION}; ` +
    `no publication date stated; read by IBANforge on ${readOn})`
  );
}

/** Ce que `bank_code_check.register` imprime : le crédit, puis la réserve qui fait de la liste un registre partiel. */
export function meRegisterName(readOn: string): string {
  return `${meCredit(readOn)}. Banks only: a listed code names its bank, an absence is not a non-allocation`;
}

let cached:
  { path: string; mtime: number; inode: number; size: number; register: MeRegister } | undefined;

/** Le registre est-il branché sur ce déploiement ? Lu à chaque appel, comme le grec. */
export function meRegisterConfigured(): boolean {
  return Boolean(process.env.ME_REGISTER_PATH);
}

/**
 * Le fichier privé, validé, ou null quand `ME_REGISTER_PATH` n'est pas posée (le
 * Monténégro répond alors comme avant). Une erreur de lecture d'un fichier
 * configuré remonte jusqu'au garde-fou de l'enrichissement ; elle ne devient
 * jamais une non-attribution. Le remplacement atomique du fichier est détecté sans
 * redémarrer l'API.
 */
export function meRegister(): MeRegister | null {
  const path = process.env.ME_REGISTER_PATH;
  if (!path) return null;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Fichier ME invalide');
  if (
    !cached ||
    cached.path !== path ||
    cached.mtime !== stat.mtimeMs ||
    cached.size !== stat.size ||
    cached.inode !== stat.ino
  ) {
    const register = meRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    cached = { path, mtime: stat.mtimeMs, inode: stat.ino, size: stat.size, register };
  }
  return cached.register;
}

export type MeLookup = MeRegister['entries'][number] & {
  /** Le texte de `bank_code_check.register`. */
  register: string;
  /** Le texte de `bic.source` : le crédit, sans la réserve sur le verdict. */
  credit: string;
  read_on: string;
};

/** La banque d'un code monténégrin (positions 5 à 7 de l'IBAN), ou null (aussi sans fichier). */
export function lookupMeCode(code: string): MeLookup | null {
  const register = meRegister();
  if (!register) return null;
  const row = register.entries.find((entry) => entry.code === code);
  if (!row) return null;
  return {
    ...row,
    register: meRegisterName(register.read_on),
    credit: meCredit(register.read_on),
    read_on: register.read_on,
  };
}
