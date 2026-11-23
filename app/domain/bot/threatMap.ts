import type { Coord } from '../types'
import type { SceneState } from '../scene/types'
import { coordKey, disk, distance, sameCell } from '../scene/rules/board/geometry'
import { firesAcross, getEyes } from '../scene/rules/board/board'
import { getInjuryCapacity } from '../character/rules/afflictions'
import { getHeight } from '../character/rules/size'
import { getPair, type PairAttack } from './pairs'
import { cellOf, getHarmAgainst, getMeans, getPace, getPresence, getOpenStepMap, getStrikeCells } from './threat'
import { getSides } from './table'
import type { SpecWeights } from './cost'

// The threat of instructions/bot-spec.md "Threat": how much harm a character
// could take standing at a cell, from everyone who can attack it, read as one
// layer for every attacker (`getLayer`), each kept by itself:
//
//   immediate = 12 / (4 + the defender's AP) × harm(evasion) × (the
//               attacker's AP − the AP of the walk into the attack's reach) / 8
//   potential = harm(evasion) × (8 − the AP of that walk) / 8
//
// the most of the attacker's attacks, never below 0, with the AP each is
// believed to hold, surge AP counted as any other. The harm is what the
// attack leaves answered with an evade, always (`getThreatHarm`). The walk is
// at the attacker's fastest pace (`getPace`: a run where it can run), and goes
// no further than a fresh round's step map, walked on the ground alone
// (`meleeSteps`); a shot needs no walk where it has a line of fire within its
// reach, and has no reach anywhere else. A foe the
// seat remembers counts its presence (bot/memory.ts, fading by the round).
// Nothing here decides.

export type When = 'immediate' | 'potential'
export type Guard = { AP: number; STA: number }

// spec "Threat": a fresh round's AP, which the harm is read over, and the
// open the defender's AP leaves it: OPEN / (OPEN_FROM + its AP)
const ROUND = 8
const OPEN = 12
const OPEN_FROM = 4
// spec "Expected harm": the metres a shot is read from when no distance is given
export const SHOT_GAP = 20

// spec "Threat": the harm `attack` leaves its target, `gap` metres away,
// answered with an evade, whatever the target holds to pay for it; none where
// the attack offers no evade. The harm a decision reads compares every defence
// the target can pay for (`pickOf` and `weighDefences` in boxes/spec.ts).
const picked = new WeakMap<PairAttack, Map<number, number>>()

export function getThreatHarm(attack: PairAttack, gap: number): number {
  const byGap = picked.get(attack) ?? new Map<number, number>()
  picked.set(attack, byGap)
  const known = byGap.get(gap)
  if (known !== undefined) return known
  const defence = attack.defences.find((d) => d.draft?.kind === 'evade')
  const harm = defence ? getHarmAgainst(attack, defence, gap) : 0
  byGap.set(gap, harm)
  return harm
}

// spec "Threat": each character's share kept by itself, as a field over the
// cells around it. Its step map (threat.ts `getOpenStepMap`) is walked on the
// ground alone, as if nobody else stood there, so it is the same wherever
// anyone else stands and is walked again only when the character moves. Each
// cell of the field holds the fewest cells it walks to strike a foe standing
// there; what that is worth comes from the foe (`getReach`: its harm against
// an evade, the AP each holds), read when asked. A move of the foe's changes
// nothing in it.
//
// The fewest cells `a`, standing at `from`, walks to strike `d` standing at
// `at` with `reach`: read off `a`'s field where `a` stands, off `d`'s, walked
// back, where `d` stands, else straight.
function meleeSteps(view: SceneState, a: string, from: Coord, d: string, at: Coord, reach: number): number | null {
  const here = cellOf(view, a)
  const there = cellOf(view, d)
  const mine = here && sameCell(here, from) ? getOpenStepMap(view, a) : null
  if (mine) return inField(mine, `on|${bodyKey(view, d, at)}|${reach}`, () => fieldSteps(view, a, from, d, at, reach, () => stepsInto(mine, at, reach, getStrikeCells(view, a, d, at, reach))))
  const theirs = there && sameCell(there, at) ? getOpenStepMap(view, d) : null
  if (theirs) return inField(theirs, `by|${bodyKey(view, a, from)}|${reach}`, () => fieldSteps(view, a, from, d, at, reach, () => stepsInto(theirs, from, reach)))
  return fieldSteps(view, a, from, d, at, reach, () => Math.max(1, distance(from, at) - Math.floor(reach)))
}

const fieldSteps = (view: SceneState, a: string, from: Coord, d: string, at: Coord, reach: number, walked: () => number | null): number | null =>
  distance(from, at) <= reach && getStrikeCells(view, a, d, at, reach)(from) ? 0 : walked()

const fields = new WeakMap<object, Map<string, number | null>>()

function inField(map: object, key: string, make: () => number | null): number | null {
  let field = fields.get(map)
  if (!field) fields.set(map, (field = new Map()))
  if (field.has(key)) return field.get(key)!
  const made = make()
  field.set(key, made)
  return made
}

// What a strike reads of a body supposed standing at `at` (threat.ts
// `getStrikeCells`): its shape and height, and how it stands where it is,
// whole where `at` is its own cell. Not whose it is: a field is read alike for
// every foe of one shape.
function bodyKey(view: SceneState, id: string, at: Coord): string {
  const c = view.characters[id]
  const p = view.board?.placements[id]
  if (!c || !p) return `${id}|${coordKey(at)}`
  const shape = `${JSON.stringify(c.footprint)}|${getHeight(c)}|${p.orientation}|${p.elevation}`
  return `${coordKey(at)}|${shape}|${sameCell(p.cell, at) ? JSON.stringify(p.climb) : ''}`
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

// What may be read in place of where a character stands and the AP it holds.
export type Shift = { id: string; at?: Coord | null; AP?: number }

const shifted = (view: SceneState, plays: readonly string[], id: string, shifts: readonly Shift[], w: SpecWeights): { at: Coord | null; AP: number } => {
  const s = shifts.find((x) => x.id === id)
  const c = view.characters[id]
  return { at: s && s.at !== undefined ? s.at : cellOf(view, id), AP: s?.AP ?? (c ? getMeans(c, plays.includes(id), w).AP : 0) }
}

const reaches = new WeakMap<SceneState, WeakMap<SpecWeights, Map<string, number>>>()

// The most harm(evasion) / 8 × (AP − walk AP) of `a`'s attacks on `d`, `a`
// standing at `from` holding `AP`, `d` at `at`, against the surge `d` has
// made where it is read now.
function getReach(view: SceneState, a: string, from: Coord, d: string, at: Coord, AP: number, when: When, w: SpecWeights): number {
  const ca = view.characters[a]
  const cd = view.characters[d]
  if (!ca || !cd || AP <= 0) return 0
  let byW = reaches.get(view)
  if (!byW) reaches.set(view, (byW = new WeakMap()))
  let byKey = byW.get(w)
  if (!byKey) byW.set(w, (byKey = new Map()))
  const surge = when === 'potential' ? null : cd.usedSurge
  const key = `${a}|${coordKey(from)}|${d}|${coordKey(at)}|${AP}|${surge}`
  const known = byKey.get(key)
  if (known !== undefined) return known
  let most = 0
  for (const attack of getPair(ca, cd, surge)) {
    if (!attack.opens.action) continue
    const walk = walkAP(view, a, from, d, at, attack)
    if (walk === null || walk >= AP) continue
    const harm = getThreatHarm(attack, attack.kind === 'shoot' ? distance(from, at) : attack.reach)
    if (harm > 0) most = Math.max(most, (harm / ROUND) * (AP - walk))
  }
  const made = most * getPresence(view, a, w) * getPresence(view, d, w)
  byKey.set(key, made)
  return made
}

// `a`'s layer on `d` (see above), each where it stands holding what it is
// believed to, but as `shifts` reads it. Of `plays`, only whether it holds a
// character counts (its sheet, or its face).
export function getLayer(view: SceneState, plays: readonly string[], a: string, d: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): number {
  const by = shifted(view, plays, a, shifts, w)
  const on = shifted(view, plays, d, shifts, w)
  if (!by.at || !on.at) return 0
  if (when === 'potential') return getReach(view, a, by.at, d, on.at, ROUND, when, w)
  return (OPEN / (OPEN_FROM + Math.max(0, on.AP))) * getReach(view, a, by.at, d, on.at, by.AP, when, w)
}

// The threat of `side` on `d`: each one's layer, added up.
export function getThreatBy(view: SceneState, members: readonly string[], side: readonly string[], d: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): number {
  return side.reduce((sum, a) => sum + getLayer(view, members, a, d, when, w, shifts), 0)
}

// The foes' threat on `id`.
export function getThreatOn(view: SceneState, members: readonly string[], id: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): number {
  return getThreatBy(view, members, getSides(view, members).foes, id, when, w, shifts)
}

// Whether an option leaves the character collapsed or dead (spec "Guard"):
// the IL it stands at, the IL its bleed adds for every STA `spentSTA` spends
// (combat.tex "Bleed"), and the foes' immediate threat on it at `at` holding
// `AP`, read as IL at `IL` harm a point, reaching its injury capacity
// (combat.tex "Injuries and Death").
export function isRuinous(view: SceneState, members: readonly string[], id: string, at: Coord | null, spentSTA: number, AP: number, w: SpecWeights): boolean {
  const me = view.characters[id]
  if (!me) return true
  const IL = me.injuries.injuryLevel + spentSTA * me.injuries.bleed + getThreatOn(view, members, id, 'immediate', w, [{ id, at, AP }]) / w.IL
  return IL >= getInjuryCapacity(me)
}
