import type { Coord } from '../types'
import type { SceneState } from '../scene/types'
import { getApproachStep } from '../scene/rules/approach'
import { distance } from '../scene/rules/board/geometry'
import { getPair } from './pairs'
import { getDefendedHarm, type ThreatTuning } from './threat'

// What walking in on someone costs the walker, for any box: combat.tex
// "Opportunity Attack": "moving towards a melee weapon while within its attack
// range" draws a strike, which the walker may only defend against. Whoever
// holds the longer weapon and stands still has it on whoever closes on them.
// The walk is taken straight, a metre a step, and read by the scene's own rule
// for the step that draws the attack (`getApproachStep`). Nothing here decides.

// Whether walking from `from` metres of the holder to `to` draws an
// opportunity attack from a weapon reaching `range`.
export function drawsOpportunity(from: number, to: number, range: number): boolean {
  if (to >= from) return false
  const distances = Array.from({ length: Math.floor(from - to) + 1 }, (_, i) => Math.max(to, from - i))
  if (distances[distances.length - 1] !== to) distances.push(to)
  return getApproachStep(distances, range) !== null
}

// The worth (`getDefendedHarm`) of the best opportunity attack `holder`, with
// `means` to pay for it, has on `walker` walking in from `before` metres of
// it to `after`, the walker defending with `guard`; 0 when the walk draws none
// it can pay for.
export function getOpportunityWorth(state: SceneState, holder: string, walker: string, before: number, after: number, means: { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning): number {
  const h = state.characters[holder]
  const w = state.characters[walker]
  if (!h || !w || after >= before) return 0
  let best = 0
  for (const attack of getPair(h, w)) {
    if (attack.kind !== 'strike' || attack.cost.AP > means.AP || attack.cost.STA > means.STA) continue
    if (!drawsOpportunity(before, after, attack.reach)) continue
    const met = getDefendedHarm(attack, after, guard, 'now', w.injuries.bleed, tuning)
    if (met && met.worth > best) best = met.worth
  }
  return best
}

// What a walk from `from` to `to` costs `walker` in the opportunity attacks of
// everyone in `holders`, each with the means `meansOf` says.
export function getApproachCost(state: SceneState, walker: string, from: Coord | null, to: Coord | null, holders: readonly string[], meansOf: (id: string) => { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning): number {
  if (!from || !to) return 0
  return holders.reduce((sum, h) => {
    const at = state.board?.placements[h]?.cell
    return at ? sum + getOpportunityWorth(state, h, walker, distance(from, at), distance(to, at), meansOf(h), guard, tuning) : sum
  }, 0)
}
