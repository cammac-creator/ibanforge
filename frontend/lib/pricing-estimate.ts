import catalogue from "@/data/onboarding.json"

export interface EndpointDef {
  key: string
  path: string

  cost: number
}

export const ENDPOINTS: readonly EndpointDef[] = [
  { key: "validate", path: "/v1/iban/validate", cost: 0.005 },
  { key: "batch", path: "/v1/iban/batch", cost: 0.002 },
  { key: "bic", path: "/v1/bic/:code", cost: 0.003 },
  { key: "chClearing", path: "/v1/ch/clearing/:iid", cost: 0.003 },
  { key: "compliance", path: "/v1/iban/compliance", cost: 0.02 },
]

export const MAX_VOLUME = 10_000_000

const PACK_1K = 5
const PACK_5K = 20
const PACK_25K = 80

export function formatCost(amount: number): string {
  if (amount === 0) return "$0.00"
  if (amount < 0.01) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

/** Combinaison de packs couvrant le volume au coût d’achat minimal. */
export function packQuote(units: number): { price: number; credits: number } {
  const thousands = Math.ceil(units / 1000)
  const big = Math.floor(thousands / 25)
  const rest = thousands % 25
  let bestPrice = PACK_25K
  let bestThousands = 25
  for (let fives = 0; fives * 5 <= rest + 4; fives++) {
    const ones = Math.max(0, rest - fives * 5)
    const price = fives * PACK_5K + ones * PACK_1K
    const covered = fives * 5 + ones
    if (price < bestPrice || (price === bestPrice && covered > bestThousands)) {
      bestPrice = price
      bestThousands = covered
    }
  }
  if (rest === 0) {
    bestPrice = 0
    bestThousands = 0
  }
  return {
    price: big * PACK_25K + bestPrice,
    credits: (big * 25 + bestThousands) * 1000,
  }
}

export function freeKeyTier(units: number): "anonymous" | "claimed" | null {
  if (units <= 0) return null
  if (units <= catalogue.anonymousMonthly) return "anonymous"
  if (units <= catalogue.claimedMonthly) return "claimed"
  return null
}

export const PRO_MONTHLY_PRICE = 29
export const PRO_MONTHLY_UNITS = 10_000
