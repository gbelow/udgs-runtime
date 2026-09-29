import type { CampaignCharacter, Character } from '../../types'
import type { Action, ActionKind, ActionOf, CombatState, DragAction, RootAction, WeaponAction } from '../types'
import { ACTIONS, getActionDef } from './actionCatalog'
import { SPELLS, isSpellKey } from '../../spells'
import { canCastSpell } from '../../character/rules/spells'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'
import { isInReach, isInShotRange } from './board'
import { canPayMove, getMoveFacts, getMovePrice, hasJumpSpace, isPathLegal, isPosture, needsBalanceTest } from './move'
import { canAfford } from '../../character/rules/cost'
import { getExplosionPayload, isAimed, isSpray } from './explosion'
import { getChargeOptions } from './explosion'
import { findTrigger } from './reactions'
import { getCancellableRoot, getGivenUpFor, getOpportunityState, isVoided } from './opportunity'
import { canGrab, getDisarmDiscount, getHoldBackTargets, getManeuverTargets, getReleaseTargets, isGrappleReach, isGrappleRowOf, isInterceptDisarm, needsDisarmPick } from './grapple'
import { getGroupSteps, getPushMovements, getPushPrice } from './drag'
import { findGrapple, getPartners } from './partners'
import { canPickUp, canThrowItem, findThrowSource, getReachableFloor, getThrowCells } from './floor'
import { sameCell } from '../geometry'
import { findWeaponRow, isRowUsable } from './weaponRow'
import { getAttackVariant, getOpportunityStrike, guardRows, isShotLoaded, isVariantOpen } from './attack'
import { canAimCast, isTargeted } from './cast'
import { canAffordRest } from '../../character/rules/rest'
import { getCounterStrike } from './counter'
import { getJoinedShot, isJoinInRange } from './coordinated'
import { isGuardPlaced } from './protect'
import { getRiposteDiscount } from './riposte'
import { getAction, getOpenAction, getReactionsTo, getRootOf } from './log'
import { getFleeCost } from './flee'

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
      return getAttackVariant(c, action) !== null && isShotLoaded(c, action)
    // thrown, the row is declared and can be fired; cast, the spell was;
    // set off, a charged spell with something to go off is named
    case 'explosion':
      return (action.source !== 'thrown' || getAttackVariant(c, action) !== null)
        && (action.source !== 'cast' || isSpellKey(action.key))
        && (action.source !== 'detonate' || getChargeOptions(state, action).some((o) => o.itemId === action.itemId))
        && isAimed(state, action)
    case 'cast':
      return isCampaignCharacter(c) && isSpellKey(action.key) && canCastSpell(c, action.key, action.quicken)
    case 'move':
      return isPathLegal(state, action)
    case 'block':
    case 'intercept': {
      const row = findWeaponRow(c, action.weaponKey, action.attack)
      const root = getRootOf(state, action)
      return row !== null && hasProperty(row.atk.properties, 'DEF') && isRowUsable(c, row) && (root?.kind !== 'strike' || isGuardPlaced(state, root, action))
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
      const strike = getOpportunityStrike(state, action, '')
      const fought = getOpportunityState(state, action)
      // combat.tex "Catch": a runner only in grabbing reach is a grab or nothing
      const root = getRootOf(state, action)
      if (root && !action.grab && findTrigger(state, root, action)?.catchOnly) return false
      return getAttackVariant(c, strike) !== null && isInReach(fought, strike, action.targetId ?? '') && isVariantOpen(state, action, action.variant)
        && (!action.grab || (canGrab(state, strike, action.targetId ?? '') && !isUncatchable(state, action)))
    }
    // combat.tex "Coordinated Shots": a shot they can fire, from where they
    // stand, at the target of the shot they join
    case 'joinShot': {
      const shot = getJoinedShot(action, '')
      return getAttackVariant(c, shot) !== null && isShotLoaded(c, shot) && isJoinInRange(state, c.id, shot, action.targetId ?? '')
    }
    // combat.tex "Grapple Maneuvers": "performed during a grapple by any of
    // the participants"
    case 'grapple':
      return true
    case 'rest':
      return true
    // combat.tex "Standard Action": something within reach, into a free hand
    case 'pickUp': {
      const found = getReachableFloor(state, c.id).find((f) => f.item.id === action.itemId)
      return !!found && canPickUp(c, found.item)
    }
    // combat.tex "Standard Action": "throwing items with bulk smaller than
    // character size by up to 10m" — from a free hand or off the floor
    case 'throwItem': {
      const item = findThrowSource(state, action.actorId, action.itemId)
      return !!item && canThrowItem(c, item) && action.to !== null && getThrowCells(state, action.actorId).some((cell) => sameCell(cell, action.to!))
    }
    // combat.tex "Push and drag": on the board, at a speed open to the
    // actor, along a way the block allows
    case 'drag': {
      const actor = state.characters[action.actorId]
      const speed = actor ? getPushMovements(actor).find((m) => m.kind === action.movement) : undefined
      return state.board !== null && !!speed?.available && action.path.length > 0 && getGroupSteps(state, action) !== null
    }
    // nothing more to declare; a blast is generated with its way already
    // walked out
    case 'blast':
    case 'release':
    case 'holdBack':
    case 'resist':
    case 'assist':
    case 'carry':
    case 'letGo':
    case 'evade':
    case 'brace':
    case 'evasion':
    case 'avoidExplosion':
    case 'follow':
    case 'flee':
    case 'fleeFollowUp':
    case 'spellTest':
      return true
    // abilities.tex "Counterattack": "as long as you are within range"
    case 'counterattack': {
      const strike = getCounterStrike(action, '')
      return getAttackVariant(c, strike) !== null && isVariantOpen(state, strike, strike.variant) && isInReach(state, strike, action.targetId ?? '')
    }
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
  switch (action.kind) {
    // combat.tex "Catch": "The catcher must spend 3 AP + 1STA to perform a
    // strike with a weapon with the grapple property"
    case 'strike':
      if (action.catch) return getAttackVariant(c, action) ? getActionCost(c, 'catch') : null
      return getVariantCost(c, action)
    case 'shoot':
      return getVariantCost(c, action)
    // a cast's explosion was paid for by the cast; a charge set off costs
    // whoever sets it off nothing
    case 'explosion':
      return action.source === 'thrown' ? getVariantCost(c, action) : { AP: 0, STA: 0 }
    case 'counterattack':
      return getVariantCost(c, getCounterStrike(action, ''))
    case 'move':
      return action.path.length > 0 || isPosture(action.movement) ? getMovePrice(c, action, action.path.length) : null
    // spells.tex "Casting spells": the spell's own price; what it asks beyond
    // AP and STA is paid the same, off the sheet
    case 'cast':
      return isSpellKey(action.key) ? { AP: SPELLS[action.key].cost.AP, STA: SPELLS[action.key].cost.STA } : null
    case 'evasion':
      return getEvasionCost(c, action.stay)
    case 'block':
    case 'intercept':
      return withGuardStep(c, action, getActionCost(c, action.kind))
    // the knockdown a hook opens is the hook's post-hit effect, not a
    // maneuver of its own (the table's ruling)
    case 'grapple':
      return action.hook ? { AP: 0, STA: 0 } : getCatalogCost(c, action.kind)
    case 'evade':
    case 'brace':
    case 'evasiveJump':
    case 'guard':
    case 'avoidExplosion':
    case 'opportunityAttack':
    case 'joinShot':
    case 'follow':
    case 'flee':
    case 'fleeFollowUp':
    case 'spellTest':
    case 'drag':
    case 'blast':
    case 'release':
    case 'holdBack':
    case 'resist':
    case 'assist':
    case 'carry':
    case 'letGo':
    case 'pickUp':
    case 'throwItem':
    case 'rest':
      return getCatalogCost(c, action.kind)
  }
}

// What the weapon row and variation the attack is declared with cost.
function getVariantCost(c: CampaignCharacter, action: WeaponAction): ActionCost | null {
  const variant = getAttackVariant(c, action)
  return variant ? { AP: variant.AP, STA: variant.STA } : null
}

// The row of the cost table the catalog names for the kind; nothing for one
// with no price of its own (an opportunity attack, a follow), which pays
// through the action it opens.
function getCatalogCost(c: CampaignCharacter, kind: ActionKind): ActionCost {
  const price = ACTIONS[kind].price
  return price ? getActionCost(c, price) : { AP: 0, STA: 0 }
}

// What the action costs its actor now, or null if they cannot pay it. A
// move pays for the path as it will be walked, cut wherever it will stop;
// a defense, less what the action given up for it already paid.
export function getPayableCost(state: CombatState, action: Action): ActionCost | null {
  const cost = getOwnCost(state, action)
  const c = state.characters[action.actorId]
  if (!c || !cost) return null
  if (action.kind === 'rest') return canAffordRest(c) ? cost : null
  if (action.kind === 'move') return canPayMove(c, action.movement, cost) ? cost : null
  return canAfford(c, cost) ? cost : null
}

// Whether the action and every reaction to it can be paid for now, priced as
// the roll or the payment will price them.
export function canPayAll(state: CombatState, root: Action): boolean {
  return [root, ...getReactionsTo(state, root.id)].every((a) => getPayableCost(state, a) !== null)
}

// What the action costs its actor as it stands, whether or not they can pay
// it; null while it is too incomplete to price. A riposte comes cheaper
// (abilities.tex "Riposte"); a flee costs the movement surge, and is null
// once that cannot be made.
export function getOwnCost(state: CombatState, action: Action): ActionCost | null {
  const c = state.characters[action.actorId]
  if (!c) return null
  if (action.kind === 'flee' || action.kind === 'fleeFollowUp') return getFleeCost(c)
  const declared = action.kind === 'move' ? getMovePrice(c, action, getMoveFacts(state, action).path.length)
    : getPushRoot(state, action) ? getPushPrice(state, getPushRoot(state, action)!, action)
    : getDeclaredCost(c, action)
  const discount = action.kind === 'strike' ? getRiposteDiscount(state, action) : action.kind === 'grapple' ? getDisarmDiscount(state, action) : 0
  const cost = declared && discount > 0 ? { AP: Math.max(0, declared.AP - discount), STA: declared.STA } : declared
  return cost && action.reactionTo ? lessRepurposed(state, action.actorId, action.reactionTo, cost) : cost
}

// The push an action pays for as its pusher, or as one who answers it.
function getPushRoot(state: CombatState, action: Action): DragAction | null {
  if (action.kind === 'drag') return action
  const root = action.kind === 'resist' || action.kind === 'assist' || action.kind === 'carry' || action.kind === 'letGo' ? getRootOf(state, action) : null
  return root?.kind === 'drag' ? root : null
}

// combat.tex "Interruption": "The AP from the interrupted action can be
// repurposed for the reaction, but the amount spent must be the highest
// between the action and the reaction" — the AP the given-up action cost
// pays towards the answer to the attack it was given up for, and that one
// only; AP it does not use is lost, and STA is paid in full.
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

// A block's or an intercept's price, and the STA of the step it is made
// with: a Defensive Advance's, or a Defender's.
export function withGuardStep(c: CampaignCharacter, action: ActionOf<'block'> | ActionOf<'intercept'>, cost: ActionCost): ActionCost {
  const step = action.kind === 'intercept' && action.advance ? getActionCost(c, 'defensiveAdvance') : action.to ? getActionCost(c, 'defenderStep') : null
  return step ? { AP: cost.AP + step.AP, STA: cost.STA + step.STA } : cost
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
// committed and waiting for its die.
export function isAnswerable(state: CombatState, open: Action): boolean {
  return open.step === 'react'
}

// Whether the action is closed by a die: a strike always, a move when it
// crosses difficult terrain (combat.tex "Balance"), an explosion when a
// reaction declared against it is a test of its own (combat.tex "Avoiding
// an Explosion").
export function needsDie(state: CombatState, action: Action): boolean {
  if (action.kind === 'move') return needsBalanceTest(state, action)
  if (action.kind === 'spellTest' && action.accepted) return false
  return ACTIONS[action.kind].die || getReactionsTo(state, action.id).some((r) => ACTIONS[r.kind].die)
}

export function getNextStep(state: CombatState): ActionStep | null {
  const open = getOpenAction(state)
  if (!open) return null
  if (open.step === 'post') return isVoided(state, open) ? 'confirm' : getPostStep(state, open)
  if (open.step === 'react') return 'react'
  const actor = state.characters[open.actorId]
  if (!actor) return 'declare'
  if (open.kind === 'explosion') return getExplosionPayload(state, open) === null ? 'declare' : isAimed(state, open) ? 'commit' : 'aim'
  // a push is aimed before its way is picked: the way runs along the line
  // through the target (combat.tex "Push and drag": "forwards or backwards")
  const aimed = open.targetId !== null && getTargetIds(state, open).includes(open.targetId)
  if (open.kind === 'drag' && !aimed) return 'target'
  if (!isDeclarationComplete(state, actor, open)) return 'declare'
  if (!needsTarget(open)) return 'commit'
  if (open.targetId === null || !getTargetIds(state, open).includes(open.targetId)) return 'target'
  return 'commit'
}

// What the root still waits on once its die is thrown or its cost paid,
// before it lands: HOP to spend on a hit, a way to point, a pick to make.
function getPostStep(state: CombatState, open: RootAction): ActionStep {
  switch (open.kind) {
    case 'strike':
    case 'shoot':
    case 'cast':
      return open.roll?.degree === 'hit' ? 'spend' : 'confirm'
    // combat.tex "Sprays": the cone is pointed once the reflexes have moved
    case 'blast':
      return isSpray(open) && open.direction === null ? 'aim' : 'confirm'
    case 'grapple':
      return needsDisarmPick(state, open) ? 'choose' : 'confirm'
    case 'explosion':
    case 'move':
    case 'drag':
    case 'release':
    case 'holdBack':
    case 'pickUp':
    case 'throwItem':
    case 'rest':
    case 'fleeFollowUp':
    case 'spellTest':
      return 'confirm'
  }
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
export function getTargetIds(state: CombatState, root: RootAction): string[] {
  if (!needsTarget(root)) return []
  const others = Object.keys(state.characters).filter((id) => id !== root.actorId)
  switch (root.kind) {
    case 'strike':
      return others.filter((id) => isInReach(state, root, id) && isGrappleReach(state, root, id) && (!root.grab || canGrab(state, root, id)))
    case 'shoot':
      return others.filter((id) => isInShotRange(state, root, id))
    case 'cast':
      return others.filter((id) => canAimCast(state, root, id))
    // combat.tex "Grapple": what is done in a grapple is done to a partner —
    // but the knockdown a hook opens, at whoever it hooked ("Hook Attack"),
    // and a disarm intercept opens, at whoever it intercepted ("Disarm")
    case 'grapple':
      if (root.hook || isInterceptDisarm(state, root)) return root.targetId ? [root.targetId] : []
      return getManeuverTargets(state, root.actorId, root.maneuver)
    case 'release':
      return getReleaseTargets(state, root.actorId)
    case 'holdBack':
      return getHoldBackTargets(state, root.actorId)
    case 'drag':
      return getPartners(state, root.actorId).filter((id) => state.board?.placements[id] !== undefined)
    // aimed at the board, or at nobody
    case 'explosion':
    case 'blast':
    case 'move':
    case 'pickUp':
    case 'throwItem':
    case 'rest':
    case 'fleeFollowUp':
    case 'spellTest':
      return []
  }
}
