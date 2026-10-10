import type { CampaignCharacter } from '../../types'
import type { SceneState } from '../types'
import { AFFLICTIONS, CHASE_ROUND_SECONDS, ROUND_SECONDS, SURGES } from '../../tables'
import { CHASE_TIERS, type ChaseSide, type ChaseTier } from '../../lists'
import { getAfflictions, isDead } from '../../character/rules/afflictions'
import { getAGI, getSTA } from '../../character/rules/characteristics'
import { getRunMovement } from '../../character/rules/movement'
import { getSituationalAfflictions } from './situational'
import { getFightName } from './fighters'
import { getFightBusy } from './turn'

export type ChaseWay = 'close' | 'open'

// The side a character runs on: whoever is in a party running away is the
// quarry, everyone else gives chase.
export function getChaseSide(state: SceneState, id: string): ChaseSide {
  return state.chase?.quarry.includes(state.partyOf[id] ?? '') ? 'quarry' : 'pursuers'
}

// Who runs for the side: everyone on it still alive.
export function getRunners(state: SceneState, side: ChaseSide): CampaignCharacter[] {
  return Object.values(state.characters).filter((c) => !isDead(c) && getChaseSide(state, c.id) === side)
}

// combat.tex "Running": at combat range a dash, "Whoever has the highest AGI
// x running speed wins"; at longer ranges a sustained pace, "The running
// speed is STA + AGI" — the STA attribute, every penalty on both counted.
export function getRunSpeed(c: CampaignCharacter, tier: ChaseTier): number {
  return tier === 'combat' ? getAGI(c) * getRunMovement(c) : getSTA(c) + getAGI(c)
}

// combat.tex "Group chase": "use the speeds of the slowest in each group".
export function getSideSpeed(runners: CampaignCharacter[], tier: ChaseTier): number {
  return Math.min(...runners.map((c) => getRunSpeed(c, tier)))
}

// combat.tex "Catching": "The quarry is caught when one of its members does
// not have STA to run, [...] or when it ends a round with any mobility
// affliction while in combat range" — both only in combat range, where
// running is a dash on the movement surge's STA. Each member who would end
// it, and why.
export function getCaught(state: SceneState): { id: string; reason: string }[] {
  const chase = state.chase
  if (!chase || chase.escaped || chase.tier !== 'combat') return []
  return getRunners(state, 'quarry').flatMap((c) => {
    const name = getFightName(state, c.id)
    if (c.resources.STA < SURGES.movement.STA) return [{ id: c.id, reason: `${name} has no STA to run` }]
    const hobbled = getAfflictions(c, getSituationalAfflictions(state, c.id)).find((k) => AFFLICTIONS[k].category === 'mobility')
    return hobbled ? [{ id: c.id, reason: `${name} is ${hobbled}` }] : []
  })
}

// combat.tex "Escape": "The chase starts when everyone in a party decides to
// run away [...]. It always starts at the beginning of a new round. Any
// character that cannot run for whatever reason at the beginning of the
// round will prevent the chase from beginning" — whoever the chase would
// catch at once.
export function getChaseStartBar(state: SceneState, quarry: string[], tier: ChaseTier): string | null {
  if (state.chase) return 'a chase is under way'
  const busy = getFightBusy(state)
  if (busy) return busy
  if (state.turnsTaken.length > 0) return 'a chase starts at the beginning of a round'
  const started = { ...state, chase: { quarry, tier, run: null, escaped: false } }
  if (getRunners(started, 'quarry').length === 0 || getRunners(started, 'pursuers').length === 0) return 'a chase needs someone on each side'
  const caught = getCaught(started)
  return caught.length ? `cannot run: ${caught.map((c) => c.reason).join(', ')}` : null
}

// Why the round's run cannot be made now: one a round, at its beginning,
// before anyone takes a turn, with both sides on their feet.
export function getRunBar(state: SceneState): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (chase.escaped) return 'the quarry got away'
  if (state.round === 0) return 'the chase has not begun'
  if (chase.run) return 'the round has been run'
  const busy = getFightBusy(state)
  if (busy) return busy
  if (state.turnsTaken.length > 0) return 'the round is under way'
  if (getRunners(state, 'quarry').length === 0 || getRunners(state, 'pursuers').length === 0) return 'a side has nobody left to run'
  const caught = getCaught(state)
  return caught.length ? `caught: ${caught.map((c) => c.reason).join(', ')}` : null
}

// combat.tex "Running": "the fastest decides to close the distance or move
// away" — closing at combat range goes nowhere nearer.
export function getChaseWays(state: SceneState): ChaseWay[] {
  const run = state.chase?.run
  if (!run || run.chosen || run.winner === null) return []
  return state.chase!.tier === 'combat' ? ['open'] : ['close', 'open']
}

// combat.tex "Outrunning": "If the distance is already far or Horizon and the
// winner decides to increase the distance, the chase is over."
export function isOutrun(tier: ChaseTier, way: ChaseWay): boolean {
  return way === 'open' && (tier === 'far' || tier === 'horizon')
}

// One tier nearer or farther.
export function stepTier(tier: ChaseTier, way: ChaseWay): ChaseTier {
  return CHASE_TIERS[CHASE_TIERS.indexOf(tier) + (way === 'open' ? 1 : -1)]
}

// How long the round took: a fight's round, or a chase's by the tier it was
// run at (or stands at, if it was not run).
export function getRoundSeconds(state: SceneState): number {
  if (!state.chase) return ROUND_SECONDS
  return CHASE_ROUND_SECONDS[state.chase.run?.tier ?? state.chase.tier]
}
