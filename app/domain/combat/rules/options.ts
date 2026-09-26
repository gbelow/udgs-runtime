import type { CampaignCharacter } from '../../types'
import type { Action, ActionDraft, ActionKind, CombatState } from '../types'
import { ACTIONS, getActionDef, getActionNoun, reactsTo } from './actionCatalog'
import { GRAPPLE_MANEUVERS } from '../../lists'
import { getAfflictions, isImmobile } from '../../character/rules/afflictions'
import { ActionCost, getActionCost } from '../../character/rules/actionCosts'
import { canAfford } from '../../character/rules/cost'
import { getMoveCost, getMovementOptions, hasJumpSpace, isMidJump } from './move'
import { getChargeOptions, hasExplosionPayload } from './explosion'
import { getTriggersFor } from './reactions'
import { getCancellableRoot } from './opportunity'
import { canStandByEscape, getHoldBackTargets, getManeuverTargets, getReleaseTargets, isGrappleRowOf } from './grapple'
import { getPartners, isHeld } from './partners'
import { canPickUp, getReachableFloor } from './floor'
import { getEvasionCost, isAnswerable, lessRepurposed } from './action'
import { canAnswer, getOpenAction, getReactionsTo } from './log'
import { defRows, getAttackOptions, guardRows, hasUnfocusedRow } from './attack'
import { getSpellOptions } from './cast'

// What can be declared: every action and reaction open to a character right
// now, each available or closed with the reason, so a command can refuse
// exactly what the list shows as closed.

export type ActionOption = {
  label: string
  draft: ActionDraft
  cost: ActionCost | null
  available: boolean
  reason: string | null
  // the open action this option answers, for a reaction; null for an action
  reactionTo: string | null
  // a reaction the character has already declared
  chosen: boolean
}

// While an opportunity attack against `defenderId` answers a still-live
// action of their own, that action is what defending actively gives up
// (`getGivenUpFor`); named for the panel.
export function getCancellableLabel(state: CombatState, root: Action, defenderId: string): string | null {
  const triggering = getCancellableRoot(state, root, defenderId)
  if (!triggering) return null
  return getActionNoun(triggering)
}

// combat.tex "Grapple" — "Attack and Defend": "It is not possible to evade or
// block attacks, only intercept." combat.tex "Evasive Jump": "only ... if
// there is space to jump"; "jumping": a jump "cannot be voluntarily
// interrupted in the middle".
function defenseGate(state: CombatState, defender: CampaignCharacter, root: Action, kind: ActionKind, cost: ActionCost): { available: boolean; reason: string | null } {
  if (!canAfford(defender, cost)) return { available: false, reason: 'cannot afford' }
  if (isImmobile(defender)) return { available: false, reason: 'immobile' }
  if (reactsTo(kind, 'strike') && kind !== 'intercept' && getAfflictions(defender).includes('grappled')) return { available: false, reason: 'grappled' }
  if (kind === 'evasiveJump' && isMidJump(state, defender.id)) return { available: false, reason: 'mid-jump' }
  if (kind === 'evasiveJump' && !hasJumpSpace(state, defender.id, root.actorId)) return { available: false, reason: 'no space to jump' }
  return { available: true, reason: null }
}

// Everything the character may declare right now: their own actions while no
// action is open, and their reactions while a committed action triggers
// something in them and is still waiting for its die. A reaction's options
// are one per thing it can be done with, so a block names the weapon it
// blocks with.
export function getAvailableActions(state: CombatState, characterId: string): ActionOption[] {
  const c = state.characters[characterId]
  if (!c) return []
  const open = getOpenAction(state)

  if (!open) {
    const strikes = getAttackOptions(c, 'strike')
    const shots = getAttackOptions(c, 'shoot')
    const explosions = getAttackOptions(c, 'explosion').filter((o) => hasExplosionPayload(c, o.weaponKey, o.attack))
    const spells = getSpellOptions(c)
    const placed = state.board?.placements[c.id] !== undefined
    const movable = getMovementOptions(state, c).some((m) => m.available)
    const grabs = strikes.filter((o) => isGrappleRowOf(c, o.weaponKey, o.attack))
    return closeIfImmobile(c, [
      {
        label: ACTIONS.strike.label,
        draft: { kind: 'strike' },
        cost: null,
        available: strikes.length > 0,
        reason: strikes.length > 0 ? null : 'no melee weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      // combat.tex "Initiate the Grab": a strike with a grapple row
      {
        label: 'grab',
        draft: { kind: 'strike', grab: true },
        cost: null,
        available: grabs.length > 0,
        reason: grabs.length > 0 ? null : 'no grapple weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      {
        label: ACTIONS.shoot.label,
        draft: { kind: 'shoot' },
        cost: null,
        available: shots.length > 0,
        reason: shots.length > 0 ? null : hasUnfocusedRow(c, 'shoot') ? 'needs a focus surge' : 'no shooting weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      // an explosion is aimed at ground, so it needs a board to land on
      {
        label: ACTIONS.explosion.label,
        draft: { kind: 'explosion', source: 'thrown' },
        cost: null,
        available: explosions.length > 0 && placed,
        reason: explosions.length > 0 ? (placed ? null : 'not on the board') : hasUnfocusedRow(c, 'explosion') ? 'needs a focus surge' : getAttackOptions(c, 'explosion').length > 0 ? 'nothing charged into it' : 'no exploding weapon in hand',
        reactionTo: null,
        chosen: false,
      },
      // combat.tex "Explosions": "If the explosion occurs before being
      // perceived, no test can be made" — a charge or a trap set off by the
      // table, from wherever the active character stands
      {
        label: 'set off a charge',
        draft: { kind: 'explosion', source: 'detonate' },
        cost: null,
        available: placed && getChargeOptions(state).length > 0,
        reason: placed ? (getChargeOptions(state).length > 0 ? null : 'nothing is charged') : 'not on the board',
        reactionTo: null,
        chosen: false,
      },
      {
        label: ACTIONS.move.label,
        draft: { kind: 'move' },
        cost: null,
        available: placed && movable,
        reason: placed ? (movable ? null : getMovementOptions(state, c).find((m) => m.reason)?.reason ?? 'cannot move') : 'not on the board',
        reactionTo: null,
        chosen: false,
      },
      {
        label: ACTIONS.cast.label,
        draft: { kind: 'cast' },
        cost: null,
        available: spells.some((s) => s.castable || s.quickenable),
        reason: spells.some((s) => s.castable || s.quickenable) ? null : spells.length > 0 ? 'no spell castable now' : 'no spell learned',
        reactionTo: null,
        chosen: false,
      },
      ...getGrappleOptions(state, c),
      getPickUpOption(state, c),
    ])
  }

  if (!isAnswerable(state, open) || !canAnswer(open, characterId)) return []
  const declared = getReactionsTo(state, open.id).find((r) => r.actorId === characterId) ?? null
  const chosen = (draft: ActionDraft) => declared !== null && sameDraft(draft, declared)

  return getTriggersFor(state, open, characterId).flatMap((trigger): ActionOption[] => {
    const kind = trigger.kind
    const price = ACTIONS[kind].price
    const cost = lessRepurposed(state, c.id, open.id, price ? getActionCost(c, price) : { AP: 0, STA: 0 })
    const gate = defenseGate(state, c, open, kind, cost)
    const option = (label: string, draft: ActionDraft, own: ActionCost | null = cost): ActionOption =>
      ({ label, draft, cost: own, ...gate, reactionTo: open.id, chosen: chosen(draft) })
    switch (kind) {
      case 'block':
      case 'intercept':
        return defRows(c).map((row) => option(`${ACTIONS[kind].label} with ${row.weapon.name}`, { kind, weaponKey: row.wielded.key, attack: row.atk.name }))
      case 'guard':
        return guardRows(state, c, open).map((row) => option(`${ACTIONS[kind].label} with ${row.weapon.name}`, { kind, weaponKey: row.wielded.key, attack: row.atk.name }))
      // combat.tex "Evasion" lets the evader move after the shot; one who
      // stays put gives that up, for Precise Reflexes' price if they have it
      case 'evasion':
        return [
          option(ACTIONS[kind].label, { kind }),
          option(`${ACTIONS[kind].label}, staying put`, { kind, stay: true }, lessRepurposed(state, c.id, open.id, getEvasionCost(c, true))),
        ]
      // where an evasive jump lands is picked on the board, not here
      case 'evasiveJump':
        return [option(ACTIONS[kind].label, { kind })]
      // combat.tex "Opportunity Attack": "The attack requires the normal AP
      // cost" — it is open only to someone who can pay for a strike, or,
      // against a grapple partner, for a maneuver or a push (combat.tex
      // "Grapple Maneuvers", "Push and drag": "can be used like opportunity
      // attacks")
      case 'opportunityAttack': {
        const strikes = getAttackOptions(c, 'strike')
        const partner = getPartners(state, c.id).includes(open.actorId)
        const affordable = strikes.some((s) => canAfford(c, { AP: s.AP, STA: s.STA }))
          || (partner && (canAfford(c, getActionCost(c, 'grappleManeuver')) || canAfford(c, getActionCost(c, 'pushDrag'))))
        const reason = strikes.length === 0 && !partner ? 'no melee weapon in hand' : affordable ? null : 'cannot afford a strike'
        const name = trigger.catchOnly ? 'catch' : ACTIONS[kind].label
        const label = trigger.at ? `${name} at step ${trigger.catchOnly ? trigger.at - 1 : trigger.at}` : name
        return [{ ...option(label, { kind, at: trigger.at }, null), available: reason === null, reason }]
      }
      // combat.tex "Push and drag": going along is paid in the basic
      // movement of the metres moved, at least one to be open;
      // letting go is only for one nobody holds
      case 'carry': {
        const most = open.kind === 'drag' ? getMoveCost(c, 'basic', 1) : { AP: 0, STA: 0 }
        return [{ ...option(ACTIONS[kind].label, { kind }, most), available: gate.available && canAfford(c, most), reason: gate.reason ?? (canAfford(c, most) ? null : 'cannot afford') }]
      }
      case 'letGo': {
        const reason = isHeld(state.grapples, c.id) ? 'held' : null
        return [{ ...option(ACTIONS[kind].label, { kind }), available: gate.available && reason === null, reason: gate.reason ?? reason }]
      }
      // combat.tex "Follow": a move of the follower's own, so it is open only
      // to someone who can pay for one
      case 'follow': {
        const reason = getMovementOptions(state, c).some((m) => m.available && canAfford(c, m.block)) ? null : 'cannot afford a move'
        return [{ ...option(ACTIONS[kind].label, { kind }, null), available: reason === null, reason }]
      }
      default:
        return [option(ACTIONS[kind].label, { kind })]
    }
  })
}

// combat.tex "Grapple": what a character in a grapple can do about it — the
// maneuvers, open to "any of the participants" whatever they hold; getting
// up, which in a grapple is an escape; pushing or dragging; letting go of a
// partner who does not hold back; grappling back one held with nothing, once
// a grapple row is in hand. Nothing, outside of one.
function getGrappleOptions(state: CombatState, c: CampaignCharacter): ActionOption[] {
  if (getPartners(state, c.id).length === 0) return []
  const option = (label: string, draft: ActionDraft, cost: ActionCost | null, reason: string | null): ActionOption =>
    ({ label, draft, cost, available: reason === null, reason, reactionTo: null, chosen: false })
  const maneuver = getActionCost(c, 'grappleManeuver')
  const drag = getActionCost(c, 'pushDrag')
  const placed = state.board?.placements[c.id] !== undefined
  const afford = (cost: ActionCost) => (canAfford(c, cost) ? null : 'cannot afford')
  return [
    ...GRAPPLE_MANEUVERS.map((m) =>
      option(m, { kind: 'grapple', maneuver: m }, maneuver, getManeuverTargets(state, c.id, m).length === 0 ? 'nobody holds you' : afford(maneuver))),
    option('stand up', { kind: 'grapple', maneuver: 'escape', stand: true }, maneuver, canStandByEscape(state, c) ? afford(maneuver) : 'not prone'),
    option(ACTIONS.drag.label, { kind: 'drag' }, drag, !placed ? 'not on the board' : afford(drag)),
    option(ACTIONS.release.label, { kind: 'release' }, { AP: 0, STA: 0 }, getReleaseTargets(state, c.id).length > 0 ? null : 'held back'),
    ...(getHoldBackTargets(state, c.id).length > 0 ? [option(ACTIONS.holdBack.label, { kind: 'holdBack' }, { AP: 0, STA: 0 }, null)] : []),
  ]
}

// combat.tex "Standard Action": "This is used to pick up items from the
// floor".
function getPickUpOption(state: CombatState, c: CampaignCharacter): ActionOption {
  const cost = getActionCost(c, 'standardAction')
  const reachable = getReachableFloor(state, c.id).filter((f) => canPickUp(c, f.item))
  const reason = state.floor.length === 0 ? 'nothing on the floor'
    : reachable.length === 0 ? (getReachableFloor(state, c.id).length > 0 ? 'no free hand' : 'nothing within reach')
    : canAfford(c, cost) ? null : 'cannot afford'
  return { label: ACTIONS.pickUp.label, draft: { kind: 'pickUp' }, cost, available: reason === null, reason, reactionTo: null, chosen: false }
}

// combat.tex "Immobile": "Cannot move and cannot use any combat or movement
// skills other than escape."
function closeIfImmobile(c: CampaignCharacter, options: ActionOption[]): ActionOption[] {
  if (!isImmobile(c)) return options
  return options.map((o) => (o.draft.kind === 'grapple' && o.draft.maneuver === 'escape') ? o : { ...o, available: false, reason: 'immobile' })
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
