import { describe, expect, it } from 'vitest'
import { RAIL_STATIONS, buildRail, type RailStep } from './rail'

const DE: RailStep[] = [
  { station: 'gate', key: 'gate', outcome: 'ok', params: { paid: false, cost: 0 } },
  { station: 'scribe', key: 'scribe', outcome: 'ok', params: { cc: 'DE' } },
  { station: 'cutter', key: 'cutter', outcome: 'ok', params: { bankCode: '37040044', account: '0532013000' } },
  { station: 'library', key: 'library', outcome: 'ok', params: { found: true, source: 'Bundesbank', basis: 'national_register' } },
  { station: 'registry', key: 'registry', outcome: 'ok', params: { cc: 'DE', register: 'Bundesbank', bic: 'COBADEFFXXX' } },
  { station: 'court', key: 'court', outcome: 'ok', params: { status: 'verified', authoritative: true, register: 'Bundesbank' } },
  { station: 'classifier', key: 'classifier', outcome: 'ok', params: { type: 'bank', name: 'Commerzbank' } },
  { station: 'border', key: 'border', outcome: 'ok', params: { sepa: true, vopRequired: true, vopParticipant: true } },
  { station: 'forge', key: 'forge', outcome: 'ok', params: { valid: true, bic: 'COBADEFFXXX', ms: 0.36 } },
  { station: 'exit', key: 'exit', outcome: 'ok', params: { ms: 0.36 } },
]

const BROKEN: RailStep[] = [
  { station: 'gate', key: 'gate', outcome: 'ok', params: { paid: false, cost: 0 } },
  { station: 'scribe', key: 'scribe', outcome: 'fail', params: { reason: 'invalid_check_digits' } },
  { station: 'exit', key: 'exit', outcome: 'fail', params: {} },
]

const UK: RailStep[] = [
  ...DE.slice(0, 3),
  { station: 'cutter', key: 'modulus', outcome: 'ok', params: { passed: true, source: 'Vocalink' } },
  ...DE.slice(3, 6),
  { station: 'court', key: 'pra', outcome: 'warn', params: { authorised: false, firm: null } },
  ...DE.slice(6),
]

describe('RAIL_STATIONS', () => {
  it('lists the twelve catalogue stations in pipeline order, in three streets', () => {
    expect(RAIL_STATIONS.map((s) => s.station)).toEqual([
      'gate', 'scribe', 'cutter', 'library',
      'registry', 'six', 'court', 'classifier',
      'border', 'tower', 'forge', 'exit',
    ])
    expect(new Set(RAIL_STATIONS.map((s) => s.group))).toEqual(new Set(['formalities', 'registers', 'frontier']))
  })
})

describe('buildRail', () => {
  it('before any quest, every row waits and nothing is counted', () => {
    const r = buildRail(null, -1)
    expect(r.rows).toHaveLength(12)
    expect(r.rows.every((row) => row.state === 'idle')).toBe(true)
    expect(r.counter).toBeNull()
  })

  it('once a quest exists, the stations the response did not reach are struck out', () => {
    const r = buildRail(DE, 0)
    const byStation = Object.fromEntries(r.rows.map((row) => [row.station, row.state]))
    expect(byStation.six).toBe('skipped')
    expect(byStation.tower).toBe('skipped')
    expect(byStation.gate).toBe('current')
    expect(byStation.scribe).toBe('idle')
    expect(r.counter).toEqual({ current: 1, total: 10 })
  })

  it('progress turns played steps into their outcome and moves the cursor', () => {
    const r = buildRail(DE, 4)
    const byStation = Object.fromEntries(r.rows.map((row) => [row.station, row.state]))
    expect(byStation.gate).toBe('done')
    expect(byStation.library).toBe('done')
    expect(byStation.registry).toBe('current')
    expect(byStation.court).toBe('idle')
    expect(r.rows.find((row) => row.station === 'registry')?.result).toBe('COBADEFFXXX')
    expect(r.rows.find((row) => row.station === 'cutter')?.result).toBe('37040044')
    expect(r.counter).toEqual({ current: 5, total: 10 })
  })

  it('a failed quest keeps the fail on the scribe and strikes everything after it', () => {
    const r = buildRail(BROKEN, 3)
    const byStation = Object.fromEntries(r.rows.map((row) => [row.station, row.state]))
    expect(byStation.scribe).toBe('fail')
    expect(byStation.exit).toBe('fail')
    expect(byStation.cutter).toBe('skipped')
    expect(byStation.forge).toBe('skipped')
    expect(r.counter).toEqual({ current: 3, total: 3 })
  })

  it('a second step on the same station becomes an indented sub-row, and the count still adds up', () => {
    const r = buildRail(UK, 12)
    expect(r.rows).toHaveLength(14)
    const subs = r.rows.filter((row) => row.sub)
    expect(subs.map((row) => row.key)).toEqual(['modulus', 'pra'])
    expect(subs[1].state).toBe('warn')
    expect(r.counter).toEqual({ current: 12, total: 12 })
  })

  it('the border row says what was actually checked', () => {
    const r = buildRail(DE, 10)
    expect(r.rows.find((row) => row.station === 'border')?.result).toBe('SEPA ✓ · VoP ✓')
    expect(r.rows.find((row) => row.station === 'classifier')?.result).toBe('Commerzbank')
  })
})
