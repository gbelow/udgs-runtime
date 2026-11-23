import type { CampaignCharacter, Coord, SurgeKind } from '../types'
import type { Board, SceneState } from '../scene/types'
import { cellNumber, coordKey, disk, distance, sameCell } from '../scene/rules/board/geometry'
import { firesAcross, getEyes, placeAt } from '../scene/rules/board/board'
import { canStandAt } from '../scene/rules/board/ground'
import { getInjuryCapacity } from '../character/rules/afflictions'
import { getHeight } from '../character/rules/size'
import { getPair, type PairAttack } from './pairs'
import { cellOf, getBelievedAP, getHarmAgainst, getPace, getPresence, getOpenStepMap, getStrikeCells } from './threat'
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
// reach, and otherwise the walk to the nearest cell that has one
// (`shotWalk`, the user's peek, 2026-11-23). A foe the
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
// answered with an evasion (an evade against a strike, combat.tex "Evade"; an
// evasion against a shot, "Evasion"), whatever the target holds to pay for
// it; none where the attack offers neither. The harm a decision reads
// compares every defence the target can pay for (`pickOf` and
// `weighDefences` in boxes/spec.ts).
const picked = new WeakMap<PairAttack, Map<number, number>>()
const EVASION = { strike: 'evade', shoot: 'evasion' } as const

export function getThreatHarm(attack: PairAttack, gap: number): number {
  const byGap = picked.get(attack) ?? new Map<number, number>()
  picked.set(attack, byGap)
  const known = byGap.get(gap)
  if (known !== undefined) return known
  const defence = attack.defences.find((d) => d.draft?.kind === EVASION[attack.kind])
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
// `at` with `reach`: read off `d`'s field, walked back, where `d` stands, to
// the cells `a` strikes it at from `from`; off `a`'s where `a` stands; else
// straight. One `moved` (read where a shift puts it, even onto its own cell)
// has its field left out, so that a cell weighed reads the same as the one it
// is weighed against, wherever the character stands.
function meleeSteps(view: SceneState, a: string, from: Coord, d: string, at: Coord, reach: number, moved: Moved): number | null {
  const here = cellOf(view, a)
  const there = cellOf(view, d)
  const theirs = !moved.d && there && sameCell(there, at) ? getOpenStepMap(view, d) : null
  if (theirs) return inField(theirs, 'by', shapeOf(view, a, from), reach, from, () => fieldSteps(view, a, from, d, at, reach, () => stepsInto(theirs, from, reach, (cell) => getStrikeCells(view, a, d, cell, reach)(from))))
  const mine = !moved.a && here && sameCell(here, from) ? getOpenStepMap(view, a) : null
  if (mine) return inField(mine, 'on', shapeOf(view, d, at), reach, at, () => fieldSteps(view, a, from, d, at, reach, () => stepsInto(mine, at, reach, getStrikeCells(view, a, d, at, reach))))
  return fieldSteps(view, a, from, d, at, reach, () => Math.max(1, distance(from, at) - Math.floor(reach)))
}

// Which of the pair a shift puts at a cell.
type Moved = { a: boolean; d: boolean }

const fieldSteps = (view: SceneState, a: string, from: Coord, d: string, at: Coord, reach: number, walked: () => number | null): number | null =>
  distance(from, at) <= reach && getStrikeCells(view, a, d, at, reach)(from) ? 0 : walked()

// A map's fields, one for each way it is read (`on` a foe, walked back `by`
// one), each shape of the other body and each reach: the steps at each cell,
// by its number.
const fields = new WeakMap<object, Map<string, Map<number, number | null>>>()

function inField(map: object, way: 'on' | 'by', shape: string | null, reach: number, cell: Coord, make: () => number | null): number | null {
  if (shape === null) return make()
  let byShape = fields.get(map)
  if (!byShape) fields.set(map, (byShape = new Map()))
  const key = `${way}|${shape}|${reach}`
  let field = byShape.get(key)
  if (!field) byShape.set(key, (field = new Map()))
  const n = cellNumber(cell)
  const known = field.get(n)
  if (known !== undefined) return known
  const made = make()
  field.set(n, made)
  return made
}

// What a strike reads of a body supposed standing elsewhere (threat.ts
// `getStrikeCells`): its shape and height, how it faces and the floor it
// stands on. Not whose it is: a field is read alike for every foe of one
// shape. Null for a climber read where it climbs, whose climb a strike reads
// too: that is never kept.
const shapes = new WeakMap<SceneState, Map<string, string | null>>()

function shapeOf(view: SceneState, id: string, at: Coord): string | null {
  const p = view.board?.placements[id]
  if (p && p.climb !== null && sameCell(p.cell, at)) return null
  let byId = shapes.get(view)
  if (!byId) shapes.set(view, (byId = new Map()))
  if (byId.has(id)) return byId.get(id)!
  const c = view.characters[id]
  const made = c && p ? `${JSON.stringify(c.footprint)}|${getHeight(c)}|${p.orientation}|${p.elevation}` : null
  byId.set(id, made)
  return made
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

// The AP of the walk `a` makes from `from` to strike `d` at `at`, null where
// it cannot.
function walkAP(view: SceneState, a: string, from: Coord, d: string, at: Coord, attack: PairAttack, moved: Moved): number | null {
  const board = view.board
  if (!board) return 0
  const steps = meleeSteps(view, a, from, d, at, attack.reach, moved)
  const pace = getPace(view, a)
  return steps === null ? null : steps === 0 ? 0 : pace ? Math.ceil(steps / pace.metres) * pace.AP : null
}

// What may be read in place of where a character stands and the AP it holds.
export type Shift = { id: string; at?: Coord | null; AP?: number }

const shifted = (view: SceneState, plays: readonly string[], id: string, shifts: readonly Shift[], w: SpecWeights): { at: Coord | null; AP: number } => {
  const s = shifts.find((x) => x.id === id)
  const c = view.characters[id]
  return { at: s && s.at !== undefined ? s.at : cellOf(view, id), AP: s?.AP ?? (c ? getBelievedAP(c, plays.includes(id), w) : 0) }
}

// The AP of the walk `a`, standing at `from`, makes to a cell with a line of
// fire on `d` at `at` within `reach` metres: none where `from` has one, else
// the nearest of the cells within PEEK_BLOCKS blocks of its pace that it can
// stand on and walks to in a line no wall stops; null where none has, or
// where `AP` does not pay for one block and leave some for the shot. Read
// the same from any cell, wherever `a` stands, and kept by the two cells.
const PEEK_BLOCKS = 2
const shotWalks = new WeakMap<SceneState, Map<string, number | null>>()

// The lines of fire from cell to cell between eyes so high: the ground's alone
// (its terrain and storeys), whoever stands at their ends, so each is kept by
// the ground.
type Lines = Map<number, Map<number, boolean>>
const linesKept = new WeakMap<Board['levels'], WeakMap<Board['terrain'], Map<string, Lines>>>()

export function lineOfFire(board: Board, eyes: ReturnType<typeof getEyes>): (a: Coord, b: Coord) => boolean {
  let byTerrain = linesKept.get(board.levels)
  if (!byTerrain) linesKept.set(board.levels, (byTerrain = new WeakMap()))
  let byEyes = byTerrain.get(board.terrain)
  if (!byEyes) byTerrain.set(board.terrain, (byEyes = new Map()))
  const key = `${eyes.from}:${eyes.to}`
  let lines = byEyes.get(key)
  if (!lines) byEyes.set(key, (lines = new Map()))
  const kept = lines
  return (a, b) => {
    const toN = cellNumber(b)
    let into = kept.get(toN)
    if (!into) kept.set(toN, (into = new Map()))
    const fromN = cellNumber(a)
    let open = into.get(fromN)
    if (open === undefined) into.set(fromN, (open = firesAcross(board, [a], [b], eyes)))
    return open
  }
}

// The cells within `radius` metres of `from` with a line of fire on `at`
// within `reach` and a line to them from `from` no wall stops, nearest first:
// the ground's alone, as the lines are, found as far as they are asked for.
type Peek = { cells: Coord[]; scanned: number }
const peeksKept = new WeakMap<Board['levels'], WeakMap<Board['terrain'], Map<string, Peek>>>()

function* getPeekCells(board: Board, eyes: ReturnType<typeof getEyes>, from: Coord, at: Coord, reach: number, radius: number): Generator<Coord> {
  let byTerrain = peeksKept.get(board.levels)
  if (!byTerrain) peeksKept.set(board.levels, (byTerrain = new WeakMap()))
  let byKey = byTerrain.get(board.terrain)
  if (!byKey) byTerrain.set(board.terrain, (byKey = new Map()))
  const key = `${eyes.from}:${eyes.to}|${cellNumber(from)}|${cellNumber(at)}|${reach}|${radius}`
  let peek = byKey.get(key)
  if (!peek) byKey.set(key, (peek = { cells: [], scanned: 0 }))
  yield* peek.cells
  const around = disk(from, radius)
  const open = lineOfFire(board, eyes)
  while (peek.scanned < around.length) {
    const c = around[peek.scanned++]
    if (sameCell(c, from) || distance(c, at) > reach || !open(c, at) || !open(from, c)) continue
    peek.cells.push(c)
    yield c
  }
}

function shotWalk(view: SceneState, a: string, from: Coord, d: string, at: Coord, reach: number, AP: number): number | null {
  const board = view.board
  if (!board) return 0
  const p = board.placements[a]
  if (!p) return null
  const eyes = getEyes(view, a, d)
  if (distance(from, at) <= reach && lineOfFire(board, eyes)(from, at)) return 0
  const pace = getPace(view, a)
  if (!pace || AP <= pace.AP) return null
  const radius = PEEK_BLOCKS * pace.metres
  if (distance(from, at) > reach + radius) return null
  let byView = shotWalks.get(view)
  if (!byView) shotWalks.set(view, (byView = new Map()))
  const key = `${a}|${d}|${reach}|${cellNumber(from)}|${cellNumber(at)}`
  const known = byView.get(key)
  if (known !== undefined) return known
  let fewest: number | null = null
  // nearest first, so the first that will do is the fewest AP away
  for (const c of getPeekCells(board, eyes, from, at, reach, radius)) {
    if (!canStandAt(view, a, placeAt(board, placeAt(board, p, from), c))) continue
    fewest = Math.ceil(distance(from, c) / pace.metres) * pace.AP
    break
  }
  byView.set(key, fewest)
  return fewest
}

// `a`'s attacks on `d`, `a` standing at `from` and `d` at `at`: for each one
// that reaches and harms, the AP of the walk in and its harm(evasion) / 8.
// Whatever AP either holds, these are the same, so they are kept by the two
// cells alone, and the AP is put in only when the threat is read; so is a
// shot's walk (`shotWalk`), searched only where the AP pays for one.
type Reach = { walk: (AP: number) => number | null; harm: number }[]

const profiles = new WeakMap<SceneState, Map<string, Map<number, Map<number, Reach>>>>()

function getProfile(view: SceneState, a: string, from: Coord, d: string, at: Coord, surge: SurgeKind | null, moved: Moved): Reach {
  let byPair = profiles.get(view)
  if (!byPair) profiles.set(view, (byPair = new Map()))
  const pairKey = `${a}|${d}|${surge}|${moved.a}|${moved.d}`
  let byFrom = byPair.get(pairKey)
  if (!byFrom) byPair.set(pairKey, (byFrom = new Map()))
  const fromN = cellNumber(from)
  let byAt = byFrom.get(fromN)
  if (!byAt) byFrom.set(fromN, (byAt = new Map()))
  const atN = cellNumber(at)
  const known = byAt.get(atN)
  if (known) return known
  const made: Reach = []
  const ca = view.characters[a]
  const cd = view.characters[d]
  if (ca && cd) for (const attack of getPair(ca, cd, surge)) {
    if (!attack.opens.action) continue
    const harm = getThreatHarm(attack, attack.kind === 'shoot' ? distance(from, at) : attack.reach) / ROUND
    if (harm <= 0) continue
    if (attack.kind === 'shoot') made.push({ walk: (AP) => shotWalk(view, a, from, d, at, attack.reach, AP), harm })
    else {
      const walk = walkAP(view, a, from, d, at, attack, moved)
      if (walk !== null) made.push({ walk: () => walk, harm })
    }
  }
  byAt.set(atN, made)
  return made
}

// The most harm(evasion) / 8 x (AP - walk AP) of `a`'s attacks on `d`, `a`
// standing at `from` holding `AP`, `d` at `at`, against the surge `d` has
// made where it is read now.
function getReach(view: SceneState, a: string, from: Coord, d: string, at: Coord, AP: number, when: When, w: SpecWeights, moved: Moved): number {
  const cd = view.characters[d]
  if (!view.characters[a] || !cd || AP <= 0) return 0
  let most = 0
  for (const { walk, harm } of getProfile(view, a, from, d, at, when === 'potential' ? null : cd.usedSurge, moved)) {
    if (harm * AP <= most) continue
    const paid = walk(AP)
    if (paid !== null && paid < AP) most = Math.max(most, harm * (AP - paid))
  }
  return most === 0 ? 0 : most * getPresence(view, a, w) * getPresence(view, d, w)
}

// `a`'s layer on `d` (see above), each where it stands holding what it is
// believed to, but as `shifts` reads it. Of `plays`, only whether it holds a
// character counts (its sheet, or its face).
export function getLayer(view: SceneState, plays: readonly string[], a: string, d: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): number {
  const by = shifted(view, plays, a, shifts, w)
  const on = shifted(view, plays, d, shifts, w)
  if (!by.at || !on.at) return 0
  const moved = { a: shifts.some((s) => s.id === a && s.at !== undefined), d: shifts.some((s) => s.id === d && s.at !== undefined) }
  if (when === 'potential') return getReach(view, a, by.at, d, on.at, ROUND, when, w, moved)
  return (OPEN / (OPEN_FROM + Math.max(0, on.AP))) * getReach(view, a, by.at, d, on.at, by.AP, when, w, moved)
}

// The threat of `side` on `d`: each one's layer, added up.
export function getThreatBy(view: SceneState, members: readonly string[], side: readonly string[], d: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): number {
  return side.reduce((sum, a) => sum + getLayer(view, members, a, d, when, w, shifts), 0)
}

// The layer of each of `side` on `d`, in the order of `side`.
export type Layers = readonly number[]

export function getLayersBy(view: SceneState, members: readonly string[], side: readonly string[], d: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): Layers {
  return side.map((a) => getLayer(view, members, a, d, when, w, shifts))
}

export const sumLayers = (layers: Layers): number => layers.reduce((sum, layer) => sum + layer, 0)

// The foes' layers on `id`.
export function getLayersOn(view: SceneState, members: readonly string[], id: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): Layers {
  return getLayersBy(view, members, getSides(view, members).foes, id, when, w, shifts)
}

// spec "Cost": the change in the threat of everyone on a character, after
// less before, over the square root of how many threaten it on either side
// of the change (the user's ruling, 2026-11-23); both the layers of one side,
// in one order.
export function getCostDelta(before: Layers, after: Layers): number {
  let change = 0
  let threatening = 0
  for (let i = 0; i < after.length; i++) {
    change += after[i] - before[i]
    if (before[i] > 0 || after[i] > 0) threatening++
  }
  return threatening === 0 ? 0 : change / Math.sqrt(threatening)
}

// The foes' threat on `id`.
export function getThreatOn(view: SceneState, members: readonly string[], id: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): number {
  return getThreatBy(view, members, getSides(view, members).foes, id, when, w, shifts)
}

// Whether an option leaves the character collapsed or dead (spec "Guard"):
// the IL it stands at, the IL its bleed adds for every STA `spentSTA` spends
// (combat.tex "Bleed"), and `threat`, the foes' immediate threat on it where
// the option leaves it, read as IL at `IL` harm a point, reaching its injury capacity
// (combat.tex "Injuries and Death").
export function isRuinous(me: CampaignCharacter, spentSTA: number, threat: number, w: SpecWeights): boolean {
  const IL = me.injuries.injuryLevel + spentSTA * me.injuries.bleed + threat / w.IL
  return IL >= getInjuryCapacity(me)
}
