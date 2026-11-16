import type { CampaignCharacter, Coord, MovementKind, Third } from '../types'
import type { SceneState } from '../scene/types'
import type { RollMode } from '../play/dice'
import { getMovementOptions, getWalkableCells } from '../scene/rules/move'
import { makeAction } from '../scene/factories'
import { coordKey, disk, distance, parseCoordKey, sameCell } from '../scene/rules/board/geometry'
import { getDistancePenalty, getShotReach } from '../character/rules/gear'
import { getSTA } from '../character/rules/characteristics'
import { getMovementBlock } from '../character/rules/movement'
import { MOVEMENT_KINDS } from '../lists'
import { canSurge, getSurgeAP, getSurgeSTA } from '../character/rules/surge'
import { ROUND_AP } from '../tables'
import { getPair, harmOf, type PairAttack, type PairDefence } from './pairs'
import { getExpectedHarm } from './odds'
import { getSides, isDown } from './table'
import { getOpportunityWorth, getStandingOpportunityWorth } from './approach'
import { getWeaponRows, isRowUsable } from '../scene/rules/weaponRow'
import { getReach } from '../scene/rules/board/board'
import { isMeleeRange } from '../weaponProperties'

// The threat one character puts on another (the user's rulings, 2026-11-14):
// the harm of one attack times its chance, against the defence the target
// would answer with, with what the attack and the move to it cost kept apart
// so they can be weighed where the threat is used.
//
// Potential threat is threat at all: one attack after fresh rounds of
// movement (8 AP and the movement surge each), counted in full when it can be
// made in one round and damped by `ring2` for every round more it takes, a
// part of a round counting its part, so that every step closer counts.
// Immediate threat is this round's: one attack the attacker can still pay for
// with what it is believed to have left. A threat that needs a walk through
// the target's own reach, or a shot fired within it, counts the opportunity
// attack it draws against it
// (bot/approach.ts), which is the target's to make. A target that cannot be harmed even
// undefended, or not this round, is under no threat from it. A threat counts
// what the attack is worth (`getDefendedHarm`): the harm against the answer
// the target would choose and what that answer costs it.
//
// What a seat knows of a character it does not play is its face: which third
// of a round's AP and of its STA it has left, taken at the end `end` says.
// Nothing here decides; it reads.

export type ThreatTuning = {
  // what a threat counts for, for every round more than one it takes
  ring2: number
  // what spending costs a character, for any spender and anything spent on
  // (`getSpendPrice`): an AP at `AP` plus `danger` times the danger the
  // spender is left in, an STA at `STA` as `getSTAPrice` prices it
  AP: number
  STA: number
  danger: number
  // what an attack is worth more for every point of harm the defence takes
  // off (`getDefendedHarm`)
  forcing: number
  // the STA against which a pool is measured (`getSTAPrice`)
  STAScale: number
  // what a threat is worth less for every point of worth of the opportunity
  // attack its walk in draws from the target (bot/approach.ts)
  opportunity: number
  // the end of a face's third taken as what a character has left
  end: 'least' | 'most'
}

export const THREAT_TUNING: ThreatTuning = { ring2: 0.5, AP: 3, STA: 3, danger: 0.1, forcing: 0.25, STAScale: 10, opportunity: 1, end: 'least' }

export type Threat = {
  // what the attack is worth against the answer the target is believed to
  // choose (`getDefendedHarm`): the harm it takes, what it pays to defend,
  // and more the more the defence takes off
  worth: number
  // expected harm of the attack, against that answer
  harm: number
  attack: PairAttack
  defence: PairDefence
  // its harm answered with none, and what each defence leaves of it and is
  // worth (`getAnswers`)
  undefended: number
  answers: Answer[]
  // what the attack costs, and the AP of the move it needs first
  cost: { AP: number; STA: number }
  moveAP: number
  // the rounds the move and the attack take, from 1 (this round, or the next)
  rounds: number
  // the worth of the opportunity attack the walk in draws from the target
  approach: number
}

export const threatValue = (t: Threat | null, tuning: ThreatTuning = THREAT_TUNING): number => (t ? Math.max(0, t.worth - tuning.opportunity * t.approach) * tuning.ring2 ** Math.max(0, t.rounds - 1) : 0)

// The least or the most a third of `most` could hold (character/lenses/face.ts
// `thirdOf`).
export function fromThird(third: Third, most: number, end: ThreatTuning['end']): number {
  if (end === 'most') return Math.floor((most * (third + 1)) / 3)
  return third === 0 ? 0 : Math.floor((most * third) / 3) + 1
}

export type Means = { AP: number; STA: number; surge: boolean }

// What a character has left this round as the seat takes it: its own sheet
// for one it plays, the face for anyone else.
export function getMeans(c: CampaignCharacter, plays: boolean, tuning: ThreatTuning = THREAT_TUNING): Means {
  const surge = c.usedSurge === null
  if (plays || !c.shown) return { AP: c.resources.AP, STA: c.resources.STA, surge }
  return { AP: fromThird(c.shown.AP, ROUND_AP, tuning.end), STA: fromThird(c.shown.STA, getSTA(c), tuning.end), surge }
}

// A fresh round's means: the round's AP and the movement surge; STA does not
// come back with the round.
const freshMeans = (now: Means): Means => ({ AP: ROUND_AP, STA: now.STA, surge: true })

// How far the character goes and for what, at its fastest movement open: the
// metres of a block and the AP and STA a block costs, and whether it runs or
// jumps, which a braced attack answers.
type Pace = { metres: number; AP: number; STA: number; running: boolean }

const paces = new WeakMap<SceneState, Map<string, Pace | null>>()

export function getPace(state: SceneState, id: string): Pace | null {
  const byId = paces.get(state) ?? new Map<string, Pace | null>()
  paces.set(state, byId)
  if (byId.has(id)) return byId.get(id) ?? null
  const c = state.characters[id]
  const open = c ? getMovementOptions(state, c).filter((o) => o.available && o.speed > 0 && o.block.AP > 0) : []
  const best = open.reduce<(typeof open)[number] | null>((b, o) => (!b || o.speed / o.block.AP > b.speed / b.block.AP ? o : b), null)
  const pace = best ? { metres: best.speed, AP: best.block.AP, STA: best.block.STA, running: best.kind === 'run' || best.kind === 'jump' } : null
  byId.set(id, pace)
  return pace
}

// What of a sheet its walking reads (`getPace`, `walkMap`): the movements
// open to it, each one's speed, block and price, and the STA it holds.
function walkingOf(state: SceneState, c: CampaignCharacter): string {
  return JSON.stringify([getMovementOptions(state, c), MOVEMENT_KINDS.map((kind) => getMovementBlock(c, kind)), c.resources.STA])
}

// The fight with `id`'s sheet replaced by `c`, where it stands as it stood
// (a change of gear): what is known of how everyone else walks is kept, since
// only `c` changed, and `c`'s own too where the change leaves its walking as
// it was (`walkingOf`); otherwise it is read anew.
export function withSheet(state: SceneState, id: string, c: CampaignCharacter): SceneState {
  const next: SceneState = { ...state, characters: { ...state.characters, [id]: c } }
  const was = state.characters[id]
  const walksAlike = !!was && walkingOf(state, was) === walkingOf(next, c)
  const keep = <T>(cache: WeakMap<SceneState, Map<string, T>>) => {
    const known = cache.get(state)
    if (known) cache.set(next, new Map([...known].filter(([key]) => walksAlike || key !== id)))
  }
  keep(paces)
  keep(stepMaps)
  return next
}

export const cellOf = (state: SceneState, id: string): Coord | null => state.board?.placements[id]?.cell ?? null

const apart = (a: Coord | null, b: Coord | null): number => (a && b ? distance(a, b) : 0)

// How many cells the character walks to each cell it can get to, counted as it
// moves (combat.tex "Movement"): around walls and bodies, on the ground it can
// stand on, as far as four fresh rounds carry it at its fastest pace. Walked at
// the walk (or the first other movement open), so the path is not bent by a
// run's turning; how fast it covers the cells is its pace's (`getPace`).
type StepMap = Map<string, number>

const MAP_ROUNDS = 4

const stepMaps = new WeakMap<SceneState, Map<string, StepMap | null>>()

export function getStepMap(state: SceneState, id: string): StepMap | null {
  const byId = stepMaps.get(state) ?? new Map<string, StepMap | null>()
  stepMaps.set(state, byId)
  if (byId.has(id)) return byId.get(id) ?? null
  const made = walkMap(state, id)
  byId.set(id, made)
  return made
}

function walkMap(state: SceneState, id: string): StepMap | null {
  const c = state.characters[id]
  const from = cellOf(state, id)
  const pace = getPace(state, id)
  if (!c || !from || !pace) return null
  const open = getMovementOptions(state, c).filter((o): o is typeof o & { kind: MovementKind } => o.available && o.speed > 0 && o.block.AP > 0 && o.kind !== 'jump')
  const walk = open.find((o) => o.kind === 'walk') ?? open[0]
  if (!walk) return null
  const metres = MAP_ROUNDS * (ROUND_AP + getSurgeAP('movement')(c)) * (pace.metres / pace.AP)
  const AP = Math.ceil(metres / walk.speed) * walk.block.AP
  const rich: SceneState = { ...state, characters: { ...state.characters, [id]: { ...c, resources: { ...c.resources, AP, STA: Math.max(c.resources.STA, Math.ceil(metres / walk.speed) * walk.block.STA) } } } }
  const map: StepMap = new Map([[coordKey(from), 0]])
  for (const r of getWalkableCells(rich, makeAction('move', { id: 'step-map', actorId: id, movement: walk.kind }))) {
    const key = coordKey(r.cell)
    if (!map.has(key) || r.steps < map.get(key)!) map.set(key, r.steps)
  }
  return map
}

// The most cells the map walks to anywhere.
const edges = new WeakMap<StepMap, number>()

function mapEdge(map: StepMap): number {
  let edge = edges.get(map)
  if (edge === undefined) {
    edge = 0
    for (const steps of map.values()) if (steps > edge) edge = steps
    edges.set(map, edge)
  }
  return edge
}

// The fewest cells `mover` walks, from where it stands, to stand within
// `reach` of `at`; null when it cannot get there in the rounds the map covers.
function stepsWithin(state: SceneState, mover: string, at: Coord, reach: number): number | null {
  const from = cellOf(state, mover)
  if (from && distance(from, at) <= reach) return 0
  const map = getStepMap(state, mover)
  if (!map) return null
  let fewest: number | null = null
  const r = Math.floor(reach)
  if (3 * r * (r + 1) + 1 < map.size) {
    for (const cell of disk(at, r)) {
      const steps = map.get(coordKey(cell))
      if (steps !== undefined && (fewest === null || steps < fewest)) fewest = steps
    }
    return fewest
  }
  for (const { cell, steps } of mapCells(map)) {
    if (distance(cell, at) <= reach && (fewest === null || steps < fewest)) fewest = steps
  }
  return fewest
}

// The map's cells, read once.
const cellLists = new WeakMap<StepMap, { cell: Coord; steps: number }[]>()

function mapCells(map: StepMap): { cell: Coord; steps: number }[] {
  let list = cellLists.get(map)
  if (!list) {
    list = [...map].flatMap(([key, steps]) => {
      const cell = parseCoordKey(key)
      return cell ? [{ cell, steps }] : []
    })
    cellLists.set(map, list)
  }
  return list
}

// The cells walked for `a`, standing at `from`, to come within `reach` of `d`
// standing at `at`. Walked from where `a` stands; for `a` supposed elsewhere,
// walked back from where `d` stands, the same way taken the other way round.
function closingSteps(state: SceneState, a: string, from: Coord | null, d: string, at: Coord | null, reach: number): number | null {
  if (!from || !at || !state.board) return 0
  if (distance(from, at) <= reach) return 0
  const straight = Math.max(0, distance(from, at) - reach)
  const here = cellOf(state, a)
  const there = cellOf(state, d)
  const map = here && sameCell(here, from) ? getStepMap(state, a) : there && sameCell(there, at) ? getStepMap(state, d) : null
  if (!map) return straight
  const walked = here && sameCell(here, from) ? stepsWithin(state, a, at, reach) : stepsWithin(state, d, from, reach)
  // past what the map covers, as far as the straight line says, but never nearer than the map's edge
  return walked ?? Math.max(straight, mapEdge(map) + 1)
}

// The AP of the blocks it takes to walk `steps` cells; null when it cannot be walked.
function closingAP(pace: Pace | null, steps: number | null): number | null {
  if (steps === null) return null
  if (steps === 0) return 0
  return pace ? Math.ceil(steps / pace.metres) * pace.AP : null
}

// The attack's skill from `gap` metres: a shot's distance penalty taken off
// at the distance it is fired from, `gap` or, closed to its reach, the reach.
export function getSkillAt(attack: PairAttack, gap: number): number {
  return attack.skill - (attack.distanceRate !== null ? getDistancePenalty(attack.distanceRate, Math.min(gap, attack.reach)) : 0)
}

// Which way of throwing the attack's test counts: the way it is thrown now,
// or the one of the ways the attacker may throw it that does the most harm.
export type ModeOf = 'now' | 'best'

// The harm of the attack against a defence.
export function getHarmAgainst(attack: PairAttack, defence: PairDefence, gap: number, mode: ModeOf = 'now'): number {
  const at = (m: RollMode) => getExpectedHarm(getSkillAt(attack, gap), defence.DL, attack.grazes, m, harmOf(attack, defence))
  return mode === 'now' ? at(attack.mode) : Math.max(...attack.modes.map(at))
}

// What each defence the target could answer with leaves of the attack's harm,
// and what it is worth: the harm it takes off answering with none (the SD).
// The greater the difference, the more the defence is worth.
export type Answer = { defence: PairDefence; harm: number; value: number; affordable: boolean }

export function getAnswers(attack: PairAttack, gap: number, budget: { AP: number; STA: number }, mode: ModeOf = 'now'): { undefended: number; answers: Answer[] } {
  const none = attack.defences.find((d) => d.draft === null)
  const undefended = none ? getHarmAgainst(attack, none, gap, mode) : 0
  const answers = attack.defences.map((defence) => {
    const harm = defence === none ? undefended : getHarmAgainst(attack, defence, gap, mode)
    return { defence, harm, value: undefended - harm, affordable: defence.cost.AP <= budget.AP && defence.cost.STA <= budget.STA }
  })
  return { undefended, answers }
}

// The price of resources, the one each is priced at whoever spends or gains
// them and on whatever, weighed by the tuning's `AP`, `danger` and `STA`.

// What `AP` AP cost one left in `danger` by spending them (the user's ruling:
// every AP spent costs something, more the more threatened the spender is
// left): each at `AP` plus `danger` times the danger.
export function getAPPrice(AP: number, danger: number, tuning: ThreatTuning = THREAT_TUNING): number {
  return Math.max(0, AP) * (tuning.AP + tuning.danger * danger)
}

// What `spent` STA cost one holding `held`, at `STA` for each: dearer the
// less would be left, so that a small pool, or one run down, is spent
// sparingly; and every STA spent bleeding adds its IL (combat.tex "Bleed"),
// harm to the spender. What STA gained is worth is the same price, read for
// the pool it ends in.
export function getSTAPrice(spent: number, held: number, bleed: number, tuning: ThreatTuning = THREAT_TUNING): number {
  if (spent <= 0) return 0
  return spent * (tuning.STA * tuning.STAScale / Math.max(1, held - spent) + 2 * bleed)
}

// What spending `spent` costs one holding `held` STA, bleeding `bleed`, left
// in `danger` by it: its AP (`getAPPrice`) and its STA (`getSTAPrice`).
export function getSpendPrice(spent: { AP: number; STA: number }, held: number, bleed: number, danger: number, tuning: ThreatTuning = THREAT_TUNING): number {
  return getAPPrice(spent.AP, danger, tuning) + getSTAPrice(spent.STA, held, bleed, tuning)
}

// What the danger a target is left in comes to once it has spent `spent` on
// a defence, read where it is known (`getTargetDanger`).
export type DangerAfter = (spent: { AP: number; STA: number }) => number

// The attack against the answer the target is believed to choose: of those
// it can pay for (none among them), the one that leaves it the least harm and
// price together. What the attack is worth is what the answer costs the
// target, the harm it takes and the price it pays, and more by `forcing` for
// every point of harm the defence takes off: an attack the target cannot
// leave unanswered drains it whichever way it answers (the user's ruling).
// The price is the one the target's own box pays for a defence
// (`getSpendPrice`), with the danger `dangerAfter` says it is left in; with
// none given, as inside the threats themselves, which the danger is read from,
// the danger is left unread.
export function getDefendedHarm(attack: PairAttack, gap: number, budget: { AP: number; STA: number }, mode: ModeOf = 'now', bleed = 0, tuning: ThreatTuning = THREAT_TUNING, dangerAfter?: DangerAfter): { worth: number; harm: number; defence: PairDefence; undefended: number; answers: Answer[] } | null {
  const { undefended, answers } = getAnswers(attack, gap, budget, mode)
  const cost = (a: Answer) => a.harm + getSpendPrice(a.defence.cost, budget.STA, bleed, dangerAfter && a.defence.cost.AP > 0 ? dangerAfter(a.defence.cost) : 0, tuning)
  const best = answers.filter((a) => a.affordable).reduce<Answer | null>((b, a) => (!b || cost(a) < cost(b) ? a : b), null)
  return best ? { worth: cost(best) + tuning.forcing * best.value, harm: best.harm, defence: best.defence, undefended, answers } : null
}

type Party = { state: SceneState; id: string; at: Coord | null }

// Whether the move and the attack can be paid for this round from `means`,
// with a surge only when they need one: the movement surge, which pays for
// movement only, or the combat surge, which pays for both (combat.tex "Action
// surge"), where the attacker may make it (`combat`, null where it may not: an
// afraid one may not). Neither alongside the focus surge a row needs.
function canPayNow(attack: PairAttack, moveAP: number, means: Means, surge: { AP: number; STA: number }, combat: { AP: number; STA: number } | null, focused: boolean): boolean {
  if (attack.needsFocus && !focused && !means.surge) return false
  const canSurge = means.surge && !(attack.needsFocus && !focused)
  if (moveAP + attack.cost.AP <= means.AP) return attack.cost.STA <= means.STA
  if (canSurge && Math.max(0, moveAP - surge.AP) + attack.cost.AP <= means.AP && attack.cost.STA + surge.STA <= means.STA) return true
  return canSurge && combat !== null && moveAP + attack.cost.AP <= means.AP + combat.AP && attack.cost.STA + combat.STA <= means.STA
}

// The rounds the move and the attack take from fresh rounds, a part of a
// round counting its part: each round's AP and its movement surge (not
// alongside the focus surge a row needs) go to the move, the last round's AP
// to the attack too. Null when the attack cannot be paid for in any round.
function roundsFor(attack: PairAttack, moveAP: number, means: Means, surge: { AP: number; STA: number }): number | null {
  if (attack.cost.AP > ROUND_AP || attack.cost.STA > means.STA) return null
  const each = ROUND_AP + (attack.needsFocus ? 0 : surge.AP)
  return Math.max(1, (moveAP + attack.cost.AP) / each)
}

// The combat surge the attacker may make this round, or null: the table's own
// gate (`canSurge`), which one who has made a surge, cannot pay its STA or is
// afraid fails. Counted in immediate threat only (the user's ruling).
function combatSurge(c: CampaignCharacter): { AP: number; STA: number } | null {
  return canSurge('combat')(c) ? { AP: getSurgeAP('combat')(c), STA: getSurgeSTA('combat')(c) } : null
}

// The best one attack `a` can make on `d`, against `d` defending with `guard`:
// this round's with `means`, or at all, from fresh rounds.
// The approach is priced at most at `d`'s own threat on `a` (the user's
// ruling: a foe that is no threat costs nothing to walk in on), read without
// that cap, so that the two threats do not ask each other; `capped` false reads it.
function bestAttack(a: Party, d: Party, means: Means, when: 'now' | 'potential', guard: { AP: number; STA: number }, mode: ModeOf, tuning: ThreatTuning, capped = true): Threat | null {
  const attacker = a.state.characters[a.id]
  const defender = d.state.characters[d.id]
  if (!attacker || !defender) return null
  const gap = apart(a.at, d.at)
  const pace = getPace(a.state, a.id)
  const surge = { AP: getSurgeAP('movement')(attacker), STA: getSurgeSTA('movement')(attacker) }
  const combat = when === 'now' ? combatSurge(attacker) : null
  const focused = attacker.usedSurge === 'focus'
  let cap: number | undefined
  const capOf = () => (cap ??= threatValue(getUncappedThreat(a.state, a.id, d.id, d.at, a.at, tuning), tuning))
  let best: Threat | null = null
  for (const attack of getPair(attacker, defender)) {
    if (!attack.opens.action) continue
    const moveAP = closingAP(pace, closingSteps(a.state, a.id, a.at, d.id, d.at, attack.reach))
    if (moveAP === null) continue
    const rounds = when === 'now' ? (canPayNow(attack, moveAP, means, surge, combat, focused) ? 1 : null) : roundsFor(attack, moveAP, means, surge)
    if (rounds === null) continue
    const met = getDefendedHarm(attack, gap, guard, mode, defender.injuries.bleed, tuning)
    if (!met || met.undefended <= 0) continue
    // the walk in, straight from where `a` stands to the attack's reach, and
    // a shot fired from within the target's own reach, against the target's
    // own strikes; only for an attack `a` can make with what it holds (the
    // user's ruling: from further off, what walking in draws is not yet weighed)
    const left = { AP: Math.max(0, means.AP - moveAP), STA: means.STA }
    const near = moveAP + attack.cost.AP <= means.AP
    const walkIn = near && gap > attack.reach ? getOpportunityWorth(a.state, d.id, a.id, gap, attack.reach, pace?.running ?? false, guard, left, tuning) : 0
    const drawn = walkIn + (near && attack.kind === 'shoot' ? getStandingOpportunityWorth(a.state, d.id, a.id, Math.min(gap, attack.reach), guard, left, tuning) : 0)
    const approach = capped && drawn > 0 ? Math.min(drawn, capOf()) : drawn
    const threat: Threat = { worth: met.worth, harm: met.harm, attack, defence: met.defence, undefended: met.undefended, answers: met.answers, cost: attack.cost, moveAP, rounds, approach }
    if (!best || threatValue(threat, tuning) > threatValue(best, tuning)) best = threat
  }
  return best
}

// The longest reach of the attacks the character can make with what it holds
// as it holds it (`isRowUsable`: a bow in one hand shoots nothing), in metres:
// a melee row's reach (`getReach`), a shot's (`getShotReach`).
const reaches = new WeakMap<CampaignCharacter, number>()

function getLongestReach(c: CampaignCharacter): number {
  let most = reaches.get(c)
  if (most === undefined) {
    most = getWeaponRows(c).filter((row) => isRowUsable(c, row)).reduce((m, row) => Math.max(m, isMeleeRange(row.atk.range) ? getReach(row.weapon, row.atk.range) : getShotReach(row.atk, row.weapon, c)), 0)
    reaches.set(c, most)
  }
  return most
}

// Whether `a`, from where it stands, cannot come within its longest reach of
// `at` in two rounds, so that no attack of its can reach there.
function isOutOfReach(state: SceneState, a: string, at: Coord | null): boolean {
  const c = state.characters[a]
  if (!c || !at || !state.board) return false
  return stepsWithin(state, a, at, getLongestReach(c)) === null
}

// Whether `a` has someone of another party it can reach in two rounds, other
// than `d`: a pair out of reach is left unread only while there is such a one
// to weigh instead.
const reachesOthers = new WeakMap<SceneState, Map<string, boolean>>()

function hasOtherInReach(state: SceneState, a: string, d: string): boolean {
  const byKey = reachesOthers.get(state) ?? new Map<string, boolean>()
  reachesOthers.set(state, byKey)
  const key = `${a}|${d}`
  const known = byKey.get(key)
  if (known !== undefined) return known
  const party = state.partyOf[a]
  const found = Object.keys(state.characters).some((e) => e !== a && e !== d && state.partyOf[e] !== party && !isDown(state, e) && !isOutOfReach(state, a, cellOf(state, e)))
  byKey.set(key, found)
  return found
}

// A pair not worth reading: `a`, standing where it stands, cannot reach `d`
// at `at`, and has someone else it can.
function isSkipped(state: SceneState, a: string, from: Coord | null, d: string, at: Coord | null): boolean {
  const here = cellOf(state, a)
  if (!here || !from || !sameCell(here, from)) return false
  return isOutOfReach(state, a, at) && hasOtherInReach(state, a, d)
}

// A threat asked of a state, read once: by the tuning, then by the rest of
// the question. Of `plays`, only whether it holds the two counts.
const threats = new WeakMap<SceneState, WeakMap<ThreatTuning, Map<string, Threat | null>>>()

function remembered(state: SceneState, tuning: ThreatTuning, key: string, read: () => Threat | null): Threat | null {
  let byTuning = threats.get(state)
  if (!byTuning) threats.set(state, (byTuning = new WeakMap()))
  let byKey = byTuning.get(tuning)
  if (!byKey) byTuning.set(tuning, (byKey = new Map()))
  if (byKey.has(key)) return byKey.get(key) ?? null
  const made = read()
  byKey.set(key, made)
  return made
}

const cellText = (c: Coord | null): string => (c ? coordKey(c) : '-')

// `a`'s potential threat on `d` standing at `at`, were `a` standing at
// `from`: a fresh round, then the next.
export function getPotentialThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null = cellOf(state, d), from: Coord | null = cellOf(state, a), tuning: ThreatTuning = THREAT_TUNING): Threat | null {
  return remembered(state, tuning, `potential|${a}|${plays.includes(a)}|${d}|${plays.includes(d)}|${cellText(at)}|${cellText(from)}`, () => readPotentialThreat(state, plays, a, d, at, from, tuning))
}

// `a`'s potential threat on `d` with its approach priced in full, as the cap
// on what walking in on `a` may cost `d` (`bestAttack`); read as one who does
// not play either of them would.
function getUncappedThreat(state: SceneState, a: string, d: string, at: Coord | null, from: Coord | null, tuning: ThreatTuning): Threat | null {
  return remembered(state, tuning, `uncapped|${a}|${d}|${cellText(at)}|${cellText(from)}`, () => readPotentialThreat(state, [], a, d, at, from, tuning, false))
}

function readPotentialThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null, from: Coord | null, tuning: ThreatTuning, capped = true): Threat | null {
  const ca = state.characters[a]
  const cd = state.characters[d]
  if (!ca || !cd || isSkipped(state, a, from, d, at)) return null
  const means = freshMeans(getMeans(ca, plays.includes(a), tuning))
  const guard = { AP: ROUND_AP, STA: getMeans(cd, plays.includes(d), tuning).STA }
  const by: Party = { state, id: a, at: from }
  const to: Party = { state, id: d, at }
  return bestAttack(by, to, means, 'potential', guard, 'best', tuning, capped)
}

// `a`'s immediate threat on `d` standing at `at`, defending with `guard` (what
// `d` is believed to have left, unless said).
export function getImmediateThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null = cellOf(state, d), guard?: { AP: number; STA: number }, tuning: ThreatTuning = THREAT_TUNING): Threat | null {
  return remembered(state, tuning, `immediate|${a}|${plays.includes(a)}|${d}|${plays.includes(d)}|${cellText(at)}|${guard ? `${guard.AP},${guard.STA}` : '-'}`, () => readImmediateThreat(state, plays, a, d, at, guard, tuning))
}

function readImmediateThreat(state: SceneState, plays: readonly string[], a: string, d: string, at: Coord | null, guard: { AP: number; STA: number } | undefined, tuning: ThreatTuning): Threat | null {
  const ca = state.characters[a]
  const cd = state.characters[d]
  if (!ca || !cd || isSkipped(state, a, cellOf(state, a), d, at)) return null
  const means = getMeans(ca, plays.includes(a), tuning)
  const held = guard ?? getMeans(cd, plays.includes(d), tuning)
  return bestAttack({ state, id: a, at: cellOf(state, a) }, { state, id: d, at }, means, 'now', held, 'now', tuning)
}

// The worst single foe's threat on `id` standing at `at`: the potential one,
// or this round's with `guard` left to defend.
export function getDanger(state: SceneState, members: readonly string[], id: string, kind: 'potential' | 'immediate', at: Coord | null = cellOf(state, id), guard?: { AP: number; STA: number }, tuning: ThreatTuning = THREAT_TUNING): number {
  const { foes } = getSides(state, members)
  return foes.reduce((worst, foe) => Math.max(worst, threatValue(kind === 'potential' ? getPotentialThreat(state, members, foe, id, at, cellOf(state, foe), tuning) : getImmediateThreat(state, members, foe, id, at, guard, tuning), tuning)), 0)
}

// What `target`, standing at `at` with `guard` to defend with, is left in once
// it has spent on a defence: the worst single foe's immediate threat on it, as
// its own box reads it when it answers (bot/boxes/threat.ts).
export function getTargetDanger(state: SceneState, target: string, at: Coord | null, guard: { AP: number; STA: number }, tuning: ThreatTuning = THREAT_TUNING): DangerAfter {
  return (spent) => getDanger(state, [target], target, 'immediate', at, { AP: Math.max(0, guard.AP - spent.AP), STA: Math.max(0, guard.STA - spent.STA) }, tuning)
}

// The seat's side: its members and their allies.
export const getTeam = (state: SceneState, members: readonly string[]): string[] => {
  const { mine, allies } = getSides(state, members)
  return [...mine, ...allies]
}

// How threatened a foe is: the whole team's potential threat on it.
export function getThreatened(state: SceneState, members: readonly string[], foe: string, tuning: ThreatTuning = THREAT_TUNING): number {
  return getTeam(state, members).reduce((sum, id) => sum + threatValue(getPotentialThreat(state, members, id, foe, cellOf(state, foe), cellOf(state, id), tuning), tuning), 0)
}

// How threatening a foe is: its worst potential threat on anyone of the team.
export function getThreatening(state: SceneState, members: readonly string[], foe: string, tuning: ThreatTuning = THREAT_TUNING): number {
  return getTeam(state, members).reduce((worst, id) => Math.max(worst, threatValue(getPotentialThreat(state, members, foe, id, cellOf(state, id), cellOf(state, foe), tuning), tuning)), 0)
}
