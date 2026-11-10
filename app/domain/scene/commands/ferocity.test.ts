import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type SceneState, type MoraleRoll } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { TrainableSchema, type CampaignCharacter, type Degree } from '../../types'
import { ABILITIES } from '../../abilities'
import { getMoraleOutcome, getSocialValue } from '../rules/morale'
import { hypeUp } from './morale'
import { nextRound } from './nextRound'
import { getSurgeBarFor } from '../rules/surge'
import { getSurged } from '../../character/rules/surge'
import { getAfflictions, getAfflictionPenalty, getInjuryCapacity } from '../../character/rules/afflictions'
import { getCharisma } from '../../character/rules/characteristics'
import { getSpiritDLTerms } from '../../character/rules/spirit'
import { getConvictionLevel } from '../../character/rules/requirements'

const learned = (...families: string[]) => Object.fromEntries(families.map((f) => [f, TrainableSchema.parse({ name: f, type: 'ability', value: 1 })]))

function fighter(families: string[], overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return { ...base, ...overrides, id: 'a', abilities: learned(...families), resources: { ...base.resources, AP: 8, STA: 10 } }
}

function inFight(c: CampaignCharacter, extra: Partial<SceneState> = {}): SceneState {
  return { ...SceneStateSchema.parse({ round: 1 }), characters: { [c.id]: c }, ...extra }
}

function tested(degree: Degree): MoraleRoll {
  return { mode: 'normal', die: 5, skill: 0, score: 5, DL: 5, degree, resisted: 0, limitStress: false, hyped: false }
}

// abilities.tex "Furious": "becomes enraged when they graze on a morale
// test, and only calm down on a crit"; a miss still leaves them afraid (the
// table's ruling).
describe('Furious', () => {
  const furious = fighter(['furious'])

  it('enrages on a graze instead of frightening', () => {
    expect(getMoraleOutcome(furious, 'graze', 'graze', false, false).inflict).toEqual(['enraged'])
    expect(getMoraleOutcome(fighter([]), 'graze', 'graze', false, false).inflict).toEqual(['afraid'])
  })

  it('keeps an enraged character enraged on a hit, and calms them on a crit', () => {
    const enraged = { ...furious, afflictions: ['enraged' as const] }
    expect(getMoraleOutcome(enraged, 'hit', 'hit', false, false).cure).not.toContain('enraged')
    expect(getMoraleOutcome(enraged, 'critical', 'critical', false, false).cure).toContain('enraged')
  })

  it('still frightens on a miss', () => {
    expect(getMoraleOutcome(furious, 'miss', 'miss', false, false).inflict).toEqual(['afraid'])
  })
})

// abilities.tex "Hype up": "can enrage themselves on a hit or crit in a
// morale test", chosen once the test is seen (the table's ruling).
describe('Hype up', () => {
  const afraid = fighter(['hype-up'], { afflictions: ['afraid'] })

  it('enrages on a hit or crit at the morale step, ending fear', () => {
    for (const degree of ['hit', 'critical'] as const) {
      const state = hypeUp('a')(inFight(afraid, { roundStep: 'morale', morale: [{ id: 'a', roll: tested(degree) }] }))
      expect(getAfflictions(state.characters.a)).toContain('enraged')
      expect(getAfflictions(state.characters.a)).not.toContain('afraid')
    }
  })

  it('is refused on a graze or a miss, before the test, after the morale step, or unlearned', () => {
    const refused: SceneState[] = [
      inFight(afraid, { roundStep: 'morale', morale: [{ id: 'a', roll: tested('graze') }] }),
      inFight(afraid, { roundStep: 'morale', morale: [{ id: 'a', roll: tested('miss') }] }),
      inFight(afraid, { roundStep: 'morale', morale: [{ id: 'a', roll: null }] }),
      inFight(afraid, { roundStep: null, morale: [{ id: 'a', roll: tested('hit') }] }),
      inFight(fighter([], { afflictions: ['afraid'] }), { roundStep: 'morale', morale: [{ id: 'a', roll: tested('hit') }] }),
    ]
    for (const state of refused) expect(hypeUp('a')(state)).toBe(state)
  })
})

// abilities.tex "Unstoppable": "Does not become immobilized by shock nor by
// IL while enraged."
describe('Unstoppable', () => {
  it('keeps a collapsed character standing only while enraged', () => {
    const base = fighter(['unstoppable'])
    const collapsed = { ...base, injuries: { ...base.injuries, injuryLevel: getInjuryCapacity(base) } }
    expect(getAfflictions(collapsed)).toContain('immobile')
    expect(getAfflictions({ ...collapsed, afflictions: ['enraged'] })).not.toContain('immobile')
  })
})

// abilities.tex "Rage Endurance": "ignores the effect of exhaustion and
// sickness during rage. They also lose the mental penalties when enraged",
// rage's own only (the table's ruling).
describe('Rage Endurance', () => {
  it('ignores exhaustion and sickness while enraged, and only then', () => {
    const base = fighter(['rage-endurance'], { afflictions: ['sick'] })
    const spent = { ...base, resources: { ...base.resources, exhaustion: 8 } }
    expect(getAfflictions(spent)).toEqual(expect.arrayContaining(['sick', 'exhausted']))
    const enraged = getAfflictions({ ...spent, afflictions: ['sick', 'enraged'] })
    expect(enraged).not.toContain('sick')
    expect(enraged).not.toContain('exhausted')
  })

  it('removes rage’s own mental penalty and leaves the others', () => {
    const tired = (c: CampaignCharacter) => ({ ...c, resources: { ...c.resources, exhaustion: 4 } })
    const without = tired(fighter([], { afflictions: ['enraged'] }))
    const withIt = tired(fighter(['rage-endurance'], { afflictions: ['enraged'] }))
    const tiredOnly = tired(fighter([]))
    expect(getAfflictionPenalty(withIt, 'cunning')).toBe(getAfflictionPenalty(tiredOnly, 'cunning'))
    expect(getAfflictionPenalty(without, 'cunning')).toBeGreaterThan(getAfflictionPenalty(withIt, 'cunning'))
  })
})

// abilities.tex "Spirit of Battle": "Add +2 to the DL of spiritual strike
// while enraged."
describe('Spirit of Battle', () => {
  it('adds its DL only while enraged', () => {
    const calm = fighter(['spirit-of-battle'])
    expect(getSpiritDLTerms(calm).map((t) => t.label)).not.toContain('Spirit of Battle')
    expect(getSpiritDLTerms({ ...calm, afflictions: ['enraged'] }).map((t) => t.label)).toContain('Spirit of Battle')
  })
})

// abilities.tex "Brutality": "can use intimidation with combat surge while
// enraged, using the character's ferocity level instead of charisma",
// whichever is higher (the table's ruling).
describe('Brutality', () => {
  const ferocious = (families: string[], afflictions: CampaignCharacter['afflictions'], ferocity: number) => {
    const c = fighter(families, { afflictions })
    return { ...c, trainables: { ...c.trainables, conviction1: { ...c.trainables.conviction1, name: 'Ferocity', value: ferocity } } }
  }

  it('lets the combat surge’s AP pay for an intimidation only while enraged', () => {
    const surged = (c: CampaignCharacter) => getSurged('combat')(c)
    const open = surged(ferocious(['brutality'], ['enraged'], 1))
    expect(getSurgeBarFor(inFight(open), open, 'social', 'intimidate')).toBeNull()
    expect(getSurgeBarFor(inFight(open), open, 'social', 'rally')).not.toBeNull()
    const calm = surged(ferocious(['brutality'], [], 1))
    expect(getSurgeBarFor(inFight(calm), calm, 'social', 'intimidate')).not.toBeNull()
    const unlearned = surged(ferocious([], ['enraged'], 1))
    expect(getSurgeBarFor(inFight(unlearned), unlearned, 'social', 'intimidate')).not.toBeNull()
  })

  it('intimidates at the higher of charisma and Ferocity while enraged', () => {
    const probe = ferocious(['brutality'], ['enraged'], 0)
    const high = getCharisma(probe) + 4
    const c = ferocious(['brutality'], ['enraged'], high)
    expect(getConvictionLevel(c, 'Ferocity')).toBe(high)
    expect(getSocialValue(c, 'intimidate')).toBe(getSocialValue({ ...c, afflictions: [] }, 'intimidate') + 2)
    expect(getSocialValue(c, 'rally')).toBe(getSocialValue({ ...c, afflictions: [] }, 'rally'))
    expect(getSocialValue(ferocious(['brutality'], ['enraged'], 0), 'intimidate')).toBe(getSocialValue(ferocious([], [], 0), 'intimidate'))
  })
})

// abilities.tex "Ferocity": "Receives 1 XP every time they are enraged and
// used combat surge", "Loses 1 XP for any round that they are enraged and
// did not use combat surge"; the XP each moves is the catalog entry's.
describe('Ferocious attitudes', () => {
  const attitudes = ABILITIES['ferocious-attitudes'].attitudes
  const xpFor = (combatSurge: boolean) => attitudes.find((a) => a.on.event === 'enragedRound' && a.on.combatSurge === combatSurge)?.XP ?? 0
  const adopted = (overrides: Partial<CampaignCharacter>) => {
    const c = fighter(['ferocious-attitudes'], overrides)
    return { ...c, trainables: { ...c.trainables, conviction1: { ...c.trainables.conviction1, name: 'Ferocity', value: 1, XP: 0 } } }
  }
  const after = (c: CampaignCharacter) => nextRound(() => 0)(inFight(c)).characters.a.trainables.conviction1.XP

  it('pays for a round spent enraged with a combat surge, takes for one without, and does nothing calm', () => {
    expect(after(adopted({ afflictions: ['enraged'], usedSurge: 'combat' }))).toBe(xpFor(true))
    expect(after(adopted({ afflictions: ['enraged'], usedSurge: 'movement' }))).toBe(xpFor(false))
    expect(after(adopted({ usedSurge: 'combat' }))).toBe(0)
  })
})
