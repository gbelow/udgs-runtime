import type { ActionRoll, CombatState, Coord, HitLocation } from '../types'
import type { CampaignCharacter, MovementKind } from '../../types'
import { ACTIONS } from '../actionCatalog'
import { Term, sumTerms } from '../../character/lenses/terms'
import {
  ActionOption,
  ActionStep,
  ReactorOptions,
  getReactors,
  needsDie,
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
import { MovementOption, ReachableCell, getBalanceDL, getBalanceTestTerms, getMoveFacts, getMovementOptions, getReachableCells } from './move'
import type { MoveStop } from '../types'

// The open action as the panel reads it, every field final.
export type OpenActionView = {
  id: string
  label: string
  actor: string
  target: string | null
  targetId: string | null
  // the declaration a strike has made so far
  weapon: string
  attack: string
  variant: string
  location: HitLocation
  // the declaration a move has made so far
  movement: MovementKind
  path: Coord[]
  // how far the move will actually get and why it stops there
  walked: { cells: number; stop: MoveStop } | null
  // an opportunity attack, or a follow: what opened it
  spawned: boolean
  cost: ActionCost | null
  // every reaction declared so far, by whom
  reactions: { actor: string; label: string; cost: ActionCost | null }[]
  // the test as it stands: the attacker's side and the defender's
  score: { terms: Term[]; total: number }
  DL: { terms: Term[]; total: number }
  roll: ActionRoll | null
}

export type ActionPanelView = {
  step: ActionStep | null
  open: OpenActionView | null
  // with nothing open: what the active character can declare
  options: ActionOption[]
  // at `react`: everyone the open action triggers something in, with their
  // options; the target's defenses are among them
  reactors: ReactorOptions[]
  strikes: StrikeOption[]
  locations: LocationOption[]
  targets: { id: string; name: string }[]
  // why the target list is empty, when it is
  noTargets: string | null
  // whether the open action is closed by a die or by paying
  die: boolean
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

const EMPTY: ActionPanelView = { step: null, open: null, options: [], reactors: [], strikes: [], locations: [], targets: [], noTargets: null, die: false, canRoll: false, moves: [], reachable: [], canCommit: false, hop: { remaining: 0, options: [] }, outcome: null }

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
  const reactions = getReactionsTo(state, open.id)
  const strike = open.kind === 'strike' ? open : null
  const move = open.kind === 'move' && open.status === 'declared' ? open : null
  const die = needsDie(state, open)
  const complete = !!actor && isDeclarationComplete(state, actor, open)
  const facts = open.kind === 'move' ? (open.facts ?? getMoveFacts(state, open)) : null

  return {
    step,
    open: {
      id: open.id,
      label: ACTIONS[open.kind].label,
      actor: actor?.fightName ?? '',
      target: target?.fightName ?? null,
      targetId: open.targetId,
      weapon: strike?.weaponKey ?? '',
      attack: strike?.attack ?? '',
      variant: strike?.variant ?? '',
      location: strike?.location ?? 'chest',
      movement: open.kind === 'move' ? open.movement : 'basic',
      path: open.kind === 'move' ? open.path : [],
      walked: facts && open.kind === 'move' && open.path.length > 0 ? { cells: facts.path.length, stop: facts.stop } : null,
      spawned: open.spawnedBy !== null,
      cost: actor ? getDeclaredCost(actor, open) : null,
      reactions: reactions.map((r) => ({
        actor: state.characters[r.actorId]?.fightName ?? '',
        label: ACTIONS[r.kind].label,
        cost: state.characters[r.actorId] ? getDeclaredCost(state.characters[r.actorId], r) : null,
      })),
      score: breakdown(strike && actor ? getAttackTerms(actor, strike) : open.kind === 'move' && actor && die ? getBalanceTestTerms(actor) : []),
      DL: breakdown(strike ? getDLTerms(state, open) : open.kind === 'move' && die ? [{ label: 'terrain', value: getBalanceDL(state, open) }] : []),
      roll: open.roll,
    },
    options: [],
    reactors: step === 'react' ? getReactors(state, open) : [],
    strikes: strike && step === 'declare' && actor ? getStrikeOptions(actor) : [],
    locations: strike ? getLocationOptions() : [],
    targets: step === 'target' ? getTargetIds(state, open).map((id) => ({ id, name: state.characters[id].fightName ?? '' })) : [],
    noTargets: step === 'target' && getTargetIds(state, open).length === 0
      ? (Object.keys(state.characters).length > 1 ? 'nobody in reach' : 'nobody else in the fight')
      : null,
    die,
    canRoll: step === 'react' && die && complete,
    moves: move && actor ? getMovementOptions(state, actor) : [],
    reachable: move ? getReachableCells(state, move.actorId, move.movement) : [],
    canCommit: step === 'react' && !die && complete && !!actor && canPay(actor, getDeclaredCost(actor, open)),
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
