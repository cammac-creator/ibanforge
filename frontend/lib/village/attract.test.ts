import { describe, expect, it } from 'vitest'
import { pickDemo, shouldAttract } from './attract'

const PLAYLIST = ['de', 'ch', 'tr', 'broken'] as const

describe('pickDemo', () => {
  it('rotates through the playlist by visit count, so a returning visitor sees another film', () => {
    expect(pickDemo(PLAYLIST, 0)).toBe('de')
    expect(pickDemo(PLAYLIST, 1)).toBe('ch')
    expect(pickDemo(PLAYLIST, 3)).toBe('broken')
    expect(pickDemo(PLAYLIST, 4)).toBe('de')
  })

  it('never breaks on garbage counters', () => {
    expect(pickDemo(PLAYLIST, -3)).toBe('de')
    expect(pickDemo(PLAYLIST, Number.NaN)).toBe('de')
  })
})

describe('shouldAttract', () => {
  const calm = { idleMs: 6000, interacted: false, visible: true, hidden: false, reduced: false, played: false, running: false }

  it('plays once, for a passive visitor, on a visible canvas, without reduced motion', () => {
    expect(shouldAttract(calm)).toBe(true)
  })

  it('never plays before six quiet seconds, nor after any gesture', () => {
    expect(shouldAttract({ ...calm, idleMs: 5999 })).toBe(false)
    expect(shouldAttract({ ...calm, interacted: true })).toBe(false)
  })

  it('never plays twice a session, off screen, in a hidden tab, under reduced motion, or over a quest', () => {
    expect(shouldAttract({ ...calm, played: true })).toBe(false)
    expect(shouldAttract({ ...calm, visible: false })).toBe(false)
    expect(shouldAttract({ ...calm, hidden: true })).toBe(false)
    expect(shouldAttract({ ...calm, reduced: true })).toBe(false)
    expect(shouldAttract({ ...calm, running: true })).toBe(false)
  })
})
