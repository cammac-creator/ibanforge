import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/*
 * The home as source (it is an async server component that calls
 * getTranslations, which needs a request context this suite does not set up):
 * the marks the integrator checks online, and the doors the dashboard counts.
 */
const source = readFileSync(resolve(__dirname, "page.tsx"), "utf8")

describe("the home page", () => {
  it("carries the mark of « la revue resserrée »", () => {
    expect(source).toContain('data-landing="home-v4"')
    expect(source).not.toContain('data-landing="home-v3"')
  })

  it("names every free-key button after its place, each once", () => {
    const buttons = [...source.matchAll(/<GetKeyButton[^>]*\bevt="([^"]+)"/g)].map((m) => m[1])
    expect(source.match(/<GetKeyButton\b/g)).toHaveLength(buttons.length)
    expect(buttons).toEqual(["cta:key-hero", "cta:key-pricing", "cta:key-final"])
    expect(new Set(buttons).size).toBe(buttons.length)
  })

  it("keeps the anchor the cover and the price table point to", () => {
    expect(source).toContain('id="try"')
    expect(source.match(/href="#try"/g)?.length).toBeGreaterThanOrEqual(2)
  })

  it("no longer draws the lens", () => {
    expect(source).not.toMatch(/components\/lens\/(lens-hero|lens-gallery|lens\.css)|lensAssets\.poster/)
  })
})
