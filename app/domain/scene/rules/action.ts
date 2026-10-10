import { notices } from './stealth'
import { getHeldPotions } from '../../item/rules/items'
import type { CampaignCharacter, Character } from '../../types'
import type { Action, ActionKind, ActionOf, AttackAction, SceneState, Coord, CostTerm, FloorItem, GrappleAction, MoveAction, RootAction } from '../types'
import { ACTIONS, getActionDef, isAttackAction, isReaction } from './actionCatalog'
import { sameCell } from './board/geometry'
import { SPELLS, isSpellKey } from '../../spells'
import { canCastSpell } from '../../character/rules/spells'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { hasProperty } from '../../weaponProperties'
import { isCampaignCharacter } from '../../utils'
import { isInReach, isInShotRange } from './board/board'
import { isWithinChaseReach } from './chase'
import { getMoveFacts, getMovePrice, hasJumpSpace, isPathLegal, needsBalanceTest } from './move'
import { isTrivialClimb, needsClimbTest } from './board/cliff'
import { canAfford } from '../../character/rules/cost'
import { hasGrant } from '../../character/rules/effects'
import { getChargeOptions, getExplosionPayload, isAimed, isSpray } from './explosion'
import { findTrigger } from './reactions'
import { getCancellableRoot, getGivenUpFor, getOpportunityState, isVoided } from './opportunity'
import { canGrab, getHoldBackTargets, getManeuverTargets, getReleaseTargets, isGrappleReach, isManeuverWon, isSeizedUse, needsDisarmPick } from './grapple'
import { canGrapple, getHOPOptions } from './damage'
import { canMoveWhileResting } from './rest'
import { getGroupSteps, getPushMovements, getPushPrice } from './drag'
import { getPullTargets, getSlipCost, getSlipTargets } from './tether'
import { getCutStrike, getCutTargets } from './cut'
import { getFeintTargets } from './feint'
import { findGrapple, getGrapples, getPartners, isGrapple } from './partners'
import { isExtinguishCell } from './extinguish'
import { canPickUp, getReachableFloor } from './floor'
import { getCellTargets, getFloorTargets } from './floorAttack'
import { canThrowItem, findThrowSource, getThrowCost, isThrowCell } from './throw'
import { findWeaponRow, getRowStack, isRowUsable } from './weaponRow'
import { getAttackVariant, getOpportunityAction, explosionBlockRows, getOpportunityStrike, guardRows, isAimOnTarget, isShotLoaded, isVariantOpen } from './attack'
import { canAimCast, canSaveGraze, getImprovementOptions, isTargeted } from './cast'
import { canAffordRest } from '../../character/rules/rest'
import { getCounterStrike } from './counter'
import { getJoinedShot, isJoinInRange } from './coordinated'
import { isGuardPlaced } from './protect'
import { allowsAlong, getRecipeCost } from './recipes'
import { getAction, getDrawnOpportunityAttacks, getOpenAction, getOpenedBy, getReactionsTo, getRootOf } from './log'
import { getFleeCost } from './flee'
import { canBeSwept, isSweep, isSweepLink, isSweepRowKept } from './sweep'
import { getFireAgainBar, getRepeatCost } from './fireAgain'
import { getReloadBar, getReloadRow } from './reload'
import { getReloadCost } from '../../character/rules/gear'
import { canReposition, findPrepared, getPreparedMain, isDefensePlaced, isPrepareComplete, isPreparedDefense, isRepositionPlaced } from './prepared'

// An action's life in the fight: whether its declaration is complete and
// aimed at someone it may be, what it costs as declared, and the step the
// table is waiting on.

// Whether everything the action needs declared has been, and names things
// its actor can actually use: a strike or a shot a variation of a row in
// hand, an explosion aimed where it can go off, a block or intercept a DEF
// row (gear.tex "DEF"), a guard a shield (combat.tex "Guard": "If using a
// shield"), an opportunity attack a strike that reaches its target from
// where it will be fought.
export function isDeclarationComplete(state: SceneState, c: Character, action: Action): boolean {
  if (isUsedOutsideGrapple(state, action)) return false
  switch (action.kind) {
    case 'strike':
      return getAttackVariant(c, action) !== null && isVariantOpen(state, action, action.variant) && isSweepRowKept(state, action, action) && isAimOnTarget(state, action)
    case 'shoot':
      return getAttackVariant(c, action) !== null && isShotLoaded(c, action) && isAimOnTarget(state, action)
    // cast, the spell was; detonated, a charge it can set off is named
    case 'explosion':
      return (action.source !== 'cast' || isSpellKey(action.key))
        && (action.source !== 'detonate' || getChargeOptions(state, action).some((o) => o.itemId === action.itemId))
        && isAimed(state, action)
    case 'cast':
      return isCampaignCharacter(c) && isSpellKey(action.key) && canCastSpell(c, action.key, action.quicken)
    case 'fireAgain':
      return isCampaignCharacter(c) && isSpellKey(action.key) && getFireAgainBar(state, c, action.key) === null
    case 'move':
      return isPathLegal(state, action) && isRepositionPlaced(state, action)
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
    case 'opportunityAttack': {
      const partner = findGrapple(getGrapples(state), action.actorId, action.targetId ?? '') !== null
      if (action.mode === 'grapple') return partner && getManeuverTargets(state, action.actorId, action.maneuver).includes(action.targetId ?? '')
      const strike = getOpportunityStrike(action, '')
      const fought = getOpportunityState(state, action)
      // combat.tex "Catch": a runner only in grabbing reach is a grab or nothing
      const root = getRootOf(state, action)
      if (root && !action.catch && findTrigger(state, root, action)?.catchOnly) return false
      const cost = getOwnCost(state, strike)
      return getAttackVariant(c, strike) !== null && !!cost && isCampaignCharacter(c) && canAfford(c, cost) && isInReach(fought, strike, action.targetId ?? '') && isVariantOpen(state, action, action.variant) && isAimOnTarget(state, strike)
        && (!action.catch || (canGrab(state, strike, action.targetId ?? '') && isCatchable(state, action)))
    }
    // combat.tex "Coordinated Shots": a shot they can fire, from where they
    // stand, at the target of the shot they join
    case 'joinShot': {
      const shot = getJoinedShot(action, '')
      return getAttackVariant(c, shot) !== null && isShotLoaded(c, shot) && isJoinInRange(state, c.id, shot, action.targetId ?? '') && isAimOnTarget(state, action)
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
    // combat.tex "Throw", "Standard Action": something it can throw, to a
    // cell the throw reaches
    case 'throw': {
      const item = findThrowSource(state, action.actorId, action.itemId)
      return !!item && canThrowItem(c, item) && action.to !== null && isThrowCell(state, action.actorId, action.itemId, action.to)
    }
    // combat.tex "Fire": a burning space within its reach
    case 'extinguish':
      return isExtinguishCell(state, action)
    // gear.tex "Potions and Medicine": a potion in hand
    case 'drink':
      return getHeldPotions(c).some((i) => i.id === action.itemId)
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
      return getAttackVariant(c, getCutStrike(action)) !== null
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
      return getAttackVariant(c, strike) !== null && isVariantOpen(state, strike, strike.variant) && isInReach(state, strike, action.targetId ?? '') && isAimOnTarget(state, strike)
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

// combat.tex "Catch" is against a running target; nothing lets a jumper be
// grabbed in the air (combat.tex "jumping": a jump "cannot be voluntarily
// interrupted in the middle").
export function isCatchable(state: SceneState, reaction: ActionOf<'opportunityAttack'>): boolean {
  const root = getRootOf(state, reaction)
  return root?.kind === 'move' && root.movement === 'run' && root.actorId === reaction.targetId
}

// combat.tex "Preparing a reaction": "The movement part of the action can be
// skipped when performing the reaction, but the other action must be
// performed." What a prepared reaction opened may not be passed up when it is
// that action and there is someone to do it to, nor the movement when passing
// it up would leave the action with nobody in reach; an action with nobody
// to be done to cannot be performed, and is passed up.
export function isPreparedRequired(state: SceneState, action: Action): boolean {
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
    // combat.tex "Catch": "The catcher must spend 3 AP + 1STA to perform a
    // strike with a weapon with the grapple property"
    case 'strike':
      if (action.catch) return getAttackVariant(c, action) ? getActionCost(c, 'catch') : null
      return getVariantCost(c, action)
    case 'shoot':
      return getVariantCost(c, action)
    // paid for by the throw, the cast or the detonation that opened it
    case 'explosion':
      return { AP: 0, STA: 0 }
    case 'throw':
      return getThrowCost(c, action.itemId)
    // gear.tex "Reload": the row's second AP term
    case 'reload': {
      const row = getReloadRow(c, action)
      return row ? getReloadCost(row.atk, c) : null
    }
    case 'slip':
      return getSlipCost(c)
    case 'cut':
      return getVariantCost(c, getCutStrike(action))
    case 'counterattack':
      return getVariantCost(c, getCounterStrike(action, ''))
    case 'move':
      return getMovePrice(state, c, action, action.movement === 'climb' ? action.path.length : getMoveFacts(state, action).path.length)
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
    case 'evasion':
      return getEvasionCost(c, action.stay)
    case 'block':
    case 'intercept':
      return withGuardStep(c, action, getActionCost(c, action.kind))
    case 'evade':
    case 'brace':
    case 'evasiveJump':
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
    case 'feint':
    case 'holdBack':
    case 'pickUp':
    case 'extinguish':
    case 'drink':
    case 'rest':
    case 'prepare':
    case 'grapple':
      return getCatalogCost(c, action.kind)
  }
}

// What the weapon row and variation the attack is declared with cost.
function getVariantCost(c: CampaignCharacter, action: AttackAction): ActionCost | null {
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
export function getPayableCost(state: SceneState, action: Action): ActionCost | null {
  const cost = getOwnCost(state, action)
  const c = state.characters[action.actorId]
  if (!c || !cost) return null
  if (action.kind === 'rest') return canAffordRest(c) ? cost : null
  return canAfford(c, cost) ? cost : null
}

// Whether the action and every reaction to it can be paid for now, priced as
// the roll or the payment will price them.
export function canPayAll(state: SceneState, root: Action): boolean {
  return [root, ...getReactionsTo(state, root.id)].every((a) => getPayableCost(state, a) !== null)
}

// What the action costs its actor as it stands, whether or not they can pay
// it; null while it is too incomplete to price. A follow-up is priced as
// its recipe says (rules/recipes.ts), and a reaction less the AP repurposed
// towards it. Three prices are fixed past both: a flee costs the movement
// surge, and is null once that cannot be made; a sweep is paid once, by the
// strike at its first target (combat.tex "Sweeping Attack"); a held spell's
// upkeep is free.
export function getOwnCost(state: SceneState, action: Action): ActionCost | null {
  const terms = getCostTerms(state, action)
  return terms && terms.reduce((sum, t) => ({ AP: sum.AP + t.AP, STA: sum.STA + t.STA }), { AP: 0, STA: 0 })
}

// The lines `getOwnCost` adds up: what the action is priced at, then what
// its recipe and the AP repurposed towards it moved that by.
export function getCostTerms(state: SceneState, action: Action): CostTerm[] | null {
  const c = state.characters[action.actorId]
  if (!c) return null
  if (action.kind === 'flee' || action.kind === 'fleeFollowUp') {
    const flee = getFleeCost(c)
    return flee && [{ label: 'movement surge', ...flee }]
  }
  if (action.kind === 'strike' && isSweepLink(action)) return [{ label: 'sweep, paid by its first strike', AP: 0, STA: 0 }]
  if (action.kind === 'fireAgain' && action.upkeep) return [{ label: 'held spell upkeep', AP: 0, STA: 0 }]
  const declared = getDeclaredCost(state, c, action)
  if (!declared) return null
  const recipe = getRecipeCost(state, action, declared)
  const priced = action.reactionTo ? lessRepurposed(state, action.actorId, action.reactionTo, recipe) : recipe
  return [
    { label: getPriceLabel(action), ...declared },
    ...costChange(`recipe ${action.recipe ?? ''}`.trim(), recipe, declared),
    ...costChange('AP repurposed from the action given up', priced, recipe),
  ]
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
  return !c || !cost || canAfford(withoutReserve(state, c, reaction.reactionTo), cost)
}

// What the character's committed opportunity attacks, against actions other
// than `except`, have yet to pay: each opens its follow-up in turn, priced as
// the strike or maneuver it was declared with, and that price is theirs to
// keep back from whatever else they answer meanwhile. One still to be
// declared is not yet priced.
function getOpportunityReserve(state: SceneState, actorId: string, except: string | null): ActionCost {
  return state.actions.reduce((sum, a) => {
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
  const { AP, surgeAP, STA } = c.resources
  const fromAP = Math.min(AP, reserve.AP)
  return { ...c, resources: { ...c.resources, AP: AP - fromAP, surgeAP: Math.max(0, surgeAP - (reserve.AP - fromAP)), STA: Math.max(0, STA - reserve.STA) } }
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

// combat.tex "Interruption": "The AP from the interrupted action can be
// repurposed for the reaction, but the amount spent must be the highest
// between the action and the reaction" — the AP the given-up action cost
// pays towards the answer to the attack it was given up for, and that one
// only; AP it does not use is lost, and STA is paid in full.
export function getRepurposedAP(state: SceneState, reactorId: string, rootId: string): number {
  const fought = getAction(state, rootId)
  const given = fought ? getCancellableRoot(state, fought, reactorId) : null
  return given && getGivenUpFor(state, given)?.id === rootId ? given.cost?.AP ?? 0 : 0
}

// A reaction's price less the AP repurposed towards it.
export function lessRepurposed(state: SceneState, reactorId: string, rootId: string, cost: ActionCost): ActionCost {
  const AP = getRepurposedAP(state, reactorId, rootId)
  return AP > 0 ? { AP: Math.max(0, cost.AP - AP), STA: cost.STA } : cost
}

// A block's or an intercept's price, and the STA of the step it is made
// with: a Defensive Advance's, or a Defender's.
export function withGuardStep(c: CampaignCharacter, action: ActionOf<'block'> | ActionOf<'intercept'>, cost: ActionCost): ActionCost {
  const step = action.kind === 'intercept' && action.advance ? getActionCost(c, 'defensiveAdvance') : action.to ? getActionCost(c, 'defenderStep') : null
  return step ? { AP: cost.AP + step.AP, STA: cost.STA + step.STA } : cost
}

// combat.tex "Evasion": "spend 3 AP to react"; abilities.tex "Precise
// Reflexes": "If the character uses reflexes without moving, reflexes only
// cost 1 AP."
export function getEvasionCost(c: CampaignCharacter, stay: boolean): ActionCost {
  return stay && hasGrant(c, 'stillReflex') ? { AP: 1, STA: 0 } : getActionCost(c, 'reflex')
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

// How many tests an interrupting attack could have the climber make: one for
// each opportunity attack drawn against the climb (combat.tex "Climbing").
export function getClimbRedoCount(state: SceneState, action: MoveAction): number {
  return action.movement === 'climb' && !isTrivialClimb(state, action) ? getDrawnOpportunityAttacks(state, action).length : 0
}

// Whether the action is closed by a die: a strike always, a move with a test
// of its own, or a climb with attacks drawn against it, an explosion when a
// reaction declared against it is a test of its own (combat.tex "Avoiding
// an Explosion").
export function needsDie(state: SceneState, action: Action): boolean {
  if (action.kind === 'move') return needsOwnDie(state, action) || getClimbRedoCount(state, action) > 0
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
// pick to make.
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
    case 'explosion':
    case 'move':
    case 'drag':
    case 'release':
    case 'slip':
    case 'feint':
    case 'cut':
    case 'holdBack':
    case 'pickUp':
    case 'throw':
    case 'extinguish':
    case 'drink':
    case 'reload':
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
    || (open.kind === 'grapple' && isAlongOffered(state, open))
}

// Whether a knockdown or an immobilize that hit asks its actor to go along
// with it for it to land, where whatever opened it allows going along.
export function isAlongOffered(state: SceneState, open: GrappleAction): boolean {
  return open.step === 'post' && isManeuverWon(open) && allowsAlong(state, open) && open.roll?.degree === 'hit' && (open.maneuver === 'knockdown' || open.maneuver === 'immobilize')
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
  return !(isAttackAction(open) && (!actor || getAttackVariant(actor, open) === null))
}

// The items on the floor the open strike or shot can be aimed at, once it is
// declared with a row that reaches them.
export function getDeclaredFloorTargets(state: SceneState, open: RootAction | null): FloorItem[] {
  if (!open || !isAttackAction(open) || open.step !== 'define') return []
  const actor = state.characters[open.actorId]
  return actor && getAttackVariant(actor, open) !== null ? getFloorTargets(state, open) : []
}

// The spaces of the ground the open strike or shot can be aimed at, once it
// is declared with a row that reaches them.
export function getDeclaredCellTargets(state: SceneState, open: RootAction | null): Coord[] {
  if (!open || !isAttackAction(open) || open.step !== 'define') return []
  const actor = state.characters[open.actorId]
  return actor && getAttackVariant(actor, open) !== null ? getCellTargets(state, open) : []
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
// not detected (combat.tex "Stealth in combat").
export function getTargetIds(state: SceneState, root: RootAction): string[] {
  return getAimableIds(state, root).filter((id) => notices(state, root.actorId, id) && isWithinChaseReach(state, root, id))
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
    case 'cut':
      return getCutTargets(state, root)
    case 'holdBack':
      return getHoldBackTargets(state, root.actorId)
    case 'drag':
      return (root.pull ? getPullTargets(state, root.actorId) : getPartners(state, root.actorId)).filter((id) => state.board?.placements[id] !== undefined)
    // aimed at the board, or at nobody
    case 'explosion':
    case 'blast':
    case 'move':
    case 'pickUp':
    case 'throw':
    case 'extinguish':
    case 'drink':
    case 'reload':
    case 'rest':
    case 'prepare':
    case 'fireAgain':
    case 'fleeFollowUp':
    case 'spellTest':
    case 'fall':
    case 'swimTest':
      return []
  }
}
