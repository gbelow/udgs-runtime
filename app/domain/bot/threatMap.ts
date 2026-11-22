import type { CampaignCharacter, Coord } from '../types'
import type { SceneState } from '../scene/types'
import { coordKey, disk, distance, sameCell } from '../scene/rules/board/geometry'
import { firesAcross, getEyes } from '../scene/rules/board/board'
import { getInjuryCapacity } from '../character/rules/afflictions'
import { getPair, type PairAttack } from './pairs'
import { cellOf, getHarmAgainst, getMeans, getPace, getPresence, getStepMap, getStrikeCells } from './threat'
import { getSides } from './table'
import { getSTAHarm, type SpecWeights } from './cost'

// The threat of instructions/bot-spec.md "Threat": how much harm a character
// could take standing at a cell, from everyone who can attack it, read as one
// layer for every attacker (`getLayer`), each kept by itself:
//
//   layer = harm per AP of the attacker's best attack × (its AP − the AP of
//           the walk into that attack's reach), never below 0
//
// immediate with the AP the attacker is believed to have left, potential with
// a fresh round's FRESH_AP. The harm is what the attack leaves against the
// defence the target picks with what it holds (`getPickedHarm`), so that the
// less it holds, the more it is open to. The walk is at the attacker's
// fastest pace (`getPace`: a run where it can run), and goes no further than a
// fresh round's step map; a shot needs no walk where it has a line of fire
// within its reach, and has no reach anywhere else. A foe the seat remembers
// counts its presence (bot/memory.ts, fading by the round). Nothing here decides.

export type When = 'immediate' | 'potential'
export type Guard = { AP: number; STA: number }

// spec "Threat": a fresh round's AP
export const FRESH_AP = 10
// spec "Expected harm": the metres a shot is read from when no distance is given
export const SHOT_GAP = 20

// The harm `attack` leaves `target`, `gap` metres away, against the defence
// it would pick holding `guard`: of those it can pay for (none among them),
// the one leaving the least harm and STA at its price.
const picked = new WeakMap<PairAttack, Map<string, number>>()

export function getPickedHarm(attack: PairAttack, gap: number, target: CampaignCharacter, guard: Guard, w: SpecWeights): number {
  const key = `${gap}|${guard.AP}|${guard.STA}|${target.injuries.bleed}|${w.caution}|${w.STA}|${w.IL}`
  const byKey = picked.get(attack) ?? new Map<string, number>()
  picked.set(attack, byKey)
  const known = byKey.get(key)
  if (known !== undefined) return known
  let best: { score: number; harm: number } | null = null
  for (const d of attack.defences) {
    if (d.cost.AP > guard.AP || d.cost.STA > guard.STA) continue
    const harm = getHarmAgainst(attack, d, gap)
    const score = harm + w.caution * getSTAHarm(d.cost.STA, target.injuries.bleed, w)
    if (!best || score < best.score) best = { score, harm }
  }
  const harm = best?.harm ?? 0
  byKey.set(key, harm)
  return harm
}

// The fewest cells `a`, standing at `from`, walks to strike `d` standing at
// `at` with `reach`: none where it reaches already, walked on `a`'s step map
// where it stands, or back on `d`'s from where `d` stands, else straight.
function meleeSteps(view: SceneState, a: string, from: Coord, d: string, at: Coord, reach: number): number | null {
  const strikes = getStrikeCells(view, a, d, at, reach)
  if (distance(from, at) <= reach && strikes(from)) return 0
  const here = cellOf(view, a)
  const there = cellOf(view, d)
  if (here && sameCell(here, from)) return stepsInto(getStepMap(view, a), at, reach, strikes)
  if (there && sameCell(there, at)) return stepsInto(getStepMap(view, d), from, reach)
  return Math.max(1, distance(from, at) - Math.floor(reach))
}

function stepsInto(map: Map<string, number> | null, at: Coord, reach: number, clear: (c: Coord) => boolean = () => true): number | null {
  if (!map) return null
  let fewest: number | null = null
  for (const cell of disk(at, Math.max(1, Math.floor(reach)))) {
    const steps = map.get(coordKey(cell))
    if (steps !== undefined && (fewest === null || steps < fewest) && clear(cell)) fewest = steps
  }
  return fewest
}

// The AP of the walk `a` makes from `from` to attack `d` at `at`, null where
// it cannot. It reads only where the two stand, the kind of attack and its
// reach, so it is kept by those for the state, whatever guard or round it is
// read for.
const walks = new WeakMap<SceneState, Map<string, number | null>>()

function walkAP(view: SceneState, a: string, from: Coord, d: string, at: Coord, attack: PairAttack): number | null {
  const board = view.board
  if (!board) return 0
  let byKey = walks.get(view)
  if (!byKey) walks.set(view, (byKey = new Map()))
  const key = `${a}|${coordKey(from)}|${d}|${coordKey(at)}|${attack.kind}|${attack.reach}`
  if (byKey.has(key)) return byKey.get(key)!
  let made: number | null
  if (attack.kind === 'shoot') made = distance(from, at) <= attack.reach && firesAcross(board, [from], [at], getEyes(view, a, d)) ? 0 : null
  else {
    const steps = meleeSteps(view, a, from, d, at, attack.reach)
    const pace = getPace(view, a)
    made = steps === null ? null : steps === 0 ? 0 : pace ? Math.ceil(steps / pace.metres) * pace.AP : null
  }
  byKey.set(key, made)
  return made
}

const layers = new WeakMap<SceneState, WeakMap<SpecWeights, Map<string, number>>>()

// `a`'s layer on `d` (see above): `a` standing at `from`, `d` at `at` holding
// `guard`. Of `plays`, only whether it holds `a` counts (its sheet, or its face).
export function getLayer(view: SceneState, plays: readonly string[], a: string, from: Coord | null, d: string, at: Coord | null, when: When, guard: Guard, w: SpecWeights): number {
  const ca = view.characters[a]
  const cd = view.characters[d]
  if (!ca || !cd || !from || !at) return 0
  let byW = layers.get(view)
  if (!byW) layers.set(view, (byW = new WeakMap()))
  let byKey = byW.get(w)
  if (!byKey) byW.set(w, (byKey = new Map()))
  const key = `${when}|${a}|${plays.includes(a)}|${coordKey(from)}|${d}|${coordKey(at)}|${guard.AP}|${guard.STA}`
  const known = byKey.get(key)
  if (known !== undefined) return known
  const AP = when === 'potential' ? FRESH_AP : getMeans(ca, plays.includes(a), w).AP
  let most = 0
  if (AP > 0) {
    for (const attack of getPair(ca, cd, when === 'potential' ? null : cd.usedSurge)) {
      if (!attack.opens.action) continue
      const walk = walkAP(view, a, from, d, at, attack)
      if (walk === null || walk >= AP) continue
      const harm = getPickedHarm(attack, attack.kind === 'shoot' ? distance(from, at) : attack.reach, cd, guard, w)
      if (harm > 0) most = Math.max(most, (harm / Math.max(1, attack.cost.AP)) * (AP - walk))
    }
  }
  const made = most * getPresence(view, a, w) * getPresence(view, d, w)
  byKey.set(key, made)
  return made
}

// The foes' threat on `id` standing at `at`, holding `guard`: every foe's layer, added up.
export function getThreatOn(view: SceneState, members: readonly string[], id: string, at: Coord | null, guard: Guard, when: When, w: SpecWeights): number {
  return getSides(view, members).foes.reduce((sum, foe) => sum + getLayer(view, members, foe, cellOf(view, foe), id, at, when, guard, w), 0)
}

// The threat of `side` on `foe` standing at `at` holding `guard`, each where
// it stands but `moved`, read as standing at `to`.
export function getThreatBy(view: SceneState, members: readonly string[], side: readonly string[], foe: string, at: Coord | null, guard: Guard, when: When, w: SpecWeights, moved?: { id: string; to: Coord | null }): number {
  return side.reduce((sum, a) => sum + getLayer(view, members, a, moved?.id === a ? moved.to : cellOf(view, a), foe, at, when, guard, w), 0)
}

// The guard a fresh round leaves a character: FRESH_AP, and the STA it holds.
export const freshGuard = (STA: number): Guard => ({ AP: FRESH_AP, STA })

// Whether an option leaves the character collapsed or dead (spec "Guard"):
// the IL it stands at, the IL its bleed adds for every STA `spentSTA` spends
// (combat.tex "Bleed"), and the foes' immediate threat on it at `at` holding
// `guard`, read as IL at `IL` harm a point, reaching its injury capacity
// (combat.tex "Injuries and Death").
export function isRuinous(view: SceneState, members: readonly string[], id: string, at: Coord | null, spentSTA: number, guard: Guard, w: SpecWeights): boolean {
  const me = view.characters[id]
  if (!me) return true
  const IL = me.injuries.injuryLevel + spentSTA * me.injuries.bleed + getThreatOn(view, members, id, at, guard, 'immediate', w) / w.IL
  return IL >= getInjuryCapacity(me)
}
