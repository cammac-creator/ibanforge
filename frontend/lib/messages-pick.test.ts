import { describe, expect, it } from "vitest"
import { pickMessages } from "./messages-pick"

const catalogue = {
  header: { logo: "IBANforge", nav: { docs: "Docs" } },
  home: { badge: "Live", hero: { title: "T", demo: { calling: "…" } }, film: { heading: "H" } },
  pricing: { hero: { title: "P" } },
}

describe("pickMessages", () => {
  it("keeps whole namespaces", () => {
    expect(pickMessages(catalogue, ["header"])).toEqual({ header: catalogue.header })
  })
  it("keeps a nested path and nothing beside it", () => {
    expect(pickMessages(catalogue, ["home.hero.demo"])).toEqual({ home: { hero: { demo: { calling: "…" } } } })
  })
  it("drops a child path when its parent is listed, without touching the source", () => {
    const before = JSON.stringify(catalogue)
    const out = pickMessages(catalogue, ["home.hero.demo", "home"])
    expect(out).toEqual({ home: catalogue.home })
    expect(JSON.stringify(catalogue)).toBe(before)
  })
  it("ignores a path that does not exist", () => {
    expect(pickMessages(catalogue, ["nope.x", "header.nav"])).toEqual({ header: { nav: { docs: "Docs" } } })
  })
  it("merges two sibling paths under one parent", () => {
    expect(pickMessages(catalogue, ["home.badge", "home.film"])).toEqual({ home: { badge: "Live", film: { heading: "H" } } })
  })
})
