import { describe, expect, it } from 'vitest'
import { gw, gwh, pct, shiftDay, signedGw, ukTime } from './format'

describe('format', () => {
  it('formats power and energy', () => {
    expect(gw(12345)).toBe('12.3 GW')
    expect(gwh(278630)).toBe('279 GWh')
    expect(gw(null)).toBe('–')
  })
  it('signs bias so shortfalls read clearly', () => {
    expect(signedGw(-1746)).toBe('−1.75 GW')
    expect(signedGw(500)).toBe('+0.50 GW')
  })
  it('formats percentages', () => expect(pct(17.92)).toBe('17.9%'))
  it('shows UK local time', () => {
    expect(ukTime('2026-01-14T07:30:00Z')).toBe('07:30')
    expect(ukTime('2026-07-14T07:30:00Z')).toBe('08:30')
  })
  it('shifts days across month boundaries', () => {
    expect(shiftDay('2026-01-31', 1)).toBe('2026-02-01')
    expect(shiftDay('2026-01-02', -1)).toBe('2026-01-01')
  })
})
