/**
 * Les codes de banque qu'une liste nationale PUBLIQUE nomme sans leur donner de BIC
 * (18/11/2026, rang 4 du classement « données fraîches »).
 *
 * ## Pourquoi un module à part
 *
 * La carte composite (`src/db/bic_data.json`) ne sait porter un code qu'avec un BIC :
 * c'est une table code → BIC. Or deux listes que ce dépôt sert déjà, sous leur mention,
 * nomment aussi des établissements qui n'ont pas de BIC à publier :
 *
 *   - la liste des codes des prestataires de services de paiement de la Banque
 *     nationale de Croatie (HNB), dont viennent les clés `HR:` de la carte, et qui
 *     autorise la reproduction avec la mention « Izvor: HNB » ;
 *   - la liste des numéros de clearing et des IBAN ID de Bankinfrastruktur i Sverige AB,
 *     dont viennent les clés `SE:`, publique selon la réponse écrite de Finance Sweden
 *     du 30/09/2026, sous son avertissement.
 *
 * Sans ce module, ces codes répondaient « absent de nos données » alors que la liste
 * que nous servons pour le pays les nomme. Ils viennent de codes demandés sans réponse.
 *
 * ## Ce que ce module ne fait pas
 *
 * Il ne répond que là où la carte composite n'a pas de clé (`decideBankCode`, après
 * la carte) : aucune réponse qui nommait déjà une banque ne change. Il ne donne aucun
 * BIC : `bic` reste null, et aucun BIC n'est déduit du nom (un BIC trouvé par
 * rapprochement de noms serait notre déduction, pas la liste). Il ne fait de ces
 * listes ni un registre qui tranche (`NATIONAL_REGISTERS`) ni un registre partiel
 * déclaré (`NON_EXHAUSTIVE_REGISTERS`) : un code absent garde la réponse d'avant,
 * jamais `not_allocated`, et les textes publics qui décrivent la couverture par pays
 * ne changent pas. Même forme que les listes d'Estonie, du Monténégro et de Serbie
 * (`enrich.ts`), mais publique : les deux listes sont du cas 1 de la grille du
 * 28/10/2026 (docs/data-sources.md).
 *
 * ## Les dates
 *
 * Croatie : le fichier de la HNB est daté du 27/03/2025 (propriétés du classeur et
 * en-tête Last-Modified, concordants), lu le 06/11/2026. Suède : la liste ne porte
 * aucune date à elle ; c'est le jour de lecture (06/11/2026) qui est servi, et le
 * crédit le dit.
 */

export interface ListedHolder {
  /** Le nom tel que la liste l'écrit. */
  name: string;
  /** Ce que `bank_code_check.register` imprime : la source, sa mention et sa date. */
  register: string;
  /** Le jour qui date la réponse (édition du fichier, ou jour de lecture). */
  as_of: string;
}

/** La mention que Bankinfrastruktur i Sverige AB demande, mot pour mot celle de `bic.source` (bic-lookup.ts). */
export const SE_LIST_CREDIT =
  'Source: Bankinfrastruktur i Sverige AB, which does not guarantee that the published information is accurate; report any inaccuracy to Bankinfrastruktur i Sverige AB.';

/** La mention de la HNB, celle des clés `HR:` de la carte. */
export const HR_LIST_CREDIT = 'Izvor: HNB';

interface ListedCountry {
  register: string;
  as_of: string;
  /** Code tel que l'IBAN le porte → nom tel que la liste l'écrit. */
  codes: Readonly<Record<string, string>>;
}

const LISTS: Readonly<Record<string, ListedCountry>> = {
  HR: {
    register: `Hrvatska narodna banka, payment service provider codes (https://www.hnb.hr/documents/d/guest/e-payment-service-provider-codes), file dated 2025-03-27. ${HR_LIST_CREDIT}. The list gives no BIC for this provider.`,
    as_of: '2025-03-27',
    codes: {
      // Établissement de monnaie électronique ; la HNB ne lui donne aucun BIC.
      '4501006': 'AIRCASH d.o.o. Zagreb',
    },
  },
  SE: {
    register: `Bankinfrastruktur i Sverige AB, clearing numbers and IBAN IDs of Swedish account providers (https://www.bankinfrastruktur.se/media/rrnhercd/tabell-for-nedladdning.csv), read on 2026-11-06. ${SE_LIST_CREDIT} The list gives no BIC for this provider.`,
    as_of: '2026-11-06',
    codes: {
      // Clearing 2160 à 2169, IBAN ID 216 ; colonne BIC vide dans la liste.
      '216': 'Trade Republic Bank',
    },
  },
};

/** L'établissement qu'une liste publique nomme pour ce code sans BIC, ou null. */
export function lookupListedHolder(countryCode: string, bankCode: string): ListedHolder | null {
  const list = LISTS[countryCode.toUpperCase()];
  if (!list) return null;
  const name = list.codes[bankCode];
  if (!name) return null;
  return { name, register: list.register, as_of: list.as_of };
}

/** Chaque code listé, pour les tests et l'inventaire des sources. */
export function listedHolderKeys(): string[] {
  return Object.entries(LISTS).flatMap(([cc, list]) =>
    Object.keys(list.codes).map((code) => `${cc}:${code}`),
  );
}
