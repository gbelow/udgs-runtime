import type { Action, ActionDraft, CombatState, HOPPurchase } from '../types'
import { ACTIONS, getActionDef } from '../rules/actionCatalog'
import type { ActionOption } from '../rules/options'
import { getOpenAction } from '../rules/log'
import { findTrigger } from '../rules/reactions'
import { getCancellableRoot } from '../rules/opportunity'
import { findWeaponRow } from '../rules/weaponRow'

// What the panel calls things: actions, the options to declare them, and
// the purchases a hit can make.

// What the action is called where it is shown on its own: a strike made as
// a grab is a grab, a maneuver goes by its name — standing up, when that is
// what the escape is for — and the rest by the catalog's label.
export function getActionName(action: ActionDraft): string {
  if (action.kind === 'strike' && action.grab) return 'grab'
  if (action.kind === 'grapple' && action.maneuver) return action.stand ? 'stand up' : action.maneuver
  return ACTIONS[action.kind].label
}

// The action as a thing done, for a sentence about it.
export function getActionNoun(action: ActionDraft): string {
  return getActionDef(action.kind).noun ?? getActionName(action)
}

// The button an option is shown as: what its draft declares, and for a
// defense made with something, what it is made with.
export function getOptionLabel(state: CombatState, actorId: string, option: ActionOption): string {
  const draft = option.draft
  switch (draft.kind) {
    case 'block':
    case 'guard':
      return withWeapon(state, actorId, draft, ACTIONS[draft.kind].label)
    case 'intercept':
      return withWeapon(state, actorId, draft, draft.advance ? 'defensive advance' : ACTIONS.intercept.label)
    case 'evasion':
      return draft.stay ? `${ACTIONS.evasion.label}, staying put` : ACTIONS.evasion.label
    case 'assist':
      return draft.unpaid ? `${ACTIONS.assist.label}, not paying` : ACTIONS.assist.label
    case 'explosion':
      return draft.source === 'detonate' ? 'set off a charge' : ACTIONS.explosion.label
    case 'opportunityAttack':
      return getOpportunityLabel(state, actorId, draft.at ?? null)
    default:
      return getActionName(draft)
  }
}

function withWeapon(state: CombatState, actorId: string, draft: { weaponKey?: string; attack?: string }, label: string): string {
  const c = state.characters[actorId]
  const row = c && draft.weaponKey !== undefined && draft.attack !== undefined ? findWeaponRow(c, draft.weaponKey, draft.attack) : null
  return row ? `${label} with ${row.weapon.name}` : label
}

// An opportunity attack at a step of the way, or a catch: the step a catch
// names is the one the runner came into reach on, the one before it fires.
function getOpportunityLabel(state: CombatState, actorId: string, at: number | null): string {
  const open = getOpenAction(state)
  const catching = open ? findTrigger(state, open, { kind: 'opportunityAttack', actorId, at })?.catchOnly === true : false
  const name = catching ? 'catch' : ACTIONS.opportunityAttack.label
  return at ? `${name} at step ${catching ? at - 1 : at}` : name
}

// While an opportunity attack against `defenderId` answers a still-live
// action of their own, that action is what defending actively gives up
// (`getGivenUpFor`), named.
export function getCancellableLabel(state: CombatState, root: Action, defenderId: string): string | null {
  const triggering = getCancellableRoot(state, root, defenderId)
  return triggering ? getActionNoun(triggering) : null
}

export const HOP_LABELS: Record<HOPPurchase, string> = {
  slice: 'slice',
  bypass: 'bypass',
  bust: 'bust',
  smash: 'smash',
  handSwitch: 'switch to hand',
  assassinate: 'assassinate',
  braced: 'braced',
  hook: 'hook',
}
