import { isCombatStarted } from './started'
import type { Action, ActionOf, SceneState, StrikeAction } from '../types'
import { makeAction } from '../factories'
import { getAttackVariant, getOpportunityStrike, isBracedStep, isHookStep } from './attack'
import { getCounterStrike } from './counter'
import { getAction, getRootOf } from './log'
import { pickStrikeDeclaration } from './declaration'
import { areModifiersOpen, getModifiedPrice, type ModifiedPrice, type ModifierContext } from './modifiers'

// A strike is declared the same way whatever declares it (types.ts
// `StrikeDeclaration`): on a turn, as an opportunity attack, as a
// counterattack, prepared, or opened by a recipe or a sweep. What it may be
// declared as, what that costs and what it delivers are read here, off where
// the strike stands — what it answers, the step that drew it — never off what
// declared it.

// What declares a strike: the strike itself, or the reaction or preparation
// that opens it.
export type StrikeHolder = StrikeAction | ActionOf<'opportunityAttack' | 'counterattack' | 'prepare'>

// `answering` is the action the strike answers, when a reaction declared or
// opened it.
export type StrikeContext = ModifierContext & {
  action: StrikeHolder
  // the strike the declaration makes, aimed at whoever it is aimed at; a
  // preparation's is aimed at nobody yet
  strike: StrikeAction
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
  const actor = state.characters[holder.actorId]
  if (!actor) return null
  const reaction = getDeclaringReaction(state, holder)
  const drawn = reaction?.kind === 'opportunityAttack' ? { braced: isBracedStep(state, reaction), hooked: isHookStep(state, reaction) } : null
  return { state, actor, action: holder, strike: getHeldStrike(holder), answering: reaction ? getRootOf(state, reaction) : null, drawn }
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
// What a strike is declared as besides (rules/modifiers.ts)

// Whether the declaration may be made where the strike stands: its
// variation, and everything it is declared as besides.
export function isStrikeDeclarationOpen(ctx: StrikeContext): boolean {
  return isVariantOpenTo(ctx, ctx.strike.variant) && areModifiersOpen(ctx.state, ctx.action)
}

// What the declaration costs: the variation's price, or what a modifier puts
// in its place, and what the modifiers add, line by line; null while it
// names no variation the attacker can make.
export function getStrikePrice(ctx: StrikeContext): ModifiedPrice | null {
  const variant = getAttackVariant(ctx.actor, ctx.strike, isCombatStarted(ctx.state))
  return variant && getModifiedPrice(ctx.state, ctx.action, { AP: variant.AP, STA: variant.STA })
}
