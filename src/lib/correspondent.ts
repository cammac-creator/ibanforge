/**
 * La fiche d'UN correspondant, pour le bureau de Claude-Alain (boîte générale,
 * étape 3, lot 3I, 11.11.2026 ; route `POST /v1/admin/correspondent`).
 *
 * Ses mots, le 10.11.2026 : « la fiche du correspondant plus les chiffres du
 * projet », « il me faut le contexte afin de ne pas avoir besoin d'aller sur le
 * dashboard ou sur la page du client ». Le bureau demande, pour l'expéditeur
 * PROUVÉ d'un mail reçu dans la boîte d'IBANforge, ce que le CRM sait de lui.
 *
 * ## Une adresse, sans relire le registre
 *
 * Le CRM du site assemble ses contacts à partir de listes entières (toutes les
 * clés, tous les prospects). Ici, chaque lecture est restreinte à l'adresse :
 *  - l'alias : une ligne de `email_aliases`, par sa clé primaire. Seulement
 *    `trim().toLowerCase()` puis l'alias, comme `toCanonical` du CRM ; jamais
 *    `normalizeEmail`, qui retire les étiquettes « + » (règle « une personne, une
 *    clé gratuite ») et fondrait deux adresses que le CRM sépare ;
 *  - le verdict d'activation : `getActivationFor`, la MÊME fonction de verdict
 *    que `/v1/admin/activation`, sur les seules clés de l'adresse. Jamais
 *    recalculé ici ;
 *  - le prospect et le correspondant institutionnel : une ligne chacun.
 *
 * ## La sorte, dans l'ordre du CRM
 *
 * Client, puis prospect, puis institution (`frontend/lib/crm/build-contacts.ts`) :
 *  - client : l'adresse porte une clé que l'activation compte (ni anonyme, ni
 *    interne). Le CRM cache en plus quelques porteurs (une clé jamais servie,
 *    une évaluation à gros plafond) ; le bureau ne demande que pour quelqu'un
 *    qui vient d'écrire, et le statut (`new`, `silent`) dit le reste ;
 *  - prospect : la première ligne non rejetée, dans l'ordre que le CRM reçoit ;
 *  - institution : la ligne enregistrée à la main, sans le filtre des internes
 *    (une autorité sur une adresse `audit@` reste une autorité).
 *  - sinon `unknown`, même forme, tous les blocs à `null`.
 *
 * `internal` dit une adresse interne ou d'essai (`isInternalEmail` de l'API) :
 * elle n'est jamais un client, comme dans l'activation et au CRM.
 *
 * ## Ce que la fiche ne dit jamais
 *
 * L'adresse demandée, son alias ou son canonique : la forme ne porte aucun champ
 * d'adresse, et un texte libre qui en contiendrait une (une note de prospection,
 * un dossier) est rendu `null` (`scrub`). Ni le préfixe d'une clé, ni un
 * identifiant de paiement, ni le site web, ni le nom d'une personne : `company`
 * vient du prospect ou de l'organisme, jamais d'une supposition tirée du domaine.
 */
import { getActivationFor, type ActivationClient } from './activation.js';
import { getStatsDB } from './db.js';
import { ensureAliasTable } from './email-aliases.js';
import { ensureInstitutionalTable } from './institutional-contacts.js';
import { isInternalEmail } from './internal-accounts.js';
import { FREE_TIER_MONTHLY_LIMIT } from './tiers.js';

export type CorrespondentKind = 'client' | 'prospect' | 'institution' | 'unknown';

export interface CorrespondentClient {
  /** Le verdict de `/v1/admin/activation`, tel quel. */
  status: ActivationClient['status'];
  /** Payant d'une façon ou de l'autre : un pack ou un abonnement vivant. */
  paid: boolean;
  packs: number;
  subscriber: boolean;
  credits_remaining: number;
  credits_total: number;
  /** Le plafond mensuel écrit sur la clé qui représente l'adresse (`null` : celui de son palier). */
  monthly_limit: number | null;
  calls_90d: number;
  first_call_at: string | null;
  /** `AAAA-MM` du dernier mois servi, toutes clés de l'adresse. */
  last_active_month: string | null;
  /** La première clé de l'adresse. */
  created_at: string;
  source: string;
}

export interface CorrespondentProspect {
  segment: string | null;
  what_they_do: string | null;
  fit_reason: string | null;
  status: string;
  outcome: 'en_discussion' | 'pas_maintenant' | 'pas_interesse' | 'mauvaise_personne' | null;
  outcome_at: string | null;
  wake_up_at: string | null;
  contact_role: string | null;
}

export interface CorrespondentInstitution {
  org: string;
  category: string;
  country: string | null;
  role: string | null;
  dossier: string | null;
}

export interface CorrespondentCard {
  version: 1;
  kind: CorrespondentKind;
  internal: boolean;
  company: string | null;
  country: string | null;
  client: CorrespondentClient | null;
  prospect: CorrespondentProspect | null;
  institution: CorrespondentInstitution | null;
}

/** Les clés de la fiche, dans l'ordre : la forme fermée, tenue par l'essai. */
export const CARD_KEYS = [
  'version',
  'kind',
  'internal',
  'company',
  'country',
  'client',
  'prospect',
  'institution',
] as const;

const OUTCOMES = ['en_discussion', 'pas_maintenant', 'pas_interesse', 'mauvaise_personne'] as const;

/** Même ordre que `GET /v1/admin/prospects`, ce que le CRM reçoit : sa « première ligne ». */
const PROSPECT_ORDER = `CASE status WHEN 'a_mailer' THEN 0 WHEN 'a_enrichir' THEN 1 WHEN 'archive' THEN 2 ELSE 3 END,
         company COLLATE NOCASE`;

interface ProspectRow {
  company: string | null;
  country: string | null;
  segment: string | null;
  what_they_do: string | null;
  fit_reason: string | null;
  status: string;
  outcome: string | null;
  outcome_at: string | null;
  wake_up_at: string | null;
  contact_role: string | null;
}

interface InstitutionRow {
  org: string;
  category: string;
  country: string | null;
  role: string | null;
  dossier: string | null;
}

interface KeyFacts {
  credits_total: number | null;
  monthly_limit: number | null;
  key_prefix: string;
  used_all_time: number;
  last_usage_month: string | null;
  last_call_month: string | null;
}

/** L'adresse telle que le CRM la lit : sans espaces de bord, en minuscules, puis son alias. */
function canonicalOf(address: string): string {
  ensureAliasTable();
  const row = getStatsDB()
    .prepare('SELECT canonical FROM email_aliases WHERE alias = ?')
    .get(address) as { canonical: string } | undefined;
  return row ? row.canonical.trim().toLowerCase() : address;
}

/**
 * Les faits de chaque clé de l'adresse qui choisissent la clé représentante,
 * avec la règle du CRM (`representativeKey`, `frontend/lib/crm/build-contacts.ts` :
 * une clé à crédits d'abord, puis la plus servie, puis le plus petit préfixe) et
 * le « servi en tout » de `GET /v1/admin/keys` (le delta des crédits pour une clé
 * sans allocation propre, le registre mensuel sinon).
 */
function keyFactsOf(address: string): KeyFacts[] {
  return getStatsDB()
    .prepare(
      `SELECT k.key_prefix, k.credits_total, k.monthly_limit,
              CASE WHEN k.credits_remaining IS NOT NULL
                    AND COALESCE(k.monthly_limit, CASE WHEN k.tier = 'paid' THEN 0 ELSE ${FREE_TIER_MONTHLY_LIMIT} END) <= 0
                   THEN MAX(COALESCE(k.credits_total, 0) - COALESCE(k.credits_remaining, 0), 0)
                   ELSE COALESCE((SELECT SUM(u.count) FROM api_usage u WHERE u.key_hash = k.key_hash), 0)
              END AS used_all_time,
              (SELECT MAX(u.month) FROM api_usage u WHERE u.key_hash = k.key_hash) AS last_usage_month,
              (SELECT MAX(substr(r.created_at, 1, 7)) FROM request_log r
                WHERE r.key_prefix = k.key_prefix) AS last_call_month
         FROM api_keys k
        WHERE lower(k.email) = ? AND k.tier != 'anonymous'`,
    )
    .all(address) as KeyFacts[];
}

function representative(keys: KeyFacts[]): KeyFacts | undefined {
  return [...keys].sort((a, b) => {
    const paid = Number(b.credits_total != null) - Number(a.credits_total != null);
    if (paid !== 0) return paid;
    if (a.used_all_time !== b.used_all_time) return b.used_all_time - a.used_all_time;
    return a.key_prefix < b.key_prefix ? -1 : a.key_prefix > b.key_prefix ? 1 : 0;
  })[0];
}

function clientBlock(
  activation: ActivationClient,
  keys: KeyFacts[],
  scrub: (value: string | null | undefined) => string | null,
): CorrespondentClient {
  const months = keys
    .flatMap((k) => [k.last_usage_month, k.last_call_month])
    .filter((m): m is string => typeof m === 'string' && m !== '')
    .sort();
  return {
    status: activation.status,
    paid: activation.packs > 0 || activation.subscriber,
    packs: activation.packs,
    subscriber: activation.subscriber,
    credits_remaining: activation.credits_remaining,
    credits_total: activation.credits_total,
    monthly_limit: representative(keys)?.monthly_limit ?? null,
    calls_90d: activation.calls_90d,
    first_call_at: activation.first_call_at,
    last_active_month: months.at(-1) ?? null,
    created_at: activation.signup_at,
    source: scrub(activation.source) ?? 'direct',
  };
}

function prospectOf(address: string): ProspectRow | undefined {
  return getStatsDB()
    .prepare(
      `SELECT company, country, segment, what_they_do, fit_reason, status, outcome, outcome_at,
              wake_up_at, contact_role
         FROM prospects
        WHERE lower(contact_email) = ? AND status != 'rejete'
        ORDER BY ${PROSPECT_ORDER}
        LIMIT 1`,
    )
    .get(address) as ProspectRow | undefined;
}

function institutionOf(address: string): InstitutionRow | undefined {
  ensureInstitutionalTable();
  return getStatsDB()
    .prepare(
      'SELECT org, category, country, role, dossier FROM institutional_contacts WHERE email = ?',
    )
    .get(address) as InstitutionRow | undefined;
}

/**
 * Un texte venu de la base, rendu `null` s'il contient une des adresses : la
 * fiche ne redit jamais l'adresse demandée, même glissée dans une note.
 */
function scrubber(addresses: string[]): (value: string | null | undefined) => string | null {
  const needles = [...new Set(addresses.filter((a) => a !== ''))];
  return (value) => {
    if (typeof value !== 'string') return null;
    const lower = value.toLowerCase();
    return needles.some((n) => lower.includes(n)) ? null : value;
  };
}

/**
 * La fiche de `rawEmail`. Ne lève pas pour une adresse inconnue : `kind:
 * 'unknown'`, même forme. L'appelant a déjà vérifié que c'est une chaîne.
 */
export function correspondentOf(rawEmail: string): CorrespondentCard {
  const asked = rawEmail.trim().toLowerCase();
  const address = canonicalOf(asked);
  const scrub = scrubber([asked, address]);
  const internal = isInternalEmail(address);

  const prospect = prospectOf(address);
  const company = scrub(prospect?.company);
  const country = scrub(prospect?.country);

  const activation = internal ? null : getActivationFor(address);
  if (activation) {
    return {
      version: 1,
      kind: 'client',
      internal,
      company,
      country,
      client: clientBlock(activation, keyFactsOf(address), scrub),
      prospect: null,
      institution: null,
    };
  }

  if (prospect) {
    return {
      version: 1,
      kind: 'prospect',
      internal,
      company,
      country,
      client: null,
      prospect: {
        segment: scrub(prospect.segment),
        what_they_do: scrub(prospect.what_they_do),
        fit_reason: scrub(prospect.fit_reason),
        status: scrub(prospect.status) ?? 'inconnu',
        outcome: OUTCOMES.includes(prospect.outcome as (typeof OUTCOMES)[number])
          ? (prospect.outcome as (typeof OUTCOMES)[number])
          : null,
        outcome_at: scrub(prospect.outcome_at),
        wake_up_at: scrub(prospect.wake_up_at),
        contact_role: scrub(prospect.contact_role),
      },
      institution: null,
    };
  }

  const institution = institutionOf(address);
  if (institution) {
    const org = scrub(institution.org);
    return {
      version: 1,
      kind: 'institution',
      internal,
      company: org,
      country: scrub(institution.country),
      client: null,
      prospect: null,
      institution: {
        org: org ?? '',
        category: scrub(institution.category) ?? '',
        country: scrub(institution.country),
        role: scrub(institution.role),
        dossier: scrub(institution.dossier),
      },
    };
  }

  return {
    version: 1,
    kind: 'unknown',
    internal,
    company: null,
    country: null,
    client: null,
    prospect: null,
    institution: null,
  };
}
