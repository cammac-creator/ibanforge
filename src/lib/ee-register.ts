import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

/**
 * Le registre estonien : les codes d'identification des numéros de compte
 * internationaux que la Finantsinspektsioon (l'autorité estonienne de
 * surveillance financière) attribue et publie, servis depuis un fichier PRIVÉ
 * désigné par `EE_REGISTER_PATH` (modèle de src/lib/gr-register.ts).
 *
 * ## Pourquoi l'Estonie revient (08/10/2026), et pourquoi un fichier privé
 *
 * Les 16 clés estoniennes de la carte composite venaient d'un site commercial et
 * ont quitté le dépôt et le service le 29/09/2026 (NOTICE, groupe « retiré »).
 * Elles reviennent par la source officielle. Permission reçue le 05/10/2026,
 * pour une lettre qui demandait de réutiliser ces codes « in our API responses,
 * one entry per request » : les informations publiques de la Finantsinspektsioon
 * « may be used … including in connection with the provision of commercial
 * services », sans autre permission ; la source à citer est la
 * Finantsinspektsioon. Cette permission porte sur les RÉPONSES DE L'API. La
 * publication de la table entière dans ce dépôt public n'a pas été demandée :
 * aucune ligne n'y entre (décision de la session principale, 08/10/2026), comme
 * pour le Luxembourg et la Grèce. Sans la variable, rien ne change.
 *
 * ## Deux tables, deux dates
 *
 * L'autorité publie deux pages : les établissements de crédit (et leurs
 * succursales étrangères), puis les établissements de paiement et de monnaie
 * électronique. Chacune porte sa propre date de dernière modification
 * (« Page last edited on »). Le fichier garde les deux, séparées, et le jour où
 * IBANforge a lu les pages : le crédit dit « page last edited » et « read by
 * IBANforge on », jamais « published ».
 *
 * ## Un registre PARTIEL, jamais dans NATIONAL_REGISTERS
 *
 * La liste nomme les titulaires d'un code ; elle ne dit pas que tout autre code
 * est inattribué. Le 08/10/2026, Eesti Pangaliit liste trois codes (00, 83, 99) que
 * les pages de l'autorité ne portent pas, et la page des établissements de crédit
 * n'a pas été modifiée depuis août 2025. Un code présent nomme son titulaire ; un
 * code absent garde la réponse d'avant, jamais `not_allocated` (même régime que
 * Saint-Marin, l'Italie et la Grèce : enrich.ts).
 *
 * ## Le BIC vient d'ailleurs, et le dit
 *
 * Les pages de l'autorité ne publient pas de BIC. Il vient de la liste d'Eesti
 * Pangaliit (l'association des banques estoniennes), qui renvoie elle-même à
 * l'autorité pour les codes, et il n'est joint QUE par le code, avec un nom
 * identique de part et d'autre (scripts/seed-ee-register.ts). Un code sans
 * correspondance a `bic: null` : aucun BIC n'est jamais déduit d'un nom.
 * L'appariement est le nôtre, pas celui de l'autorité : base `curated_map`
 * (indicative).
 */

/** Le crédit demandé : la Finantsinspektsioon. */
export const EE_SOURCE = 'Source: Finantsinspektsioon';

export const EE_CREDIT_PAGE =
  'https://www.fi.ee/en/banking-and-credit/applying-activity-licences/identity-codes-international-account-numbers-credit-institutions';
export const EE_PAYMENT_PAGE =
  'https://www.fi.ee/en/payment-and-e-money-services/applying-operating-licence-payment-services/identity-codes-international-account-numbers-payment-institutions-and-e-money-institutions';

/** La liste d'où viennent les BIC (seulement eux). */
export const EE_BIC_PAGE = 'https://pangaliit.ee/settlements-and-standards/bank-codes';
export const EE_BIC_SOURCE = 'Eesti Pangaliit (Estonian Banking Association), list of bank codes';

export const EE_KINDS = [
  'credit_institution',
  'foreign_credit_institution_branch',
  'payment_or_e_money_institution',
  'foreign_payment_institution_branch',
] as const;
export type EeKind = (typeof EE_KINDS)[number];

/** La page de l'autorité où figure chaque sorte d'établissement. */
export const EE_PAGE_OF_KIND: Record<EeKind, 'credit_institutions' | 'payment_institutions'> = {
  credit_institution: 'credit_institutions',
  foreign_credit_institution_branch: 'credit_institutions',
  payment_or_e_money_institution: 'payment_institutions',
  foreign_payment_institution_branch: 'payment_institutions',
};

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  });

/** Le fichier : deux pages datées, le jour de lecture, les établissements. */
export const eeRegisterSchema = z
  .object({
    schema: z.literal(1),
    source: z.literal(EE_SOURCE),
    pages: z.object({
      credit_institutions: z.object({ url: z.literal(EE_CREDIT_PAGE), edited: date }),
      payment_institutions: z.object({ url: z.literal(EE_PAYMENT_PAGE), edited: date }),
    }),
    bic_source: z.object({ name: z.literal(EE_BIC_SOURCE), url: z.literal(EE_BIC_PAGE) }),
    /** Le jour où IBANforge a lu les pages, jamais une date de publication. */
    read_on: date,
    entries: z
      .array(
        z.object({
          /** Positions 5 et 6 de l'IBAN, deux chiffres (« 01 » garde son zéro). */
          code: z.string().regex(/^\d{2}$/),
          name: z.string().trim().min(1),
          kind: z.enum(EE_KINDS),
          bic: z
            .string()
            .regex(/^[A-Z]{4}EE[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/)
            .nullable(),
        }),
      )
      .min(1)
      .max(200),
  })
  .superRefine((value, context) => {
    const codes = new Set<string>();
    for (const entry of value.entries) {
      if (codes.has(entry.code)) context.addIssue({ code: 'custom', message: 'Code EE dupliqué' });
      codes.add(entry.code);
    }
  });
export type EeRegister = z.infer<typeof eeRegisterSchema>;

/**
 * Ce que `bank_code_check.register` imprime pour une réponse tirée de ce
 * registre : le crédit, la page, sa date de modification, le jour de lecture, puis
 * la réserve qui fait de la liste un registre partiel.
 */
export function eeRegisterName(
  page: 'credit_institutions' | 'payment_institutions',
  edited: string,
  readOn: string,
): string {
  const what =
    page === 'credit_institutions'
      ? 'identity codes of the international account numbers of credit institutions'
      : 'identity codes of the international account numbers of payment institutions and e-money institutions';
  return (
    `${EE_SOURCE} (Estonian Financial Supervision and Resolution Authority), ${what} ` +
    `(page last edited ${edited}; read by IBANforge on ${readOn}). ` +
    'A listed code names its holder; an absence is not a non-allocation'
  );
}

/** Le nom du BIC : la liste d'Eesti Pangaliit, avec le jour de lecture. */
export function eeBicSourceName(readOn: string): string {
  return `${EE_BIC_SOURCE} (${EE_BIC_PAGE}), paired by IBANforge with the Finantsinspektsioon code; read on ${readOn}`;
}

let cached:
  { path: string; mtime: number; inode: number; size: number; register: EeRegister } | undefined;

/** Le registre est-il branché sur ce déploiement ? Lu à chaque appel, comme le grec. */
export function eeRegisterConfigured(): boolean {
  return Boolean(process.env.EE_REGISTER_PATH);
}

/**
 * Le fichier privé, validé, ou null quand `EE_REGISTER_PATH` n'est pas posée
 * (l'Estonie répond alors comme avant). Une erreur de lecture d'un fichier
 * configuré remonte jusqu'au garde-fou de l'enrichissement ; elle ne devient
 * jamais une non-attribution. Le remplacement atomique du fichier est détecté sans
 * redémarrer l'API.
 */
export function eeRegister(): EeRegister | null {
  const path = process.env.EE_REGISTER_PATH;
  if (!path) return null;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Fichier EE invalide');
  if (
    !cached ||
    cached.path !== path ||
    cached.mtime !== stat.mtimeMs ||
    cached.size !== stat.size ||
    cached.inode !== stat.ino
  ) {
    const register = eeRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    cached = { path, mtime: stat.mtimeMs, inode: stat.ino, size: stat.size, register };
  }
  return cached.register;
}

export type EeLookup = EeRegister['entries'][number] & {
  /** Le texte de `bank_code_check.register` pour ce code. */
  register: string;
  /** Le texte de `bic.source`, quand le code a un BIC. */
  bic_source: string;
  read_on: string;
};

/** Le titulaire d'un code bancaire estonien (positions 5 et 6 de l'IBAN), ou null (aussi sans fichier). */
export function lookupEeCode(code: string): EeLookup | null {
  const register = eeRegister();
  if (!register) return null;
  const row = register.entries.find((entry) => entry.code === code);
  if (!row) return null;
  const page = EE_PAGE_OF_KIND[row.kind];
  return {
    ...row,
    register: eeRegisterName(page, register.pages[page].edited, register.read_on),
    bic_source: eeBicSourceName(register.read_on),
    read_on: register.read_on,
  };
}
