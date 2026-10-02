/**
 * What the QR-bill check says about a combined (type K) address, its dates and
 * its sources, in one module with no imports so that every surface can read it:
 * the check itself (src/lib/swiss-qr-bill.ts), the MCP servers and catalogue,
 * the OpenAPI contract and the discovery documents.
 *
 * Why it exists (02/10/2026): every one of those surfaces told callers to
 * "convert before 14.11.2026", the day "banks stop processing" type K
 * QR-bills. No source says so. The standard dropped type K on 21.11.2025, the
 * banks guarantee its payment only until the end of September 2026 (UBS:
 * 30.09.2026; ZKB: "längstens bis Ende September 2026"), and 14.11.2026 is the
 * SIX date for payment ORDERS with an unstructured address.
 */

/** Combined addresses (AdrTp "K") were removed from the standard on this date. */
export const COMBINED_ADDRESS_FORBIDDEN_FROM = '2025-11-21';
/**
 * The last day the banks guarantee to pay a QR-bill that still carries a
 * combined address. Each bank publishes its own date: UBS says 30.09.2026, the
 * ZKB "längstens bis Ende September 2026".
 */
export const COMBINED_ADDRESS_PAYMENT_GUARANTEED_UNTIL = '2026-09-30';
/**
 * From this date a payment ORDER (pain.001) whose addresses miss the new
 * requirements is refused (SIX). A date for payment orders, not for the
 * QR-bill: it reaches a QR-bill only through the standing orders and templates
 * a payer typed from it.
 */
export const UNSTRUCTURED_PAYMENT_ORDERS_REFUSED_FROM = '2026-11-14';

/** What the type K finding is quoted from: the standard, two banks, and SIX on payment orders. */
export const COMBINED_ADDRESS_SOURCE =
  'SIX, Swiss Implementation Guidelines QR-bill, version 2.3 (valid from 21 November 2025): only the structured address ' +
  '(type S) is permitted. UBS, "Strukturierte Adressen" (https://www.ubs.com/ch/de/services/payments/connection-ubs/iso-20022/structured-addresses.html): ' +
  'QR-bills with unstructured addresses are accepted for payment only until 30 September 2026. Zürcher Kantonalbank, factsheet ' +
  '"Strukturierte Adressen" (https://zkb.ch/media/zkb/dokumente/sonstige/fs-strukturierte-adressen.pdf): processing of QR-bills ' +
  'with an unstructured address is guaranteed "längstens bis Ende September 2026". SIX, factsheet of 19.08.2025 for ERP and ' +
  'payment software providers (https://www.six-group.com/dam/download/banking-services/standardization/sps/factsheet-address-messageversion-erp-en.pdf): ' +
  'payments that do not meet the new address requirements can no longer be processed from 14 November 2026, and templates ' +
  'with an unstructured address must not be usable from that date.';

/**
 * The type K notice, in the three languages of the site, said ONCE.
 *
 * The API and the MCP tools read `en`. The site cannot import this module, so
 * its pages carry the same sentences verbatim, and
 * `qr-bill-notice.test.ts` fails if a page drifts from them or brings
 * back the old claim that banks stop processing type K QR-bills on 14.11.2026.
 */
export const COMBINED_ADDRESS_NOTICE = {
  fr:
    "Le type K n'est plus permis dans une QR-facture depuis le 21.11.2025 (SIX, IG QR-facture 2.3). " +
    "Les banques n'en garantissent le paiement que jusqu'à fin septembre 2026 (UBS : 30.09.2026 ; ZKB : au plus tard fin septembre 2026). " +
    "Une QR-facture K risque donc d'être refusée au paiement : réémettez-la en type S. " +
    'Dès le 14.11.2026, tout ordre de paiement à adresse non structurée est refusé. ' +
    'Refaites aussi les ordres permanents et les modèles saisis depuis une QR-facture K.',
  de:
    'Der Adresstyp K ist in einer QR-Rechnung seit dem 21.11.2025 nicht mehr zulässig (SIX, IG QR-Rechnung 2.3). ' +
    'Die Banken garantieren die Zahlung einer solchen QR-Rechnung nur bis Ende September 2026 (UBS: 30.09.2026; ZKB: längstens bis Ende September 2026). ' +
    'Eine QR-Rechnung mit Typ K kann daher bei der Zahlung abgewiesen werden: Stellen Sie sie mit Typ S neu aus. ' +
    'Ab dem 14.11.2026 wird jeder Zahlungsauftrag mit unstrukturierter Adresse abgewiesen. ' +
    'Erfassen Sie auch die Daueraufträge und Vorlagen neu, die aus einer QR-Rechnung mit Typ K übernommen wurden.',
  en:
    'Address type K has not been permitted in a QR-bill since 21.11.2025 (SIX, QR-bill IG 2.3). ' +
    'The banks guarantee payment of such a QR-bill only until the end of September 2026 (UBS: 30.09.2026; ZKB: end of September 2026 at the latest). ' +
    'A type K QR-bill may therefore be refused at payment: reissue it with type S. ' +
    'From 14.11.2026, any payment order with an unstructured address is refused. ' +
    'Also redo the standing orders and templates captured from a type K QR-bill.',
} as const;

/**
 * The same facts in one clause, for the tool descriptions and catalogue lines
 * that cannot carry five sentences.
 */
export const COMBINED_ADDRESS_CLAUSE =
  'type K has not been permitted since 21.11.2025, and the banks guarantee payment of a type K QR-bill only until the end of September 2026';

/**
 * The field `ready_for_2026_11_14` keeps its name (fields are added, never
 * renamed: decision of 24/09/2026); only what it is said to mean changes.
 */
export const READY_FIELD_DESCRIPTION =
  'valid AND every present address is structured (type S). The name is kept for compatibility and is not a deadline: ' +
  COMBINED_ADDRESS_CLAUSE +
  '.';
