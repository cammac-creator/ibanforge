import { readFileSync, statSync } from 'node:fs';
import { z } from 'zod';

/**
 * Le registre serbe : la liste PDF des banques qui participent aux systèmes RTGS et
 * de compensation de la Banque nationale de Serbie (NBS), avec leur code NBS à
 * trois caractères, leur BIC et leur numéro d'entreprise (matični broj), servie
 * depuis un fichier PRIVÉ désigné par `RS_REGISTER_PATH` (modèle de
 * src/lib/ee-register.ts et de src/lib/gr-register.ts).
 *
 * ## Permission (09/10/2026), et pourquoi un fichier privé
 *
 * Permission reçue de la NBS (service des systèmes de paiement), pour une demande de
 * réutiliser la liste PDF « in our API responses, one entry per request » : la NBS
 * autorise la réutilisation des données demandées, et seulement pour l'usage demandé
 * (la liste PDF des banques des systèmes RTGS et de compensation, code NBS à trois
 * caractères, BIC et matični broj), à des fins commerciales seulement. La liste est
 * créditée « Source: National Bank of Serbia » avec la date de publication. La NBS
 * n'est pas responsable des décisions prises sur ces données ; les liens doivent
 * mener directement à www.nbs.rs, sans usage publicitaire. La publication de la
 * table entière dans ce dépôt public n'a pas été demandée : aucune ligne n'y entre,
 * comme pour l'Estonie, le Monténégro, le Luxembourg et la Grèce. Sans la variable,
 * rien ne change.
 *
 * ## Ce que le document dit, et ne dit pas
 *
 * « Account numbers and bank identification codes of participants in the NBS RTGS and
 * clearing system » (nbs.rs, adresse ci-dessous) donne pour chaque participant le nom,
 * son compte à la NBS (908-AAAAA-CC), son numéro d'entreprise et son BIC. Il ne porte
 * pas de colonne « code » : le code NBS à trois caractères (les positions 5 à 7 de
 * l'IBAN serbe) est le début à trois chiffres du groupe central du compte. Le chargeur
 * le lit ainsi, et vérifie la clé de contrôle ISO 7064 mod 97-10 de chaque compte, qui
 * attrape une ligne mal lue. Le document est daté en tête (« 1/9/2026 », jour/mois/
 * année : le PDF a été créé le 02/09/2026) : c'est la date de publication que le
 * crédit imprime, avec le jour où IBANforge l'a lu.
 *
 * Seules les lignes dont le BIC est serbe sont gardées : Euroclear Bank (BIC belge)
 * participe aux systèmes mais n'émet pas d'IBAN serbe. Le chargeur l'écarte et le dit.
 * Le matični broj reste dans le fichier privé et n'est JAMAIS servi : le bloc
 * `institution` n'a aucun champ pour lui.
 *
 * ## Un registre PARTIEL, jamais dans NATIONAL_REGISTERS
 *
 * La liste nomme des banques participantes ; elle ne dit pas que tout autre code est
 * inattribué (la NBS elle-même, 908, n'y figure pas comme participante, et d'autres
 * établissements tiennent des comptes). Un code absent garde la réponse d'avant, jamais
 * `not_allocated`.
 *
 * ## Le BIC est celui de la NBS
 *
 * La liste publie le BIC à côté du code : l'appariement est le sien, pas le nôtre
 * (base `national_register`), comme pour le Monténégro.
 */

/** Le crédit demandé par la NBS. */
export const RS_SOURCE = 'Source: National Bank of Serbia';

/** Le document, sur www.nbs.rs : le lien du crédit mène directement chez la NBS. */
export const RS_PUBLICATION =
  'https://www.nbs.rs/export/sites/NBS_site/documents-eng/platni-sistem/banks_account_numbers.pdf';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value);
  });

export const rsRegisterSchema = z
  .object({
    schema: z.literal(1),
    source: z.literal(RS_SOURCE),
    publication: z.literal(RS_PUBLICATION),
    /** La date que le document porte en tête (jour/mois/année), celle que le crédit imprime. */
    published: date,
    /** Le jour où IBANforge a lu le document. */
    read_on: date,
    entries: z
      .array(
        z.object({
          /** Le code NBS : positions 5 à 7 de l'IBAN, trois chiffres. */
          code: z.string().regex(/^\d{3}$/),
          /** Verbatim, tel que la NBS l'écrit. */
          name: z.string().trim().min(1),
          /** Tel que publié : onze caractères, `XXX` compris. */
          bic: z.string().regex(/^[A-Z]{4}RS[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/),
          /** Le matični broj. Gardé dans le fichier privé, jamais servi. */
          registration_number: z.string().regex(/^\d{8}$/),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    if (value.published > value.read_on) {
      context.addIssue({ code: 'custom', message: 'Document daté après le jour de lecture' });
    }
    const codes = new Set<string>();
    for (const entry of value.entries) {
      if (codes.has(entry.code)) context.addIssue({ code: 'custom', message: 'Code RS dupliqué' });
      codes.add(entry.code);
    }
  });
export type RsRegister = z.infer<typeof rsRegisterSchema>;

/**
 * Le crédit : la source, le document, sa date, le jour de lecture. C'est ce que
 * `bic.source` imprime : la réserve de `rsRegisterName` qualifie le verdict sur le
 * code, pas le BIC (même choix que pour le Monténégro).
 */
export function rsCredit(published: string, readOn: string): string {
  return (
    `${RS_SOURCE}, list of participants in the NBS RTGS and clearing systems, account numbers and ` +
    `bank identification codes (${RS_PUBLICATION}; list dated ${published}; read by IBANforge on ${readOn})`
  );
}

/**
 * Ce que `bank_code_check.register` imprime : le crédit, la réserve qui fait de la liste
 * un registre partiel, puis l'absence de responsabilité de la NBS.
 */
export function rsRegisterName(published: string, readOn: string): string {
  return (
    `${rsCredit(published, readOn)}. Participating banks only: a listed code names its bank, ` +
    'an absence is not a non-allocation. The National Bank of Serbia accepts no responsibility for decisions taken on this data'
  );
}

let cached:
  { path: string; mtime: number; inode: number; size: number; register: RsRegister } | undefined;

/** Le registre est-il branché sur ce déploiement ? Lu à chaque appel, comme le grec. */
export function rsRegisterConfigured(): boolean {
  return Boolean(process.env.RS_REGISTER_PATH);
}

/**
 * Le fichier privé, validé, ou null quand `RS_REGISTER_PATH` n'est pas posée (la Serbie
 * répond alors comme avant). Une erreur de lecture d'un fichier configuré remonte
 * jusqu'au garde-fou de l'enrichissement ; elle ne devient jamais une non-attribution.
 * Le remplacement atomique du fichier est détecté sans redémarrer l'API.
 */
export function rsRegister(): RsRegister | null {
  const path = process.env.RS_REGISTER_PATH;
  if (!path) return null;
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Fichier RS invalide');
  if (
    !cached ||
    cached.path !== path ||
    cached.mtime !== stat.mtimeMs ||
    cached.size !== stat.size ||
    cached.inode !== stat.ino
  ) {
    const register = rsRegisterSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    cached = { path, mtime: stat.mtimeMs, inode: stat.ino, size: stat.size, register };
  }
  return cached.register;
}

/** Ce que la recherche rend : la ligne SANS le matični broj, qui n'est jamais servi. */
export type RsLookup = Omit<RsRegister['entries'][number], 'registration_number'> & {
  /** Le texte de `bank_code_check.register`. */
  register: string;
  /** Le texte de `bic.source` : le crédit, sans la réserve sur le verdict. */
  credit: string;
  /** La date du document, `AAAA-MM-JJ`. */
  published: string;
  read_on: string;
};

/** La banque d'un code serbe (positions 5 à 7 de l'IBAN), ou null (aussi sans fichier). */
export function lookupRsCode(code: string): RsLookup | null {
  const register = rsRegister();
  if (!register) return null;
  const row = register.entries.find((entry) => entry.code === code);
  if (!row) return null;
  return {
    code: row.code,
    name: row.name,
    bic: row.bic,
    register: rsRegisterName(register.published, register.read_on),
    credit: rsCredit(register.published, register.read_on),
    published: register.published,
    read_on: register.read_on,
  };
}
