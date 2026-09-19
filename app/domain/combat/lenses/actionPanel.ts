import type { ActionRoll, CombatState, HitLocation } from '../types'
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
  canRoll: boolean
}

const EMPTY: ActionPanelView = { step: null, open: null, options: [], strikes: [], locations: [], targets: [], canRoll: false }

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
      cost: actor ? getDeclaredCost(actor, open) : null,
      reaction: reaction ? { label: ACTIONS[reaction.kind].label, cost: reactor ? getDeclaredCost(reactor, reaction) : null } : null,
      score: breakdown(strike && actor ? getAttackTerms(actor, strike) : []),
      DL: breakdown(getDLTerms(state, open)),
      roll: open.roll,
    },
    options: step === 'react' && open.targetId ? getAvailableActions(state, open.targetId) : [],
    strikes: step === 'declare' && actor ? getStrikeOptions(actor) : [],
    locations: strike ? getLocationOptions() : [],
    targets: step === 'target' ? getTargetIds(state, open).map((id) => ({ id, name: state.characters[id].fightName ?? '' })) : [],
    canRoll: step === 'react' && !!actor && isDeclarationComplete(actor, open),
  }
}

function breakdown(terms: Term[]): { terms: Term[]; total: number } {
  return { terms, total: sumTerms(terms) }
}

export function getActionPanelDigest(state: CombatState): string {
  return JSON.stringify(getActionPanel(state))
}
