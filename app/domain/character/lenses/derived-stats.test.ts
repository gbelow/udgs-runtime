import { describe, it, expect } from 'vitest'
import { getSM, getDM } from './helpers'
import { getTGH } from './misc'
import { SMArr, dmgArr } from '../../tables'
import { makeCharacter } from '../../factories'
import type { Character } from '../../types'

function ofSize(size: number, STR?: number, TGH?: number): Character {
  return makeCharacter({ size, trainables: {STR: { value: STR }}, TGH })
}

// Size maps to a size-modifier (SM) and a damage-multiplier (DM) via table
// lookup. Sizes 1..7 index tables of length 7 (indices 0..6).
describe('size modifiers', () => {
  it.each([1, 2, 3, 4, 5, 6])('getSM(size=%i) reads SMArr[size-1]', (size) => {
    expect(getSM(ofSize(size))).toBe(SMArr[size - 1])
  })

  it.each([1, 2, 3, 4, 5, 6])('getDM(size=%i) reads dmgArr[size-1]', (size) => {
    expect(getDM(ofSize(size))).toBe(dmgArr[size - 1])
  })

  // getSize clamps out-of-range sizes into [1, 7], so lookups never throw
  // and always resolve to a table entry at the clamped boundary.
  it('clamps sizes below the valid range to the smallest entry', () => {
    expect(getDM(ofSize(0))).toBe(dmgArr[0])
    expect(getSM(ofSize(0))).toBe(SMArr[0])
  })

  it('clamps sizes above the valid range to the largest entry', () => {
    expect(getDM(ofSize(100))).toBe(dmgArr[6])
    expect(getSM(ofSize(100))).toBe(SMArr[6])
  })

  // Size 7 is the largest valid size (maps to the last table entry, index 6).
  it('accepts size 7', () => {
    expect(getDM(ofSize(7))).toBe(dmgArr[6])
    expect(getSM(ofSize(7))).toBe(SMArr[6])
  })
})

// getTGH derives a wound threshold as floor(0.5*STR*DM + base): STR is scaled
// by the size damage-multiplier, then the stored base term is added unscaled.
describe('getTGH — floor(0.5*STR*DM + base)', () => {
  // STR = 12 (so 0.5*STR = 6), base TGH = 0. Expected = floor(6 * DM).
  it.each([
    [1, 3], // DM 0.5  -> floor(3)
    [2, 4], // DM 0.75 -> floor(4.5)
    [3, 6], // DM 1    -> 6
    [4, 9], // DM 1.5  -> floor(9)
    [5, 12], // DM 2   -> 12
    [6, 18], // DM 3   -> 18
  ])('size=%i -> %i', (size, expected) => {
    expect(getTGH(ofSize(size,  12, 0 ))).toBe(expected)
  })

  it('adds the stored base term after scaling (unscaled base)', () => {
    // size 4 -> DM 1.5; floor(0.5*10*1.5 + 2) = floor(9.5) = 9
    expect(getTGH(ofSize(4, 10, 2 ))).toBe(9)
  })
})
