import type { ActionRoll, CombatState, Coord, HitLocation } from '../types'
import type { CampaignCharacter, MovementKind } from '../../types'
import { ACTIONS } from '../actionCatalog'
import { Term, sumTerms } from '../../character/lenses/terms'
import {
  ActionOption,
  ActionStep,
  LocationOption,
  StrikeOption,
  getAttackTerms,
  getAvailableActions,
  getDLTerms,
  getDeclaredCost,
  getLocationOptions,
  getNextStep,
  getOpenAction,
  getReactionsTo,
  getStrikeOptions,
  getTargetIds,
  isDeclarationComplete,
} from './action'
import { ActionCost } from '../../character/lenses/actionCosts'
import { HOPOption, Outcome, getHOPOptions, getHOPRemaining, getOutcomePreview } from './damage'
import { MovementOption, ReachableCell, getMovementOptions, getReachableCells } from './move'

// The open action as the panel reads it, every field final.
export type OpenActionView = {
  id: string
  label: string
  actor: string
  target: string | null
  // the declaration a strike has made so far
  weapon: string
  attack: string
  variant: string
  location: HitLocation
  // the declaration a move has made so far
  movement: MovementKind
  path: Coord[]
  cost: ActionCost | null
  // the defender's answer, if given
  reaction: { label: string; cost: ActionCost | null } | null
  // the test as it stands: the attacker's side and the defender's
  score: { terms: Term[]; total: number }
  DL: { terms: Term[]; total: number }
  roll: ActionRoll | null
}

export type ActionPanelView = {
  step: ActionStep | null
  open: OpenActionView | null
  // with nothing open: what the active character can declare; at `react`:
  // what the target can answer with
  options: ActionOption[]
  strikes: StrikeOption[]
  locations: LocationOption[]
  targets: { id: string; name: string }[]
  // why the target list is empty, when it is
  noTargets: string | null
  canRoll: boolean
  // for a move being declared: the kinds of movement open to the actor and
  // every cell the declared kind can reach
  moves: MovementOption[]
  reachable: ReachableCell[]
  canCommit: boolean
  // once rolled: what the hit's overflow can buy, and what the strike does
  // to the target as it stands
  hop: { remaining: number; options: HOPOption[] }
  outcome: Outcome | null
}

const EMPTY: ActionPanelView = { step: null, open: null, options: [], strikes: [], locations: [], targets: [], noTargets: null, canRoll: false, moves: [], reachable: [], canCommit: false, hop: { remaining: 0, options: [] }, outcome: null }

// Everything the action panel shows, in one shape off the fight. The active
// character is who declares; the open action's target is who reacts, so the
// two never need the roster switched between them.
export function getActionPanel(state: CombatState): ActionPanelView {
  const step = getNextStep(state)
  const open = getOpenAction(state)
  const active = state.activeCharacterId ? state.characters[state.activeCharacterId] : undefined

  if (!open) {
    return { ...EMPTY, options: active ? getAvailableActions(state, active.id) : [] }
  }

  const actor = state.characters[open.actorId]
  const target = open.targetId ? state.characters[open.targetId] : undefined
  const reaction = getReactionsTo(state, open.id).find((r) => r.actorId === open.targetId) ?? null
  const reactor = reaction ? state.characters[reaction.actorId] : undefined
  const strike = open.kind === 'strike' ? open : null
  const move = open.kind === 'move' && open.status === 'declared' ? open : null

  return {
    step,
    open: {
      id: open.id,
      label: ACTIONS[open.kind].label,
      actor: actor?.fightName ?? '',
      target: target?.fightName ?? null,
      weapon: strike?.weaponKey ?? '',
      attack: strike?.attack ?? '',
      variant: strike?.variant ?? '',
      location: strike?.location ?? 'chest',
      movement: open.kind === 'move' ? open.movement : 'basic',
      path: open.kind === 'move' ? open.path : [],
      cost: actor ? getDeclaredCost(actor, open) : null,
      reaction: reaction ? { label: ACTIONS[reaction.kind].label, cost: reactor ? getDeclaredCost(reactor, reaction) : null } : null,
      score: breakdown(strike && actor ? getAttackTerms(actor, strike) : []),
      DL: breakdown(getDLTerms(state, open)),
      roll: open.roll,
    },
    options: step === 'react' && open.targetId ? getAvailableActions(state, open.targetId) : [],
    strikes: strike && step === 'declare' && actor ? getStrikeOptions(actor) : [],
    locations: strike ? getLocationOptions() : [],
    targets: step === 'target' ? getTargetIds(state, open).map((id) => ({ id, name: state.characters[id].fightName ?? '' })) : [],
    noTargets: step === 'target' && getTargetIds(state, open).length === 0
      ? (Object.keys(state.characters).length > 1 ? 'nobody in reach' : 'nobody else in the fight')
      : null,
    canRoll: step === 'react' && !!actor && isDeclarationComplete(state, actor, open),
    moves: move && actor ? getMovementOptions(state, actor) : [],
    reachable: move ? getReachableCells(state, move.actorId, move.movement) : [],
    canCommit: step === 'commit' && !!actor && canPay(actor, getDeclaredCost(actor, open)),
    hop: strike && target && strike.status === 'rolled'
      ? { remaining: getHOPRemaining(strike, target), options: getHOPOptions(state, strike) }
      : { remaining: 0, options: [] },
    outcome: open.status === 'rolled' ? getOutcomePreview(state, open) : null,
  }
}

function canPay(c: CampaignCharacter, cost: ActionCost | null): boolean {
  return cost !== null && c.resources.AP >= cost.AP && c.resources.STA >= cost.STA
}

function breakdown(terms: Term[]): { terms: Term[]; total: number } {
  return { terms, total: sumTerms(terms) }
}

export function getActionPanelDigest(state: CombatState): string {
  return JSON.stringify(getActionPanel(state))
}
