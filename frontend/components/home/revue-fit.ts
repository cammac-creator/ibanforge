/*
 * Fits the giant lines of the film to their column, in the font the page
 * really loaded. Each line is measured once its font is there, and its width
 * in em becomes a custom property that the CSS divides the column by
 * (revue.css, `--fit`, `--fit-t`, `--fit-o`). The mockups measured French once,
 * by hand; the film speaks three languages, so it measures itself.
 *
 * The letters that rise one by one are boxes of their own, which loses the
 * kerning of the font between them: it is measured pair by pair and given back
 * as a margin (`--k`), so a still frame reads exactly like the plain word.
 *
 * Browser only, no animation library: this runs under reduced motion too, since
 * a line that overflows its column is a layout fault, not an effect.
 */

const PROBE_PX = 100

/** Waits for the three faces the film draws with, three seconds at most. */
export function filmFontsReady(root: HTMLElement): Promise<void> {
  const fonts = document.fonts
  if (!fonts?.load) return Promise.resolve()
  const samples = [".rv-d__bebas", ".rv-d__banque", ".rv-d__iban"]
    .map((selector) => root.querySelector(selector))
    .filter((el): el is Element => el !== null)
  const loads = samples.map((el) => {
    const cs = getComputedStyle(el)
    return fonts.load(`${cs.fontWeight} ${PROBE_PX}px ${cs.fontFamily}`).catch(() => [])
  })
  const timeout = new Promise<void>((resolve) => window.setTimeout(resolve, 3000))
  return Promise.race([Promise.all(loads).then(() => undefined), timeout])
}

/**
 * A hidden span dressed like `from`, at 100px, its letter spacing kept in em.
 *
 * Every style is set BEFORE the probe joins the page. Under reduced motion the
 * site gives every property of every element a 0.01 ms transition
 * (globals.css), and a probe restyled after its first style would still report
 * its old size: the lines were measured at 17px instead of 100px, six times too
 * narrow, and set six times too large (28/09/2026, caught in Chromium).
 */
function probeLike(host: HTMLElement, from: Element): HTMLSpanElement {
  const cs = getComputedStyle(from)
  const size = parseFloat(cs.fontSize) || 16
  const spacing = cs.letterSpacing === "normal" ? 0 : parseFloat(cs.letterSpacing) / size
  const probe = document.createElement("span")
  probe.setAttribute("aria-hidden", "true")
  probe.style.cssText =
    "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;white-space:nowrap;font-kerning:normal;line-height:1;transition:none"
  probe.style.fontFamily = cs.fontFamily
  probe.style.fontWeight = cs.fontWeight
  probe.style.fontStyle = cs.fontStyle
  probe.style.textTransform = cs.textTransform
  probe.style.fontVariantLigatures = cs.fontVariantLigatures
  probe.style.letterSpacing = `${spacing}em`
  probe.style.fontSize = `${PROBE_PX}px`
  host.appendChild(probe)
  return probe
}

function textWidth(probe: HTMLElement, text: string): number {
  probe.textContent = text
  return probe.getBoundingClientRect().width / PROBE_PX
}

/** Width in em of the given nodes, cloned into the probe (margins, spacers and spaces count). */
function nodesWidth(probe: HTMLElement, nodes: Node[], inline = false): number {
  probe.replaceChildren(
    ...nodes.map((node) => {
      const copy = node.cloneNode(true)
      if (inline && copy instanceof HTMLElement) copy.style.display = "inline-block"
      return copy
    }),
  )
  const width = probe.getBoundingClientRect().width / PROBE_PX
  probe.replaceChildren()
  return width
}

/** The kerning between two letter boxes that touch, in em (0 across a space or a spacer). */
function restoreKerning(host: HTMLElement, line: Element): void {
  const probe = probeLike(host, line)
  try {
    const letters = Array.from(line.querySelectorAll<HTMLElement>(".rv-d__l"))
    letters.forEach((a, i) => {
      const b = letters[i + 1]
      if (!b || a.nextSibling !== b) {
        a.style.removeProperty("--k")
        return
      }
      const ta = a.textContent ?? ""
      const tb = b.textContent ?? ""
      const kern = textWidth(probe, ta + tb) - textWidth(probe, ta) - textWidth(probe, tb)
      if (Math.abs(kern) < 0.0005) a.style.removeProperty("--k")
      else a.style.setProperty("--k", `${kern.toFixed(4)}em`)
    })
  } finally {
    probe.remove()
  }
}

/**
 * Measures every giant line of the film and writes its width. A line marked
 * `data-rv-fit="one"` is a single line; `data-rv-fit="lines"` holds several
 * `.rv-d__vl` lines, stacked on a phone (`--fit-t`, the widest) and set on one
 * line on a computer (`--fit-o`, the whole).
 */
export function fitFilm(root: HTMLElement): void {
  root.querySelectorAll<HTMLElement>("[data-rv-kern]").forEach((line) => restoreKerning(root, line))
  root.querySelectorAll<HTMLElement>("[data-rv-fit]").forEach((el) => {
    const probe = probeLike(root, el)
    try {
      if (el.dataset.rvFit === "lines") {
        const lines = Array.from(el.querySelectorAll<HTMLElement>(".rv-d__vl"))
        const widest = Math.max(...lines.map((line) => nodesWidth(probe, [line], true)))
        const whole = nodesWidth(probe, Array.from(el.childNodes), true)
        if (widest > 0) el.style.setProperty("--fit-t", widest.toFixed(4))
        if (whole > 0) el.style.setProperty("--fit-o", whole.toFixed(4))
      } else {
        const width = nodesWidth(probe, Array.from(el.childNodes), true)
        if (width > 0) el.style.setProperty("--fit", width.toFixed(4))
      }
    } finally {
      probe.remove()
    }
  })
}
