import type { CampaignCharacter } from '../types'
import type { ActionRoll, CombatState } from '../combat/types'
import { setDistance } from '../combat/geometry'
import { getRootTest } from '../combat/rules/attack'
import { getOpenAction } from '../combat/rules/log'
import { getSettled } from '../combat/rules/settle'
import { resolveTest } from '../combat/rules/test'
import { getOutcomes } from '../combat/projections/outcomes'
import { answerOpen } from './answer'
import { getLiveFoes, isMember, isStanding, type Party, type Tuning } from './party'
import { aimStrike, getStrikes } from './weapons'

// How well a state stands for a party, in fractions of a character's way to
// death: the wounds its foes carry less the wounds its own do, less what the
// foes could still do to it from here, less the ground between its acting
// character and the nearest foe, plus the AP and STA it has left over its
// foes'. Higher is better.

export type Value = { total: number; wounds: number; threat: number; engage: number; resources: number }

const FACES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]

function fraction(c: CampaignCharacter): number {
  return Math.min(1, c.injuries.injuryLevel / c.injuries.deathThreshold)
}

// What the attack waiting on its die, locked and answered as it stands, takes
// from its target on average over the die: the preview the panel shows
// (rules/settle.ts `getSettled`), once for each degree the die can give.
function expectedLoss(state: CombatState, targetId: string): number {
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
function strongestStrike(state: CombatState, party: Party, foeId: string, newId: () => string): number {
  const foeTurn = { ...state, inTurnCharacter: foeId }
  const hardest = new Map<string, { locked: CombatState; target: string; loss: number }>()
  for (const kind of ['strike', 'shoot'] as const) {
    for (const strike of getStrikes(foeTurn, foeId, kind, newId)) {
      for (const target of strike.targets.filter((t) => isMember(party, t) && isStanding(state, t))) {
        const locked = aimStrike(strike, target)
        const loss = expectedLoss(locked, target)
        const key = `${kind} ${target}`
        if (loss > (hardest.get(key)?.loss ?? -1)) hardest.set(key, { locked, target, loss })
      }
    }
  }
  const answered = [...hardest.values()].map(({ locked, target }) => expectedLoss(answerOpen(locked, party, getOpenAction(locked)!, newId) ?? locked, target))
  return Math.max(0, ...answered)
}

function getThreat(state: CombatState, party: Party, newId: () => string): number {
  return getLiveFoes(state, party).reduce((sum, foe) => sum + strongestStrike(state, party, foe, newId), 0)
}

function getGap(state: CombatState, actorId: string, foes: string[]): number {
  const from = state.board?.placements[actorId]?.cell
  const there = foes.flatMap((f) => state.board?.placements[f]?.cell ?? [])
  return from && there.length > 0 ? setDistance([from], there) : 0
}

export function evaluate(state: CombatState, party: Party, actorId: string, tuning: Tuning, newId: () => string): Value {
  const foes = getLiveFoes(state, party)
  const sum = (ids: readonly string[]) => ids.reduce((total, id) => total + (state.characters[id] ? fraction(state.characters[id]) : 0), 0)
  const wounds = sum(foes) - sum(party.members)
  const threat = tuning.threat * getThreat(state, party, newId)
  const engage = tuning.engage * getGap(state, actorId, foes)
  const left = (ids: readonly string[], pick: (c: CampaignCharacter) => number) => ids.reduce((total, id) => total + (state.characters[id] ? pick(state.characters[id]) : 0), 0)
  const ap = (c: CampaignCharacter) => c.resources.AP + c.resources.surgeAP
  const sta = (c: CampaignCharacter) => c.resources.STA
  const resources = tuning.ap * (left(party.members, ap) - left(foes, ap)) + tuning.sta * (left(party.members, sta) - left(foes, sta))
  return { total: wounds - threat - engage + resources, wounds, threat, engage, resources }
}
