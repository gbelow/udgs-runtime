import type { CampaignCharacter } from '../../types'
import type { Action, ActionDraft, ActionKind, ActionOf, CombatState, DeclarableKind } from '../types'
import { ACTIONS, getActionDef, reactsTo } from './actionCatalog'
import { GRAPPLE_MANEUVERS } from '../../lists'
import { isImmobile, hasAffliction } from '../../character/rules/afflictions'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { getMovementOptions, hasJumpSpace, isMidJump } from './move'
import { isProne } from './ground'
import { getPushAnswerCost } from './drag'
import { getChargeOptions, hasExplosionPayload } from './explosion'
import { getTriggersFor } from './reactions'
import { getHoldBackTargets, getManeuverTargets, getReleaseTargets, isGrappleRowOf } from './grapple'
import { getPartners, isHeld } from './partners'
import { canPickUp, canThrowItem, getReachableFloor } from './floor'
import { getEvasionCost, isAnswerable, lessRepurposed, withGuardStep } from './action'
import { getGuardSteps, isGuardPlaced, needsGuardStep } from './protect'
import { makeAction } from '../factories'
import { canAnswer, getOpenAction, getReactionsTo } from './log'
import { defRows, getAttackOptions, guardRows, hasUnfocusedRow, hasUnloadedRow } from './attack'
import { getSpellOptions } from './cast'
import { getSurgeBarFor } from './surge'
import { isInTurn } from './turn'

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
}

function option(draft: ActionDraft, cost: ActionCost | null, reason: string | null, reactionTo: string | null = null, chosen = false): ActionOption {
  return { draft, cost, available: reason === null, reason, reactionTo, chosen }
}

// combat.tex "Grapple" — "Attack and Defend": "It is not possible to evade or
// block attacks, only intercept." combat.tex "Evasive Jump": "only ... if
// there is space to jump"; "jumping": a jump "cannot be voluntarily
// interrupted in the middle". combat.tex "Prone": "Can only crawl and stand
// up"; "Lame": "Cannot ... jump".
function defenseGate(state: CombatState, defender: CampaignCharacter, root: Action, kind: ActionKind, cost: ActionCost): string | null {
  if (!canAfford(defender, cost)) return 'cannot afford'
  if (isImmobile(defender)) return 'immobile'
  if (reactsTo(kind, 'strike') && kind !== 'intercept' && kind !== 'counterattack' && hasAffliction(defender, 'grappled')) return 'grappled'
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

  if (!open) return closeOutOfTurn(state, c, closeBySurge(c, closeIfImmobile(c, Object.values(OWN_OPTIONS).flatMap((own) => own(state, c)))))

  if (!isAnswerable(state, open) || !canAnswer(open, characterId)) return []
  const declared = getReactionsTo(state, open.id).find((r) => r.actorId === characterId) ?? null
  const chosen = (draft: ActionDraft) => declared !== null && sameDraft(draft, declared)

  return closeBySurge(c, getTriggersFor(state, open, characterId).flatMap((trigger): ActionOption[] => {
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
          const guards = [makeAction(kind, base), ...(kind === 'intercept' && c.abilities.includes('defensive-advance') ? [makeAction('intercept', { ...base, advance: true })] : [])]
          return guards.map((guard) => {
            const { cost: own, reason } = guardOption(state, c, open, guard, gate)
            const draft: ActionDraft = guard.kind === 'intercept' && guard.advance ? { kind: 'intercept', weaponKey: base.weaponKey, attack: base.attack, advance: true } : { kind, weaponKey: base.weaponKey, attack: base.attack }
            return answer(draft, lessRepurposed(state, c.id, open.id, own), reason)
          })
        })
      case 'guard':
        return guardRows(state, c, open).map((row) => answer({ kind, weaponKey: row.wielded.key, attack: row.atk.name }))
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
        const strikes = getAttackOptions(c, 'strike')
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
        return [answer({ kind }, cost, gate ?? (isHeld(state.grapples, c.id) ? 'held' : null))]
      }
      // abilities.tex "Counterattack": a strike of their own, so it is open
      // only to someone who can pay for one
      case 'counterattack': {
        const strikes = getAttackOptions(c, 'strike')
        const reason = strikes.length === 0 ? 'no melee weapon in hand' : strikes.some((s) => canAfford(c, { AP: s.AP, STA: s.STA })) ? null : 'cannot afford a strike'
        return [answer({ kind }, null, gate ?? reason)]
      }
      // combat.tex "Follow": a move of the follower's own, so it is open only
      // to someone who can pay for one
      case 'follow': {
        const reason = getMovementOptions(state, c).some((m) => m.available && canAfford(c, m.block)) ? null : 'cannot afford a move'
        return [answer({ kind }, null, reason)]
      }
    }
  }))
}

// The actions a character may take on their own initiative, one entry per
// kind a player declares (`DeclarableKind`), each listing its options in
// the order the panel shows them.
type OwnOptions = (state: CombatState, c: CampaignCharacter) => ActionOption[]

const OWN_OPTIONS: { [K in DeclarableKind]: OwnOptions } = {
  strike: (_state, c) => {
    const strikes = getAttackOptions(c, 'strike')
    const grabs = strikes.filter((o) => isGrappleRowOf(c, o.weaponKey, o.attack))
    return [
      option({ kind: 'strike' }, null, strikes.length > 0 ? null : 'no melee weapon in hand'),
      // combat.tex "Initiate the Grab": a strike with a grapple row
      option({ kind: 'strike', grab: true }, null, grabs.length > 0 ? null : 'no grapple weapon in hand'),
    ]
  },
  shoot: (_state, c) => {
    const shots = getAttackOptions(c, 'shoot')
    const reason = shots.length > 0 ? null
      : hasUnfocusedRow(c, 'shoot') ? 'needs a focus surge'
      : hasUnloadedRow(c, 'shoot') ? 'no arrows or bolts in a quick slot'
      : 'no shooting weapon in hand'
    return [option({ kind: 'shoot' }, null, reason)]
  },
  explosion: (state, c) => {
    const placed = isPlaced(state, c)
    const explosions = getAttackOptions(c, 'explosion').filter((o) => hasExplosionPayload(c, o.weaponKey, o.attack))
    const reason = explosions.length > 0 ? (placed ? null : 'not on the board')
      : hasUnfocusedRow(c, 'explosion') ? 'needs a focus surge'
      : getAttackOptions(c, 'explosion').length > 0 ? 'nothing charged into it'
      : 'no exploding weapon in hand'
    return [
      // an explosion is aimed at ground, so it needs a board to land on
      option({ kind: 'explosion', source: 'thrown' }, null, reason),
      // combat.tex "Explosions": "If the explosion occurs before being
      // perceived, no test can be made" — a charge or a trap set off by the
      // table, from wherever the active character stands
      option({ kind: 'explosion', source: 'detonate' }, null, !placed ? 'not on the board' : getChargeOptions(state).length > 0 ? null : 'nothing is charged'),
    ]
  },
  move: (state, c) => {
    const movable = getMovementOptions(state, c).some((m) => m.available)
    return [option({ kind: 'move' }, null, !isPlaced(state, c) ? 'not on the board' : movable ? null : getMovementOptions(state, c).find((m) => m.reason)?.reason ?? 'cannot move')]
  },
  cast: (_state, c) => {
    const spells = getSpellOptions(c)
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
  drag: (state, c) => {
    if (!isInAnyGrapple(state, c)) return []
    return [option({ kind: 'drag' }, null, !isPlaced(state, c) ? 'not on the board' : isProne(state, c.id) ? 'prone' : null)]
  },
  release: (state, c) => {
    if (!isInAnyGrapple(state, c)) return []
    return [option({ kind: 'release' }, { AP: 0, STA: 0 }, getReleaseTargets(state, c.id).length > 0 ? null : 'held back')]
  },
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
  // combat.tex "Standard Action": "throwing items with bulk smaller than
  // character size by up to 10m" — from a free hand or the floor.
  throwItem: (state, c) => {
    const cost = getActionCost(c, 'standardAction')
    const throwable = [...c.held, ...getReachableFloor(state, c.id).map((f) => f.item)].filter((item) => canThrowItem(c, item))
    const reason = !isPlaced(state, c) ? 'not on the board'
      : throwable.length === 0 ? 'nothing small enough to throw'
      : afford(c, cost)
    return [option({ kind: 'throwItem' }, cost, reason)]
  },
}

function isPlaced(state: CombatState, c: CampaignCharacter): boolean {
  return state.board?.placements[c.id] !== undefined
}

function isInAnyGrapple(state: CombatState, c: CampaignCharacter): boolean {
  return getPartners(state, c.id).length > 0
}

function afford(c: CampaignCharacter, cost: ActionCost): string | null {
  return canAfford(c, cost) ? null : 'cannot afford'
}

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
function closeIfImmobile(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  if (!isImmobile(c)) return options
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
function closeBySurge(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return closeWith(options, (o) => getSurgeBarFor(c, o.draft.kind))
}

// play.tex "Combat": a character acts in their own turn; outside it, only
// reactions and what they open.
function closeOutOfTurn(state: CombatState, c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  return isInTurn(state, c.id) ? options : closeWith(options, () => 'not your turn')
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
