import { isCombatStarted } from './started'
import { notices } from './stealth'
import { getMedicineAbility, getMedicineCost, getMedicineTargets } from './medicine'
import { getTakeableHeld } from '../../item/rules/doses'
import type { CampaignCharacter, Character } from '../../types'
import type { Action, ActionKind, ActionOf, AttackAction, SceneState, Coord, CostTerm, FloorItem, GrappleAction, MoveAction, RootAction } from '../types'
import { ACTIONS, getActionDef, isAttackAction, isReaction } from './actionCatalog'
import { sameCell } from './board/geometry'
import { SPELLS, isSpellKey } from '../../spells'
import { canCastSpell, isCastPossible } from '../../character/rules/spells'
import { hasAbility } from '../../abilities'
import { hasAffliction, isDead } from '../../character/rules/afflictions'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'
import { getDistanceBetween, getStrikeReach, isInReach, isInShotRange } from './board/board'
import { isSheltered } from './chase'
import { getMoveFacts, getMovePrice, getWalkedCells, hasJumpSpace, isPathLegal, needsBalanceTest } from './move'
import { needsClimbTest } from './board/cliff'
import { canAfford, canHold } from '../../character/rules/cost'
import { getSurgeBarFor, getSurgeProbes } from './surge'
import { getHeldOf, getHeldRefund, requiresConcentration } from './hold'
import { isSpellActive } from '../../character/rules/effects'
import { getChargeOptions, getExplosionPayload, isAimed, isSpray } from './explosion'
import { findTrigger } from './reactions'
import { getCancellableRoot, getGivenUpFor, getOpportunityState, isVoided } from './opportunity'
import { GRAPPLING_HOP, getGrapplingHOP, getHoldBackTargets, getManeuverCost, getManeuversOf, getManeuverTargets, getReleaseTargets, isGrappleReach, isManeuverWon, isSeizedUse, needsDisarmPick } from './grapple'
import { canGrapple, getHOPOptions } from './damage'
import { canMoveWhileResting } from './rest'
import { getGroupSteps, getPushMovements, getPushPrice } from './drag'
import { getPullTargets, getSlipCost, getSlipTargets } from './tether'
import { getCutStrike, getCutTargets } from './cut'
import { getEnemies, getSocialCost } from './social'
import { getFeintTargets } from './feint'
import { findGrapple, getGrapples, getPartners, isGrapple } from './partners'
import { isExtinguishCell } from './extinguish'
import { isPlantDeclared } from './plant'
import { canPickUp, getReachableFloor } from './floor'
import { getCellTargets, getFloorTargets } from './floorAttack'
import { canThrowItem, findThrowSource, getThrowCost, isThrowCell } from './throw'
import { findWeaponRow, getRowStack, isRowUsable } from './weaponRow'
import { getAttackVariant, getFreeAttackOptions, getOpportunityAction, explosionBlockRows, getOpportunityStrike, guardRows, isAimOnTarget, isShotLoaded } from './attack'
import { canAimCast, canSaveGraze, getImprovementOptions, getSpellBoardBar, isTargeted } from './cast'
import { isSuggestionComplete } from './moraleSpell'
import { isCompelledAway, isCompelledTarget } from './stress'
import { isSidestepPlaced } from './sidestep'
import { getPendingDisplacement } from './displace'
import { canOverdraw } from '../../character/rules/rest'
import { getIncomingAP } from './roundChange'
import { getCounterStrike } from './counter'
import { getJoinedShot, isJoinInRange } from './coordinated'
import { isGuardPlaced } from './protect'
import { allowsAlong, getRecipeCost } from './recipes'
import { getAction, getLiveActions, getOpenAction, getOpenedBy, getReactionsTo, getRootOf } from './log'
import { getFleeCost } from './flee'
import { canBeSwept, isSweep, isSweepLink, isSweepRowKept } from './sweep'
import { getFireAgainBar, getRepeatCost } from './fireAgain'
import { getReloadBar, getReloadRow } from './reload'
import { getReloadCost } from '../../character/rules/gear'
import { canReposition, findPrepared, getPreparedMain, isDefensePlaced, isPrepareComplete, isPreparedDefense, isRepositionPlaced } from './prepared'
import { getOpeningJumpAttack, isJumpAttackLanding } from './jumpAttack'
import { getStrikeContext, isStrikeDeclarationOpen, isVariantOpen, type StrikeHolder } from './strikeDeclaration'
import { addModifierLines, areModifiersOpen, getModifiedPrice, type ModifiedPrice } from './modifiers'

// An action's life in the fight: whether its declaration is complete and
// aimed at someone it may be, what it costs as declared, and the step the
// table is waiting on.

// Why the opportunity attack cannot be fought as declared, or null: judged
// where its actor will stand when it is fought (`getOpportunityState`), with
// the attack it was declared as. `stage` counts the checks it passed before
// failing, so of several attacks the one that came nearest can be told.
export function getOpportunityCheck(state: SceneState, c: Character, action: ActionOf<'opportunityAttack'>): { bar: string | null; stage: number } {
  const target = action.targetId ?? ''
  const fail = (bar: string, stage: number) => ({ bar, stage })
  if (action.mode === 'grapple') {
    if (findGrapple(getGrapples(state), action.actorId, target) === null) return fail('no grapple with them to use a maneuver in', 0)
    if (!getManeuverTargets(state, action.actorId, action.maneuver).includes(target)) return fail(`${action.maneuver} cannot be done to them`, 1)
    if (!isCampaignCharacter(c)) return fail('it cannot be priced as declared', 2)
    if (!getManeuversOf(c).includes(action.maneuver)) return fail(`${action.maneuver} not learned`, 1)
    return canAfford(c, getManeuverCost(c, action.maneuver), isCombatStarted(state)) ? { bar: null, stage: 3 } : fail('cannot afford a maneuver', 2)
  }
  const strike = getOpportunityStrike(action, '')
  const fought = getOpportunityState(state, action)
  // combat.tex "Catch": a runner only in grabbing reach is a grab or nothing
  const root = getRootOf(state, action)
  if (root && !action.modifiers.catch && findTrigger(state, root, action)?.catchOnly) return fail('a runner only in grabbing reach: a grab, not an attack', 0)
  if (getAttackVariant(c, strike, isCombatStarted(state)) === null) return fail('that attack is not one they have in hand', 1)
  const cost = getOwnCost(state, strike)
  if (!cost || !isCampaignCharacter(c)) return fail('it cannot be priced as declared', 2)
  if (!canAfford(c, cost, isCombatStarted(state))) return fail(`cannot afford ${cost.AP} AP${cost.STA ? ` and ${cost.STA} STA` : ''}`, 3)
  if (!isInReach(fought, strike, target)) {
    const distance = getDistanceBetween(fought, action.actorId, target)
    const reach = getStrikeReach(fought, strike)
    return fail(`out of reach from where it is fought: ${distance} m away, the attack reaches ${reach} m`, 4)
  }
  if (!isStrikeOpen(state, action)) return fail('that variant is not open to them now', 5)
  return isAimOnTarget(state, strike) ? { bar: null, stage: 7 } : fail('the aim is not on the target', 6)
}

export const getOpportunityBar = (state: SceneState, c: Character, action: ActionOf<'opportunityAttack'>): string | null => getOpportunityCheck(state, c, action).bar

// Whether everything the action needs declared has been, and names things
// its actor can actually use: a strike or a shot a variation of a row in
// hand, an explosion aimed where it can go off, a block or intercept a DEF
// row (gear.tex "DEF"), a guard a shield (combat.tex "Guard": "If using a
// shield"), an opportunity attack a strike that reaches its target from
// where it will be fought.
export function isDeclarationComplete(state: SceneState, c: Character, action: Action): boolean {
  if (isUsedOutsideGrapple(state, action) || !areModifiersOpen(state, action)) return false
  switch (action.kind) {
    case 'strike':
      return getAttackVariant(c, action, isCombatStarted(state)) !== null && isStrikeOpen(state, action) && isSweepRowKept(state, action, action) && isAimOnTarget(state, action)
    case 'shoot':
      return getAttackVariant(c, action, isCombatStarted(state)) !== null && isVariantOpen(state, action, action) && isShotLoaded(c, action) && isAimOnTarget(state, action)
    // cast, the spell was; detonated, a charge it can set off is named
    case 'explosion':
      return (action.source !== 'cast' || isSpellKey(action.key))
        && (action.source !== 'detonate' || getChargeOptions(state, action).some((o) => o.itemId === action.itemId))
        && isAimed(state, action)
    case 'cast':
      return isCampaignCharacter(c) && isSpellKey(action.key) && canCastSpell(c, action.key, action.quicken, isCombatStarted(state)) && getSpellBoardBar(state, c, action.key) === null && isSuggestionComplete(state, action)
    case 'fireAgain':
      return isCampaignCharacter(c) && isSpellKey(action.key) && getFireAgainBar(state, c, action.key) === null
    case 'releaseSpell':
      return isSpellKey(action.key) && isSpellActive(c, action.key)
    case 'move':
      return isPathLegal(state, action) && isRepositionPlaced(state, action) && isSidestepPlaced(state, action) && isCompelledAway(state, action, action.path.at(-1)) && isJumpAttackLanding(state, action, action.path.at(-1))
    case 'block':
    case 'intercept': {
      const row = findWeaponRow(c, action.weaponKey, action.attack)
      const root = getRootOf(state, action)
      // a prepared defense is placed by the movement it carries, before the die
      return row !== null && hasProperty(row.atk.properties, 'DEF') && isRowUsable(c, row) && (root?.kind !== 'strike' || action.preparedId !== '' || isGuardPlaced(state, root, action))
    }
    case 'guard': {
      const root = getRootOf(state, action)
      return root !== null && guardRows(state, c, root).some((row) => row.wielded.key === action.weaponKey && row.atk.name === action.attack)
    }
    case 'blockExplosion':
      return explosionBlockRows(c).some((row) => row.wielded.key === action.weaponKey && row.atk.name === action.attack)
    case 'evasiveJump':
      return action.to !== null || !hasJumpSpace(state, action.actorId, action.targetId ?? '') || !state.board?.placements[action.actorId]
    case 'opportunityAttack':
      return getOpportunityBar(state, c, action) === null
    // combat.tex "Coordinated Shots": a shot they can fire, from where they
    // stand, at the target of the shot they join
    case 'joinShot': {
      const shot = getJoinedShot(action, '')
      return getAttackVariant(c, shot, isCombatStarted(state)) !== null && isShotLoaded(c, shot) && isJoinInRange(state, c.id, shot, action.targetId ?? '') && isAimOnTarget(state, action)
    }
    // combat.tex "Grapple Maneuvers": "performed during a grapple by any of
    // the participants"
    case 'grapple':
      return true
    case 'social':
    case 'rest':
      return true
    case 'taunt':
      return action.targetId !== null
    // combat.tex "Standard Action": something within reach, into a free hand
    case 'pickUp': {
      const found = getReachableFloor(state, c.id).find((f) => f.item.id === action.itemId)
      return !!found && canPickUp(c, found.item)
    }
    // combat.tex "Throw", "Standard Action": something it can throw, to a
    // cell the throw reaches
    case 'throw': {
      const item = findThrowSource(state, action.actorId, action.itemId)
      return !!item && canThrowItem(c, item, isCombatStarted(state)) && action.to !== null && isThrowCell(state, action.actorId, action.itemId, action.to)
    }
    // combat.tex "Fire": a burning space within its reach
    case 'extinguish':
      return isExtinguishCell(state, action)
    // abilities.tex "Crossbow and Shield": a body shield in hand, facing a
    // cell next to the planter
    case 'plant':
      return isPlantDeclared(state, c, action)
    // abilities.tex "Medicine": someone bleeding within reach
    case 'firstAid':
    case 'cauterize':
      return action.targetId !== null && getMedicineTargets(state, action.actorId).includes(action.targetId)
    // gear.tex "Potions and Medicine": a potion in hand with doses enough
    case 'drink':
      return getTakeableHeld(c).takeable.some((i) => i.id === action.itemId)
    // gear.tex "Reload": an empty row that is reloaded, and a stack in a
    // quick slot to load it from
    case 'reload': {
      const row = getReloadRow(c, action)
      return !!row && isCampaignCharacter(c) && getReloadBar(state, c, row) === null && getRowStack(c, row, action.ammoId) !== null
    }
    // combat.tex "Preparing a reaction": an action it can make and a trigger
    case 'prepare':
      return isPrepareComplete(state, c, action)
    // combat.tex "Push and drag": on the board, at a speed open to the
    // actor, along a way the block allows
    case 'drag': {
      const actor = state.characters[action.actorId]
      const speed = actor ? getPushMovements(actor, action.pull).find((m) => m.kind === action.movement) : undefined
      return state.board !== null && !!speed?.available && action.path.length > 0 && getGroupSteps(state, action) !== null
    }
    // nothing more to declare; a blast is generated with its way already
    // walked out
    case 'cut':
      return getAttackVariant(c, getCutStrike(action), isCombatStarted(state)) !== null
    case 'blast':
    case 'retarget':
    case 'release':
    case 'slip':
    case 'feint':
    case 'holdBack':
    case 'resist':
    case 'assist':
    case 'carry':
    case 'letGo':
    case 'evade':
    case 'brace':
    case 'evasion':
    case 'avoidExplosion':
    case 'prepared':
    case 'follow':
    case 'flee':
    case 'fleeFollowUp':
    case 'spellTest':
    case 'fall':
    case 'swimTest':
      return true
    // abilities.tex "Counterattack": "as long as you are within range"
    case 'counterattack': {
      const strike = getCounterStrike(action, '')
      return getAttackVariant(c, strike, isCombatStarted(state)) !== null && isStrikeOpen(state, action) && isInReach(state, strike, action.targetId ?? '') && isAimOnTarget(state, strike)
    }
  }
}

// A weapon a grapple seized is used by its grapple rows alone, against the
// partner alone: an attack's target, or the attacker a defense answers.
export function isUsedOutsideGrapple(state: SceneState, action: Action): boolean {
  if (!state.binds.some(isGrapple) || !('weaponKey' in action)) return false
  const against = action.kind === 'block' || action.kind === 'intercept' || action.kind === 'guard' || action.kind === 'blockExplosion' ? getRootOf(state, action)?.actorId : action.targetId
  return isSeizedUse(state, action.actorId, action.weaponKey, action.attack, against)
}

// Whether the strike's declaration may be made where it stands
// (rules/strikeDeclaration.ts).
function isStrikeOpen(state: SceneState, holder: StrikeHolder): boolean {
  const ctx = getStrikeContext(state, holder)
  return ctx !== null && isStrikeDeclarationOpen(ctx)
}

// What a strike's variation costs, for the strike or the counterattack
// that pays for it (an opportunity attack's strike pays for itself).
function getStrikeVariantCost(state: SceneState, c: CampaignCharacter, action: ActionOf<'strike' | 'counterattack'>): ActionCost | null {
  const ctx = getStrikeContext(state, action)
  const variant = ctx && getAttackVariant(c, ctx.strike, isCombatStarted(state))
  return variant ? { AP: variant.AP, STA: variant.STA } : null
}

// combat.tex "Preparing a reaction": "The movement part of the action can be
// skipped when performing the reaction, but the other action must be
// performed." What a prepared reaction opened may not be passed up when it is
// that action and there is someone to do it to, nor the movement when passing
// it up would leave the action with nobody in reach; an action with nobody
// to be done to cannot be performed, and is passed up.
export function isPreparedRequired(state: SceneState, action: Action): boolean {
  if (action.kind === 'move' && action.forced && action.step === 'define') return true
  // abilities.tex "Lunge": the jump was made "while using an attack";
  // "Jump Shot": to "perform a quick shot or throw"
  if ((action.kind === 'strike' || action.kind === 'shoot') && action.step === 'define' && getOpeningJumpAttack(state, action) !== null) return isPerformable(state, action)
  if (action.preparedPart === null || action.step !== 'define') return false
  if (action.preparedPart === 'main') return isRoot(action) && isPerformable(state, action)
  const reaction = action.spawnedBy ? getAction(state, action.spawnedBy) : null
  // a defense's movement is its reposition: it may be passed up by one already
  // on the line, and by nobody else, whose defense it would leave unmade
  if (reaction && isPreparedDefense(reaction) && reaction.preparedId !== '') return !isDefensePlaced(state, reaction) && canReposition(state, reaction)
  const prepared = reaction?.kind === 'prepared' ? findPrepared(state, reaction.preparedId) : null
  const main = prepared ? getPreparedMain(prepared, '') : null
  return main !== null && !isPerformable(state, main)
}

function isRoot(action: Action): action is RootAction {
  return !isReaction(action.kind)
}

function isPerformable(state: SceneState, main: RootAction): boolean {
  return !needsTarget(main) || getTargetIds(state, main).length > 0
}

// Whether every reaction declared against the action has said all it must:
// an evasive jump has picked where it lands.
export function areReactionsComplete(state: SceneState, root: Action): boolean {
  return getReactionsTo(state, root.id).every((r) => {
    const c = state.characters[r.actorId]
    return !!c && isDeclarationComplete(state, c, r)
  })
}

// ---------------------------------------------------------------------------
// Costs

// What an action costs its actor, as declared; null while the declaration is
// too incomplete to price. A move pays for the path as it will be walked, cut
// wherever it will stop; a push and the answers to it are priced by the block
// (rules/drag.ts `getPushPrice`).
function getDeclaredCost(state: SceneState, c: CampaignCharacter, action: Action): ActionCost | null {
  switch (action.kind) {
    case 'strike':
    case 'counterattack':
      return getStrikeVariantCost(state, c, action)
    case 'shoot':
      return getVariantCost(c, action, isCombatStarted(state))
    // paid for by the throw, the cast or the detonation that opened it
    case 'explosion':
      return { AP: 0, STA: 0 }
    case 'throw':
      return getThrowCost(c, action.itemId, isCombatStarted(state))
    // gear.tex "Reload": the row's second AP term
    case 'reload': {
      const row = getReloadRow(c, action)
      return row ? getReloadCost(row.atk, c) : null
    }
    case 'slip':
      return getSlipCost(c)
    case 'cut':
      return getVariantCost(c, getCutStrike(action), isCombatStarted(state))
    case 'move':
      return getMovePrice(state, c, action, getWalkedCells(state, action, getMoveFacts(state, action)))
    case 'drag':
      return getPushPrice(state, action, action)
    case 'resist':
    case 'assist':
    case 'carry':
    case 'letGo': {
      const root = getRootOf(state, action)
      return root?.kind === 'drag' ? getPushPrice(state, root, action) : getCatalogCost(c, action.kind)
    }
    // spells.tex "Casting spells": the spell's own price; what it asks beyond
    // AP and STA is paid the same, off the sheet
    case 'cast':
      return isSpellKey(action.key) ? { AP: SPELLS[action.key].cost.AP, STA: SPELLS[action.key].cost.STA } : null
    case 'fireAgain':
      return isSpellKey(action.key) ? getRepeatCost(action.key) : null
    case 'block':
    case 'intercept':
      return withGuardStep(c, action, getActionCost(c, action.kind))
    case 'evade':
    case 'evasiveJump':
      return getActionCost(c, action.kind)
    case 'brace':
    case 'guard':
    case 'avoidExplosion':
    case 'blockExplosion':
    case 'opportunityAttack':
    case 'retarget':
    case 'joinShot':
    case 'prepared':
    case 'follow':
    case 'flee':
    case 'fleeFollowUp':
    case 'spellTest':
    case 'fall':
    case 'swimTest':
    case 'blast':
    case 'release':
    case 'releaseSpell':
    case 'feint':
    case 'holdBack':
    case 'pickUp':
    case 'extinguish':
    case 'plant':
    case 'drink':
    case 'taunt':
    case 'rest':
    case 'prepare':
    case 'evasion':
      return getCatalogCost(c, action.kind)
    case 'grapple':
      return getManeuverCost(c, action.maneuver)
    // abilities.tex "Medicine": the ability's price
    case 'firstAid':
    case 'cauterize':
      return getMedicineCost(action.kind)
    // combat.tex "Social actions": 5 AP; combat.tex "Surrender": unflagging is free
    case 'social':
      return getSocialCost(c, action.say)
  }
}

// What the weapon row and variation the attack is declared with cost.
function getVariantCost(c: CampaignCharacter, action: AttackAction, charged: boolean): ActionCost | null {
  const variant = getAttackVariant(c, action, charged)
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
// a defense, with what the action given up for it refunds.
export function getPayableCost(state: SceneState, action: Action): ActionCost | null {
  if (action.kind === 'explosion' && action.source === 'gm') return { AP: 0, STA: 0 }
  const cost = getOwnCost(state, action)
  const actor = state.characters[action.actorId]
  if (!actor || !cost) return null
  const c = action.reactionTo ? withRefund(state, actor, action.reactionTo) : actor
  if (getActionDef(action.kind).rest) return canOverdraw(c, cost, isCombatStarted(state), getIncomingAP(state)) ? cost : null
  return canAfford(c, cost, isCombatStarted(state)) ? cost : null
}

// Whether the actor could pay for the action opened for them in some way they
// may still declare it, now or after a surge they may make now whose AP may
// pay for it (combat.tex "Action surge").
export function canPayOpened(state: SceneState, action: Action): boolean {
  const c = state.characters[action.actorId]
  if (!c) return false
  if (canPayAsDeclarable(state, action)) return true
  return getSurgeProbes(state, c).some((p) => getSurgeBarFor(p.state, p.state.characters[c.id], action.kind) === null && canPayAsDeclarable(p.state, action))
}

// A strike with no row picked yet, with any row that reaches its target;
// anything else as it stands, or, while it is too incomplete to price, as
// payable.
function canPayAsDeclarable(state: SceneState, action: Action): boolean {
  const c = state.characters[action.actorId]
  if (!c) return false
  if (action.kind === 'strike' && action.weaponKey === '') {
    return getFreeAttackOptions(state, c, 'strike').some((o) => {
      const strike = { ...action, weaponKey: o.weaponKey, attack: o.attack, variant: o.variant }
      return (!action.targetId || isInReach(state, strike, action.targetId)) && getPayableCost(state, strike) !== null
    })
  }
  return getOwnCost(state, action) === null || getPayableCost(state, action) !== null
}

// combat.tex "Concentration": "If any condition for the completion of the
// spell is missing when it finishes, the action fails" — why the held action
// cannot finish now, or null: what it needed to be made, bar the focus surge
// and the price, which holding it has paid.
export function getFinishBar(state: SceneState, held: RootAction): string | null {
  const c = state.characters[held.actorId]
  if (!c || isDead(c)) return 'gone'
  if (hasAffliction(c, 'unconscious')) return 'unconscious'
  if (needsTarget(held) && !isTargetAimed(state, held)) return 'target out of reach'
  switch (held.kind) {
    case 'cast':
      return isSpellKey(held.key) && isCastPossible(c, held.key) && getSpellBoardBar(state, c, held.key) === null && isSuggestionComplete(state, held) ? null : 'cannot be cast'
    case 'shoot':
      return getAttackVariant(c, held, isCombatStarted(state)) !== null && isShotLoaded(c, held) && isAimOnTarget(state, held) ? null : 'cannot be shot'
    case 'firstAid':
    case 'cauterize':
      return hasAbility(c, getMedicineAbility(held.kind)) && isDeclarationComplete(state, c, held) ? null : 'nobody bleeding within reach'
    case 'reload': {
      const row = getReloadRow(c, held)
      return row && getRowStack(c, row, held.ammoId) !== null ? null : 'nothing to load'
    }
    default:
      return isDeclarationComplete(state, c, held) ? null : 'no longer possible'
  }
}

// combat.tex "Concentration": what holding the action over to the next round
// takes now — all the AP the actor has and the STA it costs, when it requires
// concentration, there is not the AP for it, the focus surge is made and the
// actor holds nothing else. Null where it is simply paid for or cannot be held.
export function getHoldCost(state: SceneState, action: Action): ActionCost | null {
  const c = state.characters[action.actorId]
  if (!c || !requiresConcentration(action) || c.usedSurge !== 'focus') return null
  const cost = getOwnCost(state, action)
  if (!cost || canAfford(c, cost, isCombatStarted(state)) || !canHold(c, cost) || getHeldOf(state, c.id)) return null
  return { AP: Math.max(0, c.resources.AP), STA: cost.STA }
}

// Whether the action and every reaction to it can be paid for now, priced as
// the roll or the payment will price them.
export function canPayAll(state: SceneState, root: Action): boolean {
  return [root, ...getReactionsTo(state, root.id)].every((a) => getPayableCost(state, a) !== null)
}

// What the action costs its actor as it stands, whether or not they can pay
// it; null while it is too incomplete to price. A follow-up is priced as
// its recipe says (rules/recipes.ts). Two prices are fixed past it: a flee costs the movement
// surge, and is null once that cannot be made; a sweep is paid once, by the
// strike at its first target (combat.tex "Sweeping Attack").
export function getOwnCost(state: SceneState, action: Action): ActionCost | null {
  const terms = getCostTerms(state, action)
  return terms && terms.reduce((sum, t) => ({ AP: sum.AP + t.AP, STA: sum.STA + t.STA }), { AP: 0, STA: 0 })
}

// The lines `getOwnCost` adds up: what the action is priced at, then what
// its recipe moved that by.
export function getCostTerms(state: SceneState, action: Action): CostTerm[] | null {
  const c = state.characters[action.actorId]
  if (!c) return null
  if (action.kind === 'flee' || action.kind === 'fleeFollowUp') {
    const flee = getFleeCost(c)
    return flee && [{ label: 'movement surge', ...flee }]
  }
  if (action.kind === 'strike' && isSweepLink(action)) return [{ label: 'sweep, paid by its first strike', AP: 0, STA: 0 }]
  if (action.holding) {
    const full = getOwnCost(state, { ...action, holding: false })
    return full && [{ label: 'held over to the next round', AP: Math.max(0, c.resources.AP), STA: full.STA }]
  }
  const own = getDeclaredCost(state, c, action)
  if (!own) return null
  const { declared, label, added } = getOwnModifiedPrice(state, action, own)
  const recipe = getRecipeCost(state, action, declared)
  const modified = addModifierLines(recipe, added)
  const priced = modified.reduce((sum, t) => ({ AP: sum.AP + t.AP, STA: sum.STA + t.STA }), recipe)
  const remaining = { AP: Math.max(0, priced.AP - action.carried.AP), STA: Math.max(0, priced.STA - action.carried.STA) }
  return [
    { label: label ?? getPriceLabel(action), ...declared },
    ...costChange(`recipe ${action.recipe ?? ''}`.trim(), recipe, declared),
    ...modified,
    ...costChange('paid in the round before', remaining, priced),
  ]
}

// What a modifier does to the action's own price. An opportunity attack and a
// preparation are declared with the modifiers of what they open, which is
// what pays for them.
function getOwnModifiedPrice(state: SceneState, action: Action, own: ActionCost): ModifiedPrice {
  return action.kind === 'opportunityAttack' || action.kind === 'prepare' ? { declared: own, label: null, added: [] } : getModifiedPrice(state, action, own)
}

function costChange(label: string, after: ActionCost, before: ActionCost): CostTerm[] {
  return after.AP === before.AP && after.STA === before.STA ? [] : [{ label, AP: after.AP - before.AP, STA: after.STA - before.STA }]
}

// Whether the follow-up an opportunity attack opens is one its attacker can
// pay for, the surge AP they hold included; a declaration still too
// incomplete to price is not yet unaffordable.
export function canAffordOpportunity(state: SceneState, reaction: ActionOf<'opportunityAttack'>): boolean {
  const c = state.characters[reaction.actorId]
  const cost = c && getOwnCost(state, getOpportunityAction(state, reaction, `${reaction.id}-follow-up`))
  return !c || !cost || canAfford(withoutReserve(state, c, reaction.reactionTo), cost, isCombatStarted(state))
}

// What the character's committed opportunity attacks, against actions other
// than `except`, have yet to pay: each opens its follow-up in turn, priced as
// the strike or maneuver it was declared with, and that price is theirs to
// keep back from whatever else they answer meanwhile. One still to be
// declared is not yet priced.
function getOpportunityReserve(state: SceneState, actorId: string, except: string | null): ActionCost {
  return getLiveActions(state).reduce((sum, a) => {
    if (a.kind !== 'opportunityAttack' || a.actorId !== actorId || a.reactionTo === except || getOpenedBy(state, a)) return sum
    const cost = getOwnCost(state, getOpportunityAction(state, a, `${a.id}-follow-up`))
    return cost ? { AP: sum.AP + cost.AP, STA: sum.STA + cost.STA } : sum
  }, { AP: 0, STA: 0 })
}

// The character as they stand to answer something new: the points their
// other committed opportunity attacks will need set aside, AP first.
export function withoutReserve(state: SceneState, c: CampaignCharacter, except: string | null): CampaignCharacter {
  const reserve = getOpportunityReserve(state, c.id, except)
  if (reserve.AP <= 0 && reserve.STA <= 0) return c
  const { AP, STA } = c.resources
  return { ...c, resources: { ...c.resources, AP: AP - reserve.AP, STA: Math.max(0, STA - reserve.STA) } }
}

// What the action's own price is named for: the weapon row and variation of
// an attack, the movement of a move, the spell of a cast, the
// catalog's name for the rest.
function getPriceLabel(action: Action): string {
  if (action.kind === 'strike' || action.kind === 'shoot' || action.kind === 'cut' || action.kind === 'counterattack') {
    return [action.attack, 'variant' in action ? action.variant : ''].filter(Boolean).join(' ') || ACTIONS[action.kind].label
  }
  if ('attack' in action && action.attack) return `${ACTIONS[action.kind].label} with ${action.attack}`
  if (action.kind === 'move') return `${action.movement} move`
  if (action.kind === 'cast' && isSpellKey(action.key)) return SPELLS[action.key].name
  return ACTIONS[action.kind].label
}

// combat.tex "Interruption": "The AP from the interrupted action is
// refunded, but 1 AP is lost" — given back as the answer to the attack the
// action was given up for is paid, and for that one only; the STA is lost.
// An interruption from outside refunds nothing.
export function getRefundedAP(state: SceneState, reactorId: string, rootId: string): number {
  if (!isCombatStarted(state)) return 0
  const fought = getAction(state, rootId)
  const given = fought ? getCancellableRoot(state, fought, reactorId) : null
  if (given && getGivenUpFor(state, given)?.id === rootId) return Math.max(0, (given.cost?.AP ?? 0) + given.carried.AP - 1)
  return getHeldRefund(state, reactorId, rootId)
}

// The character as they stand to pay for their answer to the attack: with the
// AP the action given up for it refunds.
export function withRefund(state: SceneState, c: CampaignCharacter, rootId: string): CampaignCharacter {
  const AP = getRefundedAP(state, c.id, rootId)
  return AP > 0 ? { ...c, resources: { ...c.resources, AP: c.resources.AP + AP } } : c
}

// A block's or an intercept's price, and the STA of the step it is made
// with: a Defender's. A Defensive Advance's step is priced as the modifier
// it is declared as (rules/modifiers.ts), in place of this one.
export function withGuardStep(c: CampaignCharacter, action: ActionOf<'block'> | ActionOf<'intercept'>, cost: ActionCost): ActionCost {
  const step = action.to && !(action.kind === 'intercept' && action.modifiers.advance) ? getActionCost(c, 'defenderStep') : null
  return step ? { AP: cost.AP + step.AP, STA: cost.STA + step.STA } : cost
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
export function isAnswerable(state: SceneState, open: Action): boolean {
  return open.step === 'react'
}

// Whether the move is closed by a die of its own: a climb the first time its
// climber climbs in the round (combat.tex "Climbing"), a walk across difficult
// terrain (combat.tex "Balance"), a swim the first time the swimmer is in
// water in the round (combat.tex "Swimming").
export function needsOwnDie(state: SceneState, action: MoveAction): boolean {
  return action.movement === 'climb' ? needsClimbTest(state, action) : needsBalanceTest(state, action)
}

// Whether the action is closed by a die: a strike always, a move with a test
// of its own, an explosion when a reaction declared against it is a test of
// its own (combat.tex "Avoiding an Explosion").
export function needsDie(state: SceneState, action: Action): boolean {
  if (action.holding) return false
  if (action.kind === 'move') return needsOwnDie(state, action)
  if (action.kind === 'spellTest' && action.accepted) return false
  return ACTIONS[action.kind].die || getReactionsTo(state, action.id).some((r) => ACTIONS[r.kind].die)
}

export function getNextStep(state: SceneState): ActionStep | null {
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
  if (!isTargetAimed(state, open)) return 'target'
  return 'commit'
}

// What the root still waits on once its die is thrown or its cost paid,
// before it lands: HOP to spend on a hit, a grapple to take, a way to point, a
// pick to make, a defender to put somewhere.
function getPostStep(state: SceneState, open: RootAction): ActionStep {
  switch (open.kind) {
    case 'strike':
      return open.roll?.degree === 'hit' && (getHOPOptions(state, open).length > 0 || canGrapple(state, open)) ? 'spend' : 'confirm'
    case 'shoot':
      return open.roll?.degree === 'hit' && getHOPOptions(state, open).length > 0 ? 'spend' : 'confirm'
    case 'cast':
      return open.roll?.degree === 'hit' && getImprovementOptions(state, open).length > 0 ? 'spend' : 'confirm'
    // combat.tex "Sprays": the cone is pointed once the reflexes have moved
    case 'blast':
      return isSpray(open) && open.direction === null ? 'aim' : 'confirm'
    case 'grapple':
      return needsDisarmPick(state, open) ? 'choose' : 'confirm'
    // combat.tex "Crash": the space a won crash puts its defender in
    case 'move':
      return getPendingDisplacement(state, open) ? 'aim' : 'confirm'
    case 'explosion':
    case 'drag':
    case 'release':
    case 'releaseSpell':
    case 'slip':
    case 'feint':
    case 'cut':
    case 'holdBack':
    case 'pickUp':
    case 'throw':
    case 'extinguish':
    case 'plant':
    case 'drink':
    case 'firstAid':
    case 'cauterize':
    case 'reload':
    case 'social':
    case 'taunt':
    case 'rest':
    case 'prepare':
    case 'fireAgain':
    case 'fleeFollowUp':
    case 'spellTest':
    case 'fall':
    case 'swimTest':
      return 'confirm'
  }
}

// Whether the rolled action still waits on its actor: overflow to spend, a
// spray to point, a pick to make, a graze to save, the rest's careful move,
// whether to go along with a won maneuver. One with none lands as it is.
export function hasPostChoice(state: SceneState, open: RootAction): boolean {
  if (isVoided(state, open)) return false
  return getPostStep(state, open) !== 'confirm'
    || canMoveWhileResting(state, open)
    || (open.kind === 'cast' && canSaveGraze(state, open))
    || (open.kind === 'grapple' && (isAlongOffered(state, open) || isGrapplingEffectOffered(open)))
}

// Whether a knockdown or an immobilize that hit asks its actor to go along
// with it for it to land, where whatever opened it allows going along; and
// whether a Grappling Combat attack that landed may immobilize both
// (abilities.tex "Grappling Combat": "Hits can immobilize both characters if
// the attacker so chooses").
export function isAlongOffered(state: SceneState, open: GrappleAction): boolean {
  if (open.step !== 'post' || !isManeuverWon(open) || !allowsAlong(state, open)) return false
  return open.maneuver === 'attack' || (open.roll?.degree === 'hit' && (open.maneuver === 'knockdown' || open.maneuver === 'immobilize'))
}

// Whether a Grappling Combat attack's HOP buy it a special effect to pick.
export function isGrapplingEffectOffered(open: GrappleAction): boolean {
  return open.step === 'post' && open.maneuver === 'attack' && isManeuverWon(open) && getGrapplingHOP(open) >= GRAPPLING_HOP
}

// Who the action may be aimed at: retargeted freely until the commit, nobody
// once it is locked. An attack reaches whoever its row reaches, so it is
// aimed only once a row is picked.
export function getDeclaredTargets(state: SceneState, open: RootAction | null): string[] {
  return isAimingOpen(state, open) ? getTargetIds(state, open) : []
}

// Who the open declaration could be aimed at but its actor has not detected
// (combat.tex "Stealth in combat").
export function getDeclaredHiddenTargets(state: SceneState, open: RootAction | null): string[] {
  return isAimingOpen(state, open) ? getAimableIds(state, open).filter((id) => !notices(state, open.actorId, id)) : []
}

function isAimingOpen(state: SceneState, open: RootAction | null): open is RootAction {
  if (open?.step !== 'define') return false
  const actor = state.characters[open.actorId]
  return !(isAttackAction(open) && (!actor || getAttackVariant(actor, open, isCombatStarted(state)) === null))
}

// The items on the floor the open strike or shot can be aimed at, once it is
// declared with a row that reaches them.
export function getDeclaredFloorTargets(state: SceneState, open: RootAction | null): FloorItem[] {
  if (!open || !isAttackAction(open) || open.step !== 'define') return []
  const actor = state.characters[open.actorId]
  return actor && getAttackVariant(actor, open, isCombatStarted(state)) !== null ? getFloorTargets(state, open) : []
}

// The spaces of the ground the open strike or shot can be aimed at, once it
// is declared with a row that reaches them.
export function getDeclaredCellTargets(state: SceneState, open: RootAction | null): Coord[] {
  if (!open || !isAttackAction(open) || open.step !== 'define') return []
  const actor = state.characters[open.actorId]
  return actor && getAttackVariant(actor, open, isCombatStarted(state)) !== null ? getCellTargets(state, open) : []
}

// Whether the action is aimed at someone it may be aimed at: a character
// among its targets, or for a strike or a shot an item on the floor or a
// space of the ground.
export function isTargetAimed(state: SceneState, open: RootAction): boolean {
  if (open.targetId !== null) return getTargetIds(state, open).includes(open.targetId)
  if (!isAttackAction(open)) return false
  const cell = open.cell
  return cell !== null ? getCellTargets(state, open).some((c) => sameCell(c, cell)) : getFloorTargets(state, open).some((f) => f.item.id === open.object)
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
// be aimed at again. A sweep meets nobody fallen, and nobody twice
// (combat.tex "Sweeping Attack"). Nobody can be aimed at whom the actor has
// not detected (combat.tex "Stealth in combat"). One compelled to attack
// a caster aims at nobody else (rules/stress.ts).
export function getTargetIds(state: SceneState, root: RootAction): string[] {
  return getAimableIds(state, root).filter((id) => notices(state, root.actorId, id) && !isSheltered(state, root.actorId, id) && isCompelledTarget(state, root.actorId, id))
}

function getAimableIds(state: SceneState, root: RootAction): string[] {
  if (!needsTarget(root)) return []
  const others = Object.keys(state.characters).filter((id) => id !== root.actorId)
  switch (root.kind) {
    case 'strike': {
      const swept = isSweep(root) ? root.swept : null
      return others.filter((id) => isInReach(state, root, id) && isGrappleReach(state, root, id) && !isSeizedUse(state, root.actorId, root.weaponKey, root.attack, id)
        && (swept === null || canBeSwept(state, swept, id)))
    }
    case 'shoot':
      return others.filter((id) => isInShotRange(state, root, id) && !isSeizedUse(state, root.actorId, root.weaponKey, root.attack, id))
    case 'cast':
      return others.filter((id) => canAimCast(state, root, id))
    // combat.tex "Grapple": what is done in a grapple is done to a partner —
    // but a maneuver a follow-up opens, at whoever its recipe aimed it at
    // (rules/recipes.ts)
    case 'grapple':
      if (root.recipe !== null) return root.targetId ? [root.targetId] : []
      return getManeuverTargets(state, root.actorId, root.maneuver)
    case 'release':
      return getReleaseTargets(state, root.actorId)
    case 'slip':
      return getSlipTargets(state, root.actorId)
    case 'feint':
      return getFeintTargets(state, root.actorId)
    case 'taunt':
      return getEnemies(state, root.actorId)
    case 'cut':
      return getCutTargets(state, root)
    case 'holdBack':
      if (root.recipe !== null) return root.targetId ? [root.targetId] : []
      return getHoldBackTargets(state, root.actorId)
    case 'firstAid':
    case 'cauterize':
      return getMedicineTargets(state, root.actorId)
    case 'drag':
      return (root.pull ? getPullTargets(state, root.actorId) : getPartners(state, root.actorId)).filter((id) => state.board?.placements[id] !== undefined)
    // aimed at the board, or at nobody
    case 'explosion':
    case 'blast':
    case 'move':
    case 'pickUp':
    case 'throw':
    case 'extinguish':
    case 'plant':
    case 'drink':
    case 'reload':
    case 'social':
    case 'rest':
    case 'prepare':
    case 'fireAgain':
    case 'releaseSpell':
    case 'fleeFollowUp':
    case 'spellTest':
    case 'fall':
    case 'swimTest':
      return []
  }
}
