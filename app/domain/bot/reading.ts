import type { CampaignCharacter } from '../types'
import type { SceneState } from '../scene/types'
import type { Dice } from '../play/dice'
import { rollOrPay } from '../scene/commands/action'
import { getPayableCost } from '../scene/rules/action'
import { getAction, getOpenAction } from '../scene/rules/log'
import { isCombatStarted } from '../scene/rules/started'
import { canAfford } from '../character/rules/cost'
import { getSTA } from '../character/rules/characteristics'
import { spendBest } from './overflow'
import { getStrikeDefenses, type StrikeDefense } from './defenses'
import { getEvaluationKey } from './evaluation'
import { aimStrike, getStrikes } from './weapons'
import { isDead } from '../character/rules/afflictions'

// A quick look at what an attack could do to one foe, cheap enough to be
// taken on every turn of a fight played on (estimate.ts weighs it all, and
// is not): the injury it adds with the die at a middling and at a high value,
// the overflow of a hit spent on whatever does the most (overflow.ts), when
// the foe does not answer it (against its standard deflection, creating.tex
// "Standard Deflection") and against each defense the foe could answer with.
// It is read with both sides rested; what either can pay for is asked of the
// reading when it is used, against what they have then.

export type Dealt = { IL: number; AP: number; STA: number }

export type DefenseReading = { kind: string; cost: { AP: number; STA: number }; low: Dealt; high: Dealt }

export type Reading = {
  kind: 'strike' | 'shoot'
  weaponKey: string
  attack: string
  variant: string
  cost: { AP: number; STA: number }
  // the IL added against the foe's SD, the die at 4 and at 9, and what
  // spending the overflow costs on top of the attack
  low: Dealt
  high: Dealt
  // the same against each defense the foe could make, rested
  defenses: DefenseReading[]
}

const LOW = 4
const HIGH = 9
const REST_AP = 99

// The attack's die at `value`, then nines for whatever else is thrown.
function scripted(value: number): Dice {
  let thrown = 0
  return () => (thrown++ === 0 ? value : HIGH)
}

function dealt(locked: SceneState, openId: string, targetId: string, die: number, room: number): Dealt {
  let ids = 0
  const rolled = rollOrPay(scripted(die), () => `reading${++ids}`)(locked)
  const open = getOpenAction(rolled)
  if (open && open.step === 'post' && (open.kind === 'strike' || open.kind === 'shoot')) {
    const best = spendBest(rolled, open, targetId)
    return { IL: Math.min(best.outcome?.IL ?? 0, room), AP: best.spend.AP, STA: best.spend.STA }
  }
  const landed = getAction(rolled, openId)?.results?.find((r) => r.targetId === targetId)?.outcome
  return { IL: Math.min(landed?.IL ?? 0, room), AP: 0, STA: 0 }
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

// The ids a reading makes are its own, so that reading never changes the ids
// the table gives out after it.
// `answered` false leaves the defenses out, for a reading of the blow alone.
export function readAttacks(state: SceneState, attackerId: string, targetId: string, answered = true): Reading[] {
  let ids = 0
  const newId = () => `read${++ids}`
  const target = state.characters[targetId]
  if (!target || !state.characters[attackerId]) return []
  const room = Math.max(0, target.injuries.deathThreshold - target.injuries.injuryLevel)
  const fresh = rested(state, [attackerId, targetId])
  return (['strike', 'shoot'] as const).flatMap((kind) => getStrikes(fresh, attackerId, kind, newId)
    .filter((strike) => strike.targets.includes(targetId))
    .map((strike): Reading => {
      const locked = aimStrike(strike, targetId)
      const openId = strike.open.id
      const priced = getPayableCost(locked, strike.open)
      const defenses = (answered ? getStrikeDefenses(locked, targetId, attackerId) : []).filter(firstJump()).flatMap((defense): DefenseReading[] => {
        const declared = defense.declare(locked, getOpenAction(locked)!, newId)
        return declared ? [{ kind: defense.kind, cost: defense.cost, low: dealt(declared, openId, targetId, LOW, room), high: dealt(declared, openId, targetId, HIGH, room) }] : []
      })
      return {
        kind,
        weaponKey: strike.open.weaponKey,
        attack: strike.open.attack,
        variant: strike.open.variant,
        cost: { AP: priced?.AP ?? 0, STA: priced?.STA ?? 0 },
        low: dealt(locked, openId, targetId, LOW, room),
        high: dealt(locked, openId, targetId, HIGH, room),
        defenses,
      }
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

// `answered` false asks for the blow alone (no defense read), which a
// reading with the defenses also answers.
export function getReadings(state: SceneState, attackerId: string, targetId: string, answered = true): Reading[] {
  if (!state.characters[attackerId] || !state.characters[targetId]) return []
  const readings = keptFor(state)
  const key = `${state.board?.light ?? ''} ${getEvaluationKey(state, attackerId, targetId)}`
  const known = readings.get(`answered ${key}`) ?? (answered ? undefined : readings.get(`alone ${key}`))
  if (known) return known
  if (readings.size >= MOST_KEPT) readings.clear()
  const made = readAttacks(state, attackerId, targetId, answered)
  readings.set(`${answered ? 'answered' : 'alone'} ${key}`, made)
  return made
}

function mean(d: { low: Dealt; high: Dealt }): number {
  return (d.low.IL + d.high.IL) / 2
}

// What the attack adds on average over its two dice when nothing answers it.
export function getUnanswered(reading: Reading): number {
  return mean(reading)
}

export function canPay(state: SceneState, c: CampaignCharacter, cost: { AP: number; STA: number }): boolean {
  return canAfford(c, cost, isCombatStarted(state))
}

// What the attack adds on average over its two dice, the foe answering with
// the defense it can pay for that leaves the least, or with none.
export function getAnswered(state: SceneState, reading: Reading, target: CampaignCharacter): { IL: number; defended: boolean } {
  const answers = reading.defenses.filter((d) => canPay(state, target, d.cost)).map(mean)
  return answers.length === 0 ? { IL: mean(reading), defended: false } : { IL: Math.min(mean(reading), ...answers), defended: true }
}

// What the attack costs with the overflow spent, over its two dice.
export function getSpentCost(reading: Reading): number {
  return reading.cost.AP + reading.cost.STA + (reading.low.AP + reading.low.STA + reading.high.AP + reading.high.STA) / 2
}

export type Best = { reading: Reading; IL: number; unanswered: number }

// Of these readings, the attack the attacker can pay for that adds the most to
// the target as the target would answer it; null when there is none.
export function getBestOf(state: SceneState, readings: readonly Reading[], attacker: CampaignCharacter, target: CampaignCharacter): Best | null {
  let best: Best | null = null
  for (const reading of readings) {
    if (!canPay(state, attacker, reading.cost)) continue
    const IL = getAnswered(state, reading, target).IL
    if (!best || IL > best.IL) best = { reading, IL, unanswered: mean(reading) }
  }
  return best
}

// The same over every attack the attacker has on the target as they stand.
export function getBestReading(state: SceneState, attackerId: string, targetId: string): Best | null {
  const attacker = state.characters[attackerId]
  const target = state.characters[targetId]
  return attacker && target ? getBestOf(state, getReadings(state, attackerId, targetId), attacker, target) : null
}

// What the defenses `members` can pay for are worth as they stand, in
// fractions of each one's way to death: for each of them and each foe that
// could attack it from where it stands, what the defense that leaves the least
// takes off the foe's best attack on it.
export function getDefenseWorth(state: SceneState, members: readonly string[], foes: readonly string[]): number {
  let saved = 0
  for (const id of members) {
    const c = state.characters[id]
    if (!c || isDead(c)) continue
    for (const foe of foes) {
      const best = getBestReading(state, foe, id)
      if (best) saved += (best.unanswered - best.IL) / c.injuries.deathThreshold
    }
  }
  return saved
}
