import type { Character } from '../../types'
import type { CombatState, Coord, StrikeAction } from '../types'
import { isSweepVariant } from '../../character/rules/gear'
import { getPassedShare } from '../../character/rules/damage'
import { angleBetween, centroid, directedTurn, distance, line, setDistance } from '../geometry'
import { getPlacedFootprint, isInReach } from './board'
import { isProne } from './ground'
import { getAction } from './log'
import { findWeaponRow } from './weaponRow'

// combat.tex "Sweeping Attack": "hits everything in a semicircle. Decide
// whether to attack from right to left or vice versa and attack the enemies
// in that order in a 180-degree arc, following the damage absorption rules."
// The sweep is a chain of strikes, one per target, each rolled on its own:
// the first is declared, and each one that lands opens the next, carrying
// what is left of the blow.

export function isSweep(strike: StrikeAction): boolean {
  return isSweepVariant(strike.variant)
}

// Whether the strike is a sweep's reach past its first target: made with
// the row and variation the sweep was declared with, and paid by it.
export function isSweepLink(strike: StrikeAction): boolean {
  return strike.sweepOf !== null
}

// Who the sweep has met before this strike, the first one first.
export function getSwept(state: CombatState, strike: StrikeAction): string[] {
  if (!strike.sweepOf) return []
  const chain = state.actions.filter((a) => a.kind === 'strike' && (a.id === strike.sweepOf || a.sweepOf === strike.sweepOf))
  const at = chain.findIndex((a) => a.id === strike.id)
  return (at < 0 ? chain : chain.slice(0, at)).flatMap((a) => (a.targetId ? [a.targetId] : []))
}

// Everyone the sweep is aimed at, met or still to come: on the board, the
// arc written when it was swung.
export function getSweepTargets(state: CombatState, strike: StrikeAction): string[] {
  return [...getSwept(state, strike), ...(strike.targetId ? [strike.targetId] : []), ...strike.arc]
}

// A link keeps the row and variation the sweep was declared with.
export function isSweepRowKept(state: CombatState, strike: StrikeAction, option: Pick<StrikeAction, 'weaponKey' | 'attack' | 'variant'>): boolean {
  const first = strike.sweepOf ? getAction(state, strike.sweepOf) : null
  return first?.kind !== 'strike' || (option.weaponKey === first.weaponKey && option.attack === first.attack && option.variant === first.variant)
}

// Whether the sweep can meet the character, given who it has met: "Sweeping
// attacks do not hit fallen enemies", and none is met twice.
export function canBeSwept(state: CombatState, swept: readonly string[], id: string): boolean {
  return !isProne(state, id) && !swept.includes(id)
}

// abilities.tex "Death Spin": "Sweeping attacks with two-handed weapons can
// cover up to 360 degrees."
function getArcSpan(c: Character, strike: StrikeAction): number {
  const row = findWeaponRow(c, strike.weaponKey, strike.attack)
  return c.abilities.includes('death-spin') && row?.atk.handed === 'two' ? 2 * Math.PI : Math.PI
}

// "If one character is behind another, only the closest is hit": the
// straight line between the closest cells of the attacker and the one
// behind crosses the other.
function isBehind(attacker: readonly Coord[], behind: readonly Coord[], other: readonly Coord[]): boolean {
  let pair: [Coord, Coord] = [attacker[0], behind[0]]
  for (const a of attacker) for (const b of behind) if (distance(a, b) < distance(...pair)) pair = [a, b]
  const crossed = line(...pair).slice(1, -1)
  return crossed.length > 0 && setDistance(crossed, other) === 0
}

// Who the sweep reaches after its first target, in the order it reaches
// them: everyone in reach and in the arc that turns from the target the way
// it was declared, but the fallen and those behind another the arc reaches.
// Nobody on a fight without a board, whose sweep is aimed at each next
// target by hand.
export function getSweepArc(state: CombatState, strike: StrikeAction): string[] {
  const c = state.characters[strike.actorId]
  const attacker = getPlacedFootprint(state, strike.actorId)
  const first = strike.targetId ? getPlacedFootprint(state, strike.targetId) : null
  if (!isSweep(strike) || !c || !attacker || !first) return []
  const center = centroid(attacker)
  const start = angleBetween(center, centroid(first))
  const span = getArcSpan(c, strike)
  const placed = Object.keys(state.characters).flatMap((id) => {
    const footprint = id === strike.actorId ? null : getPlacedFootprint(state, id)
    return footprint ? [{ id, footprint, turn: directedTurn(start, angleBetween(center, centroid(footprint)), strike.sweepDirection === 'clockwise') }] : []
  })
  const reached = placed.filter(({ id, turn }) =>
    id !== strike.targetId && canBeSwept(state, [], id) && isInReach(state, strike, id) && turn <= span + 1e-9)
  const blocking = [first, ...reached.map((r) => r.footprint)]
  return reached
    .filter((r) => !blocking.some((other) => other !== r.footprint && isBehind(attacker, r.footprint, other)))
    .sort((a, b) => a.turn - b.turn)
    .map((r) => r.id)
}

// The strike with the arc its sweep reaches written onto it, as everyone
// stands when it is swung — committed, or opened by a reaction. A link
// carries its own on; any other strike has none.
export function withSweepArc(state: CombatState, strike: StrikeAction): StrikeAction {
  return isSweep(strike) && !isSweepLink(strike) ? { ...strike, arc: getSweepArc(state, strike) } : strike
}

// What is left of the blow once past the strike's target, as a share of the
// sweep's own damage (combat.tex "Damage absorption").
export function getNextShare(state: CombatState, landed: StrikeAction): number {
  const target = landed.targetId ? state.characters[landed.targetId] : undefined
  const facts = landed.facts
  if (!target || facts?.effect.type !== 'damage' || facts.degree === null) return 0
  return landed.share * getPassedShare(facts.effect.effect, facts.degree, target)
}

// The next of the arc the sweep can still meet where everyone now stands.
export function getNextSwept(state: CombatState, landed: StrikeAction): { targetId: string; arc: string[] } | null {
  const at = landed.arc.findIndex((id) => !!state.characters[id] && !isProne(state, id) && isInReach(state, landed, id))
  return at < 0 ? null : { targetId: landed.arc[at], arc: landed.arc.slice(at + 1) }
}
