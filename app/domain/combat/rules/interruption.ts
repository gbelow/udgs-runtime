import type { Interruption } from '../../types'
import type { Action, CombatState } from '../types'
import { getAction, getRootOf } from './log'
import { getCounterSlot, getOpeningCounter } from './counter'
import { isManeuverWon } from './grapple'

// combat.tex "Interruption": "receiving a tier 1+ blunt or electric injury
// causes any action and movement to be interrupted, except for running and
// jumping. The AP and STA costs of the action or movement are lost." The
// table's ruling: moving a grapple group carries on too, stopped only by a
// stun of its controller.

// What the landed action did to the victim: the interruption or stun a
// strike landed on them, or a grapple maneuver's, which "always
// interrupt[s] when [it] hit[s]" (combat.tex "Grapple Maneuvers").
export function getInterruptionOf(landed: Action | null | undefined, victimId: string): Interruption {
  if (landed?.step !== 'done') return 'none'
  switch (landed.kind) {
    case 'strike': return landed.targetId === victimId ? landed.interruption : 'none'
    case 'grapple': return landed.targetId === victimId && isManeuverWon(landed) ? 'interrupted' : 'none'
    default: return 'none'
  }
}

// Everything the action gave rise to: its reactions, what they opened, and
// so on down.
function getDescendantIds(state: CombatState, action: Action): Set<string> {
  const found = new Set<string>()
  const queue = [action.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const a of state.actions) {
      if ((a.reactionTo === id || a.spawnedBy === id) && !found.has(a.id)) {
        found.add(a.id)
        queue.push(a.id)
      }
    }
  }
  return found
}

// A counterattack's strike that tied the attack lands alongside it, and
// neither breaks the other (the table's ruling) — though what it lands on
// the attacker still interrupts or stuns them.
function isTiedCounterStrike(state: CombatState, landed: Action): boolean {
  const counter = landed.kind === 'strike' ? getOpeningCounter(state, landed) : null
  const root = counter ? getRootOf(state, counter) : null
  return !!counter && !!root && getCounterSlot(root, counter) === 'tie'
}

export type LandedInterruption = { by: Action; level: Exclude<Interruption, 'none'> }

// The interruptions landed on the action's actor by what it gave rise to,
// before its own effect, in the order they landed. What lands after it — a
// counterattack that rolled lower, a riposte, a follow-up — comes too late
// to break it.
export function getInterruptions(state: CombatState, action: Action): LandedInterruption[] {
  const descendants = getDescendantIds(state, action)
  const landedAt = state.history.indexOf(action.id)
  const before = landedAt === -1 ? state.history : state.history.slice(0, landedAt)
  return before.flatMap((id): LandedInterruption[] => {
    const by = descendants.has(id) ? getAction(state, id) : null
    if (!by || isTiedCounterStrike(state, by)) return []
    const level = getInterruptionOf(by, action.actorId)
    return level === 'none' ? [] : [{ by, level }]
  })
}

// Whether the action is broken: interrupted before its effect. A move is
// cut short where it was caught instead (`getMoveOverride`), and a push
// carries on unless its pusher is stunned (`getPushStop`).
export function isBroken(state: CombatState, action: Action): boolean {
  return action.kind !== 'move' && action.kind !== 'displace' && getInterruptions(state, action).length > 0
}
