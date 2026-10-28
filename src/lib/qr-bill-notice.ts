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
 *
 * Corrected on 28/10/2026: until then the notice said that from 14.11.2026
 * "any payment order with an unstructured address is refused", after a SIX
 * factsheet of 19.08.2025. The SIX roadmap page, read on 28.10.2026, keeps the
 * rule and the date but not the general refusal:
 *   https://www.six-group.com/en/products-services/banking-services/payment-standardization/swiss-payments.html
 *   - SPS 2026 and QR-bill IG 2.4 "valid from 14 November 2026, therefore
 *     remain unchanged and in force"; from November 2026 "Town Name" and
 *     "Country" "must always be used and populated with the correct content
 *     whenever an address is provided";
 *   - in SIC, "validation of the addresses will be waived. It should therefore
 *     be noted that payment orders containing unstructured addresses may
 *     continue to be received";
 *   - "Banks may continue to offer additional options as part of their customer
 *     services [...] This may also include the unstructured address";
 *   - Swift and the EPC "decided [...] to suspend the deadline of November 2026".
 * Two banks say what they do with it, both read on 28.10.2026:
 *   https://www.zkb.ch/de/lps/unternehmen/zahlen/neuer-zahlungsverkehr.html
 *   (incomplete address, e.g. no town: "Bankzahlung Inland in CHF und EUR:
 *   werden vorläufig weiterhin akzeptiert"; SEPA, foreign and foreign-currency
 *   payments "werden zurückgewiesen");
 *   https://www.postfinance.ch/de/unternehmen/kampagnen/iso-updates.html
 *   (pain.001 with an unstructured address "vorerst nicht strikt abgewiesen",
 *   delivery to the payee not guaranteed).
 * The notice now says exactly that much: the Swiss rule, who enforces it (each
 * bank), and what may be rejected. No more, no less.
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
 * From this date the Swiss Payment Standards 2026 apply to payment ORDERS
 * (pain.001): a structured or hybrid address, with the town and the country in
 * their own fields (SIX). A rule of the standard, not a refusal by the network:
 * SIC does not validate addresses and each bank decides what it still accepts
 * (see the sources above). A date for payment orders, not for the QR-bill: it
 * reaches a QR-bill only through the standing orders and templates a payer
 * typed from it.
 *
 * Named UNSTRUCTURED_PAYMENT_ORDERS_REFUSED_FROM until 28/10/2026; renamed
 * because the old name stated the refusal the sources no longer support.
 */
export const SPS_2026_ADDRESS_RULES_FROM = '2026-11-14';

/** What the type K finding is quoted from: the QR-bill standard and two banks, then SIX and two banks on payment orders. */
export const COMBINED_ADDRESS_SOURCE =
  'SIX, Swiss Implementation Guidelines QR-bill, version 2.3 (valid from 21 November 2025): only the structured address ' +
  '(type S) is permitted. UBS, "Strukturierte Adressen" (https://www.ubs.com/ch/de/services/payments/connection-ubs/iso-20022/structured-addresses.html): ' +
  'QR-bills with unstructured addresses are accepted for payment only until 30 September 2026. Zürcher Kantonalbank, factsheet ' +
  '"Strukturierte Adressen" (https://zkb.ch/media/zkb/dokumente/sonstige/fs-strukturierte-adressen.pdf): processing of QR-bills ' +
  'with an unstructured address is guaranteed "längstens bis Ende September 2026". SIX, Swiss Payments roadmap ' +
  '(https://www.six-group.com/en/products-services/banking-services/payment-standardization/swiss-payments.html, read 28.10.2026): ' +
  'the Swiss Payment Standards 2026 stay valid from 14 November 2026, "Town Name" and "Country" must be populated whenever an ' +
  'address is provided; in SIC "validation of the addresses will be waived", and banks may continue to offer the unstructured ' +
  'address. Zürcher Kantonalbank (https://www.zkb.ch/de/lps/unternehmen/zahlen/neuer-zahlungsverkehr.html, read 28.10.2026): ' +
  'with an incomplete address, domestic payments in CHF and EUR "werden vorläufig weiterhin akzeptiert", SEPA, foreign and ' +
  'foreign-currency payments are rejected. PostFinance (https://www.postfinance.ch/de/unternehmen/kampagnen/iso-updates.html, ' +
  'read 28.10.2026): unstructured addresses in pain.001 are "vorerst nicht strikt abgewiesen", delivery to the payee not guaranteed.';

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
    'Dès le 14.11.2026, les Swiss Payment Standards exigent dans un ordre de paiement une adresse structurée ou hybride, avec la localité et le pays dans leurs propres champs. ' +
    'Le système SIC ne valide pas les adresses : chaque banque décide. Certaines acceptent encore, pour un temps, les paiements suisses ; un paiement SEPA ou international sans localité peut être rejeté. ' +
    'Refaites aussi les ordres permanents et les modèles saisis depuis une QR-facture K.',
  de:
    'Der Adresstyp K ist in einer QR-Rechnung seit dem 21.11.2025 nicht mehr zulässig (SIX, IG QR-Rechnung 2.3). ' +
    'Die Banken garantieren die Zahlung einer solchen QR-Rechnung nur bis Ende September 2026 (UBS: 30.09.2026; ZKB: längstens bis Ende September 2026). ' +
    'Eine QR-Rechnung mit Typ K kann daher bei der Zahlung abgewiesen werden: Stellen Sie sie mit Typ S neu aus. ' +
    'Ab dem 14.11.2026 verlangen die Swiss Payment Standards in einem Zahlungsauftrag eine strukturierte oder hybride Adresse, mit Ort und Land in eigenen Feldern. ' +
    'Das SIC-System prüft die Adressen nicht: Jede Bank entscheidet selbst. Manche akzeptieren Inlandzahlungen vorläufig weiter; eine SEPA- oder Auslandzahlung ohne Ort kann abgewiesen werden. ' +
    'Erfassen Sie auch die Daueraufträge und Vorlagen neu, die aus einer QR-Rechnung mit Typ K übernommen wurden.',
  en:
    'Address type K has not been permitted in a QR-bill since 21.11.2025 (SIX, QR-bill IG 2.3). ' +
    'The banks guarantee payment of such a QR-bill only until the end of September 2026 (UBS: 30.09.2026; ZKB: end of September 2026 at the latest). ' +
    'A type K QR-bill may therefore be refused at payment: reissue it with type S. ' +
    'From 14.11.2026, the Swiss Payment Standards require a structured or hybrid address in a payment order, with the town and country in their own fields. ' +
    'The SIC system does not validate addresses: each bank decides. Some still accept domestic Swiss payments for now; a SEPA or international payment without a town may be rejected. ' +
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
