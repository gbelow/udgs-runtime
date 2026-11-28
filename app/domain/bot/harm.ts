import { getExpectedHarm, readHits } from './odds'
import { BLEED_HARM, harmOf, type PairAttack, type PairDefence } from './pairs'
import { getSkillAt } from './threat'
import type { SpecWeights } from './cost'

// The harm of instructions/bot-spec.md "Scoring" at the weights a box plays
// with, and the defence its "Defense" rule picks against an attack. The pair
// tables (bot/pairs.ts) keep each attack's harm at their own weights beside
// the bleed in it, so both are read apart and weighed here. Nothing here presses.

// The IL and the bleed an attack is expected to leave against a defence, `gap`
// metres away. A defence is one attack's alone, so the two are kept by it.
type Expected = { IL: number; bleed: number }

const expected = new WeakMap<PairDefence, Map<number, Expected>>()

function getExpected(attack: PairAttack, defence: PairDefence, gap: number): Expected {
  let byGap = expected.get(defence)
  if (!byGap) expected.set(defence, (byGap = new Map()))
  const at = attack.distanceRate === null ? 0 : gap
  const known = byGap.get(at)
  if (known) return known
  const read = (harm: Parameters<typeof getExpectedHarm>[4]) => getExpectedHarm(getSkillAt(attack, gap), defence.DL, attack.grazes, attack.mode, harm)
  const bleed = read(defence.bleeds)
  const made = { IL: (read(harmOf(attack, defence)) - BLEED_HARM * bleed) / 2, bleed }
  byGap.set(at, made)
  return made
}

// spec "Expected harm": of `attack` against `defence`, `gap` metres away.
export function getHarmOf(attack: PairAttack, defence: PairDefence, gap: number, w: SpecWeights): number {
  const { IL, bleed } = getExpected(attack, defence, gap)
  return w.IL * IL + w.bleed * bleed
}

// The same on a target already bleeding `bleed`: of the bleed each degree
// leaves, only what it adds over that (the user's ruling, 2026-11-23;
// combat.tex "Bleed": "keep the highest between the current bleed and the
// incoming bleed").
export function getHarmAdded(attack: PairAttack, defence: PairDefence, gap: number, bleeding: number, w: SpecWeights): number {
  const harm = getHarmOf(attack, defence, gap, w)
  if (bleeding <= 0) return harm
  const { miss, graze, hits } = defence.bleeds
  const kept = { miss: Math.min(miss, bleeding), graze: Math.min(graze, bleeding), hits: readHits(hits.count, (HOP) => Math.min(hits.at(HOP), bleeding)) }
  return harm - w.bleed * getExpectedHarm(getSkillAt(attack, gap), defence.DL, attack.grazes, attack.mode, kept)
}

const undefended = (attack: PairAttack): PairDefence | undefined => attack.defences.find((d) => d.draft === null)

export function getUndefendedHarm(attack: PairAttack, gap: number, w: SpecWeights): number {
  const none = undefended(attack)
  return none ? getHarmOf(attack, none, gap, w) : 0
}

// spec "Cost": the defence threats are taken to be met with, the one the
// Defense rule picks (`getAnswer`; the user's ruling, 2026-11-28), on a guard
// that pays for any of them: the harm it leaves and the AP it costs; the
// attack's whole harm, for no AP, where it picks none. One lying prone has no
// evasive jump (pairs.ts reads it off the sheet).
const ANY_GUARD = { AP: Infinity, STA: Infinity }

export function getDefended(attack: PairAttack, gap: number, w: SpecWeights): { harm: number; AP: number } {
  const { harm, AP } = getAnswer(attack, gap, ANY_GUARD, w)
  return { harm, AP }
}

// spec "Defense": of the defences `guard` pays for (and `open` keeps), where
// any leaves less than LOW_HARM, the cheapest of those that prevents more than
// `caution` harm for every AP it costs, and none if none does; where none
// leaves so little, the one that leaves the least, or none where taking the
// hit leaves no more. `defence` is null for none.
const LOW_HARM = 10

export type Answer = { defence: PairDefence | null; harm: number; undefended: number; AP: number; STA: number }

export function getAnswer(attack: PairAttack, gap: number, guard: { AP: number; STA: number }, w: SpecWeights, open: (d: PairDefence) => boolean = () => true): Answer {
  const taken = getUndefendedHarm(attack, gap, w)
  const none: Answer = { defence: null, harm: taken, undefended: taken, AP: 0, STA: 0 }
  const offered = attack.defences
    .filter((d) => d.draft !== null && d.cost.AP <= guard.AP && d.cost.STA <= guard.STA && open(d))
    .map((defence): Answer => ({ defence, harm: getHarmOf(attack, defence, gap, w), undefended: taken, AP: defence.cost.AP, STA: defence.cost.STA }))
  const low = offered.filter((a) => a.harm < LOW_HARM)
  if (!low.length) return offered.reduce((best, a) => (a.harm < best.harm || (a.harm === best.harm && best.defence !== null && a.AP < best.AP) ? a : best), none)
  return low
    .filter((a) => taken - a.harm > w.caution * a.AP)
    .reduce<Answer | null>((best, a) => (!best || a.AP < best.AP || (a.AP === best.AP && a.harm < best.harm) ? a : best), null) ?? none
}

// The defence an answer is made with, the attack's none for taking the hit.
export const getMet = (attack: PairAttack, answer: Answer): PairDefence | undefined => answer.defence ?? undefended(attack)
