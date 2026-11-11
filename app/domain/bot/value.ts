import type { CampaignCharacter } from '../types'
import type { ActionRoll, SceneState } from '../scene/types'
import { setDistance } from '../scene/rules/board/geometry'
import { getRootTest } from '../scene/rules/attack'
import { getOpenAction } from '../scene/rules/log'
import { getSettled } from '../scene/rules/settle'
import { resolveTest } from '../play/test'
import { getOutcomes } from '../scene/projections/outcomes'
import { answerOpen } from './answer'
import { getLiveFoes, getSide, isOnSide, isStanding, type Party, type Tuning } from './party'
import { aimStrike, getStrikes } from './weapons'
import { getDefenseWorth } from './reading'

// How well a state stands for a party, in fractions of a character's way to
// death: the wounds its foes carry less the wounds its side does (party.ts), less what the
// foes could still do to it from here, less the ground between its acting
// character and the nearest foe, plus the AP and STA it has left over its
// foes', plus what the defenses it can still pay for would take off the foes'
// best attacks on it, over what the foes' would take off its own. Higher is
// better.

export type Value = { total: number; wounds: number; threat: number; engage: number; resources: number; reserve: number; waiting: number; exchange: number }

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

function fraction(c: CampaignCharacter): number {
  return Math.min(1, c.injuries.injuryLevel / c.injuries.deathThreshold)
}

// What the attack waiting on its die, locked and answered as it stands, takes
// from its target on average over the die: the preview the panel shows
// (rules/settle.ts `getSettled`), once for each degree the die can give.
export function expectedLoss(state: SceneState, targetId: string): number {
  const open = getOpenAction(state)
  const target = state.characters[targetId]
  const test = open && getRootTest(state, open)
  if (!open || !test || !target) return 0
  const room = target.injuries.deathThreshold - target.injuries.injuryLevel
  const degrees = new Map<string, { faces: number; roll: ActionRoll }>()
  for (const face of FACES) {
    const roll = resolveTest(test, () => face)
    degrees.set(roll.degree, { faces: (degrees.get(roll.degree)?.faces ?? 0) + 1, roll: degrees.get(roll.degree)?.roll ?? roll })
  }
  let taken = 0
  for (const { faces, roll } of degrees.values()) {
    const hit = getOutcomes(state, getSettled(state, { ...open, roll, step: 'post' })).find((o) => o.id === targetId)
    taken += faces * (hit ? Math.min(hit.outcome.IL, room) : 0)
  }
  return taken / FACES.length / target.injuries.deathThreshold
}

// The most one foe could take from the party with a single attack from where
// it stands. Each attack is first sized as if undefended; the party's answer
// is weighed for the hardest hitting one against each of its targets.
function strongestStrike(state: SceneState, party: Party, foeId: string, newId: () => string): number {
  const foeTurn = { ...state, inTurnCharacter: foeId }
  const hardest = new Map<string, { locked: SceneState; target: string; loss: number }>()
  for (const kind of ['strike', 'shoot'] as const) {
    for (const strike of getStrikes(foeTurn, foeId, kind, newId)) {
      for (const target of strike.targets.filter((t) => isOnSide(state, party, t) && isStanding(state, t))) {
        const locked = aimStrike(strike, target)
        const loss = expectedLoss(locked, target)
        const key = `${kind} ${target}`
        if (loss > (hardest.get(key)?.loss ?? -1)) hardest.set(key, { locked, target, loss })
      }
    }
  }
  const answered = [...hardest.values()].map(({ locked, target }) => expectedLoss(answerOpen(locked, party, getOpenAction(locked)!, newId)?.state ?? locked, target))
  return Math.max(0, ...answered)
}

function getThreat(state: SceneState, party: Party, newId: () => string): number {
  return getLiveFoes(state, party).reduce((sum, foe) => sum + strongestStrike(state, party, foe, newId), 0)
}

function getGap(state: SceneState, actorId: string, foes: string[]): number {
  const from = state.board?.placements[actorId]?.cell
  const there = foes.flatMap((f) => state.board?.placements[f]?.cell ?? [])
  return from && there.length > 0 ? setDistance([from], there) : 0
}

export function evaluate(state: SceneState, party: Party, actorId: string, tuning: Tuning, newId: () => string): Value {
  const foes = getLiveFoes(state, party)
  const sum = (ids: readonly string[]) => ids.reduce((total, id) => total + (state.characters[id] ? fraction(state.characters[id]) : 0), 0)
  const side = getSide(state, party)
  const wounds = sum(foes) - sum(side)
  const threat = tuning.threat > 0 ? tuning.threat * getThreat(state, party, newId) : 0
  const engage = tuning.engage * getGap(state, actorId, foes)
  const left = (ids: readonly string[], pick: (c: CampaignCharacter) => number) => ids.reduce((total, id) => total + (state.characters[id] ? pick(state.characters[id]) : 0), 0)
  const ap = (c: CampaignCharacter) => c.resources.AP
  const sta = (c: CampaignCharacter) => c.resources.STA
  const resources = tuning.ap * (left(side, ap) - left(foes, ap)) + tuning.sta * (left(side, sta) - left(foes, sta))
  const reserve = tuning.reserve > 0 ? tuning.reserve * (getDefenseWorth(state, side, foes) - getDefenseWorth(state, foes, side.filter((id) => isStanding(state, id)))) : 0
  return { total: wounds - threat - engage + resources + reserve, wounds, threat, engage, resources, reserve, waiting: 0, exchange: 0 }
}
