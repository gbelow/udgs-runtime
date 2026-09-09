import { describe, it, expect } from 'vitest'
import { resetSkill, resetAllSkills } from './index'
import { skillLenses } from '../lenses'
import { makeCharacter } from '../../factories'
import type { Character, Skills } from '../../types'

// Writes a stored base value without going through the ingest, which would drop
// the trainable's name along with it.
function setBase<T extends Character>(c: T, key: keyof Skills, value: number): T {
  return { ...c, trainables: { ...c.trainables, [key]: { ...c.trainables[key], value } } }
}

const skillKeys = Object.keys(skillLenses) as (keyof Skills)[]

// Which trainables count as skills is answered in two places that never mention
// each other: `resetAllSkills` reads the stored `type` tag, the lens registry is
// keyed by the schema group. The bulk reset and the same reset folded over the
// registry have to land on the same character, or the two answers have drifted.
describe('resetSkills', () => {
  it('resetAllSkills matches folding resetSkill over the skill registry', () => {
    const before = skillKeys.reduce((c, key) => setBase(c, key, 4), makeCharacter(null))
    const folded = skillKeys.reduce<Character>((c, key) => resetSkill(key)(c), before)
    expect(resetAllSkills()(before)).toEqual(folded)
  })
})
