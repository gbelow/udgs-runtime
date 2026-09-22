import type { Action, ActionKind, CombatState, ExplosionAction, MoveAction, ShootAction, StrikeAction } from '../types'
import { ACTIONS, reactsTo } from '../actionCatalog'
import { getAdjacentIds, getDistanceBetween, getFlankers, getFootprint, getMeleeRange, getPlacedFootprint } from './board'
import { getThreatenedIds, isAvoidable } from './explosion'
import { getRunPath } from './move'
import { setDistance } from '../geometry'

// combat.tex "Reactions": "actions that can be performed on another
// character's turn but must be triggered by something." What an action,
// once committed to, triggers in everyone else: who may answer it, with
// which reaction, and — for a move — at which step of the path. The
// declaration is locked at the commit, so reading these off the action is
// the same as loading them then; the commands refuse any reaction not on
// the list.

export type Trigger = {
  characterId: string
  kind: ActionKind
  // the step of a move's path (counted from 1) at which the trigger fires;
  // null for a trigger that is not about a step
  at: number | null
}

export function getTriggers(state: CombatState, root: Action): Trigger[] {
  switch (root.kind) {
    case 'strike': return strikeTriggers(state, root)
    case 'shoot': return shootTriggers(state, root)
    case 'explosion': return explosionTriggers(state, root)
    case 'move': return moveTriggers(state, root)
    default: return []
  }
}

export function getTriggersFor(state: CombatState, root: Action, characterId: string): Trigger[] {
  return getTriggers(state, root).filter((t) => t.characterId === characterId)
}

// combat.tex "Defend": the target may answer with any of the four defenses.
// combat.tex "Flanking": everyone flanking the attacker gets an opportunity
// attack.
function strikeTriggers(state: CombatState, root: StrikeAction): Trigger[] {
  if (!root.targetId) return []
  const defenses = (Object.keys(ACTIONS) as ActionKind[])
    .filter((kind) => ACTIONS[kind].type === 'reaction' && kind !== 'opportunityAttack' && reactsTo(kind, 'strike'))
    .map((kind): Trigger => ({ characterId: root.targetId!, kind, at: null }))
  const flankers = getFlankers(state, root.actorId, root.targetId)
    .filter((id) => getMeleeRange(state.characters[id]) > 0)
    .map((id): Trigger => ({ characterId: id, kind: 'opportunityAttack', at: null }))
  return [...defenses, ...flankers]
}

// combat.tex "Reflex": the target may answer a shot with evasion or guard.
// combat.tex "Guard": someone may "block ranged attacks against ...
// adjacent characters, as long as they are closer to the projectile source
// than the adjacent character". What they may guard with is the option's
// to say, as it is for the target.
function shootTriggers(state: CombatState, root: ShootAction): Trigger[] {
  if (!root.targetId) return []
  const own = (Object.keys(ACTIONS) as ActionKind[])
    .filter((kind) => ACTIONS[kind].type === 'reaction' && reactsTo(kind, 'shoot'))
    .map((kind): Trigger => ({ characterId: root.targetId!, kind, at: null }))
  const toTarget = getDistanceBetween(state, root.actorId, root.targetId)
  const guards = getAdjacentIds(state, root.targetId)
    .filter((id) => id !== root.actorId)
    .filter((id) => {
      const toGuard = getDistanceBetween(state, root.actorId, id)
      return toGuard !== null && toTarget !== null && toGuard < toTarget
    })
    .map((id): Trigger => ({ characterId: id, kind: 'guard', at: null }))
  return [...own, ...guards]
}

// combat.tex "Explosions": "defended against with a reflex test"; "Sprays":
// "target all characters in range, which their reflex saves to escape".
// Everyone the explosion as declared may reach — a spray not yet aimed
// threatens its whole range — may avoid it; the attacker, though they may
// stand in their own blast, answers nothing of their own.
function explosionTriggers(state: CombatState, root: ExplosionAction): Trigger[] {
  if (!isAvoidable(root)) return []
  return getThreatenedIds(state, root)
    .filter((id) => id !== root.actorId)
    .map((id): Trigger => ({ characterId: id, kind: 'avoidExplosion', at: null }))
}

// combat.tex "Opportunity Attack": triggered by "moving towards a melee
// weapon while within its attack range" — the first step taken from a cell
// already within someone's melee range to one closer to them. Stepping into
// range is not yet moving towards the weapon while within it.
// combat.tex "Follow": "as a reaction to any movement except running,
// follow another character who is already within melee range."
function moveTriggers(state: CombatState, root: MoveAction): Trigger[] {
  const mover = state.characters[root.actorId]
  const from = state.board?.placements[root.actorId]
  if (!mover || !from || !state.board) return []
  const path = getRunPath(state, root)
  const triggers: Trigger[] = []
  for (const id of Object.keys(state.characters)) {
    if (id === root.actorId) continue
    const other = getPlacedFootprint(state, id)
    if (!other) continue
    const range = getMeleeRange(state.characters[id])
    let previous = setDistance(getFootprint(mover, from), other)
    if (range > 0 && previous <= range && root.movement !== 'run') triggers.push({ characterId: id, kind: 'follow', at: null })
    if (range === 0) continue
    for (const [i, cell] of path.entries()) {
      const distance = setDistance(getFootprint(mover, { ...from, cell }), other)
      if (previous <= range && distance < previous) {
        triggers.push({ characterId: id, kind: 'opportunityAttack', at: i + 1 })
        break
      }
      previous = distance
    }
  }
  return triggers
}
