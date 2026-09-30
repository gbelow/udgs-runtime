import type { CampaignCharacter } from '../../types'
import type { Action, CombatState } from '../types'
import { cure, inflict } from '../../character/commands/addAffliction'
import { hasAffliction } from '../../character/rules/afflictions'
import { touchFire } from '../../character/commands/deliver'
import { getHazardAt, getHazardOf, getWalkedFootprints, isLayerLive } from '../rules/hazard'
import { getTurnHolder } from '../rules/turn'
import { findOpenRoot } from '../rules/log'

// Brings the ground and whoever stands on it back into line after anything
// that could change either: a layer whose caster no longer holds its spell
// is gone for good, so casting it again later does not bring it back; and
// everyone placed is suffocating exactly while they stand in a suffocating
// gas (combat.tex "Gas": "anyone that is inside a suffocating gas is
// suffocating by default"), which also keeps them from resting
// ("Suffocation": "cannot Rest"). Nothing on a fight with no board, or for
// anyone not placed on it; what did not change keeps its identity.
export function settleHazards(state: CombatState): CombatState {
  const board = state.board
  if (!board) return state
  let pruned = state
  const dead = Object.entries(board.terrain).filter(([, cell]) => cell.layers.some((l) => !isLayerLive(state, l)))
  if (dead.length > 0) {
    const terrain = { ...board.terrain }
    for (const [key, cell] of dead) terrain[key] = { ...cell, layers: cell.layers.filter((l) => isLayerLive(state, l)) }
    pruned = { ...state, board: { ...board, terrain } }
  }
  const breathed = Object.values(pruned.characters).flatMap((c) => {
    const next = breathe(pruned, c)
    return next === c ? [] : [next]
  })
  if (breathed.length === 0) return pruned
  return { ...pruned, characters: { ...pruned.characters, ...Object.fromEntries(breathed.map((c) => [c.id, c])) } }
}

function breathe(state: CombatState, c: CampaignCharacter): CampaignCharacter {
  if (!state.board?.placements[c.id]) return c
  const inGas = getHazardOf(state, c.id).suffocating
  if (inGas === hasAffliction(c, 'suffocating')) return c
  return inGas ? inflict(['suffocating'])(c) : cure(['suffocating'])(c)
}

// combat.tex "Fire": "The fire damage taken at the end of the turn is the
// worst environmental fire the character has touched during their turn" —
// only in their own turn, so what moves them outside it touches nothing.
// Once an action lands, the holder of the turn has touched what they stand
// in now — unless a move of their own is still being played out, which has
// them only part of the way — and, for a move of their own, every cell it
// walked through. A jump opening the turn so clears the fire they started
// in (combat.tex "Fire": "they can jump once to attempt to avoid its
// effects"), even when an opportunity attack lands before it.
export function touchFireInTurn(state: CombatState, action: Action): CombatState {
  const holder = getTurnHolder(state)
  const c = holder ? state.characters[holder] : undefined
  if (!holder || !c) return state
  const moving = findOpenRoot(state, 'move', (m) => m.actorId === holder) !== null
  const walked = action.kind === 'move' && action.actorId === holder ? getWalkedFootprints(state, action) : []
  const fire = Math.max(moving ? 0 : getHazardOf(state, holder).fire, ...walked.map((f) => getHazardAt(state, f).fire))
  const touched = touchFire(fire)(c)
  return touched === c ? state : { ...state, characters: { ...state.characters, [holder]: touched } }
}
