import type { CampaignCharacter } from '../types'
import type { ActionRoll, SceneState } from '../scene/types'
import { setDistance } from '../scene/rules/board/geometry'
import { getRootTest } from '../scene/rules/attack'
import { getOpenAction } from '../scene/rules/log'
import { getSettled } from '../scene/rules/settle'
import { resolveTest } from '../play/test'
import { getOutcomes } from '../scene/projections/outcomes'
import { getLiveFoes, getSide, isOnSide, type Party, type Tuning } from './party'
import { getHarmTaken, getOutcomeHarm, isOutOfFight } from './harm'
import { canFight } from './reading'
import { getSideThreat } from './threat'
import { getLanded } from '../scene/rules/log'
import { getPostureCost } from '../scene/rules/move'
import { isProne } from '../scene/rules/board/ground'
import { STUN_AP } from '../tables'

// How well a state stands for a party, in harm (harm.ts), against where the
// decision began: the harm its foes took less the harm its side did (party.ts);
// what each side could do with a single attack from where it
// stands whatever AP it has, the one less the other; less the ground between
// its acting character and the nearest foe; plus the AP and STA it has left
// over its foes'; plus the AP the fight took from its foes that they did not
// spend themselves, less what it took from its own side. Higher is better.

export type Value = { total: number; wounds: number; potential: number; immediate: number; engage: number; resources: number; drained: number; exchange: number }

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

function getGap(state: SceneState, actorId: string, foes: string[]): number {
  const from = state.board?.placements[actorId]?.cell
  const there = foes.flatMap((f) => state.board?.placements[f]?.cell ?? [])
  return from && there.length > 0 ? setDistance([from], there) : 0
}

// The AP each character lost between the two states without spending it:
// "Stun: An interrupt in which the target also loses 2 AP" (combat.tex
// "Crash", and a blow that stuns), and for one who fell prone, what standing
// up again costs them (combat.tex "Prone": "Can only crawl and stand up").
export function getAPTaken(before: SceneState, after: SceneState): Map<string, number> {
  const taken = new Map<string, number>()
  const add = (id: string, AP: number) => taken.set(id, (taken.get(id) ?? 0) + AP)
  for (const action of getLanded(after).slice(getLanded(before).length)) {
    const crashes = [...(action.kind === 'move' ? action.facts?.trampled ?? [] : []), ...('trample' in action && action.trample ? [action.trample] : [])]
    crashes.forEach((t) => t.stunned.forEach((id) => add(id, STUN_AP)))
    ;(action.results ?? []).forEach((r) => add(r.targetId, r.outcome.apLoss))
  }
  for (const [id, c] of Object.entries(after.characters)) {
    if (before.characters[id] && !isProne(before, id) && isProne(after, id) && !isOutOfFight(c)) add(id, getPostureCost(c, 'stand').AP)
  }
  return taken
}

export function evaluate(state: SceneState, party: Party, actorId: string, tuning: Tuning, start: SceneState): Value {
  const foes = getLiveFoes(state, party).filter((id) => canFight(state, id) && !isOutOfFight(state.characters[id]))
  const side = getSide(state, party)
  const taken = (ids: readonly string[]) => ids.reduce((total, id) => total + getHarmTaken(start, state, id), 0)
  const wounds = taken(Object.keys(start.characters).filter((id) => !isOnSide(start, party, id))) - taken(getSide(start, party))
  const potential = tuning.potential > 0 ? tuning.potential * (getSideThreat(state, side, foes, 'potential', tuning) - getSideThreat(state, foes, side, 'potential', tuning)) : 0
  const immediate = tuning.immediate > 0 ? -tuning.immediate * getSideThreat(state, foes, [actorId], 'immediate', tuning) : 0
  const engage = tuning.engage * getGap(state, actorId, foes)
  const left = (ids: readonly string[], pick: (c: CampaignCharacter) => number) => ids.reduce((total, id) => total + (state.characters[id] ? pick(state.characters[id]) : 0), 0)
  const ap = (c: CampaignCharacter) => c.resources.AP
  const sta = (c: CampaignCharacter) => c.resources.STA
  const resources = tuning.ap * (left(side, ap) - left(foes, ap)) + tuning.sta * (left(side, sta) - left(foes, sta))
  const lost = getAPTaken(start, state)
  const drained = tuning.drain * [...lost].reduce((sum, [id, AP]) => sum + (isOnSide(start, party, id) ? -AP : AP), 0)
  return { total: wounds + potential + immediate - engage + resources + drained, wounds, potential, immediate, engage, resources, drained, exchange: 0 }
}
