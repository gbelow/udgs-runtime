import type { CampaignCharacter, Character } from '../../types'
import type { Action, ActionOf, CombatState } from '../types'
import { ACTIONS, getActionDef } from './actionCatalog'
import { SPELLS, isSpellKey } from '../../spells'
import { canCastSpell } from '../../character/rules/spells'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'
import { isInReach, isInShotRange } from './board'
import { getMoveFacts, getMovePrice, hasJumpSpace, isPathLegal, isPosture, needsBalanceTest } from './move'
import { canAfford } from '../../character/rules/cost'
import { getExplosionPayload, isAimed, isSpray } from './explosion'
import { findHeldItem } from './activeCharacter'
import { findTrigger, getTriggers } from './reactions'
import { getCancellableRoot, getGivenUpFor, isVoided } from './opportunity'
import { canGrab, canStandByEscape, getHoldBackTargets, getManeuverTargets, getReleaseTargets, isGrappleReach, isGrappleRowOf, needsDisarmPick, needsDragAim } from './grapple'
import { findGrapple, getPartners } from './partners'
import { canPickUp, getReachableFloor } from './floor'
import { findWeaponRow, isRowUsable } from './weaponRow'
import { getAttackVariant, getOpportunityState, getOpportunityStrike, guardRows, isAttackAction, isVariantOpen } from './attack'
import { isInCastRange, isTargeted } from './cast'
import { getAction, getOpenAction, getReactionsTo, getRootOf } from './log'

// An action's life in the fight: whether its declaration is complete and
// aimed at someone it may be, what it costs as declared, and the step the
// table is waiting on.

// Whether everything the action needs declared has been, and names things
// its actor can actually use: a strike or a shot a variation of a row in
// hand, an explosion one aimed where it can land, a block or intercept a DEF
// row (gear.tex "DEF"), a guard a shield (combat.tex "Guard": "If using a
// shield"), an opportunity attack a strike that reaches its target from
// where it will be fought.
export function isDeclarationComplete(state: CombatState, c: Character, action: Action): boolean {
  switch (action.kind) {
    case 'strike':
      return getAttackVariant(c, action) !== null && isVariantOpen(state, action, action.variant) && (!action.grab || isGrappleRowOf(c, action.weaponKey, action.attack))
    case 'shoot':
      return getAttackVariant(c, action) !== null
    // thrown, the row is declared and can be fired; cast, the spell was;
    // set off, a charged spell with something to go off is named
    case 'explosion':
      return (action.source !== 'thrown' || getAttackVariant(c, action) !== null)
        && (action.source !== 'cast' || isSpellKey(action.key))
        && (action.source !== 'detonate' || findHeldItem(state, action.itemId) !== null)
        && getExplosionPayload(state, action) !== null && isAimed(state, action)
    case 'cast':
      return isCampaignCharacter(c) && isSpellKey(action.key) && canCastSpell(c, action.key, action.quicken)
    case 'move':
      return isPathLegal(state, action)
    case 'block':
    case 'intercept': {
      const row = findWeaponRow(c, action.weaponKey, action.attack)
      return row !== null && hasProperty(row.atk.properties, 'DEF') && isRowUsable(c, row)
    }
    case 'guard': {
      const root = getRootOf(state, action)
      return root !== null && guardRows(state, c, root).some((row) => row.wielded.key === action.weaponKey && row.atk.name === action.attack)
    }
    case 'evasiveJump':
      return action.to !== null || !hasJumpSpace(state, action.actorId, action.targetId ?? '') || !state.board?.placements[action.actorId]
    case 'opportunityAttack': {
      const partner = findGrapple(state.grapples, action.actorId, action.targetId ?? '') !== null
      if (action.mode === 'grapple') return partner && getManeuverTargets(state, action.actorId, action.maneuver).includes(action.targetId ?? '')
      if (action.mode === 'drag') return partner && state.board !== null
      const strike = getOpportunityStrike(state, action, '')
      const fought = getOpportunityState(state, action)
      // combat.tex "Catch": a runner only in grabbing reach is a grab or nothing
      const root = getRootOf(state, action)
      if (root && !action.grab && findTrigger(state, root, action)?.catchOnly) return false
      return getAttackVariant(c, strike) !== null && isInReach(fought, strike, action.targetId ?? '') && isVariantOpen(state, action, action.variant)
        && (!action.grab || (canGrab(state, strike, action.targetId ?? '') && !isUncatchable(state, action)))
    }
    // combat.tex "Grapple Maneuvers": "performed during a grapple by any of
    // the participants"; an escape made to stand up, by one who is down
    case 'grapple':
      return !action.stand || canStandByEscape(state, c)
    // combat.tex "Standard Action": something within reach, into a free hand
    case 'pickUp': {
      const found = getReachableFloor(state, c.id).find((f) => f.item.id === action.itemId)
      return !!found && canPickUp(c, found.item)
    }
    // combat.tex "Push and drag": on the board; which way is the winner's
    // to say once the grapple has answered
    case 'drag':
      return state.board !== null
    case 'release':
    case 'holdBack':
    case 'resist':
    case 'assist':
    case 'carry':
    case 'letGo':
      return true
    case 'evade':
    case 'evasion':
    case 'avoidExplosion':
    case 'follow':
      return true
  }
}

// combat.tex "Catch" is against a running target; nothing lets a jumper be
// grabbed in the air (combat.tex "jumping": a jump "cannot be voluntarily
// interrupted in the middle").
function isUncatchable(state: CombatState, reaction: ActionOf<'opportunityAttack'>): boolean {
  const root = getRootOf(state, reaction)
  return root?.kind === 'move' && root.movement === 'jump'
}

// Whether every reaction declared against the action has said all it must:
// an evasive jump has picked where it lands.
export function areReactionsComplete(state: CombatState, root: Action): boolean {
  return getReactionsTo(state, root.id).every((r) => {
    const c = state.characters[r.actorId]
    return !!c && isDeclarationComplete(state, c, r)
  })
}

// ---------------------------------------------------------------------------
// Costs

// What an action costs its actor, as declared; null while the declaration is
// too incomplete to price.
export function getDeclaredCost(c: CampaignCharacter, action: Action): ActionCost | null {
  // a cast's explosion was paid for by the cast; a charge set off costs
  // whoever sets it off nothing
  if (action.kind === 'explosion' && action.source !== 'thrown') return { AP: 0, STA: 0 }
  // combat.tex "Catch": "The catcher must spend 3 AP + 1STA to perform a
  // strike with a weapon with the grapple property"
  if (action.kind === 'strike' && action.catch) return getAttackVariant(c, action) ? getActionCost(c, 'catch') : null
  if (action.kind === 'strike' || action.kind === 'shoot' || action.kind === 'explosion') {
    const variant = getAttackVariant(c, action)
    return variant ? { AP: variant.AP, STA: variant.STA } : null
  }
  if (action.kind === 'move') return action.path.length > 0 || isPosture(action.movement) ? getMovePrice(c, action, action.path.length) : null
  // spells.tex "Casting spells": the spell's own price; what it asks beyond
  // AP and STA is paid the same, off the sheet
  if (action.kind === 'cast') return isSpellKey(action.key) ? { AP: SPELLS[action.key].cost.AP, STA: SPELLS[action.key].cost.STA } : null
  if (action.kind === 'evasion') return getEvasionCost(c, action.stay)
  // combat.tex "Push and drag": going along is paid at the resolve, for the
  // metres actually moved
  // a reaction with no price of its own (an opportunity attack, a follow)
  // pays through the action it opens
  const price = ACTIONS[action.kind].price
  return price ? getActionCost(c, price) : { AP: 0, STA: 0 }
}

// What the action costs its actor now, or null if they cannot pay it. A
// move pays for the path as it will be walked, cut wherever it will stop;
// a defense, less what the action given up for it already paid.
export function getPayableCost(state: CombatState, action: Action): ActionCost | null {
  const cost = getOwnCost(state, action)
  const c = state.characters[action.actorId]
  return c && cost && canAfford(c, cost) ? cost : null
}

// What the action costs its actor as it stands, whether or not they can pay
// it; null while it is too incomplete to price.
export function getOwnCost(state: CombatState, action: Action): ActionCost | null {
  const c = state.characters[action.actorId]
  if (!c) return null
  const cost = action.kind === 'move' ? getMovePrice(c, action, getMoveFacts(state, action).path.length) : getDeclaredCost(c, action)
  return cost && action.reactionTo ? lessRepurposed(state, action.actorId, action.reactionTo, cost) : cost
}

// combat.tex "Opportunity Attack": "It is possible to cancel the triggering
// action and reuse the AP spent to defend against an opportunity attack" —
// nothing comes back, but the AP the given-up action cost pays towards the
// defense against the attack it was given up for, and that one only. STA
// is paid in full, and AP the defense does not use is lost (the table's
// ruling).
export function getRepurposedAP(state: CombatState, reactorId: string, rootId: string): number {
  const fought = getAction(state, rootId)
  const given = fought ? getCancellableRoot(state, fought, reactorId) : null
  return given && getGivenUpFor(state, given)?.id === rootId ? given.cost?.AP ?? 0 : 0
}

// A reaction's price less the AP repurposed towards it.
export function lessRepurposed(state: CombatState, reactorId: string, rootId: string, cost: ActionCost): ActionCost {
  const AP = getRepurposedAP(state, reactorId, rootId)
  return AP > 0 ? { AP: Math.max(0, cost.AP - AP), STA: cost.STA } : cost
}

// combat.tex "Evasion": "spend 2 AP to react"; abilities.tex "Precise
// Reflexes": "If the character uses reflexes without moving, reflexes only
// cost 1 AP."
export function getEvasionCost(c: CampaignCharacter, stay: boolean): ActionCost {
  return stay && c.abilities.includes('precise-reflexes') ? { AP: 1, STA: 0 } : getActionCost(c, 'reflex')
}

// ---------------------------------------------------------------------------
// Where the open action stands

// The one thing the table is waiting on. `commit` is the actor's moment: the
// declaration is complete and waits to be locked. `react` is everyone
// else's — the action is committed, its triggers loaded, and the die may be
// thrown from it, with no reaction meaning SD. `spend` is a hit with HOP to
// spend before it is applied; the purchases are optional, so it is confirmed
// from there too. `aim` is an explosion waiting to be pointed at the board:
// a disk's centre before the commit, a spray's direction once the reactions
// have moved (combat.tex "Sprays").
export type ActionStep = 'declare' | 'target' | 'aim' | 'commit' | 'react' | 'spend' | 'choose' | 'confirm'

// Whether reactions to the open action may still be declared: while it is
// committed, and for a push once more, after its way is pointed and before
// the attacks it draws from third parties are opened.
export function isAnswerable(state: CombatState, open: Action): boolean {
  return open.step === 'react' || (open.kind === 'drag' && open.step === 'post' && getNextStep(state) === 'react')
}

// Whether the action is closed by a die: a strike always, a move when it
// crosses difficult terrain (combat.tex "Balance"), an explosion when a
// reaction declared against it is a test of its own (combat.tex "Avoiding
// an Explosion").
export function needsDie(state: CombatState, action: Action): boolean {
  if (action.kind === 'move') return needsBalanceTest(state, action)
  return ACTIONS[action.kind].die || getReactionsTo(state, action.id).some((r) => ACTIONS[r.kind].die)
}

export function getNextStep(state: CombatState): ActionStep | null {
  const open = getOpenAction(state)
  if (!open) return null
  if (open.step === 'post') {
    if (isVoided(state, open)) return 'confirm'
    if (open.kind === 'explosion') return isSpray(state, open) && open.direction === null ? 'aim' : 'confirm'
    // combat.tex "Push and drag": the winner points the way, then whoever
    // it moves someone towards may answer it
    if (open.kind === 'drag') return needsDragAim(state, open) ? 'aim' : !open.fought && getTriggers(state, open).length > 0 ? 'react' : 'confirm'
    if (open.kind === 'grapple' && needsDisarmPick(state, open)) return 'choose'
    return (isAttackAction(open) || open.kind === 'cast') && open.roll?.degree === 'hit' ? 'spend' : 'confirm'
  }
  if (open.step === 'react') return 'react'
  const actor = state.characters[open.actorId]
  if (!actor) return 'declare'
  if (open.kind === 'explosion') return getExplosionPayload(state, open) === null ? 'declare' : isAimed(state, open) ? 'commit' : 'aim'
  if (!isDeclarationComplete(state, actor, open)) return 'declare'
  if (!needsTarget(open)) return 'commit'
  if (open.targetId === null || !getTargetIds(state, open).includes(open.targetId)) return 'target'
  return 'commit'
}

// Whether the declaration has to be aimed at someone before it is committed.
export function needsTarget(action: Action): boolean {
  return getActionDef(action.kind).targeted === true && (action.kind !== 'cast' || isTargeted(action))
}

// Who can be aimed at: everyone in the fight but the actor, and for a strike
// only those its reach covers from where the actor stands, for a shot only
// those the way of shooting carries to and that are in sight. A target the
// declaration has since put out of reach (a change of location on the high
// ground, a change from snipe to quick shot) drops off this list and has to
// be aimed at again.
export function getTargetIds(state: CombatState, root: Action): string[] {
  if (!needsTarget(root)) return []
  // combat.tex "Grapple": what is done in a grapple is done to a partner
  if (root.kind === 'grapple') return getManeuverTargets(state, root.actorId, root.maneuver, root.stand)
  if (root.kind === 'release') return getReleaseTargets(state, root.actorId)
  if (root.kind === 'holdBack') return getHoldBackTargets(state, root.actorId)
  if (root.kind === 'drag') return getPartners(state, root.actorId).filter((id) => state.board?.placements[id] !== undefined)
  return Object.keys(state.characters).filter((id) =>
    id !== root.actorId
    && (root.kind !== 'strike' || (isInReach(state, root, id) && isGrappleReach(state, root, id) && (!root.grab || canGrab(state, root, id))))
    && (root.kind !== 'shoot' || isInShotRange(state, root, id))
    && (root.kind !== 'cast' || isInCastRange(state, root, id)))
}
