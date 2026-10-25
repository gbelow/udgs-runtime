import type { Updater } from '../types'
import { makeAction } from '../factories'
import { getOpenAction } from '../rules/log'
import { getItemDetonation } from '../rules/explosion'
import { getGmCharge, type ExplosionDraft } from '../rules/impose'
import { findReadyObject } from '../rules/fighters'
import { chargeOne, findFloorItem } from '../rules/floor'
import { setCharge } from '../../item/commands/hands'
import { appendActions } from './log'

// The GM's hand: writes a charge into an object, held or lying on the floor,
// from the explosion the draft describes. One unit of a stack on the floor
// takes it, under an id of its own. Refused with an action open, as painting
// is, and when the draft describes no explosion.
export function chargeByGM(itemId: string, draft: ExplosionDraft, newId: () => string): Updater {
  return (state) => {
    const charge = getGmCharge(draft)
    if (!charge || getOpenAction(state)) return state
    const held = findReadyObject(state, itemId)
    if (held) return { ...state, characters: { ...state.characters, [held.holder.id]: setCharge(itemId, charge)(held.holder) } }
    return findFloorItem(state, itemId) ? { ...state, floor: chargeOne(state.floor, itemId, charge, newId()) } : state
  }
}

// The GM's hand: activates the charge in an object, held or on the floor. It
// goes off where the object is, as the GM's own explosion does, opened
// committed for everyone it reaches to answer, and the object goes with it.
export function setOffItem(itemId: string, newId: () => string): Updater {
  return (state) => {
    const detonation = getItemDetonation(state, itemId)
    if (!detonation || getOpenAction(state)) return state
    const { effects, dl, center } = detonation
    return appendActions(state, [makeAction('explosion', { id: newId(), actorId: '', source: 'gm', itemId, dl, effects, center, step: 'react' })])
  }
}
