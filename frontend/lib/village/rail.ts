/**
 * The rail of the pipeline — the twelve catalogue stations in the order the
 * request walks them, each with the state the response proved.
 *
 * Pure: the rows are a function of the quest's steps (journey.ts output) and
 * of how far the film has played. Nothing here invents a state: a station
 * absent from the steps is "skipped" because the response shows the pipeline
 * never went there (a German IBAN pays no Swiss clearing), and a played step
 * carries the outcome journey.ts read in the payload.
 */
import type { StationId, StepOutcome } from './journey'

export type RailGroup = 'formalities' | 'registers' | 'frontier'

export interface RailStation {
  station: StationId
  group: RailGroup
}

/** Pipeline order = walking order = the three streets of the village. */
export const RAIL_STATIONS: readonly RailStation[] = [
  { station: 'gate', group: 'formalities' },
  { station: 'scribe', group: 'formalities' },
  { station: 'cutter', group: 'formalities' },
  { station: 'library', group: 'formalities' },
  { station: 'registry', group: 'registers' },
  { station: 'six', group: 'registers' },
  { station: 'court', group: 'registers' },
  { station: 'classifier', group: 'registers' },
  { station: 'border', group: 'frontier' },
  { station: 'tower', group: 'frontier' },
  { station: 'forge', group: 'frontier' },
  { station: 'exit', group: 'frontier' },
]

/** The slice of a quest step the rail needs — NarratedStep and JourneyStep both fit. */
export interface RailStep {
  station: StationId
  key: string
  outcome: StepOutcome
  params?: Record<string, string | number | boolean | null>
}

export type RailState = 'idle' | 'skipped' | 'current' | 'done' | 'warn' | 'fail'

export interface RailRow {
  station: StationId
  /** the step key (== station, or 'modulus' / 'pra' for a sub-row) */
  key: string
  group: RailGroup
  sub: boolean
  state: RailState
  /** the real value the step produced, shown as a suffix — never a label */
  result: string | null
  /** index of the step in the quest, null for a catalogue row without a step */
  stepIndex: number | null
}

export interface Rail {
  rows: RailRow[]
  counter: { current: number; total: number } | null
}

const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

/** What the step really produced, in the vocabulary of the response. */
export function railResult(step: RailStep): string | null {
  const p = step.params ?? {}
  switch (step.key) {
    case 'gate':
      return p.paid ? `${p.cost} USDC` : null
    case 'scribe':
      return step.outcome === 'fail' ? s(p.reason) : s(p.cc)
    case 'cutter':
      return s(p.bankCode)
    case 'modulus':
      return p.passed ? `✓ ${s(p.source) ?? ''}`.trim() : '⚠'
    case 'library':
      return p.found ? s(p.source) : null
    case 'registry':
      return s(p.bic)
    case 'six':
      return s(p.iid) ? `IID ${p.iid}${p.sic ? ' · SIC' : ''}` : null
    case 'court':
      return p.status === 'verified' ? '✓' : s(p.status)
    case 'pra':
      return p.authorised ? `✓ ${s(p.firm) ?? ''}`.trim() : '⚠'
    case 'classifier':
      return s(p.name) ?? s(p.type)
    case 'border':
      return `SEPA ${p.sepa ? '✓' : '—'} · VoP ${p.vopParticipant ? '✓' : '—'}`
    case 'tower':
      return typeof p.score === 'number' ? `${p.score}/100` : s(p.level)
    case 'forge':
      return s(p.bic)
    case 'exit':
      return typeof p.ms === 'number' ? `${p.ms} ms` : null
    default:
      return null
  }
}

function stateOf(index: number, outcome: StepOutcome, progress: number): RailState {
  if (index > progress) return 'idle'
  if (index === progress) return 'current'
  if (outcome === 'fail') return 'fail'
  if (outcome === 'warn') return 'warn'
  return 'done'
}

export function buildRail(steps: RailStep[] | null, progress: number): Rail {
  if (!steps || steps.length === 0) {
    return {
      rows: RAIL_STATIONS.map((st) => ({
        station: st.station, key: st.station, group: st.group, sub: false,
        state: 'idle', result: null, stepIndex: null,
      })),
      counter: null,
    }
  }
  const rows: RailRow[] = []
  for (const st of RAIL_STATIONS) {
    const own = steps
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => step.station === st.station)
    if (own.length === 0) {
      rows.push({
        station: st.station, key: st.station, group: st.group, sub: false,
        state: 'skipped', result: null, stepIndex: null,
      })
      continue
    }
    for (const [k, { step, index }] of own.entries()) {
      rows.push({
        station: st.station, key: step.key, group: st.group, sub: k > 0,
        state: stateOf(index, step.outcome, progress),
        result: railResult(step),
        stepIndex: index,
      })
    }
  }
  const current = Math.min(steps.length, Math.max(0, progress + 1))
  return { rows, counter: { current, total: steps.length } }
}
