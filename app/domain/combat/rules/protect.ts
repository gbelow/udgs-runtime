import type { ActionOf, CombatState, Placement, StrikeAction } from '../types'
import { disk, line, ring, sameCell, setDistance } from '../geometry'
import { getFootprint, getPlacedFootprint, getReach } from './board'
import { canStandAt, getMoveBlockCells } from './move'
import { findWeaponRow } from './weaponRow'
import { getReactionsTo } from './log'

// The block or intercept someone meets a strike with, their own or made for
// someone else (combat.tex "Protect").
export type GuardingReaction = ActionOf<'block'> | ActionOf<'intercept'>

// combat.tex "Protect": "It is possible to defend an ally by staying within
// one space distance of the line between attacker and target. The defender
// can block or intercept an attack directed at an ally." Anyone may (the
// table's ruling: the fight has no sides). The line runs between where the
// two stand.
export function isOnProtectLine(state: CombatState, root: StrikeAction, id: string, placement: Placement): boolean {
  const c = state.characters[id]
  const from = state.board?.placements[root.actorId]
  const to = root.targetId ? state.board?.placements[root.targetId] : undefined
  if (!c || !from || !to) return false
  return setDistance(getFootprint(c, placement), line(from.cell, to.cell)) <= 1
}

// Who may protect the strike's target: anyone else placed on the line, or
// able to step onto it (`getDefenderSteps`).
export function getProtectors(state: CombatState, root: StrikeAction): string[] {
  return Object.keys(state.characters).filter((id) => {
    const at = state.board?.placements[id]
    if (id === root.actorId || id === root.targetId || !at) return false
    return isOnProtectLine(state, root, id, at) || getDefenderSteps(state, root, id).length > 0
  })
}

// abilities.tex "Defender": "Allows you to spend 1 STA to move 1 basic
// movement as a reaction to position yourself to defend someone" — where a
// protector who knows it may step to before they block or intercept: any
// place they can stand within one AP of basic movement, on the line (the
// table's ruling).
export function getDefenderSteps(state: CombatState, root: StrikeAction, id: string): Placement[] {
  const c = state.characters[id]
  const from = state.board?.placements[id]
  if (!c || !from || !c.abilities.includes('defender')) return []
  const reach = Math.floor(getMoveBlockCells(c, 'basic', 1))
  return disk(from.cell, reach)
    .filter((cell) => !sameCell(cell, from.cell))
    .map((cell) => ({ ...from, cell }))
    .filter((p) => canStandAt(state, id, p) && isOnProtectLine(state, root, id, p))
}

// combat.tex "Intercept": "It requires the defender to be in short range" —
// of the attacker, at the intercepting weapon's short reach.
export function isInInterceptRange(state: CombatState, root: StrikeAction, id: string, placement: Placement, weaponKey: string, attack: string): boolean {
  const c = state.characters[id]
  const attacker = getPlacedFootprint(state, root.actorId)
  const row = c ? findWeaponRow(c, weaponKey, attack) : null
  if (!c || !row) return false
  return !attacker || setDistance(getFootprint(c, placement), attacker) <= Math.max(1, getReach(row.weapon, 'short'))
}

// abilities.tex "Defensive Advance": "Spend 1 STA to move forward to get in
// range to intercept, adding shield cover to the defense" — one space
// towards the attacker (the table's ruling), to where the intercept reaches
// them; one protecting someone else stays on the line.
export function getAdvanceSteps(state: CombatState, root: StrikeAction, id: string, weaponKey: string, attack: string): Placement[] {
  const c = state.characters[id]
  const from = state.board?.placements[id]
  const attacker = getPlacedFootprint(state, root.actorId)
  if (!c || !from || !attacker || !c.abilities.includes('defensive-advance')) return []
  const before = setDistance(getFootprint(c, from), attacker)
  return ring(from.cell, 1)
    .map((cell) => ({ ...from, cell }))
    .filter((p) => canStandAt(state, id, p) && setDistance(getFootprint(c, p), attacker) < before)
    .filter((p) => isInInterceptRange(state, root, id, p, weaponKey, attack))
    .filter((p) => id === root.targetId || isOnProtectLine(state, root, id, p))
}

// Where the step the block or intercept is declared with may go: a
// Defensive Advance's, or a Defender's.
export function getGuardSteps(state: CombatState, root: StrikeAction, reaction: GuardingReaction): Placement[] {
  if (reaction.kind === 'intercept' && reaction.advance) return getAdvanceSteps(state, root, reaction.actorId, reaction.weaponKey, reaction.attack)
  return reaction.actorId === root.targetId ? [] : getDefenderSteps(state, root, reaction.actorId)
}

// Whether the block or intercept stands where it may be made from, once it
// has taken the step it names: the step one it may take — and a Defensive
// Advance always takes one — an intercept within short range of the
// attacker, one made for someone else from the line. Anywhere, on a fight
// without a board.
export function isGuardPlaced(state: CombatState, root: StrikeAction, reaction: GuardingReaction): boolean {
  const here = state.board?.placements[reaction.actorId]
  if (!here) return true
  if (reaction.to && !getGuardSteps(state, root, reaction).some((p) => sameCell(p.cell, reaction.to!.cell))) return false
  if (!reaction.to && reaction.kind === 'intercept' && reaction.advance) return false
  const at = reaction.to ?? here
  if (reaction.actorId !== root.targetId && !isOnProtectLine(state, root, reaction.actorId, at)) return false
  return reaction.kind !== 'intercept' || isInInterceptRange(state, root, reaction.actorId, at, reaction.weaponKey, reaction.attack)
}

// Whether the block or intercept is still waiting on the step it has to
// take before it can be made.
export function needsGuardStep(state: CombatState, root: StrikeAction, reaction: GuardingReaction): boolean {
  return reaction.to === null && !isGuardPlaced(state, root, reaction) && getGuardSteps(state, root, reaction).length > 0
}

// The block or intercept to the strike still waiting on its step, and where
// that step may go: what a click on the board picks.
export function getPendingGuardStep(state: CombatState, root: StrikeAction): { reaction: GuardingReaction; steps: Placement[] } | null {
  for (const r of getReactionsTo(state, root.id)) {
    if ((r.kind === 'block' || r.kind === 'intercept') && needsGuardStep(state, root, r)) return { reaction: r, steps: getGuardSteps(state, root, r) }
  }
  return null
}
