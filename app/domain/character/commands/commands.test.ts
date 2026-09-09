import { describe, it, expect } from 'vitest'
import { addAffliction, bleed, updateSTA, resetSkill, resetAllSkills } from './index'
import { skillLenses } from '../lenses'
import { AFFLICTIONS } from '../../tables'
import { makeCampaignCharacter, makeCharacter } from '../../factories'
import type { AfflictionKey, CampaignCharacter, Character, Skills } from '../../types'

function campaign(overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return {
    ...base,
    ...overrides,
    resources: { ...base.resources, ...(overrides.resources ?? {}) },
    injuries: { ...base.injuries, ...(overrides.injuries ?? {}) },
  }
}

// Writes a stored base value without going through the ingest, which would drop
// the trainable's name and type along with it.
function setBase<T extends Character>(c: T, key: keyof Skills, value: number): T {
  return { ...c, trainables: { ...c.trainables, [key]: { ...c.trainables[key], value } } }
}

const afflictionKeys = Object.keys(AFFLICTIONS) as AfflictionKey[]
const skillKeys = Object.keys(skillLenses) as (keyof Skills)[]

// Toggling is an involution on the stored list, and the list is the only thing
// it touches: a second toggle has to land back on the value it started from.
describe('addAffliction', () => {
  it.each(afflictionKeys)('toggling "%s" twice returns the original list', (key) => {
    const c = campaign()
    const once = addAffliction(key)(c)
    expect(addAffliction(key)(once).afflictions).toEqual(c.afflictions)
  })

  // The controlable flag is the whole contract of the command: an affliction a
  // resource owns is recomputed on every read, so writing it by hand would
  // freeze it in place. A hand-settable one has to actually appear.
  it.each(afflictionKeys)('respects the controlable flag on "%s"', (key) => {
    const c = campaign()
    const after = addAffliction(key)(c)
    if (AFFLICTIONS[key].controlable) {
      expect(after.afflictions).toContain(key)
    } else {
      expect(after).toBe(c)
    }
  })
})

describe('bleed', () => {
  it('is additive: bleeding twice matches bleeding the sum at once', () => {
    const c = campaign({ injuries: { hemorrhage: 3 } as CampaignCharacter['injuries'] })
    expect(bleed(2)(bleed(5)(c)).injuries.injuryLevel).toBe(bleed(7)(c).injuries.injuryLevel)
  })

  it('leaves the injury level alone when nothing bleeds', () => {
    const c = campaign({ injuries: { hemorrhage: 3 } as CampaignCharacter['injuries'] })
    expect(bleed(0)(c).injuries.injuryLevel).toBe(c.injuries.injuryLevel)
  })
})

describe('updateSTA', () => {
  // The two paths to the same injury: losing stamina is defined as bleeding the
  // amount lost, so the command must agree with `bleed` on every drop.
  it.each([1, 3, 10])('a drop of %i bleeds exactly what bleed(drop) would', (drop) => {
    const c = campaign({
      resources: { STA: 10 } as CampaignCharacter['resources'],
      injuries: { hemorrhage: 2 } as CampaignCharacter['injuries'],
    })
    const dropped = updateSTA(c.resources.STA - drop)(c)
    expect(dropped.resources.STA).toBe(c.resources.STA - drop)
    expect(dropped.injuries.injuryLevel).toBe(bleed(drop)(c).injuries.injuryLevel)
  })

  it('is the identity when stamina does not fall', () => {
    const c = campaign({ resources: { STA: 10 } as CampaignCharacter['resources'] })
    expect(updateSTA(12)(c)).toBe(c)
    expect(updateSTA(10)(c)).toBe(c)
  })
})

describe('resetSkills', () => {
  const trained = () => skillKeys.reduce((c, key) => setBase(c, key, 4), makeCharacter(null))

  it.each(skillKeys)('resetting "%s" touches no other trainable', (key) => {
    const before = trained()
    const after = resetSkill(key)(before)
    expect({ ...after.trainables, [key]: null }).toEqual({ ...before.trainables, [key]: null })
  })

  it.each(skillKeys)('resetting "%s" is idempotent', (key) => {
    const once = resetSkill(key)(trained())
    expect(resetSkill(key)(once)).toEqual(once)
  })

  // Two paths to the same character: the bulk reset and folding the single
  // reset over the skill registry have to agree, including on which trainables
  // count as skills.
  it('resetAllSkills matches folding resetSkill over the skill registry', () => {
    const before = trained()
    const folded = skillKeys.reduce<Character>((c, key) => resetSkill(key)(c), before)
    expect(resetAllSkills()(before)).toEqual(folded)
  })
})
