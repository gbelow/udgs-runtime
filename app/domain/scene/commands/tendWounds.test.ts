import { describe, it, expect } from 'vitest'
import type { SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import { board, brawler, medic, passRound, spearman } from '../fixtures'
import { getAvailableActions } from '../rules/options'
import { getMedicineCost } from '../rules/medicine'
import { commitAction, declareAction, setTarget } from './action'
import { endCombat } from './endCombat'
import { continueRound, nextRound } from './nextRound'
import { getUp, lieDown } from './collapse'
import { answerScene } from './answer'
import { toTable } from '../../play/calls'
import { getInjuryCapacity } from '../../character/rules/afflictions'
import { getHealth } from '../../character/rules/skills'
import { getKnowledge, getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { sumTerms } from '../../character/rules/terms'

let n = 0
const newId = () => `t${++n}`

const bleeding = (c: CampaignCharacter): CampaignCharacter => ({ ...c, injuries: { ...c.injuries, bleed: Math.max(1, c.injuries.bleed) } })
const collapsed = (c: CampaignCharacter): CampaignCharacter => ({ ...c, injuries: { ...c.injuries, collapsedByChoice: true } })

const scene = (c: CampaignCharacter): SceneState => ({ ...board({ m: [0, 0], e: [4, 0] }, { ...c, id: 'm' }, bleeding(spearman('e'))), inTurnCharacter: 'm' })

const option = (state: SceneState, kind: string) => getAvailableActions(state, 'm').find((o) => o.draft.kind === kind)

// The die that lands a hit, not a crit, for a test of `skill` against `DL`
// (play.tex "Degrees of success": 5 or more over the DL is a hit, 10 a crit).
const hitDie = (skill: number, DL: number) => Math.min(9, Math.max(0, DL + 5 - skill))

// A fight past its first round, in the rest step of the next.
const resting = (state: SceneState): SceneState => nextRound(() => 0)(passRound(() => 0)(state))

const rollers = (state: SceneState) => Object.values(state.calls).map((c) => c.roller)

// combat.tex "Tend Wounds": "It happens automatically before bleeding while
// collapsed. A character can collapse themselves to trigger this. They can
// do it to themselves at the start of a round, before bleeding. They can
// uncollapse themselves at the same moment, foregoing the effects of that
// round."
describe('Tend Wounds as the round begins', () => {
  it('waits on the die of the collapsed who bleed, and of nobody standing', () => {
    const waiting = continueRound(toTable(() => 0))(resting(scene(collapsed(bleeding(brawler('m'))))))
    expect(rollers(waiting)).toEqual(['m'])
  })

  it('lowers the bleed before the round takes it', () => {
    const c = collapsed(bleeding(medic('m')))
    const before = resting(scene(c))
    const after = continueRound(() => hitDie(getHealth(c), c.injuries.bleed))(before).characters.m
    const was = before.characters.m.injuries
    expect(after.injuries.bleed).toBeLessThan(was.bleed)
    expect(after.injuries.injuryLevel - was.injuryLevel).toBe(after.injuries.bleed)
  })

  it('is tended for whoever collapses in the rest step, and forgone by whoever stands back up in it', () => {
    const before = resting(scene(bleeding(brawler('m'))))
    const down = lieDown('m')(before)
    expect(rollers(continueRound(toTable(() => 0))(down))).toEqual(['m'])
    const up = getUp('m')(down)
    expect(up.characters.m.injuries.collapsedByChoice).toBe(false)
    expect(rollers(continueRound(toTable(() => 0))(up))).toEqual([])
  })

  it('cannot be stood up from by one collapsed by their injuries', () => {
    const c = collapsed(bleeding(brawler('m')))
    const hurt = { ...c, injuries: { ...c.injuries, injuryLevel: getInjuryCapacity(c) } }
    const before = resting(scene(hurt))
    expect(getUp('m')(before)).toBe(before)
  })
})

// abilities.tex "First Aid": "on self or other character, as long as the
// patient is collapsed".
describe('First Aid', () => {
  const ready = (c: CampaignCharacter): CampaignCharacter => ({ ...c, usedSurge: 'focus' as const, resources: { ...c.resources, AP: getMedicineCost('firstAid').AP, STA: 6 } })

  it('is closed with nobody collapsed within reach, and open once the patient is', () => {
    expect(option(scene(ready(medic('m'))), 'firstAid')?.available).toBe(false)
    expect(option(scene(collapsed(ready(medic('m')))), 'firstAid')?.available).toBe(true)
  })

  // "On a hit or crit, prevents bleeding that round completely."
  it('staunches the patient on a hit', () => {
    const c = collapsed(ready(medic('m')))
    const aidDie = hitDie(sumTerms(getKnowledgeTestTerms('medicine')(c)) + getHealth(c), c.injuries.bleed)
    const aided = commitAction(() => aidDie, newId)(setTarget('m')(declareAction('m', { kind: 'firstAid' }, newId)(scene(c)))).characters.m
    expect(aided.injuries.staunched).toBe(true)
  })
})

// combat.tex "Bleed": "When combat/chase ends, make a tend wounds test. Take
// IL damage equal to 10/6/4/2x of the bleed value and stop bleeding."
describe('the end of a fight', () => {
  const fought = (): SceneState => {
    const started = passRound(() => 0)(scene(brawler('m')))
    const m = started.characters.m
    return { ...started, agreedToEnd: ['m', 'e'], characters: { ...started.characters, m: { ...m, injuries: { ...m.injuries, bleed: 2 } }, e: { ...started.characters.e, injuries: { ...started.characters.e.injuries, bleed: 0 } } } }
  }

  it('waits on the die of each one bleeding at a table that rolls its own, and then stops the bleed for IL', () => {
    const before = fought()
    const waiting = endCombat(toTable(() => 0))(before)
    expect(waiting.characters).toEqual(before.characters)
    const calls = Object.values(waiting.calls)
    expect(calls.map((c) => c.roller)).toEqual(['m'])

    const ended = answerScene(calls[0].id, 0, 'entered', toTable(() => 0), newId)(waiting)
    expect(ended.round).toBe(0)
    expect(ended.characters.m.injuries.bleed).toBe(0)
    expect(ended.characters.m.injuries.injuryLevel).toBeGreaterThan(before.characters.m.injuries.injuryLevel)
    expect(ended.characters.e.injuries.injuryLevel).toBe(before.characters.e.injuries.injuryLevel)
  })

  // abilities.tex "First Aid": "At the end of the fights, a character with
  // first aid can add its medicine knowledge to everyone's tend wounds test";
  // the user's ruling: an ally's, one neither dead nor unconscious.
  it('adds the medicine of an ally with First Aid to the test, and of no enemy or unconscious one', () => {
    const skillWith = (medic: CampaignCharacter, partyOf: Record<string, string>) => {
      const state = fought()
      const waiting = endCombat(toTable(() => 0))({ ...state, partyOf, agreedToEnd: [...state.agreedToEnd, 'x'], characters: { ...state.characters, x: medic } })
      return Object.values(waiting.calls).find((c) => c.roller === 'm')!.test!.skill
    }
    const doc = { ...medic('x'), injuries: { ...medic('x').injuries, bleed: 0 } }
    const alone = skillWith({ ...doc, abilities: {} }, { m: 'p', e: 'q', x: 'p' })
    const medicine = getKnowledge('medicine')(doc)
    expect(medicine).toBeGreaterThan(0)
    expect(skillWith(doc, { m: 'p', e: 'q', x: 'p' })).toBe(alone + medicine)
    expect(skillWith(doc, { m: 'p', e: 'q', x: 'q' })).toBe(alone)
    expect(skillWith({ ...doc, afflictions: ['unconscious'] }, { m: 'p', e: 'q', x: 'p' })).toBe(alone)
  })
})
