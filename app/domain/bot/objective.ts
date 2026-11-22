import type { Coord } from '../types'
import type { SceneState } from '../scene/types'
import { getMovementOptions } from '../scene/rules/move'
import { getInjuryCapacity } from '../character/rules/afflictions'
import { ROUND_AP } from '../tables'
import { cellOf, getAttackRoute, getHarmTaken, getMeans, getPairThreat, getStrongestPerAP, type ThreatTuning } from './threat'

// What a character is in the fight for, which tips the scale once every option
// its meters weigh comes out bad (the user's ruling, 2026-11-22): doing nothing
// is no progress, so an option that brings the objective nearer is taken over
// standing still, unless it ruins the character. Nothing here decides; it reads.
//
// The objective is to take the foe it threatens most out of the fight (the
// user's ruling); progress is how many AP of its own it is from attacking
// that foe (the user's ruling, 2026-11-22: counted in AP, not rounds, so that
// coming nearer is progress even within a round of the foe).

export type Objective = { foe: string; attackAP: number }

// The foe the character threatens most (the user's ruling): of the foes it
// notices and sees placed, the one its strongest attack per AP is worth most
// on, read off the pair threat (`getPairThreat`, `getStrongestPerAP`), so
// that where anyone stands does not change whom it is after. With the AP that
// attack costs.
export function getObjective(view: SceneState, id: string, foes: readonly string[], unnoticed: ReadonlySet<string>, tuning: ThreatTuning): Objective | null {
  const me = view.characters[id]
  if (!me) return null
  let best: { foe: string; perAP: number; attackAP: number } | null = null
  for (const foe of foes) {
    const target = view.characters[foe]
    if (!target || unnoticed.has(foe) || !cellOf(view, foe)) continue
    const core = getStrongestPerAP(getPairThreat(me, target, getMeans(target, false, tuning).STA, tuning, null))
    if (core && (!best || core.perAP > best.perAP)) best = { foe, perAP: core.perAP, attackAP: core.attack.cost.AP }
  }
  return best && { foe: best.foe, attackAP: best.attackAP }
}

// How many AP of its own the character, standing at `from`, is from
// attacking the objective's foe: the walk to where its attack meets the foe
// (`getAttackRoute`) at its fastest movement that costs no STA, in whole
// blocks, and the attack after it. Null where no walk gets there, or the
// attack does not fit in a round.
export function getAPToAttack(view: SceneState, id: string, objective: Objective, from: Coord): number | null {
  const me = view.characters[id]
  if (!me || objective.attackAP > ROUND_AP) return null
  const route = getAttackRoute(view, id, objective.foe, from)
  if (!route) return null
  if (route.steps === 0) return objective.attackAP
  const pace = getMovementOptions(view, me)
    .filter((o) => o.available && o.speed > 0 && o.block.AP > 0 && o.block.STA === 0)
    .reduce<{ metres: number; AP: number } | null>((b, o) => (!b || o.speed / o.block.AP > b.metres / b.AP ? { metres: o.speed, AP: o.block.AP } : b), null)
  if (!pace) return null
  return Math.ceil(route.steps / pace.metres) * pace.AP + objective.attackAP
}

// Whether an option ruins the character (the user's ruling: the guard): the IL
// it is believed to stand at by the round's end reaches its injury capacity,
// where it collapses (combat.tex "Injuries and Death"). Read as the IL it has,
// the IL its bleed adds for every STA `spentSTA` spends (combat.tex "Bleed"),
// and the harm it is believed to take this round standing at `at` with `guard`
// left to answer with (`getHarmTaken`), at 2 harm a point of IL (pairs.ts
// `getHarm`; the bleed that harm counts is read as IL too, so the guard errs on
// the safe side).
export function isRuinous(view: SceneState, members: readonly string[], id: string, at: Coord | null, spentSTA: number, guard: { AP: number; STA: number }, tuning: ThreatTuning): boolean {
  const me = view.characters[id]
  if (!me) return true
  const IL = me.injuries.injuryLevel + spentSTA * me.injuries.bleed + getHarmTaken(view, members, id, at, guard, tuning) / 2
  return IL >= getInjuryCapacity(me)
}
