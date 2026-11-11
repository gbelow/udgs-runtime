import { describe, it, expect } from 'vitest'
import { ActionSchema, SceneStateSchema, type SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { TrainableSchema, type CampaignCharacter } from '../../types'
import { ABILITIES } from '../../abilities'
import { getMoraleOutcome, getMoraleTest, getMoraleTurnBar } from '../rules/morale'
import { getHeldTest } from '../rules/heldTest'
import { rollCunning } from '../rules/turn'
import { getCunningTestTerms } from '../rules/cunning'
import { keepMorale, rerollMorale, rollMorale } from './morale'
import { getAfflictions } from '../../character/rules/afflictions'

const learned = (abilities: Record<string, number>) => Object.fromEntries(Object.entries(abilities).map(([f, value]) => [f, TrainableSchema.parse({ name: f, type: 'ability', value })]))

function fighter(abilities: Record<string, number>, overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return { ...base, ...overrides, id: 'a', abilities: learned(abilities), resources: { ...base.resources, AP: 8, STA: 10, ...overrides.resources } }
}

function inFight(c: CampaignCharacter, extra: Partial<SceneState> = {}): SceneState {
  return { ...SceneStateSchema.parse({ round: 2 }), characters: { [c.id]: c }, ...extra }
}

// abilities.tex "Fateful": "The character can spend 1 AP to reroll a will
// test once. The reroll must be taken"; the morale test, thrown the same way
// (the table's ruling).
describe('Fateful', () => {
  const AP = ABILITIES.fateful.cost.AP
  const called = (c: CampaignCharacter) => inFight(c, { roundStep: 'morale', morale: [{ id: 'a', roll: null, optional: false }], tablePressure: { '': 5 } })
  const missed = rollMorale('a', 'normal', true, () => 0)(called(fighter({ fateful: 1 }, { afflictions: [] })))

  it('leaves the test open, settling nothing, until it is kept or rerolled', () => {
    expect(missed.morale[0].roll?.open).toBe(true)
    expect(getAfflictions(missed.characters.a)).not.toContain('afraid')
    expect(getMoraleTurnBar(missed)).not.toBeNull()
    const kept = keepMorale('a')(missed)
    expect(kept.morale[0].roll?.open).toBe(false)
    expect(kept.morale[0].roll?.die).toBe(0)
    expect(getMoraleTurnBar(kept)).toBeNull()
  })

  it('takes the reroll whatever it comes to, for the AP Fateful costs, once', () => {
    const rerolled = rerollMorale('a', () => 9)(missed)
    expect(rerolled.morale[0].roll).toMatchObject({ die: 9, open: false, rerolled: true })
    expect(rerolled.characters.a.resources.AP).toBe(missed.characters.a.resources.AP - AP)
    expect(rerollMorale('a', () => 9)(rerolled)).toBe(rerolled)
  })

  it('is not offered to one who cannot pay for it', () => {
    const poor = rollMorale('a', 'normal', true, () => 0)(called(fighter({ fateful: 1 }, { resources: { ...makeCampaignCharacter({}).resources, AP: AP - 1 } })))
    expect(poor.morale[0].roll?.open).toBe(false)
  })
})

// abilities.tex "Unshakable": "The character has no limit stress action"; a
// miss still leaves them afraid (the table's ruling).
describe('Unshakable', () => {
  it('activates no limit stress action on a miss, and frightens as a graze does', () => {
    const outcome = getMoraleOutcome(fighter({ unshakable: 1 }), 'miss', 'miss', true, false)
    expect(outcome.limitStress).toBe(false)
    expect(outcome.inflict).toEqual(['afraid'])
    expect(getMoraleOutcome(fighter({}), 'miss', 'miss', true, false).limitStress).toBe(true)
  })
})

// abilities.tex "Grace Under Pressure": "+1 to all skills in any turn when
// the morale test aggravating factors are equal or higher than 5"; a rally
// lowers the DL, not the factors (the table's ruling).
describe('Grace Under Pressure', () => {
  const grace = ABILITIES['grace-under-pressure']
  const hit = grace.recipes.flatMap((r) => (r.type === 'edge' ? [r.hit] : []))[0]
  const strike = ActionSchema.parse({ id: 'x', kind: 'strike', actorId: 'a' })
  const gets = (state: SceneState) => getCunningTestTerms(state, strike).find((t) => t.label === grace.family)?.value ?? 0
  const graceful = fighter({ 'grace-under-pressure': 1 })

  it('adds to the test from 5 aggravating factors, and not below', () => {
    expect(gets(inFight(graceful, { tablePressure: { '': 5 } }))).toBe(hit)
    expect(gets(inFight(graceful, { tablePressure: { '': 4 } }))).toBe(0)
  })

  it('adds to the tests made as no action: the morale test, the contest for the turn, a test held for the round', () => {
    const pressed = (c: CampaignCharacter) => inFight(c, { tablePressure: { '': 5 } })
    const plain = fighter({})
    expect(getMoraleTest(pressed(graceful), 'a')!.skill - getMoraleTest(pressed(plain), 'a')!.skill).toBe(hit)
    expect(rollCunning(pressed(graceful), 'a', 0, 'normal').skill - rollCunning(pressed(plain), 'a', 0, 'normal').skill).toBe(hit)
    expect(getHeldTest(pressed(graceful), 'a', 'stealth')!.skill - getHeldTest(pressed(plain), 'a', 'stealth')!.skill).toBe(hit)
  })

  it('is not switched off by a rally', () => {
    const rallied = inFight(graceful, { tablePressure: { '': 5 }, pressure: [{ round: 1, from: 'b', target: 'a', kind: 'rally', value: 3 }] })
    expect(gets(rallied)).toBe(hit)
  })
})

// abilities.tex "Unwearied I|II": "ignores the effect of tiredness", then
// "of exhausted".
describe('Unwearied', () => {
  const at = (exhaustion: number, level: number) =>
    getAfflictions(fighter({ unwearied: level }, { resources: { ...makeCampaignCharacter({}).resources, exhaustion } }))

  it('lifts tired at the first level and exhausted at the second', () => {
    expect(at(5, 1)).not.toContain('tired')
    expect(at(9, 1)).toContain('exhausted')
    expect(at(9, 2)).not.toContain('exhausted')
  })
})
