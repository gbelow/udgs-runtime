import type { Character, Delivery, Grant } from '../../types'
import type { Action, ActionDraft, ActionOf, CostTerm, SceneState } from '../types'
import { getActionCost, type ActionCost } from '../../character/rules/actionCosts'
import type { Term } from '../../character/rules/terms'
import { ABILITIES, hasAbility } from '../../abilities'
import { produceSpiritAttack } from '../../character/rules/spirit'
import { hasAffliction } from '../../character/rules/afflictions'
import { hasGrant } from '../../character/rules/effects'
import { makeAction } from '../factories'
import { getRootOf } from './log'
import { isInLiquid } from './board/ground'
import { canGrab, isGrappleRowOf } from './grapple'
import { isSweepLink } from './sweep'
import { LUNGE_COST, canLunge } from './jumpAttack'
import { getStrikeContext, type StrikeContext } from './strikeDeclaration'

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

// abilities.tex "Gentle Art": "You can take a -2 penalty on grapple tests in
// exchange for reducing the STA cost by 1." A grapple test is a maneuver
// and the resist against one; what a push is resisted with is Force.
const GENTLE: Modifier = {
  label: 'gentle art',
  offer: 'toggle',
  requires: 'gentleArt',
  allowed: ({ action, answering }) => action.kind === 'grapple'
    || (action.kind === 'opportunityAttack' && action.mode === 'grapple')
    || (action.kind === 'resist' && answering?.kind === 'grapple'),
  price: () => ({ add: { AP: 0, STA: -1 } }),
  terms: () => [{ label: 'gentle art', value: -2 }],
}

const DECLARATION_MODIFIERS: { [K in ModifierKind]: Record<ModifierKey<K>, Modifier<ContextOf<K>>> } = {
  strike: STRIKE_MODIFIERS,
  counterattack: STRIKE_MODIFIERS,
  // combat.tex "Preparing a reaction": a strike prepared is declared whole
  prepare: when(STRIKE_MODIFIERS, ({ action }) => action.kind === 'prepare' && action.main === 'strike'),
  // what an opportunity attack opens is a strike, or against a grapple
  // partner a maneuver (combat.tex "Grapple Maneuvers")
  opportunityAttack: {
    ...when(STRIKE_MODIFIERS, ({ action }) => action.kind === 'opportunityAttack' && action.mode === 'strike'),
    gentle: GENTLE,
  },
  grapple: { gentle: GENTLE },
  resist: { gentle: GENTLE },
  // abilities.tex "Precise Evasion": "Learns to use evade with 1 AP, but
  // takes -3 to defend in doing so"; a trample's evade is not tested
  evade: {
    precise: {
      label: 'precise evasion',
      offer: 'answer',
      requires: 'preciseEvade',
      allowed: ({ answering }) => answering?.kind === 'strike',
      price: () => ({ set: { AP: 1, STA: 0 } }),
      terms: () => [{ label: 'precise evasion', value: -3 }],
    },
  },
  // abilities.tex "Technical Lift": "spend 1 STA to perform an evasive jump
  // and stand up in the same action", taking "-3 to defend while doing so":
  // from the ground, and the water's surface is no ground to stand up from
  evasiveJump: {
    lift: {
      label: 'technical lift',
      offer: 'answer',
      requires: 'technicalLift',
      allowed: ({ state, actor }) => hasAffliction(actor, 'prone') && !isInLiquid(state, actor),
      price: () => ({ add: { AP: 0, STA: 1 } }),
      terms: () => [{ label: 'technical lift', value: -3 }],
    },
  },
  // abilities.tex "Defensive Advance": an intercept made with the step its
  // defender takes towards the attack, priced in place of the defender's step
  // (rules/protect.ts)
  intercept: {
    advance: {
      label: 'defensive advance',
      offer: 'answer',
      requires: 'advancingIntercept',
      allowed: ({ action }) => action.kind === 'intercept' && action.preparedId === '',
      price: ({ actor }) => ({ add: getActionCost(actor, 'defensiveAdvance') }),
    },
  },
  // abilities.tex "Lunge": "jump for 1 STA" (rules/lunge.ts)
  move: {
    lunge: {
      label: 'lunge',
      offer: 'toggle',
      requires: 'lunge',
      allowed: ({ state, action }) => action.kind === 'move' && canLunge(state, action),
      price: () => ({ set: LUNGE_COST }),
    },
  },
}

// The modifiers, open only where the action is the one they go with.
function when<C extends ModifierContext, K extends string>(modifiers: Record<K, Modifier<C>>, applies: (ctx: C) => boolean): Record<K, Modifier<C>> {
  const entries = (Object.entries(modifiers) as [K, Modifier<C>][]).map(([key, m]) => [key, { ...m, allowed: (ctx: C) => applies(ctx) && m.allowed(ctx) }])
  return Object.fromEntries(entries) as Record<K, Modifier<C>>
}

type Entry = { key: string; modifier: Modifier }

function getEntries(action: { kind: Action['kind'] }): Entry[] {
  if (!(action.kind in DECLARATION_MODIFIERS)) return []
  const table = DECLARATION_MODIFIERS[action.kind as ModifierKind] as unknown as Record<string, Modifier>
  return Object.entries(table).map(([key, modifier]) => ({ key, modifier }))
}

function isDeclared(action: Action, key: string): boolean {
  return 'modifiers' in action && (action.modifiers as Record<string, boolean>)[key] === true
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
  const entries = getEntries(action).filter((e) => isDeclared(action, e.key))
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
  const answers = getEntries(draft).filter((e) => e.modifier.offer === 'answer')
  if (answers.length === 0) return []
  const probe = makeAction(draft.kind, { ...draft, id: '', actorId, reactionTo: rootId } as Parameters<typeof makeAction>[1])
  const ctx = getContext(state, probe)
  if (!ctx || !('modifiers' in probe)) return []
  return answers
    .filter((e) => isOpen(e.modifier, ctx))
    .map((e) => ({ ...draft, modifiers: { ...probe.modifiers, [e.key]: true } }) as ActionDraft)
}

// What the answer is called for the modifier it was offered as, if any.
export function getAnswerLabel(draft: ActionDraft): string | null {
  const modifiers = 'modifiers' in draft ? (draft.modifiers as Record<string, boolean> | undefined) : undefined
  return getEntries(draft).find((e) => e.modifier.offer === 'answer' && modifiers?.[e.key])?.modifier.label ?? null
}

export type ModifierToggle = { key: string; label: string; on: boolean; allowed: boolean; price: { set: ActionCost } | { add: ActionCost }; terms: Term[]; modifiers: Record<string, boolean> }

// The modifiers offered as a toggle on the action as it is being declared:
// each open where it stands, or declared already so it can be taken back,
// and the modifiers pressing it declares.
export function getModifierToggles(state: SceneState, action: Action): ModifierToggle[] {
  const ctx = getContext(state, action)
  if (!ctx || !('modifiers' in action)) return []
  const modifiers = action.modifiers as Record<string, boolean>
  return getEntries(action).filter((e) => e.modifier.offer === 'toggle').flatMap(({ key, modifier }) => {
    const on = modifiers[key] === true
    const allowed = isOpen(modifier, ctx)
    if (!on && !allowed) return []
    return [{ key, label: modifier.label, on, allowed, price: modifier.price(ctx), terms: modifier.terms?.(ctx) ?? [], modifiers: { ...modifiers, [key]: !on } }]
  })
}

// The action's modifiers, none declared: what a change that leaves none of
// them open declares.
export function getModifiersOff(action: { kind: Action['kind'] }): Record<string, boolean> {
  return Object.fromEntries(getEntries(action).map((e) => [e.key, false]))
}
