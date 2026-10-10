import type { CampaignCharacter } from '../../types'
import type { SceneState } from '../types'
import type { Term } from '../../character/rules/terms'
import { AFFLICTIONS, CHASE_PARTIAL_COVER_REFLEX, CHASE_ROUND_SECONDS, CHASE_TIER_METRES, ROUND_AP, ROUND_SECONDS, SKIRMISH_APPROACH_AP, SKIRMISH_SECONDS, SKIRMISH_SHOOT_AP, SKIRMISH_SHOOTER_AP, SURGES } from '../../tables'
import { CHASE_TIERS, type ChaseSide, type ChaseTier, type SkirmishStance } from '../../lists'
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
// not have STA to run, when they decide to turn around and face the pursuer,
// or when it ends a round with any mobility affliction while in combat range"
// — lacking STA only in combat range too, where running is a dash on the
// movement surge's STA. Each member who would end it, and why.
export function getCaught(state: SceneState): { id: string; reason: string }[] {
  const chase = state.chase
  if (!chase || chase.escaped) return []
  return getRunners(state, 'quarry').flatMap((c) => {
    const name = getFightName(state, c.id)
    if (chase.turned.includes(c.id)) return [{ id: c.id, reason: `${name} turned around` }]
    if (chase.tier !== 'combat') return []
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
  const started = { ...state, chase: { quarry, tier, run: null, escaped: false, turned: [], stances: {}, cover: {} } }
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
  if (Object.keys(chase.stances).length > 0) return 'a skirmish is being fought this round'
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
  if (Object.keys(state.chase.stances).length > 0) return SKIRMISH_SECONDS
  return CHASE_ROUND_SECONDS[state.chase.run?.tier ?? state.chase.tier]
}

// combat.tex "Routing": in combat range "the pursuers have +2 bonus to all
// uses of strike, accuracy and cunning".
export function getRoutingTerms(state: SceneState, id: string): Term[] {
  const chase = state.chase
  return chase && !chase.escaped && chase.tier === 'combat' && getChaseSide(state, id) === 'pursuers' ? [{ label: 'routing', value: 2 }] : []
}

// The metres between two characters on opposite sides of a chase past combat
// range; null for everyone else, whose distance is the board's, if any.
export function getChaseDistance(state: SceneState, a: string, b: string): number | null {
  const chase = state.chase
  if (!chase || chase.tier === 'combat' || getChaseSide(state, a) === getChaseSide(state, b)) return null
  return CHASE_TIER_METRES[chase.tier]
}

// combat.tex "Cover": "If a character has cover, they can decide not to
// leave it and stay untargetable, but then they cannot target any enemy" —
// whether either of the two stays in cover from the other's side.
export function isSheltered(state: SceneState, a: string, b: string): boolean {
  const cover = state.chase?.cover ?? {}
  return getChaseSide(state, a) !== getChaseSide(state, b) && (cover[a] === 'total' || cover[b] === 'total')
}

// combat.tex "Cover": partial cover's bonus to the character's reflexes.
export function getChaseCoverTerms(state: SceneState, id: string): Term[] {
  return state.chase?.cover[id] === 'partial' ? [{ label: 'cover', value: CHASE_PARTIAL_COVER_REFLEX }] : []
}

// combat.tex "Skirmish": "This stage can only happen at Shooting distance",
// chosen at the beginning of the round in place of running; each side's
// stance once, the round's run not made.
export function getStanceBar(state: SceneState, side: ChaseSide): string | null {
  const chase = state.chase
  if (!chase) return 'there is no chase'
  if (chase.tier !== 'shooting') return 'a skirmish is fought only at shooting range'
  if (chase.stances[side]) return 'the side has chosen'
  const bar = getRunBar(state)
  return bar === 'a skirmish is being fought this round' ? null : bar
}

// combat.tex "Skirmish": the AP each side has for the round once both have
// chosen — 12 each when both shoot; 6 for whoever approaches, and for the
// shooters what the slowest approacher's running speed leaves them.
export function getSkirmishAP(state: SceneState, side: ChaseSide): number | null {
  const stances = state.chase?.stances
  const other: ChaseSide = side === 'quarry' ? 'pursuers' : 'quarry'
  if (!stances?.[side] || !stances[other]) return null
  if (stances[side] === 'approach') return SKIRMISH_APPROACH_AP
  if (stances[other] === 'shoot') return SKIRMISH_SHOOT_AP
  const slowest = Math.min(...getRunners(state, other).map(getRunMovement))
  return SKIRMISH_SHOOTER_AP.find((row) => slowest >= row.speed)!.AP
}

// The round's AP traded for a skirmish's, keeping what was owed into it
// (combat.tex "End of the round": "reset to 8 AP minus any negative AP").
export function getSkirmishAPOf(c: CampaignCharacter, AP: number): number {
  return AP + c.resources.AP - ROUND_AP
}

// combat.tex "Skirmish": "At the end, both teams will be in combat range"
// when anyone approached.
export function isClosingSkirmish(stances: Partial<Record<ChaseSide, SkirmishStance>>): boolean {
  return Object.values(stances).includes('approach') && Object.keys(stances).length === 2
}
