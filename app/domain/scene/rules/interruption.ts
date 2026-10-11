import type { Interruption } from '../../types'
import type { Action, SceneState } from '../types'
import { getAction, getHistory, getReactionsTo, getRootOf, getSpawned } from './log'
import { getCounterSlot, getOpeningCounter } from './counter'
import { isManeuverWon } from './grapple'
import { getDeliveryInterruption } from './damage'
import { getShotGroup } from './coordinated'

// combat.tex "Interruption": "receiving a tier 1+ blunt or electric injury
// causes any action and movement to be interrupted, except for running and
// jumping. The AP and STA costs of the action or movement are lost." The
// table's ruling: a push carries on too, stopped only by a stun of its
// pusher.

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
function getDescendantIds(state: SceneState, action: Action): Set<string> {
  const found = new Set<string>()
  const queue = [action.id]
  while (queue.length > 0) {
    const id = queue.shift()!
    for (const a of [...getReactionsTo(state, id), ...getSpawned(state, id)]) {
      if (!found.has(a.id)) {
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
function isTiedCounterStrike(state: SceneState, landed: Action): boolean {
  const counter = landed.kind === 'strike' ? getOpeningCounter(state, landed) : null
  const root = counter ? getRootOf(state, counter) : null
  return !!counter && !!root && getCounterSlot(root, counter) === 'tie'
}

export type LandedInterruption = { by: Action; level: Exclude<Interruption, 'none'> }

// The interruptions landed on the action's actor by what it gave rise to,
// before its own effect, in the order they landed. What lands after it — a
// counterattack that rolled lower, a riposte, a follow-up — comes too late
// to break it.
export function getInterruptions(state: SceneState, action: Action): LandedInterruption[] {
  return getLandedBefore(state, action).filter(({ by }) => !isTiedCounterStrike(state, by))
}

function getLandedBefore(state: SceneState, action: Action): LandedInterruption[] {
  const descendants = getDescendantIds(state, action)
  const history = getHistory(state)
  const landedAt = history.indexOf(action.id)
  const before = landedAt === -1 ? history : history.slice(0, landedAt)
  return before.flatMap((id): LandedInterruption[] => {
    const by = descendants.has(id) ? getAction(state, id) : null
    if (!by) return []
    const level = getInterruptionOf(by, action.actorId)
    return level === 'none' ? [] : [{ by, level }]
  })
}

// combat.tex "Interruption", "Stun": the strongest of what the landed action
// did to the character's own action — what it landed on them (a shot together
// with the shots joined to it, which land as one, combat.tex "Coordinated
// Shots"), the crash it set off, the deliveries of an area or a spell, a
// spiritual attack among them.
export function getInterruptionBy(state: SceneState, landed: Action, id: string): Interruption {
  return strongest([getInterruptionOf(landed, id), ...getLandedOn(state, landed, id)])
}

function getLandedOn(state: SceneState, landed: Action, id: string): Interruption[] {
  switch (landed.kind) {
    case 'shoot': return getShotGroup(state, landed).filter((shot) => shot.targetId === id).map((shot) => shot.interruption)
    case 'strike': return landed.trample?.stunned.includes(id) ? ['stunned'] : []
    case 'move': return landed.facts?.trampled.some((t) => t.stunned.includes(id)) ? ['stunned'] : []
    case 'blast':
    case 'cast':
    case 'fireAgain':
    case 'fall':
    case 'spellTest': {
      const c = state.characters[id]
      return c ? (landed.facts?.[id] ?? []).map((d) => getDeliveryInterruption(d, c)) : []
    }
    default: return []
  }
}

const LEVELS: readonly Interruption[] = ['none', 'interrupted', 'stunned']

function strongest(levels: Interruption[]): Interruption {
  return levels.reduce<Interruption>((a, b) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a), 'none')
}

// Whether the landed action interrupted the character, who then gets no
// follow-up of it to choose (the table's ruling): whatever it landed on
// them, or, for its own actor, whatever landed on them while it was played
// out, a tied counterattack's strike.
export function isInterruptedBy(state: SceneState, landed: Action, id: string): boolean {
  if (landed.actorId === id && getLandedBefore(state, landed).length > 0) return true
  return getInterruptionBy(state, landed, id) !== 'none'
}

// Whether the action is broken: interrupted before its effect. A move is
// cut short where it was caught instead (`getMoveOverride`), and a push
// carries on unless its pusher is stunned (`getPushStop`).
export function isBroken(state: SceneState, action: Action): boolean {
  return action.kind !== 'move' && action.kind !== 'drag' && getInterruptions(state, action).length > 0
}
