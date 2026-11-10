import type { CarriedMoveRecipe, Character } from '../../types'
import type { Action, ActionKind, RootAction, SceneState } from '../types'
import { getActionCost } from '../../character/rules/actionCosts'
import { SHOTS } from '../../tables'
import { getRecipeEntry, getRecipesOf, type RecipeEntry } from './recipes'
import { getCastSpentAP } from './cast'
import { getOwnCost } from './action'

// A careful move an action carries, bought with AP already paid for it
// (RecipeSchema `carriedMove`).
// combat.tex "Rest": "The character is allowed to move 4 AP worth of careful
// movement while resting during their own turn"; spells.tex "Effortless
// Spell": a cast rested through.
// abilities.tex "Battle Mage I": "Allows the caster to use careful movement
// while concentrating, repurposing the same action points used for the
// spell": a cast that needs concentration, as far as its AP reach, and what
// holding on to held spells pays at the round change.
// abilities.tex "Steady Arms": "Can move at careful movement speed while
// performing ranged attacks (except snipe), reutilizing the AP cost"
// (rules/steadyArms.ts).
// A move made once the action is rolled is the actor's to make or not,
// once, while the action waits to land; one declared with the action is
// walked around the step the action is made from.

export type CarriedEntry = RecipeEntry<CarriedMoveRecipe>

const WHEN: Record<NonNullable<CarriedMoveRecipe['when']>, (action: Action) => boolean> = {
  effortless: (a) => a.kind === 'cast' && (a.improved.effortless ?? 0) > 0,
  notSnipe: (a) => a.kind === 'shoot' && a.variant !== SHOTS.snipe.variant,
}

function goesWith(entry: CarriedEntry, action: Action): boolean {
  return entry.recipe.on === action.kind && (entry.recipe.when === null || WHEN[entry.recipe.when](action))
}

// The AP the recipe's move is bought with on the action: what a rest costs,
// or what the action itself cost.
function getBudget(state: SceneState, c: Character, entry: CarriedEntry, action: RootAction): number {
  if (entry.recipe.budget === 'rest') return getActionCost(c, 'rest').AP
  if (action.kind === 'cast') return getCastSpentAP(action)
  return getOwnCost(state, action)?.AP ?? 0
}

// The AP of careful movement the action carries once it is rolled, already
// paid with it: the farthest of the moves its recipes give, where more than
// one does.
export function getRolledMoveAP(state: SceneState, root: RootAction): number {
  const c = state.characters[root.actorId]
  if (!c) return 0
  const budgets = getRecipesOf(c, 'carriedMove').filter((e) => e.recipe.path === 'afterRoll' && goesWith(e, root)).map((e) => getBudget(state, c, e, root))
  return Math.max(0, ...budgets)
}

// The AP of careful movement a move declared with the action is bought with.
export function getDeclaredMoveAP(state: SceneState, action: RootAction): number {
  const c = state.characters[action.actorId]
  const entry = getCarriedOf(c, action)
  return c && entry ? getBudget(state, c, entry, action) : 0
}

// The carried moves a fighter may declare with an action of the kind.
export function getDeclaredCarriedMoves(c: Character, kind: ActionKind): CarriedEntry[] {
  return getRecipesOf(c, 'carriedMove').filter((e) => e.recipe.path === 'declared' && e.recipe.on === kind)
}

// The carried move the action is declared with, as its actor has it; null
// for any other.
export function getCarriedOf(c: Character | undefined, action: { recipe?: string | null }): CarriedEntry | null {
  const entry = c ? getRecipeEntry(c, action.recipe ?? null) : null
  return entry && entry.recipe.type === 'carriedMove' && entry.recipe.path === 'declared' ? (entry as CarriedEntry) : null
}

// Whether the action may be declared with the recipe: an action of its
// actor's own, on the board, as the recipe asks.
export function canDeclareCarried(state: SceneState, action: Action, entry: CarriedEntry): boolean {
  return action.spawnedBy === null && state.board?.placements[action.actorId] !== undefined && goesWith(entry, action)
}
