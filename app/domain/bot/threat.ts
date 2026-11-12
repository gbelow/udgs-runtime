import type { SceneState } from '../scene/types'
import { setDistance } from '../scene/rules/board/geometry'
import { getSTA } from '../character/rules/characteristics'
import { ROUND_AP } from '../tables'
import { isOutOfFight } from './harm'
import { costOf, getWalks, standingAt, type Walk } from './position'
import { canFight, getHits } from './reading'

// How much a foe threatens a character: the most its best attack is worth per
// point of cost.
//
//   threat = chance to hit x harm of a hit / cost
//
// The chance to hit is the skill difference (reading.ts `readHit`) and the harm
// of a hit the weight of the wound it deals (harm.ts), against a character that
// does not answer. Cost is the attack's AP and STA plus the walk the foe makes
// first to reach the character, by basic movement with the AP of a rested
// round. A foe out of the fight, or unable to fight, threatens no one, and nor
// does anyone threaten a character out of it.
export function getThreat(state: SceneState, foeId: string, targetId: string, newId: () => string): number {
  const foe = state.characters[foeId]
  const target = state.characters[targetId]
  const origin = state.board?.placements[foeId]
  const cell = state.board?.placements[targetId]?.cell
  if (!foe || !target || !origin || !cell || isOutOfFight(foe) || isOutOfFight(target) || !canFight(state, foeId)) return 0
  const rested: SceneState = { ...state, inTurnCharacter: foeId, characters: { ...state.characters, [foeId]: { ...foe, surgeFloor: null, resources: { ...foe.resources, AP: ROUND_AP, STA: getSTA(foe) } } } }
  const here: Walk = { movement: 'basic', to: { cell: origin.cell, steps: 0, cost: { AP: 0, STA: 0 }, path: [] }, at: origin }
  const walks = [here, ...getWalks(rested, foeId, [cell], newId).filter((w) => w.movement === 'basic')]
  let threat = 0
  for (const walk of walks) {
    if (setDistance([walk.to.cell], [cell]) === 0) continue
    const standing = standingAt(rested, foeId, walk.at, walk.to.cost)
    for (const hit of getHits(standing, foeId, targetId)) {
      threat = Math.max(threat, (hit.hitChance * hit.hitHarm) / Math.max(1, costOf(walk.to) + hit.cost.AP + hit.cost.STA))
    }
  }
  return threat
}
