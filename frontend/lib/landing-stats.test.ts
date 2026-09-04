import { describe, expect, it } from "vitest"
import { refreshDay } from "./landing-stats"

/**
 * The trust band shows the day of the last BIC refresh, read from /health.
 * The page must never show a guessed date: anything that is not a plain
 * "YYYY-MM-DD…" string falls back to the undated wording.
 */
describe("refreshDay", () => {
  it("keeps the day of a /health timestamp", () => {
    expect(refreshDay("2026-09-01 03:22:35")).toBe("2026-09-01")
    expect(refreshDay("2026-09-01")).toBe("2026-09-01")
  })
  it("returns null for anything it cannot read", () => {
    expect(refreshDay(undefined)).toBeNull()
    expect(refreshDay(1725000000)).toBeNull()
    expect(refreshDay("hier")).toBeNull()
    expect(refreshDay("")).toBeNull()
  })
})
