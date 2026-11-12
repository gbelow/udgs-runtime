import type { CampaignCharacter } from '../types'
import type { ActionRoll, SceneState } from '../scene/types'
import { setDistance } from '../scene/rules/board/geometry'
import { getRootTest } from '../scene/rules/attack'
import { getOpenAction } from '../scene/rules/log'
import { getSettled } from '../scene/rules/settle'
import { resolveTest } from '../play/test'
import { getOutcomes } from '../scene/projections/outcomes'
import { getLiveFoes, getSide, isOnSide, isStanding, type Party, type Tuning } from './party'
import { getHarmTaken, getOutcomeHarm, isOutOfFight } from './harm'
import { canFight, getReadings, getUnanswered } from './reading'

// How well a state stands for a party, in harm (harm.ts), against where the
// decision began: the harm its foes took less the harm its side did (party.ts);
// what each side could do with a single attack from where it
// stands whatever AP it has, the one less the other; less the ground between
// its acting character and the nearest foe; plus the AP and STA it has left
// over its foes'. Higher is better.

export type Value = { total: number; wounds: number; potential: number; engage: number; resources: number; waiting: number; exchange: number }

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

// What the attack waiting on its die, locked and answered as it stands, takes
// from its target on average over the die: the preview the panel shows
// (rules/settle.ts `getSettled`), once for each degree the die can give.
export function expectedLoss(state: SceneState, targetId: string): number {
  const open = getOpenAction(state)
  const target = state.characters[targetId]
  const test = open && getRootTest(state, open)
  if (!open || !test || !target) return 0
  const degrees = new Map<string, { faces: number; roll: ActionRoll }>()
  for (const face of FACES) {
    const roll = resolveTest(test, () => face)
    degrees.set(roll.degree, { faces: (degrees.get(roll.degree)?.faces ?? 0) + 1, roll: degrees.get(roll.degree)?.roll ?? roll })
  }
  let taken = 0
  for (const { faces, roll } of degrees.values()) {
    const hit = getOutcomes(state, getSettled(state, { ...open, roll, step: 'post' })).find((o) => o.id === targetId)
    taken += faces * getOutcomeHarm(target, hit?.outcome ?? null)
  }
  return taken / FACES.length
}

// What `attackers` could do to `defenders` from where they stand, whatever AP
// they have left: for each defender and each attacker, the attacker's best
// attack on it as it would answer (reading.ts), as if both were rested, in
// fractions of its way to death.
function getPotential(state: SceneState, attackers: readonly string[], defenders: readonly string[]): number {
  let potential = 0
  for (const id of defenders) {
    const c = state.characters[id]
    if (isOutOfFight(c)) continue
    for (const attacker of attackers) {
      if (isStanding(state, attacker)) potential += Math.max(0, ...getReadings(state, attacker, id).map((r) => getUnanswered(r)))
    }
  }
  return potential
}

function getGap(state: SceneState, actorId: string, foes: string[]): number {
  const from = state.board?.placements[actorId]?.cell
  const there = foes.flatMap((f) => state.board?.placements[f]?.cell ?? [])
  return from && there.length > 0 ? setDistance([from], there) : 0
}

export function evaluate(state: SceneState, party: Party, actorId: string, tuning: Tuning, start: SceneState): Value {
  const foes = getLiveFoes(state, party).filter((id) => canFight(state, id) && !isOutOfFight(state.characters[id]))
  const side = getSide(state, party)
  const taken = (ids: readonly string[]) => ids.reduce((total, id) => total + getHarmTaken(start, state, id), 0)
  const wounds = taken(Object.keys(start.characters).filter((id) => !isOnSide(start, party, id))) - taken(getSide(start, party))
  const potential = tuning.potential > 0 ? tuning.potential * (getPotential(state, side, foes) - getPotential(state, foes, side)) : 0
  const engage = tuning.engage * getGap(state, actorId, foes)
  const left = (ids: readonly string[], pick: (c: CampaignCharacter) => number) => ids.reduce((total, id) => total + (state.characters[id] ? pick(state.characters[id]) : 0), 0)
  const ap = (c: CampaignCharacter) => c.resources.AP
  const sta = (c: CampaignCharacter) => c.resources.STA
  const resources = tuning.ap * (left(side, ap) - left(foes, ap)) + tuning.sta * (left(side, sta) - left(foes, sta))
  return { total: wounds + potential - engage + resources, wounds, potential, engage, resources, waiting: 0, exchange: 0 }
}
