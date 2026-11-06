import { complianceTableLoaded, getComplianceDB } from './compliance-db.js';
import type { FinmaRegisterCheck, FinmaRegisterLicence } from '../types.js';

/**
 * Ce que le registre public de la FINMA dit de l'établissement d'un IBAN suisse.
 *
 * ## Ce que ce champ a le droit de dire
 *
 * « Listé » : le rapprochement par identifiants (scripts/seed-finma-register.ts) a
 * trouvé cet établissement dans la copie datée, sous ce libellé, recopié tel quel. Le
 * fichier de la FINMA ne donne ni date d'autorisation ni statut : le champ ne dit donc
 * pas depuis quand, et il ne qualifie rien lui-même.
 *
 * « Non vérifié » : tout le reste. Une banque autorisée peut n'avoir aucun identifiant
 * commun avec le registre : une absence n'est JAMAIS une preuve d'absence
 * d'autorisation. Le champ n'écrit donc jamais « non autorisé », et il n'entre pas
 * dans le score de risque. Rien ici ne lit ni ne nomme la liste d'alerte de la FINMA.
 *
 * Servi depuis la surcouche privée (membre `finma_register`) : sans elle, retiré par
 * `RESTRICTED_WITHDRAWN=finma.ch`, ou la copie trop vieille, chaque réponse dit
 * « non vérifié » et nomme la raison. Une lecture qui échoue aussi : ce champ ne doit
 * jamais faire tomber le contrôle de conformité.
 */

/** Au-delà, la copie n'est plus présentée comme une réponse. La chaîne privée tourne chaque semaine. */
export const FINMA_REGISTER_MAX_AGE_DAYS = 14;

export const FINMA_REGISTER_SOURCE =
  'FINMA, public register of authorised institutions, copy collected by OpenSwissData';
export const FINMA_REGISTER_SOURCE_URL =
  'https://www.finma.ch/en/finma-public/authorised-institutions-individuals-and-products/';
export const FINMA_REGISTER_NOTE =
  'Unofficial copy, not a service of FINMA, which gives no warranty on it; finma.ch remains the reference. A bank not matched here may still be authorised.';

const DAY_MS = 86_400_000;

interface RegisterRow {
  uid: string;
  licence_type: string;
  licence_type_de: string | null;
  licence_type_fr: string | null;
  licence_type_it: string | null;
  matched_by: 'lei_to_uid' | 'head_office_lei_to_uid';
  as_of: string;
}

const BASE = {
  source: FINMA_REGISTER_SOURCE,
  source_url: FINMA_REGISTER_SOURCE_URL,
  note: FINMA_REGISTER_NOTE,
} as const;

function notVerified(
  reason: 'register_not_loaded' | 'register_unreadable' | 'copy_too_old' | 'no_common_identifier',
  asOf: string | null,
): FinmaRegisterCheck {
  return { status: 'not_verified', reason, as_of: asOf, ...BASE };
}

function licenceOf(row: RegisterRow): FinmaRegisterLicence {
  return {
    en: row.licence_type,
    de: row.licence_type_de,
    fr: row.licence_type_fr,
    it: row.licence_type_it,
  };
}

/** `iid` : le numéro de banque résolu de l'IBAN, `null` quand le fichier de SIX ne le porte pas. */
export function checkFinmaRegister(iid: string | null, now: Date = new Date()): FinmaRegisterCheck {
  try {
    if (!complianceTableLoaded('finma_register')) return notVerified('register_not_loaded', null);
    const db = getComplianceDB();
    const { as_of: asOf } = db.prepare('SELECT MAX(as_of) AS as_of FROM finma_register').get() as {
      as_of: string;
    };
    const ageDays = (now.getTime() - Date.parse(`${asOf}T00:00:00Z`)) / DAY_MS;
    if (!Number.isFinite(ageDays) || ageDays > FINMA_REGISTER_MAX_AGE_DAYS) {
      return notVerified('copy_too_old', asOf);
    }
    if (!iid) return notVerified('no_common_identifier', asOf);
    const rows = db
      .prepare(
        `SELECT uid, licence_type, licence_type_de, licence_type_fr, licence_type_it, matched_by, as_of
           FROM finma_register WHERE iid = ? ORDER BY licence_type`,
      )
      .all(iid) as RegisterRow[];
    if (rows.length === 0) return notVerified('no_common_identifier', asOf);
    return {
      status: 'listed',
      licence_types: rows.map(licenceOf),
      uid: rows[0].uid,
      matched_by: rows[0].matched_by,
      as_of: rows[0].as_of,
      ...BASE,
    };
  } catch {
    return notVerified('register_unreadable', null);
  }
}
