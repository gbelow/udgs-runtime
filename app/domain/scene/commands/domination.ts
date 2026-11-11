import type { Compulsion, SceneState, Updater } from '../types'
import type { Throw } from '../../play/calls'
import { payCost } from '../../character/commands/cost'
import { cure, inflict } from '../../character/commands/addAffliction'
import { isCombatStarted } from '../rules/started'
import { getSocialValue } from '../rules/morale'
import { isStressAutomatic } from '../rules/stress'
import { getBreakFreeBar, getBreakFreeTest, getMockable, getMockeryBar, getMockeryCost, getOrderBar, getOrderCost, getOrderTest, MOCKERY_BONUS, type Order } from '../rules/domination'
import { calling } from './calling'
import { updateCharacter } from './characters'
import { makeAutomatic } from './stress'
import { speak } from './social'

// abilities.tex "Overrule", "Subjugate": the character gives orders to
// someone whose limit stress action the round's morale test activated, for
// the AP the ability costs, on a test of their persuasion or deception
// against the target's will (`getOrderTest`). Tried once each. On a hit or a
// crit, Overrule puts the limit stress action picked in place of the one
// owed; Subjugate takes the owed one away and leaves the target dominated
// by the character, the score standing as the DL to break out against
// (combat.tex "Dominated": "the original DL"). Whatever the target's turn
// was taken up with goes on, played by whoever dominates them.
export function giveOrder(by: string, targetId: string, order: Order, thrown: Throw): Updater {
  return calling({ kind: 'overrule', by, targetId, order }, thrown, (caller) => (state) => {
    const c = state.characters[by]
    const test = getOrderTest(state, by, targetId)
    const cost = c ? getOrderCost(c, order) : null
    if (!test || !cost || getOrderBar(state, by, targetId, order)) return state
    const result = caller.test({ id: `order:${by}:${targetId}`, roller: by, label: order === 'dominate' ? 'subjugate' : 'overrule', test })
    if (!result) return state
    const label = order === 'dominate' ? 'Subjugate' : 'Overrule'
    const paid = updateCharacter(by, payCost(cost, isCombatStarted(state)), label)(state)
    const tried = { ...paid, compulsions: paid.compulsions.map((t) => (t.id === targetId && !t.taken ? { ...t, contested: [...t.contested, by] } : t)) }
    if (result.degree !== 'hit' && result.degree !== 'critical') return tried
    return order === 'dominate' ? subjugate(tried, by, targetId, result.score) : overrule(tried, by, targetId, order)
  })
}

function overrule(state: SceneState, by: string, targetId: string, order: Exclude<Order, 'dominate'>): SceneState {
  const given = (t: Compulsion): Compulsion => ({ ...t, action: order, overruledBy: by, taken: isStressAutomatic(state, targetId, order) })
  const compulsions = state.compulsions.map((t) => (t.id === targetId && !t.taken ? given(t) : t))
  const owed = compulsions.find((t) => t.id === targetId && t.overruledBy === by)
  return makeAutomatic({ ...state, compulsions }, owed?.taken ? [owed] : [])
}

function subjugate(state: SceneState, by: string, targetId: string, DL: number): SceneState {
  const compulsions = state.compulsions.filter((t) => t.id !== targetId || t.taken)
  const dominations = [...state.dominations.filter((d) => d.id !== targetId), { id: targetId, by, DL }]
  return updateCharacter(targetId, inflict(['dominated']), 'Subjugate')({ ...state, compulsions, dominations })
}

// combat.tex "Dominated": the dominated character tests their insight or
// cunning against the original DL; a hit or a crit breaks them out.
export function breakFree(id: string, thrown: Throw): Updater {
  return calling({ kind: 'breakFree', id }, thrown, (caller) => (state) => {
    const test = getBreakFreeTest(state, id)
    if (!test || getBreakFreeBar(state, id)) return state
    const result = caller.test({ id: `breakFree:${id}`, roller: id, label: 'break free', test })
    if (!result || (result.degree !== 'hit' && result.degree !== 'critical')) return state
    const freed = updateCharacter(id, cure(['dominated']), 'broke free')(state)
    return { ...freed, dominations: freed.dominations.filter((d) => d.id !== id) }
  })
}

// abilities.tex "Mockery": the character mocks whoever their crit was
// against, or whoever missed against them, "for 2 extra AP, which works as
// taunt and gets +1 to the provocation test": a taunt's pressure, one more,
// said to them now.
export function mock(mocker: string): Updater {
  return (state) => {
    const c = state.characters[mocker]
    const mockable = getMockable(state, mocker)
    const cost = c ? getMockeryCost(c) : null
    if (!c || !mockable || !cost || getMockeryBar(state, mocker)) return state
    const paid = updateCharacter(mocker, payCost(cost, isCombatStarted(state)), 'Mockery')(state)
    const said = speak(paid, mocker, 'taunt', getSocialValue(c, 'taunt') + MOCKERY_BONUS, [mockable.targetId])
    return { ...said, mocked: [...said.mocked, mockable.action.id] }
  }
}
