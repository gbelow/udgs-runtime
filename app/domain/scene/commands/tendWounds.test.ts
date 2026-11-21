import { describe, it, expect } from 'vitest'
import type { SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import { board, brawler, medic, passRound, spearman } from '../fixtures'
import { getAvailableActions } from '../rules/options'
import { getMedicineCost } from '../rules/medicine'
import { commitAction, declareAction, setTarget } from './action'
import { endCombat } from './endCombat'
import { answerScene } from './answer'
import { toTable } from '../../play/calls'
import { getInjuryCapacity } from '../../character/rules/afflictions'
import { getHealth } from '../../character/rules/skills'
import { getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { sumTerms } from '../../character/rules/terms'

let n = 0
const newId = () => `t${++n}`

// Bleeding, with the focus surge made and AP enough for Tend Wounds'
// price; collapsed at their injury capacity where asked.
function ready(c: CampaignCharacter, collapsed = false): CampaignCharacter {
  const r = { ...c, usedSurge: 'focus' as const, resources: { ...c.resources, AP: getMedicineCost('tendWounds').AP, STA: 6 }, injuries: { ...c.injuries, bleed: Math.max(1, c.injuries.bleed) } }
  return collapsed ? { ...r, injuries: { ...r.injuries, injuryLevel: getInjuryCapacity(r) } } : r
}

const scene = (c: CampaignCharacter): SceneState => ({ ...board({ m: [0, 0], e: [4, 0] }, { ...c, id: 'm' }, spearman('e')), inTurnCharacter: 'm' })

const option = (state: SceneState, kind: string) => getAvailableActions(state, 'm').find((o) => o.draft.kind === kind)

// The die that lands a hit, not a crit, for a test of `skill` against `DL`
// (play.tex "Degrees of success": 5 or more over the DL is a hit, 10 a crit).
const hitDie = (skill: number, DL: number) => Math.min(9, Math.max(0, DL + 5 - skill))

// combat.tex "Tend Wounds", "Collapsed": "cannot use any of the combat skills
// nor force"; the user's rulings: Tend Wounds needs no ability, and a
// collapsed character may still give care.
describe('Tend Wounds', () => {
  it('is open to a collapsed character who has learned nothing, who may not strike', () => {
    const state = scene(ready(brawler('m'), true))
    expect(option(state, 'tendWounds')?.available).toBe(true)
    expect(option(state, 'strike')?.available).toBe(false)
  })

  it('is closed to one who is not bleeding', () => {
    const c = ready(brawler('m'))
    expect(option(scene({ ...c, injuries: { ...c.injuries, bleed: 0 } }), 'tendWounds')?.available).toBe(false)
  })

  // combat.tex "Tend Wounds": "stops 0/0/1/2 bleed per use"; only First Aid
  // "prevents bleeding that turn completely".
  it('lowers the tender’s own bleed on a hit, and staunches nothing where First Aid would', () => {
    const c = ready(medic('m'))
    const { bleed } = c.injuries
    const tended = commitAction(() => hitDie(getHealth(c), bleed), newId)(declareAction('m', { kind: 'tendWounds' }, newId)(scene(c))).characters.m
    expect(tended.injuries.bleed).toBe(bleed - 1)
    expect(tended.injuries.staunched).toBe(false)

    const aidDie = hitDie(sumTerms(getKnowledgeTestTerms('medicine')(c)) + getHealth(c), bleed)
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
})
