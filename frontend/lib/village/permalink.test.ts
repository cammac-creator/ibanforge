import { describe, expect, it } from 'vitest'
import { parseLiveParams } from './permalink'

describe('parseLiveParams', () => {
  it('reads an IBAN, a mode and the autoplay flag', () => {
    expect(parseLiveParams('?iban=de89%203704%200044&mode=compliance&autoplay=1')).toEqual({
      iban: 'DE89 3704 0044',
      mode: 'compliance',
      autoplay: true,
    })
  })

  it('defaults to the validation quest, no IBAN, no autoplay', () => {
    expect(parseLiveParams('')).toEqual({ iban: null, mode: 'iban', autoplay: false })
    expect(parseLiveParams('?mode=whatever')).toEqual({ iban: null, mode: 'iban', autoplay: false })
  })

  it('collapses whitespace and refuses an IBAN longer than the field', () => {
    expect(parseLiveParams('?iban=  ch78   0076  ').iban).toBe('CH78 0076')
    expect(parseLiveParams(`?iban=${'X'.repeat(43)}`).iban).toBeNull()
  })

  it('drops anything that is not an IBAN character', () => {
    expect(parseLiveParams('?iban=DE89-3704%20(0044)!').iban).toBe('DE893704 0044')
  })
})
