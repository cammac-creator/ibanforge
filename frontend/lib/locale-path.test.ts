import { describe, expect, it } from "vitest"
import { localePath } from "./locale-path"

describe("localePath", () => {
  it("serves English at the root", () => {
    expect(localePath("en")).toBe("/")
    expect(localePath("en", "/")).toBe("/")
    expect(localePath("en", "/docs/mcp")).toBe("/docs/mcp")
    expect(localePath("en", "docs")).toBe("/docs")
  })
  it("prefixes the other locales", () => {
    expect(localePath("fr")).toBe("/fr")
    expect(localePath("de", "/pricing")).toBe("/de/pricing")
    expect(localePath("fr", "blog/x")).toBe("/fr/blog/x")
  })
})
