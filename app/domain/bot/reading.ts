import type { SceneState } from '../scene/types'
import type { Dice } from '../play/dice'
import { rollOrPay } from '../scene/commands/action'
import { getPayableCost } from '../scene/rules/action'
import { getAction, getOpenAction } from '../scene/rules/log'
import { spendBest } from './overflow'
import { getStrikeDefenses } from './defenses'
import { aimStrike, getStrikes } from './weapons'

// A quick look at what an attack could do to one foe, cheap enough to be
// taken on every turn of a fight played on (estimate.ts weighs it all, and
// is not). Two things: the injury it adds when the foe does not answer it,
// the die at a middling and at a high value against the foe's standard
// deflection (creating.tex "Standard Deflection"), the overflow of a hit
// spent on whatever does the most (overflow.ts); and whether the foe has the
// AP and STA for a defense against it at all.

export type Reading = {
  kind: 'strike' | 'shoot'
  weaponKey: string
  attack: string
  variant: string
  cost: { AP: number; STA: number }
  // the IL added against the foe's SD, the die at 4 and at 9, the overflow
  // spent at its best, and what that spending costs on top of the attack
  low: { IL: number; AP: number; STA: number }
  high: { IL: number; AP: number; STA: number }
  // whether the foe can pay for a defense against it
  defended: boolean
}

const LOW = 4
const HIGH = 9

// The attack's die at `value`, then nines for whatever else is thrown.
function scripted(value: number): Dice {
  let thrown = 0
  return () => (thrown++ === 0 ? value : HIGH)
}

function added(locked: SceneState, openId: string, targetId: string, die: number, room: number): Reading['low'] {
  let ids = 0
  const rolled = rollOrPay(scripted(die), () => `reading${++ids}`)(locked)
  const open = getOpenAction(rolled)
  if (open && open.step === 'post' && (open.kind === 'strike' || open.kind === 'shoot')) {
    const best = spendBest(rolled, open, targetId)
    return { IL: Math.min(best.outcome?.IL ?? 0, room), AP: best.spend.AP, STA: best.spend.STA }
  }
  const landed = getAction(rolled, openId)?.results?.find((r) => r.targetId === targetId)?.outcome
  return { IL: Math.min(landed?.IL ?? 0, room), AP: 0, STA: 0 }
}

export function readAttacks(state: SceneState, attackerId: string, targetId: string, newId: () => string): Reading[] {
  const target = state.characters[targetId]
  if (!target || !state.characters[attackerId]) return []
  const room = Math.max(0, target.injuries.deathThreshold - target.injuries.injuryLevel)
  return (['strike', 'shoot'] as const).flatMap((kind) => getStrikes(state, attackerId, kind, newId)
    .filter((strike) => strike.targets.includes(targetId))
    .map((strike): Reading => {
      const locked = aimStrike(strike, targetId)
      const priced = getPayableCost(locked, strike.open)
      return {
        kind,
        weaponKey: strike.open.weaponKey,
        attack: strike.open.attack,
        variant: strike.open.variant,
        cost: { AP: priced?.AP ?? 0, STA: priced?.STA ?? 0 },
        low: added(locked, strike.open.id, targetId, LOW, room),
        high: added(locked, strike.open.id, targetId, HIGH, room),
        defended: getStrikeDefenses(locked, targetId, attackerId).length > 0,
      }
    }))
}
