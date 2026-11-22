import type { Coord } from '../types'
import type { SceneState } from '../scene/types'
import { getApproachStep } from '../scene/rules/approach'
import { distance } from '../scene/rules/board/geometry'
import { getPair } from './pairs'
import { getDefendedHarm, type SpendCost, type ThreatTuning } from './threat'

// What walking in on someone, or doing something within their reach that draws
// an opportunity attack, costs the one who does it, for any box: combat.tex
// "Opportunity Attack": "moving towards a melee weapon while within its attack
// range" draws a strike, which the walker may only defend against, and a
// braced one only if it runs or jumps in ("Braced Attack"). Whoever
// holds the longer weapon and stands still has it on whoever closes on them.
// The walk is read along the cells it is walked through where they are known,
// and otherwise taken straight, a metre a step, by the scene's own rule for
// the step that draws the attack (`getApproachStep`). A shot, an action
// that requires concentration, and a move with gear that has a price, a
// standard action or more, draw one from everyone whose melee weapon reaches
// where it is done from (scene/rules/reactions.ts `opportunityTriggers`).
// Nothing here decides.

// The metres from the holder at each step of a walk taken straight from
// `from` metres of it to `to`, a metre a step; the first is where it sets out.
function straightDistances(from: number, to: number): number[] {
  const distances = Array.from({ length: Math.floor(Math.abs(from - to)) + 1 }, (_, i) => (to < from ? Math.max(to, from - i) : Math.min(to, from + i)))
  if (distances[distances.length - 1] !== to) distances.push(to)
  return distances
}

// What drawing opportunity attacks comes to: their worth (`getDefendedHarm`),
// the harm alone they leave the walker answering as it would, and the AP and
// STA it spends answering them with that defence.
export type Drawn = { worth: number; harm: number; AP: number; STA: number }

const NONE_DRAWN: Drawn = { worth: 0, harm: 0, AP: 0, STA: 0 }

// The best opportunity attack `holder`, with `means` to pay for it, has on
// `walker` walking a way that keeps it `distances` metres from it, step by
// step, running or jumping in if `running`, the walker defending with
// `guard`; nothing when the walk draws none it can pay for. The attack is met
// at the step that draws it, answered as `spend` prices what the walker
// spends (`getDefendedHarm`), or at its price where none is given.
function getDrawnAlong(state: SceneState, holder: string, walker: string, distances: readonly number[], running: boolean, means: { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning, spend?: SpendCost): Drawn {
  const h = state.characters[holder]
  const w = state.characters[walker]
  if (!h || !w) return NONE_DRAWN
  let best = NONE_DRAWN
  for (const attack of getPair(h, w)) {
    if (attack.kind !== 'strike' || !(running ? attack.opens.approach : attack.opens.step) || attack.cost.AP > means.AP || attack.cost.STA > means.STA) continue
    const step = getApproachStep([...distances], attack.reach)
    if (step === null) continue
    const met = getDefendedHarm(attack, distances[step], guard, 'now', w, tuning, spend)
    if (met && met.worth > best.worth) best = { worth: met.worth, harm: met.harm, AP: met.defence.cost.AP, STA: met.defence.cost.STA }
  }
  return best
}

// The worth of the same, for a walk in taken straight from `before` metres of
// the holder to `after`.
export function getOpportunityWorth(state: SceneState, holder: string, walker: string, before: number, after: number, running: boolean, means: { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning): number {
  return after >= before ? 0 : getDrawnAlong(state, holder, walker, straightDistances(before, after), running, means, guard, tuning).worth
}

// What a walk from `from` to `to`, run or jumped if `running`, draws on
// `walker` in the opportunity attacks of everyone in `holders`, each with the
// means `meansOf` says: along `path`, the cells it is walked through to `to`,
// where it is known (the user's ruling: a walk that passes by a foe within
// its reach draws its strike, wherever it ends), or else taken straight;
// with what answering them costs it, priced by `spend` where given.
export function getApproachDrawn(state: SceneState, walker: string, from: Coord | null, to: Coord | null, running: boolean, holders: readonly string[], meansOf: (id: string) => { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning, path?: readonly Coord[], spend?: SpendCost): Drawn {
  if (!from || !to) return NONE_DRAWN
  return holders.reduce<Drawn>((sum, h) => {
    const at = state.board?.placements[h]?.cell
    if (!at) return sum
    const distances = path && path.length > 0 ? [from, ...path].map((c) => distance(c, at)) : distance(to, at) < distance(from, at) ? straightDistances(distance(from, at), distance(to, at)) : null
    if (!distances) return sum
    const drawn = getDrawnAlong(state, h, walker, distances, running, meansOf(h), guard, tuning, spend)
    return { worth: sum.worth + drawn.worth, harm: sum.harm + drawn.harm, AP: sum.AP + drawn.AP, STA: sum.STA + drawn.STA }
  }, NONE_DRAWN)
}

// The worth of the same.
export function getApproachCost(state: SceneState, walker: string, from: Coord | null, to: Coord | null, running: boolean, holders: readonly string[], meansOf: (id: string) => { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning, path?: readonly Coord[]): number {
  return getApproachDrawn(state, walker, from, to, running, holders, meansOf, guard, tuning, path).worth
}

// The worth of the best opportunity attack `holder`, with `means` to pay for
// it, has on `actor` doing something that draws one `gap` metres from it, the
// actor defending with `guard` (its answer priced by `spend`, where given);
// or, `read` 'harm', the harm alone it leaves; 0 when no strike reaches or can
// be paid for.
export function getStandingOpportunityWorth(state: SceneState, holder: string, actor: string, gap: number, means: { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning, read: 'worth' | 'harm' = 'worth', spend?: SpendCost): number {
  const h = state.characters[holder]
  const a = state.characters[actor]
  if (!h || !a) return 0
  let best: { worth: number; harm: number } | null = null
  for (const attack of getPair(h, a)) {
    if (attack.kind !== 'strike' || !attack.opens.step || attack.reach < gap || attack.cost.AP > means.AP || attack.cost.STA > means.STA) continue
    const met = getDefendedHarm(attack, gap, guard, 'now', a, tuning, spend)
    if (met && (!best || met.worth > best.worth)) best = met
  }
  return best ? best[read] : 0
}

// What doing something that draws an opportunity attack at `at` costs `actor`
// in the attacks of everyone in `holders`, each with the means `meansOf` says,
// as `read` reads it (`getStandingOpportunityWorth`).
export function getStandingCost(state: SceneState, actor: string, at: Coord | null, holders: readonly string[], meansOf: (id: string) => { AP: number; STA: number }, guard: { AP: number; STA: number }, tuning: ThreatTuning, read: 'worth' | 'harm' = 'worth', spend?: SpendCost): number {
  if (!at) return 0
  return holders.reduce((sum, h) => {
    const there = state.board?.placements[h]?.cell
    return there ? sum + getStandingOpportunityWorth(state, h, actor, distance(at, there), meansOf(h), guard, tuning, read, spend) : sum
  }, 0)
}
