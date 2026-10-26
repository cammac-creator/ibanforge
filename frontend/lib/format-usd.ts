import { formatGrouped } from "./format-grouped"

/**
 * Un montant en dollars tel que le site l'écrit, dans la langue de la page :
 * « $330,000.00 » en anglais, « 330 000,00 $ » en français et en allemand
 * (espaces insécables : le signe ne part jamais seul à la ligne).
 *
 * Du travail de chaîne par-dessus formatGrouped, jamais `Intl` : le calculateur
 * des tarifs est un composant du navigateur, et WebKit groupe les chiffres
 * autrement que Node (AGENTS.md, règle 8). Jusqu'au 26.10.2026, le calculateur
 * écrivait « $330000.00 » sur toutes les pages, et le texte français autour « 29 $ ».
 *
 * `decimals` fixe le nombre de décimales. Sans lui, un montant entier n'en a
 * aucune (« $29 », « 29 $ ») et les autres gardent leurs propres chiffres,
 * jusqu'à quatre (« $0.005 », « 0,0032 $ ») : l'écriture d'un prix de catalogue.
 */
export function formatUsd(amount: number, locale: string, decimals?: number): string {
  const figures = formatGrouped(amount, locale, decimals ?? ownDecimals(amount))
  return locale.toLowerCase().startsWith("en") ? `$${figures}` : `${figures}\u00a0$`
}

function ownDecimals(amount: number): number {
  const frac = Math.abs(amount).toFixed(4).split(".")[1].replace(/0+$/, "")
  return frac.length
}
