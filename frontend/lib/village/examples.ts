/**
 * The example quests offered under the /live field: five stories a cold
 * visitor could not tell from memory, each verified against the production
 * API on 01/09/2026 (DA audit, script `j.py`) — the route each one walks is
 * real, not promised.
 *
 * - de: the reference journey — national register (Bundesbank), court ok.
 * - ch: the Swiss counter lights up (Banque Cantonale Vaudoise, sic: true).
 * - tr: compliance mode — library warn, court warn, watchtower warn: the
 *   three "reserve" states of the village in one film.
 * - broken: last digit off — the seal breaks at the Scribe, the hero turns back.
 * - gb: compliance mode with the PRA authorisation sub-step, which nothing
 *   else lights.
 */
export interface LiveExample {
  key: 'de' | 'ch' | 'tr' | 'broken' | 'gb'
  iban: string
  mode: 'iban' | 'compliance'
}

export const LIVE_EXAMPLES: readonly LiveExample[] = [
  { key: 'de', iban: 'DE89 3704 0044 0532 0130 00', mode: 'iban' },
  { key: 'ch', iban: 'CH78 0076 7001 2345 6700 0', mode: 'iban' },
  { key: 'tr', iban: 'TR33 0006 1005 1978 6457 8413 26', mode: 'compliance' },
  { key: 'broken', iban: 'DE89 3704 0044 0532 0130 01', mode: 'iban' },
  { key: 'gb', iban: 'GB33 BUKB 2020 1555 5555 55', mode: 'compliance' },
]
