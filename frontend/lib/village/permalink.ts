/**
 * The quest permalink: `/live?iban=…&mode=compliance&autoplay=1` replays a
 * quest exactly as someone saw it. Read once at mount, never trusted: the
 * IBAN is reduced to its alphabet, spaced as typed, and capped at the
 * field's own length.
 */
export interface LiveParams {
  iban: string | null
  mode: 'iban' | 'compliance'
  autoplay: boolean
}

const MAX_LEN = 42

export function parseLiveParams(search: string): LiveParams {
  const q = new URLSearchParams(search)
  const rawIban = q.get('iban')
  let iban: string | null = null
  if (rawIban) {
    const clean = rawIban
      .toUpperCase()
      .replace(/[^A-Z0-9 ]+/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    iban = clean.length > 0 && clean.length <= MAX_LEN ? clean : null
  }
  return {
    iban,
    mode: q.get('mode') === 'compliance' ? 'compliance' : 'iban',
    autoplay: q.get('autoplay') === '1',
  }
}
