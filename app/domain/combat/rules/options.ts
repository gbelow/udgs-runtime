import type { CampaignCharacter, SurgeKind } from '../../types'
import type { Action, ActionDraft, ActionKind, ActionOf, CombatState, DeclarableKind, RootAction } from '../types'
import { ACTIONS, getActionDef, reactsTo } from './actionCatalog'
import { GRAPPLE_MANEUVERS } from '../../lists'
import { hasAffliction } from '../../character/rules/afflictions'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { canSurge } from '../../character/rules/surge'
import { actionSurge } from '../../character/commands/actionSurge'
import { hasGrant } from '../../character/rules/abilities'
import { getMovementOptions, hasJumpSpace, isMidJump } from './move'
import { isProne } from './ground'
import { getPushAnswerCost } from './drag'
import { getTriggersFor } from './reactions'
import { getHoldBackTargets, getManeuverTargets, getReleaseTargets, isGrappleRowOf } from './grapple'
import { getPartners, getGrapples, isHeld, isTether } from './partners'
import { getPullTargets, getSlipCost, getSlipTargets } from './tether'
import { getFeintBar } from './feint'
import { canPickUp, getReachableFloor } from './floor'
import { canThrowItem, getThrowCost, getThrowables } from './throw'
import { getEvasionCost, isAnswerable, isUsedOutsideGrapple, lessRepurposed, withGuardStep } from './action'
import { getGuardSteps, isGuardPlaced, needsGuardStep } from './protect'
import { makeAction } from '../factories'
import { canAnswer, getOpenAction, getReactionsTo } from './log'
import { defRows, getFreeAttackOptions, guardRows, hasUnfocusedRow, hasUnloadedRow } from './attack'
import { getSpellOptions } from './cast'
import { isSpellKey } from '../../spells'
import { getFireAgainBar, getFireAgainOptions, getRepeatCost } from './fireAgain'
import { getFleeBarFor, getSurgeBarFor } from './surge'
import { getFleeBar, getFleeCost } from './flee'
import { isJoinInRange } from './coordinated'
import { SURGES } from '../../tables'
import { isInTurn } from './turn'
import { isConcentrating } from '../../character/rules/concentration'
import { canAffordRest } from '../../character/rules/rest'
import { hasFightAffliction, isImmobile, isSuffocating } from './situational'

// What can be declared: every action and reaction open to a character right
// now, each available or closed with the reason, so a command can refuse
// exactly what the list shows as closed.

export type ActionOption = {
  draft: ActionDraft
  cost: ActionCost | null
  available: boolean
  reason: string | null
  // the open action this option answers, for a reaction; null for an action
  reactionTo: string | null
  // a reaction the character has already declared
  chosen: boolean
  // the surge to make first, for a reaction the character can pay only with it
  surge: SurgeKind | null
}

function option(draft: ActionDraft, cost: ActionCost | null, reason: string | null, reactionTo: string | null = null, chosen = false): ActionOption {
  return { draft, cost, available: reason === null, reason, reactionTo, chosen, surge: null }
}

// combat.tex "Grapple" — "Attack and Defend": "It is not possible to evade or
// block attacks, only intercept." combat.tex "Evasive Jump": "only ... if
// there is space to jump"; "jumping": a jump "cannot be voluntarily
// interrupted in the middle". combat.tex "Prone": "Can only crawl and stand
// up"; "Lame": "Cannot ... jump".
function defenseGate(state: CombatState, defender: CampaignCharacter, root: Action, kind: ActionKind, cost: ActionCost): string | null {
  if (!canAfford(defender, cost)) return 'cannot afford'
  if (isImmobile(state, defender)) return 'immobile'
  if (reactsTo(kind, 'strike') && kind !== 'intercept' && kind !== 'counterattack' && hasFightAffliction(state, defender, 'grappled')) return 'grappled'
  if (kind === 'evasiveJump' && isProne(state, defender.id)) return 'prone'
  if (kind === 'evasiveJump' && hasAffliction(defender, 'lame')) return 'lame'
  if (kind === 'evasiveJump' && isMidJump(state, defender.id)) return 'mid-jump'
  if (kind === 'evasiveJump' && !hasJumpSpace(state, defender.id, root.actorId)) return 'no space to jump'
  return null
}

// A block or an intercept as it may be made against a strike: whether it
// can be made from where its defender stands, or from a step they can
// still take (`needsGuardStep`), and its price with that step. Against
// anything else, as it stands.
function guardOption(state: CombatState, c: CampaignCharacter, root: Action, guard: ActionOf<'block'> | ActionOf<'intercept'>, gate: string | null): { cost: ActionCost; reason: string | null } {
  const cost = withGuardStep(c, guard, getActionCost(c, guard.kind))
  if (root.kind !== 'strike') return { cost, reason: gate }
  const stepping = needsGuardStep(state, root, guard)
  const placed = stepping || isGuardPlaced(state, root, guard)
  const priced = stepping && !(guard.kind === 'intercept' && guard.advance) ? withGuardStep(c, { ...guard, to: getGuardSteps(state, root, guard)[0] }, getActionCost(c, guard.kind)) : cost
  const reason = gate ?? (!canAfford(c, priced) ? 'cannot afford' : placed ? null : guard.kind === 'intercept' ? 'out of short range' : 'off the line')
  return { cost: priced, reason }
}

// Whether anyone has an answer open to the committed action. With none, the
// table owes it nothing before its die.
export function hasOpenAnswer(state: CombatState): boolean {
  return Object.keys(state.characters).some((id) => getAvailableActions(state, id).some((o) => o.available))
}

// Everything the character may declare right now: their own actions while no
// action is open and it is their turn, and their reactions while a committed
// action triggers something in them and is still waiting for its die. A
// reaction's options are one per thing it can be done with, so a block names
// the weapon it blocks with. While a surge's AP is left, only what it allows
// is open.
export function getAvailableActions(state: CombatState, characterId: string): ActionOption[] {
  const c = state.characters[characterId]
  if (!c) return []
  const open = getOpenAction(state)

  if (!open) return closeOutOfTurn(state, c, closeWhileFleeing(state, c, closeBySurge(state, c, closeWhileConcentrating(c, closeIfImmobile(state, c, Object.values(OWN_OPTIONS).flatMap((own) => own(state, c)))))))

  if (!isAnswerable(state, open) || !canAnswer(open, characterId)) return []
  return withReactionSurge(state, c, open)
}

// combat.tex "Action surge": the reaction surge is made outside one's own turn,
// so a reaction the character cannot pay now is still open to them if the
// surge would let them — the surge made first, then the reaction.
function withReactionSurge(state: CombatState, c: CampaignCharacter, open: RootAction): ActionOption[] {
  const now = getAnswers(state, c, open)
  if (now.every((o) => o.available) || !canSurge('reaction')(c)) return now
  const surged = actionSurge('reaction')(c)
  const after = getAnswers({ ...state, characters: { ...state.characters, [c.id]: surged } }, surged, open)
  return now.map((o) => {
    if (o.available) return o
    const viaSurge = after.find((a) => a.available && sameDraft(a.draft, o.draft))
    return viaSurge ? { ...viaSurge, surge: 'reaction' } : o
  })
}

function getAnswers(state: CombatState, c: CampaignCharacter, open: RootAction): ActionOption[] {
  const characterId = c.id
  const declared = getReactionsTo(state, open.id).find((r) => r.actorId === characterId) ?? null
  const chosen = (draft: ActionDraft) => declared !== null && sameDraft(draft, declared)

  return closeBySurge(state, c, closeWhileConcentrating(c, getTriggersFor(state, open, characterId).flatMap((trigger): ActionOption[] => {
    const kind = trigger.kind
    const price = ACTIONS[kind].price
    const own = open.kind === 'drag' ? getPushAnswerCost(state, open, { kind, actorId: c.id }) : price ? getActionCost(c, price) : { AP: 0, STA: 0 }
    const cost = lessRepurposed(state, c.id, open.id, own)
    const gate = defenseGate(state, c, open, kind, cost)
    const answer = (draft: ActionDraft, own: ActionCost | null = cost, reason: string | null = gate): ActionOption =>
      option(draft, own, reason, open.id, chosen(draft))
    switch (kind) {
      case 'block':
      case 'intercept':
        return defRows(c).flatMap((row) => {
          const base = { id: '', actorId: c.id, reactionTo: open.id, weaponKey: row.wielded.key, attack: row.atk.name }
          const guards = [makeAction(kind, base), ...(kind === 'intercept' && hasGrant(c, 'advancingIntercept') ? [makeAction('intercept', { ...base, advance: true })] : [])]
          return guards.map((guard) => {
            const { cost: own, reason } = guardOption(state, c, open, guard, gate)
            const draft: ActionDraft = guard.kind === 'intercept' && guard.advance ? { kind: 'intercept', weaponKey: base.weaponKey, attack: base.attack, advance: true } : { kind, weaponKey: base.weaponKey, attack: base.attack }
            return answer(draft, lessRepurposed(state, c.id, open.id, own), reason ?? seizedReason(state, guard))
          })
        })
      case 'guard':
        return guardRows(state, c, open).map((row) => {
          const draft = { kind, weaponKey: row.wielded.key, attack: row.atk.name }
          return answer(draft, cost, gate ?? seizedReason(state, makeAction(kind, { ...draft, id: '', actorId: c.id, reactionTo: open.id })))
        })
      // combat.tex "Evasion" lets the evader move after the shot; one who
      // stays put gives that up, for Precise Reflexes' price if they have it
      case 'evasion':
        return [
          answer({ kind }),
          answer({ kind, stay: true }, lessRepurposed(state, c.id, open.id, getEvasionCost(c, true))),
        ]
      // nothing to pick among; where an evasive jump lands is picked on the
      // board, not here
      case 'evade':
      case 'brace':
      case 'evasiveJump':
      case 'avoidExplosion':
      case 'resist':
        return [answer({ kind })]
      // combat.tex "Push and drag": a helper walks with the block, and may
      // "spend 2 AP to gain 5 force" besides
      case 'assist': {
        if (open.kind !== 'drag') return []
        const boosted = getPushAnswerCost(state, open, { kind, actorId: c.id, boost: true })
        return [answer({ kind }), answer({ kind, boost: true }, boosted, gate ?? (canAfford(c, boosted) ? null : 'cannot afford'))]
      }
      // combat.tex "Opportunity Attack": "The attack requires the normal AP
      // cost" — it is open only to someone who can pay for a strike, or,
      // against a grapple partner, for a maneuver (combat.tex "Grapple
      // Maneuvers": "can be used like opportunity attacks")
      case 'opportunityAttack': {
        const strikes = getFreeAttackOptions(state, c, 'strike')
        const partner = getPartners(state, c.id).includes(open.actorId)
        const affordable = strikes.some((s) => canAfford(c, { AP: s.AP, STA: s.STA }))
          || (partner && canAfford(c, getActionCost(c, 'grappleManeuver')))
        const reason = strikes.length === 0 && !partner ? 'no melee weapon in hand' : affordable ? null : 'cannot afford a strike'
        return [answer({ kind, at: trigger.at }, null, reason)]
      }
      // combat.tex "Push and drag": tagging along is paid in the movement of
      // the block; one with no AP to move stays put and counts passively,
      // or, held by nobody, lets go
      case 'carry':
        return [answer({ kind }, cost, gate ?? (canAfford(c, cost) ? null : 'cannot afford'))]
      case 'letGo': {
        return [answer({ kind }, cost, gate ?? (isHeld(getGrapples(state), c.id) ? 'held' : null))]
      }
      // a held spray aimed anew: open to whoever could fire it again, paid
      // from their own AP — the focus surge holding it took is the only
      // surge it needs
      case 'retarget': {
        const key = trigger.key
        if (!key || !isSpellKey(key)) return []
        return [answer({ kind, key, at: trigger.at }, getRepeatCost(key), isImmobile(state, c) ? 'immobile' : getFireAgainBar(state, c, key))]
      }
      // combat.tex "Coordinated Shots": a shot of their own, so it is open
      // only to someone who can pay for one that reaches the target
      case 'joinShot': {
        const shots = getFreeAttackOptions(state, c, 'shoot')
        const reaching = shots.filter((s) => isJoinInRange(state, c.id, s, trigger.against ?? ''))
        const reason = shots.length === 0 ? (hasUnfocusedRow(c, 'shoot') ? 'needs a focus surge' : hasUnloadedRow(c, 'shoot') ? 'no arrows or bolts in a quick slot' : 'no shooting weapon in hand')
          : reaching.length === 0 ? 'out of range'
          : reaching.some((s) => canAfford(c, { AP: s.AP, STA: s.STA })) ? null : 'cannot afford a shot'
        return [answer({ kind }, null, gate ?? reason)]
      }
      // abilities.tex "Counterattack": a strike of their own, so it is open
      // only to someone who can pay for one
      case 'counterattack': {
        const strikes = getFreeAttackOptions(state, c, 'strike')
        const reason = strikes.length === 0 ? 'no melee weapon in hand' : strikes.some((s) => canAfford(c, { AP: s.AP, STA: s.STA })) ? null : 'cannot afford a strike'
        return [answer({ kind }, null, gate ?? reason)]
      }
      // combat.tex "Flee": paid with the movement surge, made as it is
      // paid
      case 'flee':
        return [answer({ kind, at: trigger.at }, getFleeCost(c) ?? { AP: 0, STA: SURGES.movement.STA }, getFleeBar(state, c))]
      // combat.tex "Follow": a move of the follower's own, so it is open only
      // to someone who can pay for one
      case 'follow': {
        const reason = getMovementOptions(state, c).some((m) => m.available && canAfford(c, m.block)) ? null : 'cannot afford a move'
        return [answer({ kind }, null, reason)]
      }
    }
  })))
}

// The actions a character may take on their own initiative, one entry per
// kind a player declares (`DeclarableKind`), each listing its options in
// the order the panel shows them.
type OwnOptions = (state: CombatState, c: CampaignCharacter) => ActionOption[]

const OWN_OPTIONS: { [K in DeclarableKind]: OwnOptions } = {
  strike: (state, c) => {
    const strikes = getFreeAttackOptions(state, c, 'strike')
    const grabs = strikes.filter((o) => isGrappleRowOf(c, o.weaponKey, o.attack))
    return [
      option({ kind: 'strike' }, null, strikes.length > 0 ? null : 'no melee weapon in hand'),
      // combat.tex "Initiate the Grab": a strike with a grapple row
      option({ kind: 'strike', grab: true }, null, grabs.length > 0 ? null : 'no grapple weapon in hand'),
    ]
  },
  shoot: (state, c) => {
    const shots = getFreeAttackOptions(state, c, 'shoot')
    const reason = shots.length > 0 ? null
      : hasUnfocusedRow(c, 'shoot') ? 'needs a focus surge'
      : hasUnloadedRow(c, 'shoot') ? 'no arrows or bolts in a quick slot'
      : 'no shooting weapon in hand'
    return [option({ kind: 'shoot' }, null, reason)]
  },
  move: (state, c) => {
    const movable = getMovementOptions(state, c).some((m) => m.available)
    return [option({ kind: 'move' }, null, !isPlaced(state, c) ? 'not on the board' : movable ? null : getMovementOptions(state, c).find((m) => m.reason)?.reason ?? 'cannot move')]
  },
  // a held spell fired again without the casting test (the table's ruling)
  fireAgain: (state, c) => getFireAgainOptions(state, c).map(({ key, reason }) => option({ kind: 'fireAgain', key }, getRepeatCost(key), reason)),
  cast: (state, c) => {
    const spells = getSpellOptions(state, c)
    const castable = spells.some((s) => s.castable || s.quickenable)
    return [option({ kind: 'cast' }, null, castable ? null : spells.length > 0 ? 'no spell castable now' : 'no spell learned')]
  },
  // combat.tex "Grapple": what a character in a grapple can do about it — the
  // maneuvers, open to "any of the participants" whatever they hold; getting
  // up, which in a grapple is an escape; pushing or dragging; letting go of a
  // partner who does not hold back; grappling back one held with nothing, once
  // a grapple row is in hand. Nothing, outside of one.
  grapple: (state, c) => {
    if (!isInAnyGrapple(state, c)) return []
    const maneuver = getActionCost(c, 'grappleManeuver')
    return [
      ...GRAPPLE_MANEUVERS.map((m) =>
        option({ kind: 'grapple', maneuver: m }, maneuver, getManeuverTargets(state, c.id, m).length === 0 ? 'nobody holds you' : afford(c, maneuver))),
    ]
  },
  // combat.tex "Prone": "cannot push nor drag"
  // gear.tex "Net": a tether is pulled by either end, a grapple pushed or dragged
  drag: (state, c) => {
    const reason = !isPlaced(state, c) ? 'not on the board' : isProne(state, c.id) ? 'prone' : null
    return [
      ...(isInAnyGrapple(state, c) ? [option({ kind: 'drag' }, null, reason)] : []),
      ...(getPullTargets(state, c.id).length > 0 ? [option({ kind: 'drag', pull: true }, null, reason)] : []),
    ]
  },
  release: (state, c) => {
    if (!isInAnyGrapple(state, c)) return []
    return [option({ kind: 'release' }, { AP: 0, STA: 0 }, getReleaseTargets(state, c.id).length > 0 ? null : 'held back')]
  },
  // gear.tex "Equipment Breakage": a net is cut with a melee weapon in hand
  cut: (state, c) => {
    if (!state.binds.some(isTether)) return []
    return [option({ kind: 'cut' }, null, getFreeAttackOptions(state, c, 'strike').length > 0 ? null : 'no melee weapon in hand')]
  },
  // gear.tex "Net": a tethered character slips the net it was caught in
  slip: (state, c) => {
    if (getSlipTargets(state, c.id).length === 0) return []
    const cost = getSlipCost(c)
    return [option({ kind: 'slip' }, cost, afford(c, cost))]
  },
  // combat.tex "Turns and Actions" ("Feint"): a test against someone in melee
  feint: (state, c) => [option({ kind: 'feint' }, { AP: 0, STA: 0 }, getFeintBar(state, c))],
  holdBack: (state, c) => {
    if (!isInAnyGrapple(state, c) || getHoldBackTargets(state, c.id).length === 0) return []
    return [option({ kind: 'holdBack' }, { AP: 0, STA: 0 }, null)]
  },
  // combat.tex "Standard Action": "This is used to pick up items from the
  // floor".
  pickUp: (state, c) => {
    const cost = getActionCost(c, 'standardAction')
    const reachable = getReachableFloor(state, c.id).filter((f) => canPickUp(c, f.item))
    const reason = state.floor.length === 0 ? 'nothing on the floor'
      : reachable.length === 0 ? (getReachableFloor(state, c.id).length > 0 ? 'no free hand' : 'nothing within reach')
      : canAfford(c, cost) ? null : 'cannot afford'
    return [option({ kind: 'pickUp' }, cost, reason)]
  },
  // combat.tex "Throw", "Standard Action": something held or on the floor
  // in reach, at its throwing row's price or a standard action's
  throw: (state, c) => {
    const throwable = getThrowables(state, c).filter((item) => canThrowItem(c, item))
    const reason = !isPlaced(state, c) ? 'not on the board'
      : throwable.length === 0 ? 'nothing it can throw'
      : throwable.some((item) => canAfford(c, getThrowCost(c, item.id))) ? null : 'cannot afford'
    return [option({ kind: 'throw' }, null, reason)]
  },
  // combat.tex "Rest"
  rest: (state, c) => {
    const cost = getActionCost(c, 'rest')
    return [option({ kind: 'rest' }, cost, isSuffocating(state, c) ? 'cannot breathe' : canAffordRest(c) ? null : 'cannot afford')]
  },
}

function isPlaced(state: CombatState, c: CampaignCharacter): boolean {
  return state.board?.placements[c.id] !== undefined
}

function isInAnyGrapple(state: CombatState, c: CampaignCharacter): boolean {
  return getPartners(state, c.id).length > 0
}

function seizedReason(state: CombatState, action: Action): string | null {
  return isUsedOutsideGrapple(state, action) ? 'held in a grapple' : null
}

function afford(c: CampaignCharacter, cost: ActionCost): string | null {
  return canAfford(c, cost) ? null : 'cannot afford'
}

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
function closeIfImmobile(state: CombatState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  if (!isImmobile(state, c)) return options
  return options.map((o) => (o.draft.kind === 'grapple' && o.draft.maneuver === 'escape') ? o : { ...o, available: false, reason: 'immobile' })
}

function closeWith(options: ActionOption[], reasonFor: (o: ActionOption) => string | null): ActionOption[] {
  return options.map((o) => {
    const reason = o.available ? reasonFor(o) : null
    return reason ? { ...o, available: false, reason } : o
  })
}

// combat.tex "Action surge": an earmarked surge's AP is spent only on what
// the surge allows, and until it is, nothing else can be done.
// spells.tex "Sustained Spells": a caster holding a spell does nothing but
// cast what it lets them (rules/cast.ts `getSpellOptions` says which), or
// fire what they hold again — no
// moving, no answering (abilities.tex "Battle Mage" is what would allow
// either).
function closeWhileConcentrating(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return isConcentrating(c) ? closeWith(options, (o) => (o.draft.kind === 'cast' || o.draft.kind === 'fireAgain' || o.draft.kind === 'retarget' ? null : 'concentrating')) : options
}

function closeBySurge(state: CombatState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWith(options, (o) => getSurgeBarFor(state, c, o.draft.kind))
}

// combat.tex "Flee": a flee turn allows only what the movement surge does.
function closeWhileFleeing(state: CombatState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWith(options, (o) => getFleeBarFor(state, c, o.draft.kind))
}

// play.tex "Combat": a character acts in their own turn; outside it, only
// reactions and what they open — and a rest, the table's ruling.
function closeOutOfTurn(state: CombatState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return isInTurn(state, c.id) ? options : closeWith(options, (o) => (o.draft.kind === 'rest' ? null : 'not your turn'))
}

// The option a draft would take, so a command can refuse exactly what the
// list shows as closed.
export function findOption(state: CombatState, characterId: string, draft: ActionDraft): ActionOption | null {
  return getAvailableActions(state, characterId).find((o) => sameDraft(o.draft, draft)) ?? null
}

// Two drafts are the same option when they are of one kind and agree on
// every field the catalog names as telling that kind's options apart.
function sameDraft(option: ActionDraft, draft: ActionDraft): boolean {
  if (option.kind !== draft.kind) return false
  const identity: Record<string, unknown> = getActionDef(option.kind).identity ?? {}
  const a: Record<string, unknown> = option
  const b: Record<string, unknown> = draft
  return Object.entries(identity).every(([field, unset]) => (a[field] ?? unset) === (b[field] ?? unset))
}
