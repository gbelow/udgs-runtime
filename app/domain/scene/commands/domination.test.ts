import { describe, it, expect } from 'vitest'
import { SceneStateSchema, type Compulsion, type SceneState } from '../types'
import { makeCampaignCharacter } from '../../factories'
import { TrainableSchema, type CampaignCharacter } from '../../types'
import { ABILITIES } from '../../abilities'
import { rollMorale } from './morale'
import { nextRound } from './nextRound'
import { breakFree, giveOrder } from './domination'
import { getControllerId, getOrderBar } from '../rules/domination'
import { getStudyOffers } from '../../character/rules/attitudes'

const learned = (...families: string[]) => Object.fromEntries(families.map((f) => [f, TrainableSchema.parse({ name: f, type: 'ability', value: 1 })]))

function fighter(id: string, families: string[], overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const base = makeCampaignCharacter({})
  return { ...base, ...overrides, id, abilities: learned(...families), resources: { ...base.resources, AP: 8, STA: 10 } }
}

// A character who holds Domination as their worldview.
function dominating(id: string, families: string[], overrides: Partial<CampaignCharacter> = {}): CampaignCharacter {
  const c = fighter(id, families, overrides)
  return { ...c, trainables: { ...c.trainables, conviction2: { ...c.trainables.conviction2, name: 'Domination', value: 1, XP: 0 } } }
}

const withSkill = (c: CampaignCharacter, skill: 'will' | 'persuasion', value: number): CampaignCharacter =>
  ({ ...c, trainables: { ...c.trainables, [skill]: { ...c.trainables[skill], value } } })

// `a` in party x, everyone else in party y.
function inFight(characters: CampaignCharacter[], extra: Partial<SceneState> = {}): SceneState {
  const partyOf = Object.fromEntries(characters.map((c) => [c.id, c.id === 'a' ? 'x' : 'y']))
  return { ...SceneStateSchema.parse({ round: 2 }), characters: Object.fromEntries(characters.map((c) => [c.id, c])), partyOf, ...extra }
}

const owed = (id: string, fields: Partial<Compulsion> = {}): Compulsion =>
  ({ id, action: 'coward', acted: false, taken: false, by: '', constraint: null, overruledBy: '', contested: [], ...fields })

const worldviewXP = (s: SceneState, id: string) => s.characters[id].trainables.conviction2.XP

// abilities.tex "Domination": "Gains 1 XP each time an enemy triggers their
// limit stress action from a morale test the character weighed on with a
// social action"; "Loses 1 XP each round that they finish afraid, confused or
// dominated". The XP each moves is the catalog entry's.
describe('Dominating attitudes', () => {
  const attitudes = ABILITIES['dominating-attitudes'].attitudes
  const gain = attitudes.find((a) => a.on.event === 'enemyStress')?.XP ?? 0
  const loss = attitudes.find((a) => a.on.event === 'roundEnd')?.XP ?? 0

  it('pays the intimidator when the enemy they weighed on is broken', () => {
    const a = dominating('a', ['dominating-attitudes'])
    const b = withSkill(fighter('b', []), 'will', 0)
    const state = inFight([a, b], {
      roundStep: 'morale',
      morale: [{ id: 'b', roll: null, optional: false }],
      pressure: [{ round: 1, from: 'a', target: 'b', kind: 'intimidate', value: 20 }],
    })
    const tested = rollMorale('b', 'normal', true, () => 0)(state)
    expect(tested.morale[0].roll?.limitStress).toBe(true)
    expect(worldviewXP(tested, 'a')).toBe(gain)
  })

  it('takes for a round ended afraid, and nothing for one ended enraged', () => {
    const after = (c: CampaignCharacter) => worldviewXP(nextRound(() => 0)(inFight([c])), 'a')
    expect(after(dominating('a', ['dominating-attitudes'], { afflictions: ['afraid'] }))).toBe(loss)
    expect(after(dominating('a', ['dominating-attitudes'], { afflictions: ['enraged'] }))).toBe(0)
  })
})

// abilities.tex "Silver Tongue": "can learn charisma, insight, persuasion
// and deception with conviction XP".
describe('Silver Tongue', () => {
  it('offers exactly the trainables the study names to the Domination XP', () => {
    const named = ABILITIES['silver-tongue'].studies.flatMap((s) => (s.kind === 'trainables' ? s.keys : []))
    const offered = getStudyOffers(dominating('a', ['silver-tongue']), 'conviction2').map((o) => (o.target.kind === 'trainable' ? o.target.key : null))
    expect(offered.sort()).toEqual([...named].sort())
  })
})

// abilities.tex "Overrule": "substituting the target's limit stress action
// on a hit or crit in a persuasion or deception vs will test", "This cannot
// be used to stop magical effects"; "Subjugate": "give a command and be
// dominated"; combat.tex "Dominated": "Under the control of another
// character", broken out of by "an Insight or Cunning test against the
// original DL".
describe('Overrule and Subjugate', () => {
  const a = dominating('a', ['overrule', 'subjugate'])
  const b = withSkill(fighter('b', []), 'will', 0)

  it('puts the order picked in place of the limit stress action on a hit, for the AP the catalog asks', () => {
    const state = inFight([a, b], { compulsions: [owed('b')] })
    const ordered = giveOrder('a', 'b', 'violent', () => 9)(state)
    expect(ordered.compulsions[0]).toMatchObject({ action: 'violent', overruledBy: 'a' })
    expect(ordered.characters.a.resources.AP).toBe(8 - ABILITIES.overrule.cost.AP)
  })

  it('leaves the limit stress action as it was on a miss, and the overruler may not try again', () => {
    const state = inFight([a, withSkill(b, 'will', 30)], { compulsions: [owed('b')] })
    const tried = giveOrder('a', 'b', 'violent', () => 0)(state)
    expect(tried.compulsions[0].action).toBe('coward')
    expect(getOrderBar(tried, 'a', 'b', 'martyr')).not.toBeNull()
  })

  it('cannot overrule what a spell compels', () => {
    expect(getOrderBar(inFight([a, b], { compulsions: [owed('b', { by: 'c' })] }), 'a', 'b', 'violent')).not.toBeNull()
  })

  it('dominates on a hit, hands the target to the dominator, and lets a hit on the break-out test free them', () => {
    const state = inFight([a, b], { compulsions: [owed('b')] })
    const subjugated = giveOrder('a', 'b', 'dominate', () => 9)(state)
    expect(subjugated.characters.b.afflictions).toContain('dominated')
    expect(subjugated.compulsions.filter((t) => t.id === 'b' && !t.taken)).toEqual([])
    expect(getControllerId(subjugated, 'b')).toBe('a')
    const freed = breakFree('b', () => 9)({ ...subjugated, dominations: subjugated.dominations.map((d) => ({ ...d, DL: 0 })) })
    expect(freed.characters.b.afflictions).not.toContain('dominated')
    expect(getControllerId(freed, 'b')).toBe('b')
  })
})
