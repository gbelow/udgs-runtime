import { describe, it, expect } from 'vitest'
import { getAfflictions, getAfflictionPenalty, getInjuryPenalty } from './afflictions'
import { getAGI, getSTA, getSTR } from './characteristics'
import { getTGH } from './misc'
import { getJumpMovement, getRunMovement, getStandMovement } from './movement'
import { getAlchemy } from './magic'
import { makeKnowledgeLens } from './knowledge'
import { addAffliction, addKnowledge } from '../commands'
import { makeCharacter, makeCampaignCharacter } from '../../factories'
import { ContainerSchema } from '../../types'
import type { CampaignCharacter } from '../../types'

// Build a valid campaign character from defaults, then override the nested
// state we want to exercise (afflictions / resources / injuries).
function campaign(overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return {
    ...base,
    ...overrides,
    resources: { ...base.resources, ...(overrides.resources ?? {}) },
    injuries: { ...base.injuries, ...(overrides.injuries ?? {}) },
  }
}

describe('getAfflictionPenalty', () => {
  it('is always 0 for a base (non-campaign) character', () => {
    const base = makeCharacter({ characteristics: { STR: 12 } })
    expect(getAfflictionPenalty(base, 'strike')).toBe(0)
    expect(getAfflictionPenalty(base, 'will')).toBe(0)
  })

  it('applies a sensory penalty only to sensory-category skills', () => {
    const c = campaign({ afflictions: ['disoriented'] }) // sensory: 2
    expect(getAfflictionPenalty(c, 'strike')).toBe(2) // sensory skill
    expect(getAfflictionPenalty(c, 'will')).toBe(0) // not sensory
  })

  it('applies a mental penalty to mental-category skills', () => {
    // combat.tex "Afflictions": Tired/Exhausted/Confused = -1/-2/-4 mental
    const c = campaign({ afflictions: ['confused'] })
    expect(getAfflictionPenalty(c, 'will')).toBe(4)
  })

  it('stacks sensory and mental on a skill that combat.tex lists in both', () => {
    // Exploration is named under both Sensory and Mental.
    const c = campaign({ afflictions: ['disoriented', 'tired'] }) // -2 sensory, -1 mental
    expect(getAfflictionPenalty(c, 'explore')).toBe(3)
    expect(getAfflictionPenalty(c, 'stealth')).toBe(2) // sensory only
    expect(getAfflictionPenalty(c, 'insight')).toBe(1) // mental only
  })

  it('keeps the injury penalty off the skill categories', () => {
    // combat.tex puts the injury penalty on STR/AGI/STA, not on a skill list.
    const c = campaign({ injuries: { injuryLevel: 20, injuryThreshold: 10 } as CampaignCharacter['injuries'] })
    expect(getInjuryPenalty(c)).toBe(2)
    expect(getAfflictionPenalty(c, 'grapple')).toBe(0)
    expect(getAfflictionPenalty(c, 'strike')).toBe(0)
  })
})

describe('the injury penalty — combat.tex "Afflictions"', () => {
  it('reduces STR, AGI and STA by -1 per multiple of the injury threshold', () => {
    const healthy = campaign()
    const hurt = campaign({ injuries: { injuryLevel: 20, injuryThreshold: 10 } as CampaignCharacter['injuries'] })

    expect(getSTR(healthy) - getSTR(hurt)).toBe(2)
    expect(getAGI(healthy) - getAGI(hurt)).toBe(2)
    expect(getSTA(healthy) - getSTA(hurt)).toBe(2)
  })

  it('leaves TGH and movement speeds alone, as the rulebook states', () => {
    const healthy = campaign()
    const hurt = campaign({ injuries: { injuryLevel: 30, injuryThreshold: 10 } as CampaignCharacter['injuries'] })

    expect(getTGH(hurt)).toBe(getTGH(healthy))
    expect(getRunMovement(hurt)).toBe(getRunMovement(healthy))
    expect(getJumpMovement(hurt)).toBe(getJumpMovement(healthy))
    expect(getStandMovement(hurt)).toBe(getStandMovement(healthy))
  })
})

describe('severity ladders', () => {
  it('keeps only the worst rung of a ladder, so the tiers never stack', () => {
    // combat.tex: Weakened/Malnourished = -1/-2 Health, not -1 and -2 together.
    const c = campaign({ afflictions: ['weakened', 'malnourished'] })
    expect(getAfflictions(c)).toContain('malnourished')
    expect(getAfflictions(c)).not.toContain('weakened')
    expect(getAfflictionPenalty(c, 'health')).toBe(2)
  })

  it('lets afflictions from different ladders stack', () => {
    const c = campaign({ afflictions: ['malnourished', 'dehydrated'] }) // -2 and -2 Health
    expect(getAfflictionPenalty(c, 'health')).toBe(4)
  })
})

describe('getAfflictions — resource-derived afflictions', () => {
  // survival.tex states these as exclusive bands, so each resource contributes
  // exactly one affliction.
  it('maps hunger onto its survival.tex band', () => {
    const fed = campaign({ resources: { hunger: 14 } as CampaignCharacter['resources'] })
    const weak = campaign({ resources: { hunger: 15 } as CampaignCharacter['resources'] })
    const starving = campaign({ resources: { hunger: 30 } as CampaignCharacter['resources'] })

    expect(getAfflictions(fed)).not.toContain('weakened')
    expect(getAfflictions(weak)).toContain('weakened')
    expect(getAfflictions(weak)).not.toContain('malnourished')
    expect(getAfflictions(starving)).toContain('malnourished')
    expect(getAfflictions(starving)).not.toContain('weakened')
    expect(getAfflictionPenalty(starving, 'health')).toBe(2)
  })

  it('maps thirst onto its survival.tex band, including "Unconscious + Dehydrated"', () => {
    const thirsty = campaign({ resources: { thirst: 4 } as CampaignCharacter['resources'] })
    const dehydrated = campaign({ resources: { thirst: 8 } as CampaignCharacter['resources'] })
    const collapsing = campaign({ resources: { thirst: 12 } as CampaignCharacter['resources'] })

    expect(getAfflictions(thirsty)).toEqual(['thirsty'])
    expect(getAfflictions(dehydrated)).toEqual(['dehydrated'])
    expect(getAfflictions(collapsing)).toContain('dehydrated')
    expect(getAfflictions(collapsing)).toContain('unconscious')
  })

  it('maps exhaustion onto its survival.tex band', () => {
    const tired = campaign({ resources: { exhaustion: 4 } as CampaignCharacter['resources'] })
    const exhausted = campaign({ resources: { exhaustion: 8 } as CampaignCharacter['resources'] })
    const confused = campaign({ resources: { exhaustion: 12 } as CampaignCharacter['resources'] })

    expect(getAfflictionPenalty(tired, 'will')).toBe(1)
    expect(getAfflictionPenalty(exhausted, 'will')).toBe(2)
    expect(getAfflictionPenalty(confused, 'will')).toBe(4)
  })

  it('does not duplicate an affliction that is both explicit and derived', () => {
    const c = campaign({
      afflictions: ['weakened'],
      resources: { hunger: 20 } as CampaignCharacter['resources'],
    })
    expect(getAfflictions(c).filter((a) => a === 'weakened')).toHaveLength(1)
  })
})

describe('burden-derived afflictions — gear.tex "Containers and burden"', () => {
  it('makes an "over" burden lame', () => {
    // Sled: penalty 3 = the "over" band, which the rulebook says leaves the
    // character lame. A Backpack (penalty 1, "medium") does not.
    const sled = campaign({ containers: { Sled: ContainerSchema.parse({ name: 'Sled', penalty: 3 }) } })
    const pack = campaign({ containers: { Backpack: ContainerSchema.parse({ name: 'Backpack', penalty: 1 }) } })

    expect(getAfflictions(sled)).toContain('lame')
    expect(getAfflictions(pack)).not.toContain('lame')
  })
})

describe('mental afflictions reach knowledges and spellcasting', () => {
  it('applies the mental penalty to a knowledge value', () => {
    // combat.tex "Afflictions": mental penalties affect "all Knowledges".
    const trained = makeKnowledgeLens('medicine').set(addKnowledge('medicine')(campaign()), 5)
    const afflicted = { ...trained, afflictions: ['confused'] } as typeof trained // -4 mental

    expect(makeKnowledgeLens('medicine').get(trained)).toBe(5)
    expect(makeKnowledgeLens('medicine').get(afflicted)).toBe(1)
  })

  it('inverts the penalty on write, so the stored base is what changes', () => {
    const c = addKnowledge('medicine')(campaign({ afflictions: ['confused'] }))
    const withLevel = makeKnowledgeLens('medicine').set(c, 5)

    // Writing the afflicted value 5 stores a base of 9, and reads back as 5.
    expect(withLevel.knowledges['medicine'].value).toBe(9)
    expect(makeKnowledgeLens('medicine').get(withLevel)).toBe(5)
  })

  it('reaches spellcasting once, through the knowledge it is built on', () => {
    const healthy = addKnowledge('alchemy')(campaign())
    const afflicted = addKnowledge('alchemy')(campaign({ afflictions: ['intoxicated3'] })) // -3 mental

    expect(getAlchemy(healthy) - getAlchemy(afflicted)).toBe(3)
  })

  it('penalizes persuasion and deception, which combat.tex now lists as mental', () => {
    const c = campaign({ afflictions: ['afraid'] }) // -1 mental
    expect(getAfflictionPenalty(c, 'persuasion')).toBe(1)
    expect(getAfflictionPenalty(c, 'deception')).toBe(1)
  })
})

describe('controlable afflictions', () => {
  it('ignores a toggle on an affliction its resource owns', () => {
    const c = campaign()
    expect(addAffliction('tired')(c).afflictions).toEqual([])
    expect(addAffliction('malnourished')(c).afflictions).toEqual([])
    expect(addAffliction('dehydrated')(c).afflictions).toEqual([])
  })

  it('still toggles the hand-settable ones, confused included', () => {
    const c = campaign()
    expect(addAffliction('confused')(c).afflictions).toEqual(['confused'])
    expect(addAffliction('blind')(c).afflictions).toEqual(['blind'])
  })
})
