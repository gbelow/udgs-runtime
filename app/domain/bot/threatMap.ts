import type { CampaignCharacter, Coord, SurgeKind } from '../types'
import type { Board, SceneState } from '../scene/types'
import { cellNumber, coordKey, disk, distance, sameCell } from '../scene/rules/board/geometry'
import { firesAcross, getEyes, placeAt } from '../scene/rules/board/board'
import { canStandAt } from '../scene/rules/board/ground'
import { isDown } from '../scene/rules/fight'
import { getInjuryCapacity } from '../character/rules/afflictions'
import { getHeight } from '../character/rules/size'
import { getSurgeAP } from '../character/rules/surge'
import { ROUND_AP } from '../tables'
import { getPair, type PairAttack } from './pairs'
import { getDefended, getUndefendedHarm } from './harm'
import { cellOf, getBelievedAP, getPace, getCarriedMetres, getPaceAt, getPresence, getOpenStepMap, getRouteAP, getStrikeCells, isWetAt } from './threat'
import type { SpecWeights } from './cost'

// The threat, the price of AP and the exposure of instructions/bot-spec.md
// "Threat" and "Cost and exposure". The threat of one character on another is
// the harm of its best attack on it, undefended, as many times as the AP it
// has left once it has walked there pays for, read as a fraction
// (`getThreat`): the most, over its attacks, of
//
//   harm / the attack's AP × (the AP it holds − the AP of the walk)
//
// so that nothing turns on an AP more or less. Immediate reads the AP each
// holds, surge AP counted as any other, and potential a fresh round's; to
// either the surge it may still make that leaves it the most (`getLeft`).
//
// The harm per AP is read off a pair of fighters once, and for a shot by the
// metres away, so a cell reads only the AP of the walk to each reach: the
// fewest cells to it (`meleeSteps`), or to a line of fire (`shotWalk`). The
// metres an attack brings itself (threat.ts `getCarriedMetres`) are walked for
// nothing. The walk is at the attacker's fastest pace (`getPace`: a run where
// it can run), not rounded up to its blocks, and goes no further than a
// fresh round's step map, walked on the ground alone (`meleeSteps`); a shot
// needs no walk where it has a line of fire within its reach, and otherwise
// the walk, at a walking pace, to the nearest cell that has one (`shotWalk`,
// the user's peek, 2026-11-23). A foe the seat remembers counts its presence
// (bot/memory.ts, fading by the round). Nothing here decides.

export type When = 'immediate' | 'potential'
export type Guard = { AP: number; STA: number }

// spec "Expected harm": the metres a shot is read from when no distance is given
export const SHOT_GAP = 20

// spec "Threat": each character's share kept by itself, as a field over the
// cells around it. Its step map (threat.ts `getOpenStepMap`) is walked on the
// ground alone, as if nobody else stood there, so it is the same wherever
// anyone else stands and is walked again only when the character moves. Each
// cell of the field holds the fewest cells it walks to strike a foe standing
// there; what that is worth comes from the pair (`getProfile`, `getThreat`),
// read when asked. A move of the foe's changes nothing in it.
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

// The AP of the walk `a` makes from `from` to strike `d` at `at`, at the pace
// it has there (`getRouteAP`), null where it cannot.
function walkAP(view: SceneState, a: string, from: Coord, d: string, at: Coord, attack: PairAttack, moved: Moved): number | null {
  const board = view.board
  if (!board) return 0
  const steps = meleeSteps(view, a, from, d, at, attack.reach, moved)
  if (steps === null) return null
  const walked = steps - (isWetAt(view, a, from) ? 0 : getCarriedMetres(view, a, attack))
  return walked <= 0 ? 0 : getRouteAP(view, a, from, walked)
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
// the nearest of the cells within PEEK_BLOCKS blocks of its walk (the user's
// ruling, 2026-11-23: at a walk, never a run) that it can
// stand on and walks to in a line no wall stops; null where none has, or
// where `AP` does not pay for one block and leave some for the shot. The
// metres the shot carries (`getCarriedMetres`) come before the blocks, and
// cost nothing. Read the same from any cell, wherever `a` stands, and kept by the two cells.
export const PEEK_BLOCKS = 2
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

function shotWalk(view: SceneState, a: string, from: Coord, d: string, at: Coord, attack: PairAttack, AP: number): number | null {
  const { reach } = attack
  const board = view.board
  if (!board) return 0
  const p = board.placements[a]
  if (!p) return null
  const eyes = getEyes(view, a, d)
  if (distance(from, at) <= reach && lineOfFire(board, eyes)(from, at)) return 0
  const pace = getPaceAt(view, a, 'walk')
  const carried = getCarriedMetres(view, a, attack)
  const radius = carried + (pace && AP > pace.AP ? PEEK_BLOCKS * pace.metres : 0)
  if (radius === 0 || distance(from, at) > reach + radius) return null
  let byView = shotWalks.get(view)
  if (!byView) shotWalks.set(view, (byView = new Map()))
  const key = `${a}|${d}|${reach}|${cellNumber(from)}|${cellNumber(at)}|${carried}|${radius}`
  const known = byView.get(key)
  if (known !== undefined) return known
  let fewest: number | null = null
  // nearest first, so the first that will do is the fewest AP away
  for (const c of getPeekCells(board, eyes, from, at, reach, radius)) {
    if (!canStandAt(view, a, placeAt(board, placeAt(board, p, from), c))) continue
    const walked = distance(from, c) - carried
    fewest = walked <= 0 || !pace ? 0 : Math.ceil(walked / pace.metres) * pace.AP
    break
  }
  byView.set(key, fewest)
  return fewest
}

// What attacks made on a character come to: their harm undefended, what
// evading them all prevents of it, and the AP that takes (spec "Cost").
export type Exposure = { threat: number; prevented: number; defenceAP: number }

// The threat of one character on another, and the attack it is made of, how
// many times; null for none.
export type Threat = Exposure & { attack: PairAttack | null; gap: number; times: number }

const NO_ATTACKS: Threat = { threat: 0, prevented: 0, defenceAP: 0, attack: null, gap: 0, times: 0 }

// What an AP spent on `attack` comes to, `gap` metres away. `focus`: a shot
// the focus surge opens.
type Rate = Exposure & { attack: PairAttack; gap: number; AP: number; focus: boolean }

function rateOf(attack: PairAttack, gap: number, w: SpecWeights): Rate[] {
  const harm = getUndefendedHarm(attack, gap, w)
  if (harm <= 0 || !attack.opens.action) return []
  const defended = getDefended(attack, gap, w)
  const AP = Math.max(1, attack.cost.AP)
  return [{ threat: harm / AP, prevented: (harm - defended.harm) / AP, defenceAP: defended.AP / AP, attack, gap, AP, focus: attack.needsFocus }]
}

const timesOf = (r: Rate, AP: number): Threat => ({ threat: r.threat * AP, prevented: r.prevented * AP, defenceAP: r.defenceAP * AP, attack: r.attack, gap: r.gap, times: AP / r.AP })

// What of a threat gets through the defence met with (`getDefended`), whatever it costs.
export const getDefendedThreat = (t: Exposure): number => t.threat - t.prevented

// The best of the rates read at the same spot: of each reach, the metres it
// brings itself and whether it takes the focus surge, the one of most harm,
// and the one the defence met with leaves the most of.
function bestOf(rates: readonly Rate[]): Rate[] {
  const best = new Map<string, { most: Rate; evaded: Rate }>()
  for (const r of rates) {
    const key = `${r.focus}|${r.attack.reach}|${r.attack.carries?.movement}|${r.attack.carries?.metres}`
    const known = best.get(key)
    best.set(key, { most: known && known.most.threat >= r.threat ? known.most : r, evaded: known && getDefendedThreat(known.evaded) >= getDefendedThreat(r) ? known.evaded : r })
  }
  return [...new Set([...best.values()].flatMap((b) => [b.most, b.evaded]))]
}

const strikeRates = new WeakMap<SpecWeights, WeakMap<PairAttack[], Rate[]>>()
const shotRates = new WeakMap<SpecWeights, WeakMap<PairAttack[], Map<number, Rate[]>>>()

function getStrikeRates(pair: PairAttack[], w: SpecWeights): Rate[] {
  let byPair = strikeRates.get(w)
  if (!byPair) strikeRates.set(w, (byPair = new WeakMap()))
  let made = byPair.get(pair)
  if (!made) byPair.set(pair, (made = bestOf(pair.flatMap((a) => (a.kind === 'strike' ? rateOf(a, a.reach, w) : [])))))
  return made
}

function getShotRates(pair: PairAttack[], gap: number, w: SpecWeights): Rate[] {
  let byPair = shotRates.get(w)
  if (!byPair) shotRates.set(w, (byPair = new WeakMap()))
  let byGap = byPair.get(pair)
  if (!byGap) byPair.set(pair, (byGap = new Map()))
  let made = byGap.get(gap)
  if (!made) byGap.set(gap, (made = bestOf(pair.flatMap((a) => (a.kind === 'shoot' ? rateOf(a, gap, w) : [])))))
  return made
}

// `a`'s rates on `d`, `a` standing at `from` and `d` at `at`: for each one
// that reaches, the AP of the walk in. Whatever AP either
// holds, these are the same, so they are kept by the two cells alone; a
// shot's walk (`shotWalk`) is searched only where the AP pays for one.
type Reach = { walk: (AP: number) => number | null; rate: Rate }[]

const profiles = new WeakMap<SpecWeights, WeakMap<SceneState, Map<string, Map<number, Map<number, Reach>>>>>()

function getProfile(view: SceneState, a: string, from: Coord, d: string, at: Coord, surge: SurgeKind | null, moved: Moved, w: SpecWeights): Reach {
  let byView = profiles.get(w)
  if (!byView) profiles.set(w, (byView = new WeakMap()))
  let byPair = byView.get(view)
  if (!byPair) byView.set(view, (byPair = new Map()))
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
  if (ca && cd) {
    // one in water lies prone there, and has no evasive jump (rules/options.ts)
    const pair = getPair(ca, isWetAt(view, d, at) && !cd.afflictions.includes('prone') ? { ...cd, afflictions: [...cd.afflictions, 'prone'] } : cd, surge)
    for (const rate of getStrikeRates(pair, w)) {
      const walk = walkAP(view, a, from, d, at, rate.attack, moved)
      if (walk !== null) made.push({ walk: () => walk, rate })
    }
    for (const rate of getShotRates(pair, distance(from, at), w)) made.push({ walk: (AP) => shotWalk(view, a, from, d, at, rate.attack, AP), rate })
  }
  byAt.set(atN, made)
  return made
}

// The AP `a` has left for attacks once it has walked `walk` AP of the `held`
// it holds, or starts a fresh round with: with the surge it may still make, which shows
// on a face (the user's rulings, 2026-11-24), the combat surge paying for walk
// and attacks alike, or the movement surge for the walk alone, whichever
// leaves more. A shot the focus surge opens is made with no other surge.
function getLeft(a: CampaignCharacter, held: number, walk: number, focus: boolean, when: When): number {
  const AP = held
  const surge = when === 'potential' ? null : a.usedSurge
  if (focus) return surge === null || surge === 'focus' ? AP - walk : 0
  if (surge !== null) return AP - walk
  return Math.max(AP + getSurgeAP('combat')(a) - walk, AP - Math.max(0, walk - getSurgeAP('movement')(a)))
}

const isMoved = (shifts: readonly Shift[], id: string): boolean => shifts.some((s) => s.id === id && s.at !== undefined)

// The threat of `a` on `d` (see above), each where it stands holding what it
// is believed to, a fresh round's AP for a potential threat, but as `shifts`
// reads it. Of `plays`, only whether it holds
// a character counts (its sheet, or its face). `by`: what the attack it is made
// of is the most of, undefended unless told (`getDefendedThreat`).
export function getThreat(view: SceneState, plays: readonly string[], a: string, d: string, when: When, w: SpecWeights, shifts: readonly Shift[] = [], by: (r: Exposure) => number = (r) => r.threat): Threat {
  const from = shifted(view, plays, a, shifts, w)
  const on = shifted(view, plays, d, shifts, w)
  const ca = view.characters[a]
  const cd = view.characters[d]
  if (!from.at || !on.at || !ca || !cd) return NO_ATTACKS
  const held = when === 'potential' ? (shifts.find((s) => s.id === a)?.AP ?? ROUND_AP) : from.AP
  let most = NO_ATTACKS
  let reached = 0
  for (const { walk, rate } of getProfile(view, a, from.at, d, on.at, when === 'potential' ? null : cd.usedSurge, { a: isMoved(shifts, a), d: isMoved(shifts, d) }, w)) {
    const AP = getLeft(ca, held, 0, rate.focus, when)
    if (AP <= 0 || by(rate) * AP <= reached) continue
    const walked = walk(AP)
    const left = walked === null ? 0 : getLeft(ca, held, walked, rate.focus, when)
    if (by(rate) * left <= reached) continue
    reached = by(rate) * left
    most = timesOf(rate, left)
  }
  const share = most.threat === 0 ? 1 : getPresence(view, a, w) * getPresence(view, d, w)
  return share === 1 ? most : { ...most, threat: most.threat * share, prevented: most.prevented * share, defenceAP: most.defenceAP * share, times: most.times * share }
}

// What everyone of `side` has on `d`, added up.
export function getExposure(view: SceneState, plays: readonly string[], side: readonly string[], d: string, when: When, w: SpecWeights, shifts: readonly Shift[] = []): Exposure {
  const sum = { threat: 0, prevented: 0, defenceAP: 0 }
  for (const a of side) {
    const t = getThreat(view, plays, a, d, when, w, shifts)
    sum.threat += t.threat
    sum.prevented += t.prevented
    sum.defenceAP += t.defenceAP
  }
  return sum
}

// spec "Cost and exposure": how many of its party stand within `solitude` metres
// of `cell`, `id` among them, sharing the foes' attacks.
export function getCompany(view: SceneState, id: string, cell: Coord | null, w: SpecWeights): number {
  if (!cell) return 1
  const party = view.partyOf[id]
  return Object.keys(view.characters).reduce((n, other) => {
    const at = other !== id && view.partyOf[other] === party ? cellOf(view, other) : null
    return at && distance(at, cell) <= w.solitude && !isDown(view, other) && !view.surrendered.includes(other) ? n + 1 : n
  }, 1)
}

// spec "Cost and exposure", exposure: the harm that gets through to one holding `AP`,
// which defends its share of the attacks as far as that pays for.
export function getExposed(on: Exposure, company: number, AP: number): number {
  const covered = on.defenceAP > 0 ? Math.min(1, (AP * company) / on.defenceAP) : 1
  return (on.threat - covered * on.prevented) / company
}

// spec "Escape": the exposure that is too much, a share `courage` of the harm
// the character can still take (combat.tex "Injuries and Death"), less what it
// bleeds by the next round ("Bleed").
export function getExposureLimit(c: CampaignCharacter, w: SpecWeights): number {
  return w.courage * w.IL * Math.max(0, getInjuryCapacity(c) - c.injuries.injuryLevel) - w.IL * c.injuries.bleed
}

// spec "Strategies", "Attack": the potential threat of `a`, defended, on one it cannot
// reach in a round, once it has walked `walked` cells of the way there, the
// way read as shorter by what puts it out of reach: where it stands now is the
// edge of its potential threat.
export function getFarThreat(view: SceneState, a: string, d: string, w: SpecWeights): (walked: number) => number {
  const ca = view.characters[a]
  const cd = view.characters[d]
  const pace = getPace(view, a)
  if (!ca || !cd || !pace) return () => 0
  const pair = getPair(ca, cd, null)
  const rates = [...getStrikeRates(pair, w), ...getShotRates(pair, SHOT_GAP, w)]
  const edge = (Math.max(0, ...rates.map((r) => ROUND_AP + (r.focus ? 0 : Math.max(getSurgeAP('combat')(ca), getSurgeAP('movement')(ca))))) / pace.AP) * pace.metres
  const presence = getPresence(view, d, w)
  return (walked) => {
    const walk = (Math.max(0, edge - walked) / pace.metres) * pace.AP
    return presence * rates.reduce((most, r) => Math.max(most, getDefendedThreat(r) * getLeft(ca, ROUND_AP, walk, r.focus, 'potential')), 0)
  }
}
