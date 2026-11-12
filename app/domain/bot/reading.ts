import type { CampaignCharacter } from '../types'
import type { RootAction, SceneState } from '../scene/types'
import { replaceActions } from '../scene/commands/log'
import { rollOrPay } from '../scene/commands/action'
import type { Dice } from '../play/dice'
import { getPayableCost } from '../scene/rules/action'
import { getAction, getLiveActions, getOpenAction } from '../scene/rules/log'
import { getRootTest } from '../scene/rules/attack'
import { getSettled } from '../scene/rules/settle'
import { getOutcomes } from '../scene/projections/outcomes'
import { resolveTest } from '../play/test'
import { isCombatStarted } from '../scene/rules/started'
import { canAfford } from '../character/rules/cost'
import { getSTA } from '../character/rules/characteristics'
import { spendBest } from './overflow'
import { getStrikeDefenses, type StrikeDefense } from './defenses'
import { getEvaluationKey, getPairKey } from './evaluation'
import { aimStrike, getStrikes } from './weapons'
import { isDead } from '../character/rules/afflictions'
import { isImmobile } from '../scene/rules/situational'
import { getOutcomeHarm, isOutOfFight } from './harm'
import { SURGES } from '../tables'

// A quick look at what an attack could do to one foe, cheap enough to be taken
// on every turn of a fight played on: the harm it takes from the foe on
// average when the foe does not answer it (against its standard deflection,
// creating.tex "Standard Deflection") and against each defense the foe could
// answer with. It is read with both sides rested; what either can pay for is
// asked of the reading when it is used, against what they have then.
//
// How often an attack hits is the skill over the DL alone (play.tex "How skills
// work": a hit is the d10, 0 to 9 and never exploding here, plus the skill over
// the DL by 5, a graze by 0, so 50% to hit when they are equal and 10 points
// more or less for each point between them). The harm of a hit and of a graze
// (harm.ts) are each read from one played out at the middle of the faces that
// give it, the overflow of a hit spent on whatever does the most (overflow.ts).
// A defense has no die: it sets the DL the attack is tested against, and so
// changes how often it hits and grazes, not what either does. What a defense
// needs is those two harms and its own chances, so it costs no die, and is read
// only when asked for, once.

export type Dealt = { harm: number; AP: number; STA: number }

// `expected` is what the attack takes from the target on average: the chance of
// a hit times the harm of one, and the chance of a graze times the harm of one
// (a graze is a miss for an attack that does not graze). `spend` is the AP and
// STA the overflow of a hit is spent with, on top of the attack. `defenses` is
// `expected` for each answer the target could make, with what it costs the
// target to make it.
export type DefenseChance = { cost: { AP: number; STA: number }; expected: number }
export type Reading = { kind: 'strike' | 'shoot'; weaponKey: string; attack: string; variant: string; cost: { AP: number; STA: number }; expected: number; spend: number; defenses: () => DefenseChance[] }

const REST_AP = 99

// The attack's die at `value`, then nines for whatever else is thrown.
function scripted(value: number): Dice {
  let thrown = 0
  return () => (thrown++ === 0 ? value : 9)
}

// What the attack waiting on its die comes to when the die shows `face` (any
// number: the faces that matter to a defense that moves the DL are not only
// 0 to 9), read off the action put at `post` with that roll, without pressing
// the roll. A hit's overflow is spent at its best (overflow.ts). Where an answer
// is declared, it may be tested with a die of its own, so the roll is pressed
// as the table does.
function dealtAt(locked: SceneState, target: CampaignCharacter, face: number): Dealt {
  const open = getOpenAction(locked)
  const test = open && getRootTest(locked, open)
  if (!open || !test) return { harm: 0, AP: 0, STA: 0 }
  let ids = 0
  const answered = getLiveActions(locked).length > 1
  const posted = { ...open, roll: resolveTest(test, () => face), step: 'post' } as RootAction
  const rolled = answered ? rollOrPay(scripted(face), () => `reading${++ids}`)(locked) : replaceActions(locked, [posted])
  const rolledOpen = answered ? getOpenAction(rolled) : posted
  if (rolledOpen && rolledOpen.step === 'post' && (rolledOpen.kind === 'strike' || rolledOpen.kind === 'shoot')) {
    const best = spendBest(rolled, rolledOpen, target.id)
    return { harm: getOutcomeHarm(target, best.outcome), AP: best.spend.AP, STA: best.spend.STA }
  }
  if (answered) return { harm: getOutcomeHarm(target, getAction(rolled, open.id)?.results?.find((r) => r.targetId === target.id)?.outcome ?? null), AP: 0, STA: 0 }
  return { harm: getOutcomeHarm(target, getOutcomes(rolled, getSettled(rolled, posted)).find((o) => o.id === target.id)?.outcome ?? null), AP: 0, STA: 0 }
}

// An evasive jump is read at its first landing alone: where it lands seldom
// changes what the blow does.
function firstJump(): (defense: StrikeDefense) => boolean {
  let jumped = false
  return (defense) => {
    if (defense.kind !== 'evasiveJump') return true
    if (jumped) return false
    jumped = true
    return true
  }
}

function rested(state: SceneState, ids: string[]): SceneState {
  const rest = (c: CampaignCharacter): CampaignCharacter => ({ ...c, surgeFloor: null, resources: { ...c.resources, AP: REST_AP, STA: getSTA(c) } })
  return { ...state, characters: { ...state.characters, ...Object.fromEntries(ids.map((id) => [id, rest(state.characters[id])])) } }
}

function once<T>(make: () => T): () => T {
  let made: { value: T } | null = null
  return () => (made ??= { value: make() }).value
}

// The skill over the DL the attack waiting on its die is tested with: a face
// adds to it to make the overflow of the test (play.tex "How skills work"), a hit
// at 5 and over, a graze at 0 and over.
function edgeOf(state: SceneState): { edge: number; DL: number } | null {
  const open = getOpenAction(state)
  const test = open && getRootTest(state, open)
  return test ? { edge: test.skill - test.DL, DL: test.DL } : null
}

// What the blow does depends on the overflow it comes to and the DL it was made
// against (the deflection a defense replaces), not on the die that made it. So
// the harm at each overflow is kept once for the attack, the pair of characters
// and the DL, whatever the gap or cell, and read off the attack at the die that
// gives that overflow.
const breakpointTables = new Map<string, Map<number, Dealt>>()

function breakpointsFor(key: string): Map<number, Dealt> {
  const known = breakpointTables.get(key)
  if (known) return known
  if (breakpointTables.size >= MOST_KEPT) breakpointTables.clear()
  const made = new Map<number, Dealt>()
  breakpointTables.set(key, made)
  return made
}

// A miss and a graze are each one entry whatever the overflow; a hit has one for
// each HOP it can spend.
const MISS = -1
const GRAZE = 0
const breakpoint = (reached: number) => (reached < 0 ? MISS : reached < 5 ? GRAZE : reached)

// The attack's average over the ten faces from the breakpoints, each read when
// first needed, as the attack stands (`state`: undefended, or with a defense
// declared, whose label is part of the key). A miss does no harm to a target that
// does not answer; one that does may take the blow or lose its weapon to it
// whatever the die shows, so every face is read.
function averageOver(state: SceneState, target: CampaignCharacter, key: string, label: string): { harm: number; spend: number } {
  const at = edgeOf(state)
  if (!at) return { harm: 0, spend: 0 }
  const points = breakpointsFor(`${key} ${label} ${at.DL}`)
  const answered = getLiveActions(state).length > 1
  let harm = 0
  let spend = 0
  for (let face = 0; face <= 9; face++) {
    const reached = face + at.edge
    if (reached < 0 && !answered) continue
    const point = breakpoint(reached)
    const dealt = points.get(point) ?? dealtAt(state, target, face)
    points.set(point, dealt)
    harm += dealt.harm / 10
    spend += reached >= 5 ? (dealt.AP + dealt.STA) / 10 : 0
  }
  return { harm, spend }
}

function readHit(locked: SceneState, target: CampaignCharacter, attackerId: string, newId: () => string, key: string): { expected: number; spend: number; defenses: () => DefenseChance[] } {
  const defenses = once((): DefenseChance[] => getStrikeDefenses(locked, target.id, attackerId).filter(firstJump()).flatMap((defense): DefenseChance[] => {
    const declared = defense.declare(locked, getOpenAction(locked)!, newId)
    return declared ? [{ cost: defense.cost, expected: averageOver(declared, target, key, `${defense.kind} ${defense.cost.AP}/${defense.cost.STA}`).harm }] : []
  }))
  const unanswered = averageOver(locked, target, key, 'none')
  return { expected: unanswered.harm, spend: unanswered.spend, defenses }
}

// The ids a reading makes are its own, so that reading never changes the ids
// the table gives out after it. Every attack the attacker has on the target as
// they stand, both rested.
export function readAttacks(state: SceneState, attackerId: string, targetId: string): Reading[] {
  let ids = 0
  const newId = () => `read${++ids}`
  const target = state.characters[targetId]
  if (!target || !state.characters[attackerId]) return []
  const fresh = rested(state, [attackerId, targetId])
  const pair = getPairKey(state, attackerId, targetId)
  return (['strike', 'shoot'] as const).flatMap((kind) => getStrikes(fresh, attackerId, kind, newId)
    .filter((strike) => strike.targets.includes(targetId))
    .map((strike): Reading => {
      const locked = aimStrike(strike, targetId)
      const priced = getPayableCost(locked, strike.open)
      return { kind, weaponKey: strike.open.weaponKey, attack: strike.open.attack, variant: strike.open.variant, cost: { AP: priced?.AP ?? 0, STA: priced?.STA ?? 0 }, ...readHit(locked, target, attackerId, newId, `${pair} ${kind} ${strike.open.weaponKey} ${strike.open.attack} ${strike.open.variant}`) }
    }))
}

// Readings are kept under what they are made of: what both characters carry,
// the gap between them, their grapples and the catalogs (evaluation.ts
// `getEvaluationKey`), on a board's ground, its levels and its pieces as they
// stand, each of which is replaced, never changed, when the board is. A
// reading is the same whenever these are, so it is made once. Other
// characters' bodies in the way are not part of it.
const NO_BOARD = {}
const MOST_KEPT = 5000
const kept = new WeakMap<object, WeakMap<object, WeakMap<object, Map<string, Reading[]>>>>()

function keptFor(state: SceneState): Map<string, Reading[]> {
  const board = state.board
  const [terrain, levels, pieces] = board ? [board.terrain, board.levels, board.pieces] : [NO_BOARD, NO_BOARD, NO_BOARD]
  const byLevels = kept.get(terrain) ?? new WeakMap()
  kept.set(terrain, byLevels)
  const byPieces = byLevels.get(levels) ?? new WeakMap()
  byLevels.set(levels, byPieces)
  const readings = byPieces.get(pieces) ?? new Map<string, Reading[]>()
  byPieces.set(pieces, readings)
  return readings
}

// Whether the character can attack at all: alive, and not immobile (combat.tex
// "Immobile": "cannot use any combat or movement skills other than escape").
// Readings are made rested, so what keeps one from fighting is asked here.
export function canFight(state: SceneState, id: string): boolean {
  const c = state.characters[id]
  return !!c && !isDead(c) && !isImmobile(state, c)
}

export function getReadings(state: SceneState, attackerId: string, targetId: string): Reading[] {
  if (!canFight(state, attackerId) || !state.characters[targetId]) return []
  const readings = keptFor(state)
  const key = `${state.board?.light ?? ''} ${getEvaluationKey(state, attackerId, targetId)}`
  const known = readings.get(key)
  if (known) return known
  if (readings.size >= MOST_KEPT) readings.clear()
  const made = readAttacks(state, attackerId, targetId)
  readings.set(key, made)
  return made
}

export function canPay(state: SceneState, c: CampaignCharacter, cost: { AP: number; STA: number }): boolean {
  return canAfford(c, cost, isCombatStarted(state))
}

// What the attack adds on average when nothing answers it.
export function getUnanswered(reading: Reading): number {
  return reading.expected
}

// What the attack adds on average, the foe answering with the defense it can
// pay for that leaves the least, or with none.
export function getAnswered(state: SceneState, reading: Reading, target: CampaignCharacter): { harm: number; defended: boolean } {
  const answers = reading.defenses().filter((d) => canPay(state, target, d.cost)).map((d) => d.expected)
  return answers.length === 0 ? { harm: reading.expected, defended: false } : { harm: Math.min(reading.expected, ...answers), defended: true }
}

// What the attack costs with the overflow of a hit spent.
export function getSpentCost(reading: Reading): number {
  return reading.cost.AP + reading.cost.STA + reading.spend
}

export type Best = { reading: Reading; harm: number; unanswered: number }

// Of these readings, the attack the attacker can pay for that adds the most to
// the target as the target would answer it; null when there is none.
export function getBestOf(state: SceneState, readings: readonly Reading[], attacker: CampaignCharacter, target: CampaignCharacter): Best | null {
  let best: Best | null = null
  for (const reading of readings) {
    if (!canPay(state, attacker, reading.cost)) continue
    const harm = getAnswered(state, reading, target).harm
    if (!best || harm > best.harm) best = { reading, harm, unanswered: reading.expected }
  }
  return best
}

// The same over every attack the attacker has on the target as they stand.
export function getBestReading(state: SceneState, attackerId: string, targetId: string): Best | null {
  const attacker = state.characters[attackerId]
  const target = state.characters[targetId]
  return attacker && target ? getBestOf(state, getReadings(state, attackerId, targetId), attacker, target) : null
}

// What the defenses `members` can pay for are worth as they stand, in harm
// (harm.ts): for each of them and each foe that
// could attack it from where it stands, what the defense that leaves the least
// takes off the foe's best attack on it.
export function getDefenseWorth(state: SceneState, members: readonly string[], foes: readonly string[]): number {
  let saved = 0
  for (const id of members) {
    const c = state.characters[id]
    if (isOutOfFight(c)) continue
    for (const foe of foes) {
      const best = getBestReading(state, foe, id)
      if (best) saved += best.unanswered - best.harm
    }
  }
  return saved
}

// Whether the character could pay for an answer costing `cost`: with what it
// has, or with a reaction surge it has not yet made this round (combat.tex
// "Action surge": "Reaction surge: 2 STA to gain 4 AP, but can only use
// reactions").
export function canAnswer(state: SceneState, c: CampaignCharacter, cost: { AP: number; STA: number }): boolean {
  if (canPay(state, c, cost)) return true
  if (c.usedSurge !== null) return false
  const surged = { ...c, resources: { ...c.resources, AP: c.resources.AP + SURGES.reaction.AP(), STA: c.resources.STA - SURGES.reaction.STA } }
  return surged.resources.STA >= 0 && canPay(state, surged, cost)
}

// combat.tex "Opportunity Attack": what the foes in melee reach could do to
// `id` with an opportunity attack on an action that draws one (a shot, which
// needs concentration), each with the hardest blow it could pay for, a
// reaction surge counted, in harm.
export function getDrawnByAction(state: SceneState, id: string, foes: readonly string[]): number {
  const me = state.characters[id]
  if (!me) return 0
  return foes.reduce((sum, foe) => {
    const c = state.characters[foe]
    if (!c || isDead(c)) return sum
    const blows = getReadings(state, foe, id).filter((r) => r.kind === 'strike' && canAnswer(state, c, r.cost)).map(getUnanswered)
    return sum + Math.max(0, ...blows)
  }, 0)
}
