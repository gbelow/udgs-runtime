import type { CombatState } from '../combat/types'
import type { Dice } from '../combat/dice'
import { resolveAction, rollOrPay } from '../combat/commands/action'
import { chooseGrapple } from '../combat/commands/choices'
import { isGrappleRowOf } from '../combat/rules/grapple'
import { getOpenAction } from '../combat/rules/log'
import type { AttackEstimate } from './estimate'
import { getBestAttack, type Evaluations } from './evaluation'
import { aimStrike, getStrikes } from './weapons'

// What a grab changes for each side. A strike with a grapple row is played to a
// hit twice, once taking hold and once not; the two states are the same hit
// with the same price paid, so what differs between them is the hold. Each side
// is then read off the same estimates the attacks are valued by: what it can do
// to the other, what the other can do to it, and how much its answers take off
// that.

export type Prospects = {
  // the best attack it has on the other, against the other's best answer
  offense: number
  // the best attack the other has on it, against its own best answer
  taken: number
  // what its best answer takes off that attack
  saved: number
  // the answers it has to that attack
  answers: number
}

export type Posture = { attacker: Prospects; foe: Prospects }

export type GrabReading = {
  weapon: string
  attack: string
  variant: string
  // the same hit without taking hold, and with
  apart: Posture
  held: Posture
}

// The attack's die high enough to hit, then nines for whatever else is thrown.
function hitDice(): Dice {
  let thrown = 0
  return () => (thrown++ === 0 ? 22 : 9)
}

// The prospects of the side that holds `best` against the side that answers
// `incoming`: each is the other's best attack, read once.
function prospectsOf(best: AttackEstimate | undefined, incoming: AttackEstimate | undefined): Prospects {
  const unguarded = incoming?.defenses.find((d) => d.kind === 'none')
  return {
    offense: best?.expectedIL ?? 0,
    taken: incoming?.expectedIL ?? 0,
    saved: incoming && unguarded ? Math.max(0, unguarded.expectedIL - incoming.expectedIL) : 0,
    answers: incoming?.defenses.filter((d) => d.kind !== 'none').length ?? 0,
  }
}

function postureOf(store: Evaluations, state: CombatState, attackerId: string, foeId: string): Posture {
  const byAttacker = getBestAttack(store, state, attackerId, foeId) ?? undefined
  const byFoe = getBestAttack(store, state, foeId, attackerId) ?? undefined
  return { attacker: prospectsOf(byAttacker, byFoe), foe: prospectsOf(byFoe, byAttacker) }
}

// The hit, played out from the declared strike: rolled high, the grab chosen or
// not, and landed. Null where the strike does not offer to grab.
function playedHit(strikeState: CombatState, grab: boolean, newId: () => string): CombatState | null {
  const rolled = rollOrPay(hitDice(), newId)(strikeState)
  const open = getOpenAction(rolled)
  if (!open || open.kind !== 'strike' || open.step !== 'post') return null
  const chosen = chooseGrapple(grab)(rolled)
  if (grab && !(getOpenAction(chosen) as typeof open).grapples) return null
  return resolveAction(newId)(chosen)
}

export function readGrabs(store: Evaluations, state: CombatState, attackerId: string, foeId: string): GrabReading[] {
  let ids = 0
  const newId = () => `grab${++ids}`
  const attacker = state.characters[attackerId]
  return getStrikes(state, attackerId, 'strike', newId)
    .filter((s) => s.targets.includes(foeId) && isGrappleRowOf(attacker, s.open.weaponKey, s.open.attack))
    .flatMap((strike): GrabReading[] => {
      const aimed = aimStrike(strike, foeId)
      const held = playedHit(aimed, true, newId)
      const apart = playedHit(aimed, false, newId)
      if (!held || !apart) return []
      return [{ weapon: strike.open.weaponKey, attack: strike.open.attack, variant: strike.open.variant, apart: postureOf(store, apart, attackerId, foeId), held: postureOf(store, held, attackerId, foeId) }]
    })
}
