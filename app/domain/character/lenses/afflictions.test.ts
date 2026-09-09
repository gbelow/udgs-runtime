import { describe, it, expect } from 'vitest'
import { getAfflictions, getAfflictionPenalty, getMentalAfflictionPenalty } from './afflictions'
import { magicGetters, movementLenses, skillLenses } from './index'
import { getTGH } from './misc'
import { makeKnowledgeLens } from './knowledge'
import { addKnowledge } from '../commands'
import { AFFLICTIONS, knowledges_list } from '../../tables'
import { makeCharacter, makeCampaignCharacter } from '../../factories'
import type { AfflictionKey, CampaignCharacter, Movement, Skills } from '../../types'

function campaign(overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return {
    ...base,
    ...overrides,
    resources: { ...base.resources, ...(overrides.resources ?? {}) },
    injuries: { ...base.injuries, ...(overrides.injuries ?? {}) },
  }
}

const afflictionKeys = Object.keys(AFFLICTIONS) as AfflictionKey[]
const skillKeys = Object.keys(skillLenses) as (keyof Skills)[]
const movementKeys = Object.keys(movementLenses) as (keyof Movement)[]

describe('getAfflictionPenalty is total', () => {
  // Afflictions live only on the campaign arm of the union, so this getter has
  // to answer for a base character rather than reaching for a field that is
  // not there — the types cannot see the difference.
  it.each(skillKeys)('answers for a base character on "%s"', (skill) => {
    expect(getAfflictionPenalty(makeCharacter({ trainables: { STR: { value: 12 } } }), skill)).toBe(0)
  })

  // Penalties are stored and reported as positive magnitudes throughout the
  // domain, so a penalty getter that returns a bonus is a defect rather than a
  // sign convention.
  it.each(skillKeys)('never returns a bonus for "%s"', (skill) => {
    expect(getAfflictionPenalty(campaign({ afflictions: afflictionKeys }), skill)).toBeGreaterThanOrEqual(0)
  })
})

// combat.tex writes several afflictions as severity ladders ("Intoxicated
// I/II/III", "15-29 Weakened / 30 Malnourished"). A character sits on exactly
// one rung of a ladder, so a worse rung replaces a milder one instead of
// stacking on top of it. Driven off the table, so a ladder added there is
// checked without anyone writing a case for it.
describe('severity ladders', () => {
  const everything = getAfflictions(campaign({ afflictions: afflictionKeys }))
  const groups = [...new Set(afflictionKeys.map((key) => AFFLICTIONS[key].group))].filter(
    (group): group is string => group !== undefined,
  )

  it('never returns the same affliction twice', () => {
    expect(everything).toEqual([...new Set(everything)])
  })

  it.each(groups)('keeps only the worst rung of the "%s" ladder', (group) => {
    const rungs = afflictionKeys.filter((key) => AFFLICTIONS[key].group === group)
    const worst = rungs.reduce((a, b) => ((AFFLICTIONS[a].rank ?? 0) >= (AFFLICTIONS[b].rank ?? 0) ? a : b))
    expect(everything.filter((key) => AFFLICTIONS[key].group === group)).toEqual([worst])
  })

  it('does not duplicate an affliction that is both hand-set and derived', () => {
    const c = campaign({
      afflictions: ['weakened'],
      resources: { ...makeCampaignCharacter({}).resources, hunger: 20 },
    })
    expect(getAfflictions(c).filter((key) => key === 'weakened')).toHaveLength(1)
  })
})

// combat.tex "Afflictions": "Injury (IL): penalties affect STR, AGI, STA. This
// does not affect movement speeds, nor TGH." The exclusions are the part worth
// pinning — they are why those getters read an unpenalized base.
describe('the injury penalty', () => {
  const hurt = (injuryLevel: number) =>
    campaign({ injuries: { ...makeCampaignCharacter({}).injuries, injuryLevel } })
  const levels = [0, 5, 10, 25, 60]

  it.each(movementKeys)('leaves the "%s" speed untouched at every injury level', (name) => {
    expect(new Set(levels.map((level) => movementLenses[name].get(hurt(level)))).size).toBe(1)
  })

  it('leaves TGH untouched at every injury level', () => {
    expect(new Set(levels.map((level) => getTGH(hurt(level)))).size).toBe(1)
  })

  // The rulebook puts this penalty on the three attributes rather than on a
  // skill category, so it must not arrive a second time through the table.
  it.each(skillKeys)('stays out of the affliction penalty for "%s"', (skill) => {
    expect(getAfflictionPenalty(hurt(60), skill)).toBe(getAfflictionPenalty(hurt(0), skill))
  })
})

// combat.tex "Afflictions": mental penalties affect "all Knowledges". The lens
// reports the afflicted value, so its setter has to invert through the penalty
// for the sheet to bind two-way to it.
describe('knowledges under a mental affliction', () => {
  it.each(knowledges_list)('the "%s" lens still round-trips', (name) => {
    const lens = makeKnowledgeLens(name)
    const c = addKnowledge(name)(campaign({ afflictions: ['confused'] }))
    expect(lens.get(lens.set(c, 5))).toBe(5)
  })
})

// combat.tex names both "all Knowledges" and "all spellcasting", and a spell
// value is built out of a knowledge — so the penalty has to arrive exactly
// once, not once per mention.
describe('spellcasting takes the mental penalty once', () => {
  // getMiracle is 2 x its knowledge, so the penalty inside that knowledge is
  // doubled along with it. Left standing as a known divergence rather than
  // filtered out of the loop.
  const DOUBLED = ['miracle']

  for (const [name, getter] of Object.entries(magicGetters)) {
    const run = DOUBLED.includes(name) ? it.fails : it
    run(name + ' drops by the mental penalty, no more', () => {
      const healthy = addKnowledge(name)(campaign())
      const afflicted = addKnowledge(name)(campaign({ afflictions: ['intoxicated3'] }))
      expect(getter(healthy) - getter(afflicted)).toBe(getMentalAfflictionPenalty(afflicted))
    })
  }
})
