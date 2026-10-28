import { localePath } from "@/lib/locale-path"

/**
 * Le pont de l'outil QR-facture vers l'audit de fichier (28.10.2026).
 *
 * Quelqu'un qui colle une QR-facture à adresse combinée (type K) paie des
 * fournisseurs suisses : c'est le seul visiteur qualifié que le site sache
 * reconnaître pour l'audit. L'encart ne s'affiche que dans ce cas, sans parler
 * d'échéance : la règle du 14.11.2026 et ce que chaque banque en fait sont dits
 * dans la notice, pas ici.
 */

interface QrParty {
  present: boolean
  structured: boolean | null
}

export interface QrResultForAudit {
  findings: Array<{ code: string }>
  creditor: QrParty
  ultimate_debtor: QrParty
}

/** Une adresse combinée (type K) ou non structurée dans la réponse du contrôle. */
export function pointsToAudit(result: QrResultForAudit): boolean {
  return (
    result.findings.some((f) => f.code === "combined_address") ||
    [result.creditor, result.ultimate_debtor].some((p) => p.present && p.structured === false)
  )
}

/** La page d'audit dans la langue du visiteur, marquée comme venue de l'outil QR. */
export function auditHrefFromQr(locale: string): string {
  return `${localePath(locale, "/audit")}?src=qr`
}
