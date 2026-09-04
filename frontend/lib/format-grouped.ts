/**
 * Locale-aware number formatting that gives the SAME string on the server
 * and in every browser.
 *
 * `Intl.NumberFormat` does not: Node and Chromium share one ICU, WebKit ships
 * another, and "121 773" (narrow no-break space) on the server against
 * "121 773" (no-break space) in Safari is a React #418 hydration error on
 * every page that renders a figure in a client component. Measured on
 * 2026-09-04 on the home page: the error fired in WebKit only, and React's
 * recovery re-rendered <html>, wiping the `js` class the motion layer keys
 * on — the film fell apart in Safari for a formatting detail.
 *
 * So: string work. Thousands are grouped with a no-break space for fr and
 * de and a comma for en; the decimal separator follows the locale.
 */
export function formatGrouped(value: number, locale: string, decimals = 0): string {
  const fixed = Math.abs(value).toFixed(decimals)
  const [int, frac] = fixed.split(".")
  const en = locale.toLowerCase().startsWith("en")
  const groupSep = en ? "," : " "
  const decSep = en ? "." : ","
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, groupSep)
  const sign = value < 0 ? "-" : ""
  return frac ? `${sign}${grouped}${decSep}${frac}` : `${sign}${grouped}`
}
