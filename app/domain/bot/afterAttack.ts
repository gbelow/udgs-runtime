import type { CombatState } from '../combat/types'
import type { AttackEstimate } from './estimate'
import { getBestAttack, type Evaluations } from './evaluation'

// What an attack leaves the table: the two characters having paid for it — the
// attacker its price, the foe the answer it is assumed to give — and the best
// attack the foe could then make back, the attacker answering as it best can.
// The estimate of the foe's attack is the same one the attacker's own attacks
// are valued by, with the roles turned.

export type Aftermath = {
  // what each has left to spend
  attackerLeft: { AP: number; STA: number }
  foeLeft: { AP: number; STA: number }
  // the foe's best attack on the attacker from there, null when it has none
  reply: AttackEstimate | null
}

function paid(state: CombatState, id: string, price: { AP: number; STA: number }): CombatState {
  const c = state.characters[id]
  return { ...state, characters: { ...state.characters, [id]: { ...c, resources: { ...c.resources, AP: Math.max(0, c.resources.AP - price.AP), STA: Math.max(0, c.resources.STA - price.STA) } } } }
}

// Attacks that leave the same AP and STA on both sides share one answer, so
// the reader keeps the foe's best attack for each leftover it has seen.
export function makeAftermathReader(store: Evaluations, state: CombatState, attackerId: string, foeId: string): (attack: AttackEstimate) => Aftermath {
  const seen = new Map<string, Aftermath>()
  return (attack) => {
    const attackerLeft = paid(state, attackerId, attack.cost).characters[attackerId].resources
    const foeLeft = paid(state, foeId, attack.guarded.cost).characters[foeId].resources
    const left = { attacker: { AP: attackerLeft.AP, STA: attackerLeft.STA }, foe: { AP: foeLeft.AP, STA: foeLeft.STA } }
    const key = JSON.stringify(left)
    const known = seen.get(key)
    if (known) return known
    const after = paid(paid(state, attackerId, attack.cost), foeId, attack.guarded.cost)
    const aftermath = { attackerLeft: left.attacker, foeLeft: left.foe, reply: getBestAttack(store, after, foeId, attackerId) }
    seen.set(key, aftermath)
    return aftermath
  }
}
