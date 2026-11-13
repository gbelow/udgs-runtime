import type { Action, ActionDraft, ActionKind, SceneState, HOPPurchase } from '../types'
import { ACTIONS, getActionDef } from '../rules/actionCatalog'
import type { ActionOption } from '../rules/options'
import { getOpenAction } from '../rules/log'
import { findTrigger } from '../rules/reactions'
import { getCancellableRoot } from '../rules/opportunity'
import { findWeaponRow } from '../rules/weaponRow'
import { findPrepared } from '../rules/prepared'
import { getHeldOf, isGivingUpHeld } from '../rules/hold'
import { getAnswerLabel } from '../rules/modifiers'
import { SPELLS, isSpellKey } from '../../spells'
import type { Character, GearMove } from '../../types'
import { findCarriedItem, getContainer } from '../../item/rules/containers'

// What the panel calls things: actions, the options to declare them, and
// the purchases a hit can make.

// What the action is called where it is shown on its own: a maneuver goes by
// its name, and the rest by the catalog's label.
export function getActionName(action: ActionDraft): string {
  if (action.kind === 'grapple' && action.maneuver) return action.maneuver === 'attack' ? 'grappling attack' : action.maneuver
  if (action.kind === 'drag' && action.pull) return 'pull'
  if (action.kind === 'social' && action.say) return action.say
  if (action.kind === 'fireAgain' && action.key !== undefined && isSpellKey(action.key)) return `${SPELLS[action.key].name} again`
  if (action.kind === 'releaseSpell' && action.key !== undefined && isSpellKey(action.key)) return `let go of ${SPELLS[action.key].name}`
  if (action.kind === 'gear' && action.move) return GEAR_MOVE_NAMES[action.move.kind]
  return ACTIONS[action.kind].label
}

// The action as a thing done, for a sentence about it.
export function getActionNoun(action: ActionDraft): string {
  return getActionDef(action.kind).noun ?? getActionName(action)
}

// The button an option is shown as: what its draft declares, named for the
// modifier it is offered as if any, and for a defense made with something,
// what it is made with.
export function getOptionLabel(state: SceneState, actorId: string, option: ActionOption): string {
  const label = getDraftLabel(state, actorId, option)
  return option.surge ? `${label} (surge first)` : label
}

function getDraftLabel(state: SceneState, actorId: string, option: ActionOption): string {
  const draft = option.draft
  switch (draft.kind) {
    case 'block':
    case 'guard': {
      const label = getAnswerLabel(draft) ?? (draft.preparedId ? `prepared ${ACTIONS[draft.kind].label}` : ACTIONS[draft.kind].label)
      return withWeapon(state, actorId, draft, draft.kind === 'guard' && draft.cover ? `${label}, taking cover` : label)
    }
    case 'blockExplosion':
      return withWeapon(state, actorId, draft, ACTIONS[draft.kind].label)
    case 'reload': {
      const weapon = getDraftWeapon(state, actorId, draft)
      return weapon ? `${ACTIONS.reload.label} ${weapon}` : ACTIONS.reload.label
    }
    case 'intercept':
      return withWeapon(state, actorId, draft, getAnswerLabel(draft) ?? (draft.preparedId ? 'prepared intercept' : ACTIONS.intercept.label))
    case 'assist':
      return draft.boost ? `${ACTIONS.assist.label} +5` : ACTIONS.assist.label
    case 'explosion':
      return draft.source === 'detonate' ? 'set off a charge' : ACTIONS.explosion.label
    case 'opportunityAttack':
      return getOpportunityLabel(state, actorId, draft.at ?? null)
    case 'retarget':
      return draft.at ? `${ACTIONS.retarget.label} at step ${draft.at}` : ACTIONS.retarget.label
    case 'counterspell':
      return draft.at ? `${ACTIONS.counterspell.label} at step ${draft.at}` : ACTIONS.counterspell.label
    case 'prepared': {
      const prepared = draft.preparedId ? findPrepared(state, draft.preparedId) : null
      return prepared?.main ? `prepared ${prepared.main}` : ACTIONS.prepared.label
    }
    case 'gear': {
      const c = state.characters[actorId]
      return c && draft.move ? getGearMoveLabel(c, draft.move) : getActionName(draft)
    }
    default:
      return getAnswerLabel(draft) ?? getActionName(draft)
  }
}

const GEAR_MOVE_NAMES: Record<GearMove['kind'], string> = {
  regripItem: 'regrip',
  dropItem: 'drop',
  slingShield: 'sling',
  unslingShield: 'unsling the shield',
  throwOffShield: 'throw off the shield',
  putOnFromHands: 'put on',
  wearFromHands: 'wear',
  storeItem: 'put away',
  drawItem: 'draw',
  putOnFromContainer: 'put on',
  wearFromContainer: 'wear',
  takeOffContainer: 'take off',
  doffArmor: 'take off the armor',
  putGauntlets: 'gauntlets',
  putHelm: 'helmet',
  toggleVisor: 'visor',
}

// A move with gear as a button says it: what it does, to what, and where.
function getGearMoveLabel(c: Character, move: GearMove): string {
  const item = (id: string) => {
    const found = findCarriedItem(c, id)?.item
    return found ? found.name || found.refId : id
  }
  const container = (key: string) => getContainer(c, key)?.name ?? key
  switch (move.kind) {
    case 'regripItem': return `hold ${item(move.args[0])} in ${move.args[1] === 1 ? 'one hand' : 'two hands'}`
    case 'storeItem': return `put ${item(move.args[0])} in the ${move.args[2]} slots of ${container(move.args[1])}`
    case 'drawItem':
    case 'putOnFromContainer':
    case 'wearFromContainer': return `${GEAR_MOVE_NAMES[move.kind]} ${item(move.args[1])} from ${container(move.args[0])}`
    case 'dropItem':
    case 'slingShield':
    case 'putOnFromHands':
    case 'wearFromHands': return `${GEAR_MOVE_NAMES[move.kind]} ${item(move.args[0])}`
    case 'takeOffContainer': return `take off ${container(move.args[0])}`
    case 'doffArmor': return move.args[0] ? `take off the armor into the ${move.args[0].slot} slots of ${container(move.args[0].containerKey)}` : 'take off the armor'
    case 'putGauntlets': return c.hasGauntlets ? 'take off the gauntlets' : 'put on the gauntlets'
    case 'putHelm': return c.hasHelm ? 'take off the helmet' : 'put on the helmet'
    case 'toggleVisor': return c.visorOpen ? 'close the visor' : 'open the visor'
    case 'unslingShield':
    case 'throwOffShield': return GEAR_MOVE_NAMES[move.kind]
  }
}

function withWeapon(state: SceneState, actorId: string, draft: { weaponKey?: string; attack?: string }, label: string): string {
  const weapon = getDraftWeapon(state, actorId, draft)
  return weapon ? `${label} with ${weapon}` : label
}

function getDraftWeapon(state: SceneState, actorId: string, draft: { weaponKey?: string; attack?: string }): string | null {
  const c = state.characters[actorId]
  const row = c && draft.weaponKey !== undefined && draft.attack !== undefined ? findWeaponRow(c, draft.weaponKey, draft.attack) : null
  return row?.weapon.name ?? null
}

// An opportunity attack at a step of the way, or a catch: the step a catch
// names is the one the runner came into reach on, the one before it fires.
function getOpportunityLabel(state: SceneState, actorId: string, at: number | null): string {
  const open = getOpenAction(state)
  const catching = open ? findTrigger(state, open, { kind: 'opportunityAttack', actorId, at })?.catchOnly === true : false
  const name = catching ? 'catch' : ACTIONS.opportunityAttack.label
  return at ? `${name} at step ${catching ? at - 1 : at}` : name
}

// While an opportunity attack against `defenderId` answers a still-live
// action of their own, that action is what defending actively gives up
// (`getGivenUpFor`), named; so is the action they hold over for the round to
// change.
export function getCancellableLabel(state: SceneState, root: Action, defenderId: string, kind?: ActionKind): string | null {
  const own = getCancellableRoot(state, root, defenderId, kind) ?? (isGivingUpHeld(state, defenderId, root.id, kind) ? getHeldOf(state, defenderId) : null)
  return own ? getActionNoun(own) : null
}

export const HOP_LABELS: Record<HOPPurchase, string> = {
  slice: 'slice',
  bust: 'bust',
  smash: 'smash',
  handSwitch: 'switch to hand',
  assassinate: 'assassinate',
  braced: 'braced',
  hook: 'hook',
}
