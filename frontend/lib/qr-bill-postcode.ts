/**
 * Les adresses de la QR-facture dont le NPA et la localité n'ont pas pu être
 * comparés au répertoire officiel des localités de swisstopo (29.10.2026).
 *
 * L'API ne donne d'avertissement que lorsque le répertoire contredit le couple.
 * Un NPA de case postale probable (`not_verifiable`, l'exemple de SIX
 * « 2501 Biel ») et un répertoire illisible sur le serveur
 * (`directory_unavailable`) n'en donnent pas : sans cette liste, la page
 * afficherait « toutes les règles passent » sur un couple que personne n'a
 * vérifié (relecture de la PR 470).
 */

export type UnverifiedPostcodeStatus = "not_verifiable" | "directory_unavailable"

interface PartyForPostcode {
  present: boolean
  address: { postal_code?: string; town?: string }
  sps_check?: { postcode_locality?: { status: string } | null } | null
}

export interface QrResultForPostcode {
  creditor: PartyForPostcode
  ultimate_debtor: PartyForPostcode
}

export interface UnverifiedPostcode {
  party: "creditor" | "debtor"
  status: UnverifiedPostcodeStatus
  postcode: string
  town: string
}

const UNVERIFIED: ReadonlySet<string> = new Set<UnverifiedPostcodeStatus>([
  "not_verifiable",
  "directory_unavailable",
])

/** Les parties présentes dont le couple NPA et localité reste non vérifié, créancier d'abord. */
export function unverifiedPostcodes(result: QrResultForPostcode): UnverifiedPostcode[] {
  const out: UnverifiedPostcode[] = []
  for (const [party, p] of [
    ["creditor", result.creditor],
    ["debtor", result.ultimate_debtor],
  ] as const) {
    const status = p.present ? p.sps_check?.postcode_locality?.status : undefined
    if (status && UNVERIFIED.has(status)) {
      out.push({
        party,
        status: status as UnverifiedPostcodeStatus,
        postcode: p.address.postal_code ?? "",
        town: p.address.town ?? "",
      })
    }
  }
  return out
}
