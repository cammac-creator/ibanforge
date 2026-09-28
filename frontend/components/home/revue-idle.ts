/**
 * Resolves once the page has loaded and the browser is idle: the motion
 * engines of the home (GSAP) never compete with its first paint.
 *
 * Since the tightened magazine of 28/09/2026 the film follows the cover
 * directly, so it is near the screen on arrival; loading its engine at once put
 * GSAP before the largest paint of a phone (Lighthouse, 28/09/2026).
 */
export function afterLoadIdle(timeout = 2500): Promise<void> {
  return new Promise((resolve) => {
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number
    }
    const idle = () => {
      if (w.requestIdleCallback) w.requestIdleCallback(() => resolve(), { timeout })
      else window.setTimeout(resolve, 300)
    }
    if (document.readyState === "complete") idle()
    else window.addEventListener("load", idle, { once: true })
  })
}
