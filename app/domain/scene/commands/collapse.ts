import type { Updater } from '../types'
import { collapseByChoice } from '../../character/commands/bleed'
import { getGetUpBar, getLieDownBar } from '../rules/collapse'
import { updateCharacter } from './characters'

// combat.tex "Tend Wounds": the character collapses themselves as the round
// begins, so that their wounds are tended before it bleeds.
export function lieDown(id: string): Updater {
  return (state) => (getLieDownBar(state, id) ? state : updateCharacter(id, collapseByChoice(true), 'collapses to tend their wounds')(state))
}

// combat.tex "Tend Wounds": "They can uncollapse themselves at the same
// moment, foregoing the effects of that round": standing, their wounds are
// not tended as the round begins.
export function getUp(id: string): Updater {
  return (state) => (getGetUpBar(state, id) ? state : updateCharacter(id, collapseByChoice(false), 'stands back up')(state))
}
