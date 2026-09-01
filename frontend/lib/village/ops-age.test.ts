import { describe, expect, it } from 'vitest'
import { opAgeMinutes } from './ops-age'

describe('opAgeMinutes', () => {
  const now = Date.UTC(2026, 8, 1, 19, 0, 0)

  it('reads the SQLite default shape (space, no zone) as UTC', () => {
    expect(opAgeMinutes('2026-09-01 18:45:51', now)).toBe(14)
  })

  it('reads the ISO shape the application inserts', () => {
    expect(opAgeMinutes('2026-09-01T18:30:00.000Z', now)).toBe(30)
  })

  it('never goes negative when the clocks disagree by a few seconds', () => {
    expect(opAgeMinutes('2026-09-01 19:00:30', now)).toBe(0)
  })

  it('rejects what it cannot read', () => {
    expect(opAgeMinutes('yesterday', now)).toBeNull()
    expect(opAgeMinutes('', now)).toBeNull()
  })
})
