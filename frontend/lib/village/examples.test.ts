import { describe, expect, it } from 'vitest'
import { LIVE_EXAMPLES } from './examples'

/** ISO 13616 mod-97: rotate, letters to 10..35, remainder must be 1. */
function mod97(iban: string): boolean {
  const s = iban.slice(4) + iban.slice(0, 4)
  let r = 0
  for (const ch of s) {
    const v = /\d/.test(ch) ? Number(ch) : ch.charCodeAt(0) - 55
    r = Number(String(r) + String(v)) % 97
  }
  return r === 1
}

describe('LIVE_EXAMPLES', () => {
  it('tells five stories, each with a quest mode', () => {
    expect(LIVE_EXAMPLES).toHaveLength(5)
    for (const e of LIVE_EXAMPLES) expect(['iban', 'compliance']).toContain(e.mode)
    expect(new Set(LIVE_EXAMPLES.map((e) => e.key)).size).toBe(5)
  })

  it('every well-formed example passes mod-97; the broken one is the only failure', () => {
    for (const e of LIVE_EXAMPLES) {
      expect(mod97(e.iban.replace(/\s+/g, ''))).toBe(e.key !== 'broken')
    }
  })

  it('is printed in groups of four, the way a human reads an IBAN', () => {
    for (const e of LIVE_EXAMPLES) expect(e.iban).toMatch(/^([A-Z0-9]{4} )+[A-Z0-9]{1,4}$/)
  })
})
