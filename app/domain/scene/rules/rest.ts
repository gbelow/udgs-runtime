import type { SceneState, RootAction } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import { getCarriedMove, type ReactionMove } from './reactionMoves'
import { getPassedUp, getSpawned } from './log'
import { isInTurn } from './turn'
import { getCastSpentAP } from './cast'
import { getCastMoveAP } from './battleMage'

// combat.tex "Rest": "The character is allowed to move 4 AP worth of careful
// movement while resting during their own turn" — a rest, or a cast rested
// through (spells.tex "Effortless Spell"); and a cast that needs
// concentration by a Battle Mage, as far as its AP reach (abilities.tex
// "Battle Mage I"), the farther of the two where both are. The move is the
// actor's to make or not, once, while the action waits to land: it is played
// out before the action's effects, a spell's among them.
export function canMoveWhileResting(state: SceneState, root: RootAction): boolean {
  return root.step === 'post' && getCarriedMoveAP(state, root) > 0 && isInTurn(state, root.actorId) && state.board?.placements[root.actorId] !== undefined
    && !hasRestMove(state, root.id)
}

export function hasRestMove(state: SceneState, rootId: string): boolean {
  return [...getSpawned(state, rootId), ...getPassedUp(state, rootId)].some((a) => a.kind === 'move')
}

// The AP of careful movement the action carries, already paid with it.
function getCarriedMoveAP(state: SceneState, root: RootAction): number {
  const c = state.characters[root.actorId]
  if (!c) return 0
  const rest = getActionCost(c, 'rest').AP
  if (root.kind === 'rest') return rest
  if (root.kind !== 'cast') return 0
  return Math.max((root.improved.effortless ?? 0) > 0 ? rest : 0, getCastMoveAP(state, root, getCastSpentAP(root)))
}

// The move the action allows: careful only, as far as its AP reaches, which
// have already paid for it.
export function getRestMove(state: SceneState, root: RootAction): ReactionMove {
  return getCarriedMove(getCarriedMoveAP(state, root))
}
