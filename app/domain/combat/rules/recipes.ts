import { RecipeSchema, type Character, type Recipe, type RecipeCondition, type RecipeEvent } from '../../types'
import type { ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import type { Action, CombatState, RootAction, StrikeAction } from '../types'
import { ABILITIES, isAbilityKey, type AbilityKey } from '../../abilities'
import { makeAction } from '../factories'
import { isDefense } from './actionCatalog'
import { getAction, getReactionsTo, getRootOf } from './log'
import { getDefaultAim, getFreeAttackOptions } from './attack'
import { isInReach } from './board'
import { getHookedMotion } from './damage'
import { getDisarmOptions } from './grapple'

// Actions as data. A recipe (RecipeSchema) says when a fighter may make an
// action the rules give nobody else — a follow-up a landed strike offers, a
// strike contested with the one aimed at them — and what that action gets;
// this file is the one reader of every word a recipe can be written in. A
// fighter has the rules' recipes and those of the abilities they know.

type FollowUpRecipe = Extract<Recipe, { type: 'followUp' }>
export type RecipeEntry<R extends Recipe = Recipe> = { id: string; label: string; recipe: R }

function isFollowUp(entry: RecipeEntry): entry is RecipeEntry<FollowUpRecipe> {
  return entry.recipe.type === 'followUp'
}

// The follow-up recipe the action was opened under; null for any other.
function getFollowUpRecipe(state: CombatState, action: Action): FollowUpRecipe | null {
  const entry = getRecipeOf(state, action)
  return entry && isFollowUp(entry) ? entry.recipe : null
}

const RULE_RECIPES = {
  // combat.tex "Hook Attack": "If the attack was aimed at the legs or head,
  // the post hit effect is a knockdown attempt which cannot be reacted
  // against if they are running or jumping" — made only once the hook's
  // damage was bought, and free: the hook's post-hit effect, not a maneuver
  // of its own (the table's rulings). "Knockdown": "It is not possible to
  // throw oneself along during a hook attack".
  hookKnockdown: {
    label: 'hook knockdown',
    recipe: RecipeSchema.parse({
      type: 'followUp',
      on: { event: 'struck', degrees: ['hit'], spent: 'hook', locations: ['head', 'leg'] },
      opens: { kind: 'grapple', maneuver: 'knockdown' },
      cost: { operation: 'set', AP: 0, STA: 0 },
      unresistedWhen: 'targetInMotion',
    }),
  },
  // combat.tex "Disarm": "Can be used by spending +1AP+1STA when intercept
  // stops an attack" — at whoever was intercepted. An intercept stops the
  // attack on a graze or a miss (the table's ruling, as abilities.tex
  // "Riposte" reads the same two degrees off a defense).
  interceptDisarm: {
    label: 'disarm',
    recipe: RecipeSchema.parse({
      type: 'followUp',
      on: { event: 'defended', defenses: ['intercept'], degrees: ['miss', 'graze'], defender: 'any' },
      opens: { kind: 'grapple', maneuver: 'disarm' },
      cost: { operation: 'set', AP: 1, STA: 1 },
    }),
  },
} satisfies Record<string, Omit<RecipeEntry, 'id'>>
export type RuleRecipeId = keyof typeof RULE_RECIPES

const RULE_ENTRIES: RecipeEntry[] = Object.entries(RULE_RECIPES).map(([id, entry]) => ({ id, ...entry }))

function isRuleRecipeId(id: string): id is RuleRecipeId {
  return Object.hasOwn(RULE_RECIPES, id)
}

// An ability's recipe, by the ability and its place on the stage.
function getAbilityEntry(key: AbilityKey, i: number): RecipeEntry | null {
  const recipe = ABILITIES[key].recipes[i]
  return recipe ? { id: `${key}.${i}`, label: ABILITIES[key].name.toLowerCase(), recipe } : null
}

// The recipes of the abilities the fighter knows.
function getLearnedRecipes(c: Character): RecipeEntry[] {
  return c.abilities.filter(isAbilityKey).flatMap((key) => ABILITIES[key].recipes.flatMap((_, i) => getAbilityEntry(key, i) ?? []))
}

// What a condition a recipe names asks of the fight: the strike the opener
// stands in, the action the follow-up is opened from — the defense, or the
// strike itself — and the follow-up.
type RecipeContext = { state: CombatState; root: StrikeAction; opener: Action; opened: Action }

const CONDITIONS: Record<RecipeCondition, (ctx: RecipeContext) => boolean> = {
  // abilities.tex "Riposte": "if made with an object different from the one
  // used for defense". An evade is made with no object, so whatever the
  // follow-up is made with is another (the table's ruling).
  differentObjectFromOpener: ({ opener, opened }) => {
    const used = opener.kind === 'block' || opener.kind === 'intercept' ? opener.weaponKey : null
    return !('weaponKey' in opened) || used !== opened.weaponKey
  },
  // combat.tex "Hook Attack": "if they are running or jumping"
  targetInMotion: ({ state, root }) => getHookedMotion(state, root) !== null,
}

// Who the event offers its follow-up to on the landed strike, at whom, and
// the action it is opened from; null where it offers this actor nothing.
type Opening = { targetId: string; opener: Action }

function getOpening(state: CombatState, root: StrikeAction, actorId: string, on: RecipeEvent): Opening | null {
  if (!root.roll || !root.targetId) return null
  if (on.degrees.length > 0 && !on.degrees.includes(root.roll.degree)) return null
  switch (on.event) {
    case 'defended': {
      if (on.defender === 'target' && actorId !== root.targetId) return null
      const defense = getReactionsTo(state, root.id).find((r) =>
        r.actorId === actorId && isDefense(r.kind) && (on.defenses.length === 0 || on.defenses.includes(r.kind)))
      return defense ? { targetId: root.actorId, opener: defense } : null
    }
    case 'struck':
      if (actorId !== root.actorId) return null
      if (on.spent && (root.spent[on.spent] ?? 0) === 0) return null
      if (on.locations.length > 0 && !on.locations.includes(root.location)) return null
      return { targetId: root.targetId, opener: root }
  }
}

// The follow-up the recipe opens for the actor, when its event offers them
// one and they can make it: a strike some attack they hold reaches the
// target with, aimed at the target's chest; a disarm with something to
// take.
function openRecipe(state: CombatState, root: StrikeAction, actorId: string, entry: RecipeEntry<FollowUpRecipe>, newId: () => string): Action | null {
  const opening = getOpening(state, root, actorId, entry.recipe.on)
  const c = state.characters[actorId]
  if (!opening || !c) return null
  const base = { id: newId(), actorId, targetId: opening.targetId, spawnedBy: opening.opener.id, recipe: entry.id }
  const { opens, unresistedWhen } = entry.recipe
  switch (opens.kind) {
    case 'strike': {
      const strike = makeAction('strike', { ...base, ...getDefaultAim(state.characters[opening.targetId]) })
      return getFreeAttackOptions(state, c, 'strike').some((o) => isInReach(state, { ...strike, ...o }, opening.targetId)) ? strike : null
    }
    case 'grapple': {
      const draft = makeAction('grapple', { ...base, maneuver: opens.maneuver })
      const grapple = { ...draft, unresisted: unresistedWhen !== null && CONDITIONS[unresistedWhen]({ state, root, opener: opening.opener, opened: draft }) }
      return opens.maneuver !== 'disarm' || getDisarmOptions(state, grapple).length > 0 ? grapple : null
    }
  }
}

// The follow-ups the landed strike's recipes open, for its attacker and for
// everyone who answered it: the rules' first, then the abilities', so an
// ability's is played out first.
export function getRecipeFollowUps(state: CombatState, root: RootAction, newId: () => string): Action[] {
  if (root.kind !== 'strike') return []
  const actorIds = [...new Set([root.actorId, ...getReactionsTo(state, root.id).map((r) => r.actorId)])]
  const open = (recipesOf: (c: Character) => RecipeEntry[]) => actorIds.flatMap((id) => {
    const c = state.characters[id]
    return c ? recipesOf(c).filter(isFollowUp).flatMap((entry) => openRecipe(state, root, id, entry, newId) ?? []) : []
  })
  return [...open(() => RULE_ENTRIES), ...open(getLearnedRecipes)]
}

// The recipe the fighter makes a contested strike with, if any
// (abilities.tex "Counterattack"): the first they have, the one kind of
// contested strike there is being the counterattack.
export function getContestRecipe(c: Character): RecipeEntry | null {
  return [...RULE_ENTRIES, ...getLearnedRecipes(c)].find((e) => e.recipe.type === 'contestedReaction') ?? null
}

// The recipe the action was made under, as its actor has it; null for an
// action no recipe gave, or one whose recipe its actor has since lost.
export function getRecipeOf(state: CombatState, action: Action): RecipeEntry | null {
  const id = action.recipe
  if (!id) return null
  if (isRuleRecipeId(id)) return { id, ...RULE_RECIPES[id] }
  const [key, i] = id.split('.')
  return isAbilityKey(key) && state.characters[action.actorId]?.abilities.includes(key) ? getAbilityEntry(key, Number(i)) : null
}

function getRecipeContext(state: CombatState, action: Action): RecipeContext | null {
  const opener = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  const root = opener ? getRootOf(state, opener) ?? opener : null
  return opener && root?.kind === 'strike' ? { state, root, opener, opened: action } : null
}

// What the recipe adds to the attack.
export function getRecipeHitTerms(state: CombatState, strike: StrikeAction): Term[] {
  const entry = getRecipeOf(state, strike)
  return entry && entry.recipe.hit !== 0 ? [{ label: entry.label, value: entry.recipe.hit }] : []
}

// The follow-up's price as its recipe makes it: added to what it would
// cost, or set in its place, where the recipe's condition holds.
export function getRecipeCost(state: CombatState, action: Action, cost: ActionCost): ActionCost {
  const recipe = getFollowUpRecipe(state, action)
  const change = recipe?.cost
  if (!recipe || !change) return cost
  const when = recipe.costWhen
  const ctx = when ? getRecipeContext(state, action) : null
  if (when && (!ctx || !CONDITIONS[when](ctx))) return cost
  return change.operation === 'set'
    ? { AP: change.AP, STA: change.STA }
    : { AP: Math.max(0, cost.AP + change.AP), STA: Math.max(0, cost.STA + change.STA) }
}

// Whether the follow-up's actor may throw themselves along with its
// maneuver; one no recipe opened is a grapple's own, and may.
export function allowsAlong(state: CombatState, action: Action): boolean {
  if (!action.recipe) return true
  const opens = getFollowUpRecipe(state, action)?.opens
  return opens?.kind === 'grapple' && opens.along
}

// Whether the action draws opportunity attacks as any other would.
export function drawsOpportunity(state: CombatState, action: Action): boolean {
  return getFollowUpRecipe(state, action)?.drawsOpportunity ?? true
}
