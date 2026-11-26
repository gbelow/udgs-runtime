import { getDiceBar } from '../../play/calls'
import type { ReactionKind, RootAction, SceneState } from '../types'

// The table's ruling: a character is not offered the answers that would turn
// them on their own party (an opportunity attack on an ally, a flee from one,
// a guard of a foe against one) nor join a foe's shot, unless the table has
// let them, for the fight or for one action (`againstAllies`). The book
// forbids none of these: it is what the screen offers.

// Whether the two stand in the same fight party. Someone in none is nobody's
// ally, and nobody's foe either: where a fight has no parties, nothing is
// held back.
export function areAllies(state: Pick<SceneState, 'partyOf'>, a: string, b: string): boolean {
  const party = state.partyOf[a]
  return !!party && party === state.partyOf[b]
}

function areFoes(state: Pick<SceneState, 'partyOf'>, a: string, b: string): boolean {
  return !!state.partyOf[a] && !!state.partyOf[b] && state.partyOf[a] !== state.partyOf[b]
}

// Whether the character may answer the action against their own party: for
// the whole fight, or for this action alone.
export function mayTurnOnAllies(state: SceneState, id: string, root: RootAction): boolean {
  return state.againstAllies.includes(id) || state.againstAlliesOnce[id] === root.id
}

const HOSTILE: readonly ReactionKind[] = ['opportunityAttack', 'retarget', 'counterspell', 'flee']
const PROTECTIVE: readonly ReactionKind[] = ['guard', 'block', 'intercept']

// Whether the answer would turn the character on their own party, or side
// them with a foe: an attack on an ally, a flee from one, the guard of a foe
// against one, joining any shot but an ally's at a foe.
export function turnsOnAllies(state: SceneState, root: RootAction, t: { characterId: string; kind: ReactionKind; against?: string }): boolean {
  const id = t.characterId
  if (HOSTILE.includes(t.kind)) return areAllies(state, id, t.against ?? root.actorId)
  const targetId = 'targetId' in root ? root.targetId : null
  if (PROTECTIVE.includes(t.kind)) return !!targetId && targetId !== id && areAllies(state, id, root.actorId) && areFoes(state, id, targetId)
  if (t.kind === 'joinShot') return areFoes(state, id, root.actorId) || (!!targetId && areAllies(state, id, targetId))
  return false
}

// Whether the fight-long setting may be switched off now: not while an
// action is open, whose answers it may already be standing behind.
export function getAgainstAlliesBar(state: SceneState, id: string, on: boolean): string | null {
  if (!state.characters[id]) return 'not in the fight'
  if (getDiceBar(state.calls)) return 'a die waits'
  if (on === state.againstAllies.includes(id)) return on ? 'already on' : 'already off'
  return !on && state.stack.length > 0 ? 'not while an action is open' : null
}
