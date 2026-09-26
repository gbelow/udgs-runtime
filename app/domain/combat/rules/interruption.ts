import type { Interruption } from '../../types'
import type { Action, CombatState } from '../types'
import { getAction, getRootOf } from './log'
import { getCounterSlot, getOpeningCounter } from './counter'

// combat.tex "Interruption": "an effect that interrupts any action from its
// victim, making them lose its associated costs. [...] It happens when a
// tier 1+ blunt or electric damage is inflicted or when the character is
// pushed." The table's ruling: an interruption always breaks the action it
// interrupts, except running, jumping and pushing, which carry on; a push is
// stopped only by a stun of its pusher.

// What the landed action did to the victim: the interruption or stun a
// strike landed on them, or the interruption of being pushed — or of
// resisting a push actively, which "interrupt[s] itself" (combat.tex "Push
// and drag").
export function getInterruptionOf(landed: Action | null | undefined, victimId: string): Interruption {
  if (landed?.step !== 'done') return 'none'
  switch (landed.kind) {
    case 'strike': return landed.targetId === victimId ? landed.interruption : 'none'
    case 'drag':
    case 'displace': return landed.facts?.interrupted.includes(victimId) ? 'interrupted' : 'none'
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
