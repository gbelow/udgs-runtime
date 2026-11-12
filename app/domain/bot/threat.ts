import type { Coord, SceneState } from '../scene/types'
import type { ReachableCell } from '../scene/rules/move'
import { setDistance } from '../scene/rules/board/geometry'
import { getSTA } from '../character/rules/characteristics'
import { ROUND_AP } from '../tables'
import { isOutOfFight } from './harm'
import { costOf, getWalks, standingAt, type Walk } from './position'
import { canAnswer, canFight, canPay, getReadings, type Reading } from './reading'
import { getEvaluationKey } from './evaluation'
import { DEFAULT_TUNING, type Tuning } from './party'

// How much a foe threatens a character, as one number: the most its attacks
// are worth per point of cost.
//
//   threat = chance to hit x harm of a hit / cost
//
// The chance to hit is the skill difference (reading.ts `readHit`) and the harm
// of a hit the weight of the wound it deals (harm.ts), against a character that
// does not answer. Cost is the attack's AP and STA plus the walk the foe makes
// first to reach the character, by basic movement. A foe out of the fight, or
// unable to fight, threatens no one, and nor does anyone threaten a character
// out of it.
//
// `extra` is a cost paid first that the attack carries (a weapon switch).
//
// `potential` is what the foe could do with a rested round (full AP and STA,
// any attack it has). `immediate` is what it can do now, on its own turn, with
// the AP and STA it has: it walks only as far as they take it and makes only
// the attacks they still pay for after the walk.
export type ThreatKind = 'potential' | 'immediate'
export type Weights = Pick<Tuning, 'undefended' | 'forced'>

const MOST_KEPT = 5000
const NO_BOARD = {}
const kept = new WeakMap<object, WeakMap<object, WeakMap<object, Map<string, number>>>>()

// A threat is the same whenever what it is made of is: both characters and the
// gap between them (evaluation.ts), where each stands, the ground and the
// pieces on it, and for an immediate threat the AP and STA the foe has.
function keptFor(state: SceneState): Map<string, number> {
  const board = state.board
  const [terrain, levels, pieces] = board ? [board.terrain, board.levels, board.pieces] : [NO_BOARD, NO_BOARD, NO_BOARD]
  const byLevels = kept.get(terrain) ?? new WeakMap()
  kept.set(terrain, byLevels)
  const byPieces = byLevels.get(levels) ?? new WeakMap()
  byLevels.set(levels, byPieces)
  const known = byPieces.get(pieces) ?? new Map<string, number>()
  byPieces.set(pieces, known)
  return known
}

export function getThreat(state: SceneState, foeId: string, targetId: string, newId: () => string, kind: ThreatKind = 'potential', weights: Weights = DEFAULT_TUNING, extra = 0): number {
  const g=(globalThis as any).__p??={};g.threatCalls=(g.threatCalls??0)+1 //PERFPROBE
  const foe = state.characters[foeId]
  const here = state.board?.placements[foeId]?.cell
  const there = state.board?.placements[targetId]?.cell
  if (!foe || !here || !there || !state.characters[targetId]) return 0
  const known = keptFor(state)
  const resources = kind === 'immediate' ? `${foe.resources.AP} ${foe.resources.STA}` : ''
  const key = `${kind} ${weights.undefended} ${weights.forced} ${extra} ${here.q},${here.r} ${there.q},${there.r} ${resources} ${state.board?.light ?? ''} ${getEvaluationKey(state, foeId, targetId)}`
  const cached = known.get(key)
  if (cached !== undefined) return cached
  ;{const g=(globalThis as any).__p;g.threatMiss=(g.threatMiss??0)+1;g.threatSize=known.size} //PERFPROBE
  if (known.size >= MOST_KEPT) known.clear()
  const made = makeThreat(state, foeId, targetId, newId, kind, weights, extra)
  known.set(key, made)
  return made
}

// What a reading depends on is the gap to the target, so of the cells at one
// gap only the cheapest to reach is looked at.
function cheapestPerGap(target: Coord): (cells: ReachableCell[]) => ReachableCell[] {
  return (cells) => {
    const cheapest = new Map<number, ReachableCell>()
    for (const to of cells) {
      const gap = setDistance([to.cell], [target])
      const known = cheapest.get(gap)
      if (!known || costOf(to) < costOf(known)) cheapest.set(gap, to)
    }
    return [...cheapest.values()]
  }
}

// What an attack is worth to the one who makes it when nothing answers it.
export function getUnansweredWorth(hit: Reading, weights: Weights): number {
  return hit.expected * weights.undefended
}

// What an attack is worth given what the target pays to answer it: the least
// over the target's answers, since the target answers with the one that leaves
// the attacker least. Not answering counts as paying `undefended`. A defense the
// target cannot afford now is not an answer (an immediate reading); a potential
// reading lets it pay for any. An attack that does no harm but makes the target
// pay is still a threat, so no answer takes the worth below `forced` of what the
// attack is worth unanswered. No answer leaves more than the attack is worth
// unanswered, so that is the most it can come to.
export function getHitWorth(state: SceneState, hit: Reading, targetId: string, kind: ThreatKind, weights: Weights): number {
  const target = state.characters[targetId]
  const alone = getUnansweredWorth(hit, weights)
  const answers = hit.defenses().filter((d) => kind === 'potential' || canAnswer(state, target, d.cost))
  return Math.max(weights.forced * alone, Math.min(alone, ...answers.map((d) => d.expected * (d.cost.AP + d.cost.STA))))
}

function makeThreat(state: SceneState, foeId: string, targetId: string, newId: () => string, kind: ThreatKind, weights: Weights, extra: number): number {
  const foe = state.characters[foeId]
  const target = state.characters[targetId]
  const origin = state.board?.placements[foeId]
  const cell = state.board?.placements[targetId]?.cell
  if (!foe || !target || !origin || !cell || isOutOfFight(foe) || isOutOfFight(target) || !canFight(state, foeId)) return 0
  const rested: SceneState = kind === 'immediate'
    ? { ...state, inTurnCharacter: foeId }
    : { ...state, inTurnCharacter: foeId, characters: { ...state.characters, [foeId]: { ...foe, surgeFloor: null, resources: { ...foe.resources, AP: ROUND_AP, STA: getSTA(foe) } } } }
  const here: Walk = { movement: 'basic', to: { cell: origin.cell, steps: 0, cost: { AP: 0, STA: 0 }, path: [] }, at: origin }
  const walks = [here, ...getWalks(rested, foeId, [cell], newId, ['basic'], cheapestPerGap(cell))]
  let threat = 0
  for (const walk of walks) {
  const g=(globalThis as any).__p??={};g.walks=(g.walks??0)+walks.length //PERFPROBE
    if (setDistance([walk.to.cell], [cell]) === 0) continue
    const standing = standingAt(rested, foeId, walk.at, walk.to.cost)
    const cost = (hit: Reading) => Math.max(1, extra + costOf(walk.to) + hit.cost.AP + hit.cost.STA)
    // The attacks that can pay, the best unanswered first: once one cannot beat
    // the threat found, its answers are not read, and neither are the rest.
    const open = getReadings(standing, foeId, targetId)
      .filter((hit) => kind !== 'immediate' || canPay(standing, standing.characters[foeId], hit.cost))
      .map((hit) => ({ hit, most: getUnansweredWorth(hit, weights) / cost(hit) }))
      .sort((a, b) => b.most - a.most)
    for (const { hit, most } of open) {
      if (most <= threat) break
      threat = Math.max(threat, getHitWorth(standing, hit, targetId, kind, weights) / cost(hit))
    }
  }
  return threat
}

// What a side's members threaten the others with: each goes for the one it
// threatens most.
export function getSideThreat(state: SceneState, attackers: readonly string[], defenders: readonly string[], kind: ThreatKind, weights: Weights = DEFAULT_TUNING): number {
  let n = 0
  const newId = () => `threat${++n}`
  return attackers.reduce((sum, a) => sum + Math.max(0, ...defenders.map((d) => getThreat(state, a, d, newId, kind, weights))), 0)
}
