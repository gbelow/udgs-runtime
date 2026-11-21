import { describe, it, expect } from 'vitest'
import type { SceneState } from '../types'
import type { CampaignCharacter } from '../../types'
import { board, medic, spearman } from '../fixtures'
import { getAvailableActions } from '../rules/options'
import { commitAction, declareAction, setTarget } from './action'
import { getInjuryCapacity } from '../../character/rules/afflictions'
import { getHealth } from '../../character/rules/skills'
import { getKnowledgeTestTerms } from '../../character/rules/knowledge'
import { sumTerms } from '../../character/rules/terms'
import { ABILITIES } from '../../abilities'

let n = 0
const newId = () => `t${++n}`

// The fixture medic, bleeding, with the focus surge made and AP enough for
// the ability's price; collapsed at their injury capacity where asked.
function tender(collapsed: boolean): CampaignCharacter {
  const c = medic('m')
  const ready = { ...c, usedSurge: 'focus' as const, resources: { ...c.resources, AP: ABILITIES['tend-wounds'].cost.AP, STA: 6 } }
  return collapsed ? { ...ready, injuries: { ...ready.injuries, injuryLevel: getInjuryCapacity(ready) } } : ready
}

const scene = (c: CampaignCharacter): SceneState => ({ ...board({ m: [0, 0], e: [4, 0] }, c, spearman('e')), inTurnCharacter: 'm' })

const option = (state: SceneState, kind: string) => getAvailableActions(state, 'm').find((o) => o.draft.kind === kind)

// The die that lands a hit, not a crit, for a test of `skill` against `DL`
// (play.tex "Degrees of success": 5 or more over the DL is a hit, 10 a crit).
const hitDie = (skill: number, DL: number) => Math.min(10, Math.max(1, DL + 5 - skill))

// combat.tex "Collapsed": "cannot use any of the combat skills nor force";
// the user's ruling: a collapsed character may still give care.
describe('Tend Wounds', () => {
  it('is open to a collapsed character, who may not strike', () => {
    const state = scene(tender(true))
    expect(option(state, 'tendWounds')?.available).toBe(true)
    expect(option(state, 'strike')?.available).toBe(false)
  })

  it('is closed to one who is not bleeding', () => {
    const c = tender(false)
    expect(option(scene({ ...c, injuries: { ...c.injuries, bleed: 0 } }), 'tendWounds')?.available).toBe(false)
  })

  // abilities.json "Tend Wounds": "Reduces bleeding by 0/0/1/2"; First Aid is
  // the stronger, and only it "prevents bleeding that turn completely" (the
  // user's ruling).
  it('lowers the tender’s own bleed on a hit, and staunches nothing where First Aid would', () => {
    const c = tender(false)
    const { bleed } = c.injuries
    const tended = commitAction(() => hitDie(getHealth(c), bleed), newId)(declareAction('m', { kind: 'tendWounds' }, newId)(scene(c))).characters.m
    expect(tended.injuries.bleed).toBe(bleed - 1)
    expect(tended.injuries.staunched).toBe(false)

    const aidDie = hitDie(sumTerms(getKnowledgeTestTerms('medicine')(c)) + getHealth(c), bleed)
    const aided = commitAction(() => aidDie, newId)(setTarget('m')(declareAction('m', { kind: 'firstAid' }, newId)(scene(c)))).characters.m
    expect(aided.injuries.staunched).toBe(true)
  })
})
