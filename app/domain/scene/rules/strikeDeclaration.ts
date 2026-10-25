import { isCombatStarted } from './started'
import type { Character, Delivery } from '../../types'
import type { Action, ActionOf, CostTerm, SceneState, StrikeAction } from '../types'
import { getActionCost, type ActionCost } from '../../character/rules/actionCosts'
import { ABILITIES, hasAbility } from '../../abilities'
import { produceSpiritAttack } from '../../character/rules/spirit'
import { makeAction } from '../factories'
import { getAttackVariant, getOpportunityStrike, isBracedStep, isHookStep } from './attack'
import { getCounterStrike } from './counter'
import { canGrab, isGrappleRowOf } from './grapple'
import { hasGrant } from '../../character/rules/effects'
import { getAction, getRootOf } from './log'
import { isSweepLink } from './sweep'
import { pickStrikeDeclaration, type StrikeDeclared } from './declaration'

// A strike is declared the same way whatever declares it (types.ts
// `StrikeDeclaration`): on a turn, as an opportunity attack, as a
// counterattack, prepared, or opened by a recipe or a sweep. What it may be
// declared as, what that costs and what it delivers are read here, off where
// the strike stands — what it answers, the step that drew it — never off what
// declared it.

// What declares a strike: the strike itself, or the reaction or preparation
// that opens it.
export type StrikeHolder = StrikeAction | ActionOf<'opportunityAttack' | 'counterattack' | 'prepare'>

export type StrikeContext = {
  state: SceneState
  attacker: Character
  // the strike the declaration makes, aimed at whoever it is aimed at; a
  // preparation's is aimed at nobody yet
  strike: StrikeAction
  // the action the strike answers, when a reaction declared or opened it
  answering: Action | null
  // the step of a move the strike was drawn by, as an opportunity attack:
  // towards the attacker (combat.tex "Braced Attack"), or a runner's away
  // from them ("Hook Attack")
  drawn: { braced: boolean; hooked: boolean } | null
}

function getHeldStrike(holder: StrikeHolder): StrikeAction {
  switch (holder.kind) {
    case 'strike': return holder
    case 'opportunityAttack': return getOpportunityStrike(holder, '')
    case 'counterattack': return getCounterStrike(holder, '')
    case 'prepare': return makeAction('strike', { id: '', actorId: holder.actorId, ...pickStrikeDeclaration(holder) })
  }
}

// The reaction the strike is declared on or opened by, if any.
function getDeclaringReaction(state: SceneState, holder: StrikeHolder): Action | null {
  if (holder.kind !== 'strike') return holder.reactionTo ? holder : null
  const opener = holder.spawnedBy ? getAction(state, holder.spawnedBy) : null
  return opener?.reactionTo ? opener : null
}

export function getStrikeContext(state: SceneState, holder: StrikeHolder): StrikeContext | null {
  const attacker = state.characters[holder.actorId]
  if (!attacker) return null
  const reaction = getDeclaringReaction(state, holder)
  const drawn = reaction?.kind === 'opportunityAttack' ? { braced: isBracedStep(state, reaction), hooked: isHookStep(state, reaction) } : null
  return { state, attacker, strike: getHeldStrike(holder), answering: reaction ? getRootOf(state, reaction) : null, drawn }
}

export function isStrikeHolder(action: Action): action is StrikeHolder {
  return action.kind === 'strike' || action.kind === 'opportunityAttack' || action.kind === 'counterattack' || (action.kind === 'prepare' && action.main === 'strike')
}

// ---------------------------------------------------------------------------
// Variations

// Whether the strike may be made as this variation where it stands.
// combat.tex "Braced Attack": "a reaction when a target is moving towards the
// weapon or as an action in situations where the attacker is mounted and
// running" — mounts are not modelled, so only when drawn by a step towards
// the attacker. "Hook Attack": "an action or ... a reaction against running
// targets that move away from the weapon" — and what a runner moving away
// draws is only ever a hook attack.
function isVariantOpenTo(ctx: StrikeContext, variant: string): boolean {
  if (!ctx.drawn) return variant !== 'braced'
  if (variant === 'braced') return ctx.drawn.braced
  return variant === 'hook' ? ctx.drawn.hooked : !ctx.drawn.hooked
}

// The same, for any action: what is not a strike's declaration has every
// variation it has open.
export function isVariantOpen(state: SceneState, action: Action, variant: string): boolean {
  const ctx = isStrikeHolder(action) ? getStrikeContext(state, action) : null
  return !ctx || isVariantOpenTo(ctx, variant)
}

// ---------------------------------------------------------------------------
// What a strike is declared as besides

// Every yes-or-no of the declaration is one of these, so a new one cannot be
// declared without saying when it may be, what it costs and what it delivers.
export type StrikeModifierKey = { [K in keyof StrikeDeclared]-?: StrikeDeclared[K] extends boolean ? K : never }[keyof StrikeDeclared]

type StrikeModifier = {
  label: string
  allowed: (ctx: StrikeContext) => boolean
  // what it does to the price: puts its own in place of the variation's, or
  // adds to it
  price: (ctx: StrikeContext) => { set: ActionCost } | { add: ActionCost }
  // what it delivers along with the blow, once the die is known
  riders: (ctx: StrikeContext) => Delivery[]
}

const MARTIAL_SPIRIT = 'martial-spirit'
const TACKLE = 'tackle'

export const STRIKE_MODIFIERS: Record<StrikeModifierKey, StrikeModifier> = {
  // combat.tex "Catch": "The catcher must spend 3 AP + 1STA to perform a
  // strike with a weapon with the grapple property" against a running target;
  // its hit is a crash (rules/damage.ts)
  catch: {
    label: 'catch',
    allowed: ({ state, strike, answering }) => {
      const runner = answering?.kind === 'move' && answering.movement === 'run' ? answering.actorId : null
      return runner !== null && runner === strike.targetId && canGrab(state, strike, runner)
    },
    price: ({ attacker }) => ({ set: getActionCost(attacker, 'catch') }),
    riders: () => [],
  },
  // abilities.tex "Martial Spirit": spiritual strike along with a melee
  // attack, its price added to the attack's (the table's ruling: the
  // catalog's 1 AP and 1 STA); "The spellcasting result is the same as the
  // strike's", so it rides a hit alone — a cast's graze does nothing. It goes
  // with the blow that was declared, once: not a sweep's later strikes.
  martialSpirit: {
    label: 'Martial Spirit',
    allowed: ({ attacker, strike }) => hasAbility(attacker, MARTIAL_SPIRIT) && !isSweepLink(strike),
    price: () => {
      const { AP, STA } = ABILITIES[MARTIAL_SPIRIT].cost
      return { add: { AP, STA } }
    },
    riders: ({ attacker, strike }) => (strike.targetId && strike.roll?.degree === 'hit' ? [produceSpiritAttack(attacker)] : []),
  },
  // abilities.tex "Tackle": "initiate a grapple and perform a knockdown in
  // the same action" (the table's ruling: no trample), for its 4 AP + 1 STA.
  // A strike of one's own with a grapple row: its hit grabs, and opens the
  // knockdown (the ability's recipe).
  tackle: {
    label: 'tackle',
    allowed: ({ state, attacker, strike, answering }) => answering === null && hasGrant(attacker, 'tackle') && isGrappleRowOf(attacker, strike.weaponKey, strike.attack) && (!strike.targetId || canGrab(state, strike, strike.targetId)),
    price: () => {
      const { AP, STA } = ABILITIES[TACKLE].cost
      return { set: { AP, STA } }
    },
    riders: () => [],
  },
}

const MODIFIER_KEYS = Object.keys(STRIKE_MODIFIERS) as StrikeModifierKey[]

function getDeclaredModifiers(strike: StrikeAction): StrikeModifierKey[] {
  return MODIFIER_KEYS.filter((k) => strike[k])
}

// Whether the declaration may be made where the strike stands: its
// variation, and everything it is declared as besides.
export function isStrikeDeclarationOpen(ctx: StrikeContext): boolean {
  return isVariantOpenTo(ctx, ctx.strike.variant) && getDeclaredModifiers(ctx.strike).every((k) => STRIKE_MODIFIERS[k].allowed(ctx))
}

// What the declaration costs: the variation's price, or what a modifier puts
// in its place (named, so the line says so), and what the modifiers add, line
// by line; null while it names no variation the attacker can make.
export function getStrikePrice(ctx: StrikeContext): { declared: ActionCost; label: string | null; added: CostTerm[] } | null {
  const variant = getAttackVariant(ctx.attacker, ctx.strike, isCombatStarted(ctx.state))
  if (!variant) return null
  return getDeclaredModifiers(ctx.strike).reduce<{ declared: ActionCost; label: string | null; added: CostTerm[] }>((price, k) => {
    const change = STRIKE_MODIFIERS[k].price(ctx)
    const label = STRIKE_MODIFIERS[k].label
    return 'set' in change ? { ...price, declared: change.set, label } : { ...price, added: [...price.added, { label, ...change.add }] }
  }, { declared: { AP: variant.AP, STA: variant.STA }, label: null, added: [] })
}

// What the strike's modifiers deliver along with its blow.
export function getStrikeRiders(state: SceneState, strike: StrikeAction): Delivery[] {
  const ctx = getStrikeContext(state, strike)
  return ctx ? getDeclaredModifiers(strike).flatMap((k) => (STRIKE_MODIFIERS[k].allowed(ctx) ? STRIKE_MODIFIERS[k].riders(ctx) : [])) : []
}
