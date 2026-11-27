import type { Character, Delivery, Grant, ModifierRecipe } from '../../types'
import type { Action, ActionDraft, ActionKind, ActionOf, CostTerm, SceneState } from '../types'
import { getActionCost, type ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import { ABILITIES, hasAbility } from '../../abilities'
import { produceSpiritAttack } from '../../character/rules/spirit'
import { hasGrant } from '../../character/rules/effects'
import { makeAction } from '../factories'
import { getRootOf } from './log'
import { canGrab, isGrappleRowOf } from './grapple'
import { canSweep, isSweepLink } from './sweep'
import { ACTIONS, isReaction } from './actionCatalog'
import { getRecipeLabel, getRecipesOf, type RecipeEntry } from './recipes'
import { canCarryStep, getCombinedMoves, getCombinedPrice, getCombinedTerms, isCombinedDefense } from './combinedMove'
import { canCarryJump, isJumpAttack } from './attackJump'
import { getHeavyDegree, getHeavyDegrees } from './heavy'
import { findWeaponRow } from './weaponRow'
import { getHeavyName, getHeavyVariation } from '../../character/rules/gear'
import { canDeclareCarried, getDeclaredCarriedMoves } from './carriedMove'
import { getStrikeContext, isStrikeHolder, type StrikeContext } from './strikeDeclaration'

// Every yes-or-no an action is declared with besides what it is (types.ts,
// each kind's `modifiers`) is one of these, so a new one cannot be declared
// without saying when it may be, what it does to the price and to the test
// of the action it is declared on, and how it is offered: as a toggle on the
// action being declared, or as an answer of its own, where without it the
// answer may not be open at all.

export type ModifierContext = {
  state: SceneState
  actor: Character
  action: Action
  // the action a reaction answers, or null
  answering: Action | null
}

export type Modifier<C extends ModifierContext = ModifierContext> = {
  label: string
  offer: 'toggle' | 'answer'
  // the grant it is learned as, when it is one
  requires?: Grant
  allowed: (ctx: C) => boolean
  // what it does to the price: puts its own in place of the action's, or
  // adds to it
  price: (ctx: C) => { set: ActionCost } | { add: ActionCost }
  // what it puts on the test of the action it is declared on
  terms?: (ctx: C) => Term[]
  // what a strike delivers along with the blow, once the die is known
  riders?: (ctx: C) => Delivery[]
}

type ModifierAction = Extract<Action, { modifiers: object }>
type ModifierKind = ModifierAction['kind']
type ModifierKey<K extends ModifierKind> = keyof ActionOf<K>['modifiers'] & string
export type StrikeModifierKey = ModifierKey<'strike'>
type ContextOf<K extends ModifierKind> = K extends 'strike' | 'opportunityAttack' | 'counterattack' | 'prepare' ? StrikeContext : ModifierContext

const MARTIAL_SPIRIT = 'martial-spirit'
const TACKLE = 'tackle'

const STRIKE_MODIFIERS: Record<StrikeModifierKey, Modifier<StrikeContext>> = {
  // combat.tex "Sweeping Attack": "spends 1 additional AP on the attack and
  // hits everything in a semicircle" (rules/sweep.ts)
  sweep: {
    label: 'sweep',
    offer: 'toggle',
    allowed: ({ actor, strike }) => canSweep(actor, strike),
    price: ({ actor }) => ({ add: getActionCost(actor, 'sweep') }),
  },
  // combat.tex "Catch": "The catcher must spend 3 AP + 1STA to perform a
  // strike with a weapon with the grapple property" against a running target;
  // its hit is a crash (rules/damage.ts)
  catch: {
    label: 'catch',
    offer: 'toggle',
    allowed: ({ state, strike, answering }) => {
      const runner = answering?.kind === 'move' && answering.movement === 'run' ? answering.actorId : null
      return runner !== null && runner === strike.targetId && canGrab(state, strike, runner)
    },
    price: ({ actor }) => ({ set: getActionCost(actor, 'catch') }),
  },
  // abilities.tex "Martial Spirit": spiritual strike along with a melee
  // attack, its price added to the attack's (the table's ruling: the
  // catalog's 1 AP and 1 STA); "The spellcasting result is the same as the
  // strike's", so it rides a hit alone: a cast's graze does nothing. It goes
  // with the blow that was declared, once: not a sweep's later strikes.
  martialSpirit: {
    label: 'Martial Spirit',
    offer: 'toggle',
    allowed: ({ actor, strike }) => hasAbility(actor, MARTIAL_SPIRIT) && !isSweepLink(strike),
    price: () => {
      const { AP, STA } = ABILITIES[MARTIAL_SPIRIT].cost
      return { add: { AP, STA } }
    },
    riders: ({ actor, strike }) => (strike.targetId && strike.roll?.degree === 'hit' ? [produceSpiritAttack(actor)] : []),
  },
  // abilities.tex "Tackle": "initiate a grapple and perform a knockdown in
  // the same action" (the table's ruling: no trample), for its 4 AP + 1 STA.
  // A strike of one's own with a grapple row: its hit grabs, and opens the
  // knockdown (the ability's recipe).
  tackle: {
    label: 'tackle',
    offer: 'toggle',
    requires: 'tackle',
    allowed: ({ state, actor, strike, answering }) => answering === null && isGrappleRowOf(actor, strike.weaponKey, strike.attack) && (!strike.targetId || canGrab(state, strike, strike.targetId)),
    price: () => {
      const { AP, STA } = ABILITIES[TACKLE].cost
      return { set: { AP, STA } }
    },
  },
}

// The tests a learned trade (RecipeSchema `modifier`) may go with. A grapple
// test is a maneuver, one an opportunity attack opens, and the resist against
// one; what a push is resisted with is Force (abilities.tex "Gentle Art").
const MODIFIER_ON: Record<ModifierRecipe['on'], { kinds: readonly ActionKind[]; allowed: (ctx: ModifierContext) => boolean }> = {
  evade: { kinds: ['evade'], allowed: ({ action }) => action.kind === 'evade' },
  grappleTest: {
    kinds: ['grapple', 'opportunityAttack', 'resist'],
    allowed: ({ action, answering }) => action.kind === 'grapple'
      || (action.kind === 'opportunityAttack' && action.mode === 'grapple')
      || (action.kind === 'resist' && answering?.kind === 'grapple'),
  },
}

function getLearnedModifiers(actor: Character, kind: ActionKind): RecipeEntry<ModifierRecipe>[] {
  return getRecipesOf(actor, 'modifier').filter((e) => MODIFIER_ON[e.recipe.on].kinds.includes(kind))
}

function toModifier(entry: RecipeEntry<ModifierRecipe>): Modifier {
  const { on, answering, offer, cost, hit } = entry.recipe
  const change = { AP: cost.AP, STA: cost.STA }
  return {
    label: entry.label,
    offer,
    allowed: (ctx) => MODIFIER_ON[on].allowed(ctx) && (answering === null || ctx.answering?.kind === answering),
    price: () => (cost.operation === 'set' ? { set: change } : { add: change }),
    terms: () => (hit !== 0 ? [{ label: entry.label, value: hit }] : []),
  }
}

// combat.tex "Grapple Maneuvers" (the table's ruling): an escape may be made
// without the STA at -5; one who has learned a trade for grapple tests
// (abilities.tex "Gentle Art") takes that instead, so the two never go
// together.
const WINDED: Modifier = {
  label: 'no stamina',
  offer: 'toggle',
  allowed: ({ actor, action }) => action.kind === 'grapple' && action.maneuver === 'escape' && !getRecipesOf(actor, 'modifier').some((e) => e.recipe.on === 'grappleTest'),
  price: () => ({ add: { AP: 0, STA: -1 } }),
  terms: () => [{ label: 'no stamina', value: -5 }],
}

// combat.tex "Cover": a guard made with a body shield may take total cover
// behind it, at no price of its own
const GUARD_MODIFIERS: Record<ModifierKey<'guard'>, Modifier> = {
  cover: {
    label: 'take cover',
    offer: 'toggle',
    allowed: ({ actor, action }) => action.kind === 'guard' && !!findWeaponRow(actor, action.weaponKey, action.attack)?.weapon.shield?.body,
    price: () => ({ add: { AP: 0, STA: 0 } }),
  },
}

const DECLARATION_MODIFIERS: { [K in ModifierKind]: Record<ModifierKey<K>, Modifier<ContextOf<K>>> } = {
  strike: STRIKE_MODIFIERS,
  counterattack: STRIKE_MODIFIERS,
  // combat.tex "Preparing a reaction": a strike prepared is declared whole
  prepare: when(STRIKE_MODIFIERS, ({ action }) => action.kind === 'prepare' && action.main === 'strike'),
  // what an opportunity attack opens is a strike, or against a grapple
  // partner a maneuver (combat.tex "Grapple Maneuvers")
  opportunityAttack: when(STRIKE_MODIFIERS, ({ action }) => action.kind === 'opportunityAttack' && action.mode === 'strike'),
  grapple: { winded: WINDED },
  guard: GUARD_MODIFIERS,
}

// The modifiers, open only where the action is the one they go with.
function when<C extends ModifierContext, K extends string>(modifiers: Record<K, Modifier<C>>, applies: (ctx: C) => boolean): Record<K, Modifier<C>> {
  const entries = (Object.entries(modifiers) as [K, Modifier<C>][]).map(([key, m]) => [key, { ...m, allowed: (ctx: C) => applies(ctx) && m.allowed(ctx) }])
  return Object.fromEntries(entries) as Record<K, Modifier<C>>
}

// A modifier as an action is declared with it: a yes-or-no of its own kind's
// `modifiers` (`flag`), a move of a recipe its actor has learned
// (rules/combinedMove.ts, rules/carriedMove.ts), which the action names as its
// `recipe`, a learned trade, one of its `learnedModifiers` (`learned`), or a
// strike's heavy degree (`heavy`, rules/heavy.ts), declared when it is the
// one the strike is made at, and `fixed` when it cannot be taken back.
type Entry = { key: string; modifier: Modifier; slot: 'flag' | 'recipe' | 'learned' } | { key: string; modifier: Modifier; slot: 'heavy'; degree: number; declared: boolean; fixed: boolean }

function getFlagEntries(action: { kind: Action['kind'] }): Entry[] {
  if (!(action.kind in DECLARATION_MODIFIERS)) return []
  const table = DECLARATION_MODIFIERS[action.kind as ModifierKind] as unknown as Record<string, Modifier>
  return Object.entries(table).map(([key, modifier]) => ({ key, modifier, slot: 'flag' }))
}

function getRecipeEntries(state: SceneState, action: Pick<Action, 'kind' | 'actorId'>): Entry[] {
  const actor = state.characters[action.actorId]
  if (!actor) return []
  const offer = isReaction(action.kind) ? 'answer' : 'toggle'
  const combined = getCombinedMoves(actor, action.kind).map((entry): Entry => ({
    key: entry.id,
    slot: 'recipe',
    modifier: {
      label: entry.label,
      offer,
      allowed: ({ state, action, answering }) => (isJumpAttack(action) ? canCarryJump(state, action, entry) : isCombinedDefense(action) && canCarryStep(state, answering, action, entry)),
      price: ({ actor }) => getCombinedPrice(actor, entry.recipe),
      terms: () => getCombinedTerms(entry),
    },
  }))
  const carried = getDeclaredCarriedMoves(actor, action.kind).map((entry): Entry => ({
    key: entry.id,
    slot: 'recipe',
    modifier: {
      label: entry.label,
      offer,
      allowed: ({ state, action }) => canDeclareCarried(state, action, entry),
      price: () => ({ add: { AP: 0, STA: 0 } }),
    },
  }))
  const learned = getLearnedModifiers(actor, action.kind).map((entry): Entry => ({ key: entry.id, slot: 'learned', modifier: toModifier(entry) }))
  return [...combined, ...carried, ...learned]
}

// combat.tex "Heavy Attack": "Heavy I increases damage of physical attacks
// by +0.5 x STR xDM, but have an added cost of +1AP. Heavy II adds +1xSTR xDM,
// costs +2AP+1STA, and gives a -2 penalty to hit. Heavy III adds +1.5 x STR
// x DM, costs +3AP+1STA, and gives a -3 penalty to hit": one entry for each
// degree the row allows. The minimum of a row that forbids the normal attack
// is fixed, and so is the degree of a sweep's later strikes, struck as the
// first was.
function getHeavyEntries(state: SceneState, action: Action): Entry[] {
  const ctx = isStrikeHolder(action) ? getStrikeContext(state, action) : null
  if (!ctx) return []
  const { actor, strike } = ctx
  const range = getHeavyDegrees(actor, strike)
  const row = findWeaponRow(actor, strike.weaponKey, strike.attack)
  if (!range || !row) return []
  const at = getHeavyDegree(actor, strike)
  const link = isSweepLink(strike)
  return Array.from({ length: range.max - Math.max(1, range.min) + 1 }, (_, i) => Math.max(1, range.min) + i).map((degree): Entry => {
    const label = getHeavyName(degree)
    const { cost, penalty } = getHeavyVariation(row.atk, row.weapon, actor, degree)
    return {
      key: `heavy${degree}`,
      slot: 'heavy',
      degree,
      declared: at === degree,
      fixed: link || (at === degree && degree === range.min),
      modifier: { label, offer: 'toggle', allowed: () => true, price: () => ({ add: cost }), terms: () => (penalty !== 0 ? [{ label, value: -penalty }] : []) },
    }
  })
}

function getEntries(state: SceneState, action: Action): Entry[] {
  return [...getFlagEntries(action), ...getHeavyEntries(state, action), ...getRecipeEntries(state, action)]
}

function isDeclared(action: Action, entry: Entry): boolean {
  if (entry.slot === 'heavy') return entry.declared
  if (entry.slot === 'recipe') return action.recipe === entry.key
  if (entry.slot === 'learned') return action.learnedModifiers.includes(entry.key)
  return 'modifiers' in action && (action.modifiers as Record<string, boolean>)[entry.key] === true
}

function getContext(state: SceneState, action: Action): ModifierContext | null {
  switch (action.kind) {
    case 'strike':
    case 'opportunityAttack':
    case 'counterattack':
    case 'prepare':
      return getStrikeContext(state, action)
    default: {
      const actor = state.characters[action.actorId]
      return actor ? { state, actor, action, answering: getRootOf(state, action) } : null
    }
  }
}

function isOpen(modifier: Modifier, ctx: ModifierContext): boolean {
  return (!modifier.requires || hasGrant(ctx.actor, modifier.requires)) && modifier.allowed(ctx)
}

function getDeclared(state: SceneState, action: Action): { entries: Entry[]; ctx: ModifierContext } | null {
  const entries = getEntries(state, action).filter((e) => isDeclared(action, e))
  if (entries.length === 0) return null
  const ctx = getContext(state, action)
  return ctx && { entries, ctx }
}

// Whether everything the action is declared with may be, where it stands.
export function areModifiersOpen(state: SceneState, action: Action): boolean {
  const declared = getDeclared(state, action)
  return !declared || declared.entries.every((e) => isOpen(e.modifier, declared.ctx))
}

export type ModifiedPrice = { declared: ActionCost; label: string | null; added: CostTerm[] }

// The price the action is declared at: its own, or what a modifier puts in
// its place (named, so the line says so), and what the modifiers add, line
// by line.
export function getModifiedPrice(state: SceneState, action: Action, base: ActionCost): ModifiedPrice {
  const declared = getDeclared(state, action)
  if (!declared) return { declared: base, label: null, added: [] }
  return declared.entries.reduce<ModifiedPrice>((price, { modifier }) => {
    const change = modifier.price(declared.ctx)
    return 'set' in change ? { ...price, declared: change.set, label: modifier.label } : { ...price, added: [...price.added, { label: modifier.label, ...change.add }] }
  }, { declared: base, label: null, added: [] })
}

// The lines a modifier adds, after `from`: none takes the price below
// nothing.
export function addModifierLines(from: ActionCost, added: CostTerm[]): CostTerm[] {
  let sum = from
  return added.map((line) => {
    const next = { AP: Math.max(0, sum.AP + line.AP), STA: Math.max(0, sum.STA + line.STA) }
    const taken = { label: line.label, AP: next.AP - sum.AP, STA: next.STA - sum.STA }
    sum = next
    return taken
  })
}

export function getModifiedTotal(state: SceneState, action: Action, base: ActionCost): ActionCost {
  const price = getModifiedPrice(state, action, base)
  return [price.declared, ...addModifierLines(price.declared, price.added)].reduce((sum, t) => ({ AP: sum.AP + t.AP, STA: sum.STA + t.STA }), { AP: 0, STA: 0 })
}

// What the action's modifiers put on its own test.
export function getModifierTerms(state: SceneState, action: Action): Term[] {
  const declared = getDeclared(state, action)
  return declared ? declared.entries.flatMap(({ modifier }) => modifier.terms?.(declared.ctx) ?? []) : []
}

// What a strike's modifiers deliver along with its blow.
export function getModifierRiders(state: SceneState, action: Action): Delivery[] {
  const declared = getDeclared(state, action)
  return declared ? declared.entries.flatMap(({ modifier }) => (isOpen(modifier, declared.ctx) ? modifier.riders?.(declared.ctx) ?? [] : [])) : []
}

// The answers a modifier offered as an answer of its own makes of the draft:
// the draft with each such modifier open to the answerer declared.
export function getAnswerDrafts(state: SceneState, actorId: string, rootId: string, draft: ActionDraft): ActionDraft[] {
  const probe = makeAction(draft.kind, { ...draft, id: '', actorId, reactionTo: rootId } as Parameters<typeof makeAction>[1])
  const answers = getEntries(state, probe).filter((e) => e.modifier.offer === 'answer')
  if (answers.length === 0) return []
  const ctx = getContext(state, probe)
  if (!ctx) return []
  const flags = 'modifiers' in probe ? (probe.modifiers as Record<string, boolean>) : {}
  return answers
    .filter((e) => isOpen(e.modifier, ctx))
    .map((e) => (e.slot === 'recipe' ? { ...draft, recipe: e.key }
      : e.slot === 'learned' ? { ...draft, learnedModifiers: [...(draft.learnedModifiers ?? []), e.key] }
      : { ...draft, modifiers: { ...flags, [e.key]: true } }) as ActionDraft)
}

// What the answer is called for the modifier it was offered as, if any: a
// recipe's beside the action it goes with.
export function getAnswerLabel(draft: ActionDraft): string | null {
  const recipe = [draft.recipe ?? null, ...(draft.learnedModifiers ?? [])].flatMap((id) => (id ? [getRecipeLabel(id)] : [])).find((label) => label !== null)
  if (recipe) return `${ACTIONS[draft.kind].label} (${recipe})`
  const modifiers = 'modifiers' in draft ? (draft.modifiers as Record<string, boolean> | undefined) : undefined
  return getFlagEntries(draft).find((e) => e.modifier.offer === 'answer' && modifiers?.[e.key])?.modifier.label ?? null
}

export type ModifierToggle = { key: string; label: string; on: boolean; allowed: boolean; price: { set: ActionCost } | { add: ActionCost }; terms: Term[]; press: Partial<ActionDraft> }

// The modifiers offered as a toggle on the action as it is being declared:
// each open where it stands, or declared already so it can be taken back,
// and what pressing it declares.
export function getModifierToggles(state: SceneState, action: Action): ModifierToggle[] {
  const ctx = getContext(state, action)
  if (!ctx) return []
  const flags = 'modifiers' in action ? (action.modifiers as Record<string, boolean>) : {}
  return getEntries(state, action).filter((e) => e.modifier.offer === 'toggle').flatMap((entry) => {
    const { key, modifier } = entry
    const on = isDeclared(action, entry)
    const allowed = isOpen(modifier, ctx)
    if ((!on && !allowed) || (entry.slot === 'heavy' && entry.fixed)) return []
    const press = (entry.slot === 'heavy' ? { heavy: on ? 0 : entry.degree }
      : entry.slot === 'recipe' ? { recipe: on ? null : key, ...(isJumpAttack(action) ? { jumpTo: null } : {}) }
      : entry.slot === 'learned' ? { learnedModifiers: on ? action.learnedModifiers.filter((k) => k !== key) : [...action.learnedModifiers, key] }
      : { modifiers: { ...flags, [key]: !on } }) as Partial<ActionDraft>
    return [{ key, label: modifier.label, on, allowed, price: modifier.price(ctx), terms: modifier.terms?.(ctx) ?? [], press }]
  })
}

// The action's modifiers, none declared: what a change that leaves none of
// them open declares.
export function getModifiersOff(action: { kind: Action['kind'] }): Record<string, boolean> {
  return Object.fromEntries(getFlagEntries(action).map((e) => [e.key, false]))
}
