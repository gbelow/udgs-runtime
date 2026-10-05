import type { CombatState, HeldRoll, HeldTest, MoveAction } from '../types'
import { getFightName } from './fighters'

export type HeldKind = HeldTest['kind']

function findHeld(state: CombatState, id: string, kind: HeldKind): HeldTest | undefined {
  return state.heldTests.find((t) => t.id === id && t.kind === kind)
}

// The score a character made on a held test this round, if they have made it.
export function getHeldRoll(state: CombatState, id: string, kind: HeldKind): HeldRoll | null {
  return findHeld(state, id, kind)?.roll ?? null
}

// Every held test the character has made this round, by kind.
export function getHeldRolls(state: CombatState, id: string): Partial<Record<HeldKind, HeldRoll>> {
  return Object.fromEntries(state.heldTests.flatMap((t) => (t.id === id && t.roll ? [[t.kind, t.roll]] : [])))
}

// The held test the move goes on: the round's while it is being declared, and
// from its commit the one written on it then.
export function getMoveHeld(state: CombatState, action: MoveAction, kind: HeldKind): HeldRoll | null {
  return action.held ? action.held[kind] ?? null : getHeldRoll(state, action.actorId, kind)
}

// Why the character cannot roll a held test now, or null.
export function getHeldBar(state: CombatState, id: string, kind: HeldKind): string | null {
  const call = findHeld(state, id, kind)
  if (!call || !state.characters[id]) return 'not called to this test'
  return call.roll ? 'already tested this round' : null
}

// Why a turn waits on the tests the round called, or null.
export function getHeldTurnBar(state: CombatState): string | null {
  const pending = state.heldTests.filter((t) => t.roll === null && state.characters[t.id])
  return pending.length > 0 ? `waiting for ${pending.map((t) => `${getFightName(state, t.id)} to test ${t.kind}`).join(', ')}` : null
}
