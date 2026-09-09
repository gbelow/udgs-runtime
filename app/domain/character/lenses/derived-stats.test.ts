import { describe, it, expect } from 'vitest'
import { getSM, getDM } from './helpers'
import { getTGH } from './misc'
import { SMArr, dmgArr } from '../../tables'
import { makeCharacter } from '../../factories'
import type { Character } from '../../types'

function ofSize(size: number, STR = 12, TGH = 0): Character {
  return makeCharacter({ size, trainables: { STR: { value: STR } }, TGH })
}

// Size resolves to a size-modifier and a damage-multiplier by table lookup.
// The tables are the transcription of the creating.tex size table; what these
// check is that no size can miss them.
describe('size lookups are total', () => {
  const sizes = [-10, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 50]

  it.each(sizes)('size %i lands on a real table entry', (size) => {
    expect(SMArr).toContain(getSM(ofSize(size)))
    expect(dmgArr).toContain(getDM(ofSize(size)))
  })
})

// The architectural invariant behind the wound stats: STR is scaled by the
// damage multiplier and the stored base is added unscaled, so the base keeps a
// +1 coefficient at every size. That is what lets the generic inverting setter
// write through this getter — a form that scaled the base too would invert
// correctly at size 3 and nowhere else.
describe('getTGH keeps its base term at +1', () => {
  const sizes = [1, 2, 3, 4, 5, 6, 7]
  const bases = [-3, 0, 1, 4, 10]

  it.each(sizes)('a stored base moves TGH one for one at size %i', (size) => {
    const unmodified = getTGH(ofSize(size, 12, 0))
    for (const base of bases) {
      expect(getTGH(ofSize(size, 12, base))).toBe(unmodified + base)
    }
  })
})
